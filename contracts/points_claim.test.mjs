// Behavioural tests for PointsClaim, run against a local TVM emulator.
//
// The point of these is the abuse cases: forged permits, replays, a permit
// redeemed by the wrong wallet, and the ceilings that bound a stolen signing
// key. The happy path is the easy part.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Blockchain } from '@ton/sandbox';
import { Cell, beginCell, contractAddress, toNano, Address } from '@ton/core';
import { sign, keyPairFromSeed } from '@ton/crypto';

const OP_CLAIM = 0x50434c4d;
const OP_ROTATE_KEY = 0x41444d31;
const OP_SET_CAPS = 0x41444d32;

const ERROR_EXPIRED = 101;
const ERROR_NONCE_USED = 102;
const ERROR_BAD_SIGNATURE = 103;
const ERROR_ABOVE_PER_CLAIM_CAP = 104;
const ERROR_ABOVE_DAILY_CAP = 105;
const ERROR_NOT_ADMIN = 106;
const ERROR_INSUFFICIENT_VALUE = 107;

const { boc } = JSON.parse(fs.readFileSync('build/points_claim.compiled.json', 'utf8'));
const CODE = Cell.fromBase64(boc);

const backendKeys = keyPairFromSeed(Buffer.alloc(32, 7));
const attackerKeys = keyPairFromSeed(Buffer.alloc(32, 9));

function buildConfig({ admin, jettonWallet, maxPerClaim, dailyCap }) {
  return beginCell()
    .storeAddress(admin)
    .storeAddress(jettonWallet)
    .storeCoins(maxPerClaim)
    .storeCoins(dailyCap)
    .endCell();
}

function buildData({ publicKey, config, claimedToday = 0n, dayStartedAt = 0 }) {
  return beginCell()
    .storeUint(BigInt('0x' + publicKey.toString('hex')), 256)
    .storeCoins(claimedToday)
    .storeUint(dayStartedAt, 32)
    .storeDict(null)
    .storeRef(config)
    .endCell();
}

/** Mirrors buildPermit() in the contract; the recipient is part of the signed bytes. */
function signPermit({ amount, nonce, validUntil, recipient }, secretKey = backendKeys.secretKey) {
  const permit = beginCell()
    .storeCoins(amount)
    .storeUint(nonce, 64)
    .storeUint(validUntil, 32)
    .storeAddress(recipient)
    .endCell();
  return sign(permit.hash(), secretKey);
}

function claimBody({ queryId = 1n, amount, nonce, validUntil, signature }) {
  return beginCell()
    .storeUint(OP_CLAIM, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeUint(nonce, 64)
    .storeUint(validUntil, 32)
    .storeBuffer(signature)
    .endCell();
}

async function setup({ maxPerClaim = toNano('100'), dailyCap = toNano('1000') } = {}) {
  const blockchain = await Blockchain.create();
  blockchain.now = Math.floor(Date.now() / 1000);

  const admin = await blockchain.treasury('admin');
  const claimer = await blockchain.treasury('claimer');
  const outsider = await blockchain.treasury('outsider');
  // Stands in for the contract's Jetton wallet: we assert on the message sent
  // to it rather than re-testing a TEP-74 implementation.
  const jettonWallet = await blockchain.treasury('jettonWallet');

  const config = buildConfig({
    admin: admin.address,
    jettonWallet: jettonWallet.address,
    maxPerClaim,
    dailyCap,
  });
  const data = buildData({ publicKey: backendKeys.publicKey, config });
  const address = contractAddress(0, { code: CODE, data });

  await blockchain.setShardAccount(
    address,
    (await import('@ton/sandbox')).createShardAccount({
      address,
      code: CODE,
      data,
      balance: toNano('10'),
      workchain: 0,
    })
  );

  const validUntil = blockchain.now + 3600;

  async function claim(from, overrides = {}) {
    const params = {
      amount: toNano('10'),
      nonce: 1n,
      validUntil,
      recipient: from.address,
      ...overrides,
    };
    const signature =
      overrides.signature ??
      signPermit(params, overrides.secretKey ?? backendKeys.secretKey);

    return from.send({
      to: address,
      value: overrides.value ?? toNano('0.2'),
      body: claimBody({ ...params, signature }),
    });
  }

  return { blockchain, admin, claimer, outsider, jettonWallet, address, validUntil, claim };
}

function exitCodes(result, to) {
  return result.transactions
    .filter((tx) => tx.inMessage?.info?.dest?.equals?.(to))
    .map((tx) => tx.description?.computePhase?.exitCode);
}

test('a correctly signed permit sends the Jetton transfer to the claimer', async () => {
  const { claimer, jettonWallet, address, claim } = await setup();
  const result = await claim(claimer);

  assert.deepEqual(exitCodes(result, address), [0]);

  const forwarded = result.transactions.find((tx) =>
    tx.inMessage?.info?.dest?.equals?.(jettonWallet.address)
  );
  assert.ok(forwarded, 'expected a message to the jetton wallet');

  const body = forwarded.inMessage.body.beginParse();
  assert.equal(body.loadUint(32), 0xf8a7ea5, 'TEP-74 transfer op');
  body.loadUint(64); // queryId
  assert.equal(body.loadCoins(), toNano('10'));
  assert.ok(body.loadAddress().equals(claimer.address), 'destination is the claimer');
});

test('a permit signed by the wrong key is rejected', async () => {
  const { claimer, address, claim } = await setup();
  const result = await claim(claimer, { secretKey: attackerKeys.secretKey });
  assert.deepEqual(exitCodes(result, address), [ERROR_BAD_SIGNATURE]);
});

test('a permit cannot be redeemed by a different wallet', async () => {
  const { claimer, outsider, address, validUntil } = await setup();

  // Signed for the claimer, sent by someone who intercepted it.
  const signature = signPermit({
    amount: toNano('10'),
    nonce: 5n,
    validUntil,
    recipient: claimer.address,
  });

  const result = await outsider.send({
    to: address,
    value: toNano('0.2'),
    body: claimBody({ amount: toNano('10'), nonce: 5n, validUntil, signature }),
  });

  assert.deepEqual(exitCodes(result, address), [ERROR_BAD_SIGNATURE]);
});

test('a nonce cannot be replayed', async () => {
  const { claimer, address, claim } = await setup();

  const first = await claim(claimer, { nonce: 42n });
  assert.deepEqual(exitCodes(first, address), [0]);

  const replay = await claim(claimer, { nonce: 42n });
  assert.deepEqual(exitCodes(replay, address), [ERROR_NONCE_USED]);
});

test('an expired permit is rejected', async () => {
  const { blockchain, claimer, address, claim } = await setup();
  const validUntil = blockchain.now - 1;
  const result = await claim(claimer, { validUntil });
  assert.deepEqual(exitCodes(result, address), [ERROR_EXPIRED]);
});

test('a claim above the per-claim ceiling is rejected', async () => {
  const { claimer, address, claim } = await setup({ maxPerClaim: toNano('50') });
  const result = await claim(claimer, { amount: toNano('51'), nonce: 7n });
  assert.deepEqual(exitCodes(result, address), [ERROR_ABOVE_PER_CLAIM_CAP]);
});

test('the daily cap bounds what a stolen key can drain in one day', async () => {
  const { claimer, address, claim } = await setup({
    maxPerClaim: toNano('60'),
    dailyCap: toNano('100'),
  });

  assert.deepEqual(exitCodes(await claim(claimer, { amount: toNano('60'), nonce: 1n }), address), [0]);
  // 60 + 60 would exceed the daily 100 even though each is under the per-claim cap.
  assert.deepEqual(
    exitCodes(await claim(claimer, { amount: toNano('60'), nonce: 2n }), address),
    [ERROR_ABOVE_DAILY_CAP]
  );
  // Something that still fits is allowed.
  assert.deepEqual(exitCodes(await claim(claimer, { amount: toNano('40'), nonce: 3n }), address), [0]);
});

test('the daily window rolls over, it does not block the next day', async () => {
  const { blockchain, claimer, address, claim } = await setup({
    maxPerClaim: toNano('60'),
    dailyCap: toNano('100'),
  });

  assert.deepEqual(exitCodes(await claim(claimer, { amount: toNano('60'), nonce: 1n }), address), [0]);

  blockchain.now += 86400 + 60;
  const validUntil = blockchain.now + 3600;
  assert.deepEqual(
    exitCodes(await claim(claimer, { amount: toNano('60'), nonce: 2n, validUntil }), address),
    [0]
  );
});

test('a claim that underpays for gas is rejected', async () => {
  const { claimer, address, claim } = await setup();
  const result = await claim(claimer, { value: toNano('0.05'), nonce: 9n });
  assert.deepEqual(exitCodes(result, address), [ERROR_INSUFFICIENT_VALUE]);
});

test('only the admin can rotate the signing key', async () => {
  const { admin, outsider, address, claimer, validUntil } = await setup();

  const rotate = (from, key) =>
    from.send({
      to: address,
      value: toNano('0.1'),
      body: beginCell()
        .storeUint(OP_ROTATE_KEY, 32)
        .storeUint(1n, 64)
        .storeUint(BigInt('0x' + key.toString('hex')), 256)
        .endCell(),
    });

  assert.deepEqual(
    exitCodes(await rotate(outsider, attackerKeys.publicKey), address),
    [ERROR_NOT_ADMIN]
  );

  assert.deepEqual(exitCodes(await rotate(admin, attackerKeys.publicKey), address), [0]);

  // After rotation the old key no longer authorises anything.
  const signature = signPermit({
    amount: toNano('10'),
    nonce: 11n,
    validUntil,
    recipient: claimer.address,
  });
  const afterRotation = await claimer.send({
    to: address,
    value: toNano('0.2'),
    body: claimBody({ amount: toNano('10'), nonce: 11n, validUntil, signature }),
  });
  assert.deepEqual(exitCodes(afterRotation, address), [ERROR_BAD_SIGNATURE]);
});

test('only the admin can change the caps', async () => {
  const { admin, outsider, address } = await setup();

  const setCaps = (from) =>
    from.send({
      to: address,
      value: toNano('0.1'),
      body: beginCell()
        .storeUint(OP_SET_CAPS, 32)
        .storeUint(1n, 64)
        .storeCoins(toNano('5'))
        .storeCoins(toNano('25'))
        .endCell(),
    });

  assert.deepEqual(exitCodes(await setCaps(outsider), address), [ERROR_NOT_ADMIN]);
  assert.deepEqual(exitCodes(await setCaps(admin), address), [0]);
});

test('an unknown opcode is rejected rather than silently accepted', async () => {
  const { outsider, address } = await setup();
  const result = await outsider.send({
    to: address,
    value: toNano('0.1'),
    body: beginCell().storeUint(0xdeadbeef, 32).endCell(),
  });
  assert.deepEqual(exitCodes(result, address), [0xffff]);
});

test('a plain transfer tops the contract up without doing anything else', async () => {
  const { outsider, address } = await setup();
  const result = await outsider.send({ to: address, value: toNano('1'), body: beginCell().endCell() });
  assert.deepEqual(exitCodes(result, address), [0]);
  assert.equal(
    result.transactions.filter((tx) => tx.outMessagesCount > 0 && tx.inMessage?.info?.dest?.equals?.(address))
      .length,
    0,
    'a top-up must not send anything'
  );
});
