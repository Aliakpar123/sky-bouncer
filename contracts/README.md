# Pulse Radar contracts

`PointsClaim` — the bridge from off-chain points to on-chain Jettons.

```bash
npm install
npm test     # compiles the contract, then runs it on a local TVM emulator
```

## Why a signed permit rather than on-chain logic

Points come from walking and from catching bonuses at venues. Neither is
verifiable on-chain: no contract can tell whether someone actually took 8,000
steps or stood inside a cafe. The backend is the only party that can judge
that, so it decides who may claim what and signs a permit. The contract's job
is narrower and checkable — make that signature the only way value leaves.

The signed payload is `(amount, nonce, validUntil, recipient)`. The recipient
is inside it, so a permit captured in transit cannot be redeemed by another
wallet; the nonce is spent on use, so it cannot be replayed; `validUntil`
bounds how long a leaked permit stays worth anything.

## Why the ceilings exist

The signing key is the single point of failure — whoever holds it can author
permits. The ceilings decide what that costs:

- `maxPerClaim` caps one permit.
- `dailyCap` caps everything claimed in a rolling 24h window, and the window
  rolls forward rather than resetting at midnight, so a quiet day does not
  leave yesterday's total blocking today.
- `RotateKey` lets the admin replace the key without redeploying.

Without these, a stolen key drains the distributable supply in one
transaction. With them, an attacker is limited to the daily cap, which is the
difference between an incident and a write-off.

## What it does not do

It is not a Jetton implementation. It holds a Jetton wallet and sends TEP-74
`internal_transfer` messages to it, so the token itself is a standard minter
deployed separately. The tests assert on the message sent to that wallet
rather than re-testing someone else's standard.

## Language

Written in Tolk 1.4. Tact, which earlier versions of this plan assumed, is
deprecated upstream — its npm package now says so and points at Tolk.

## Deployment (not yet done)

Nothing here has touched a network, testnet included. Before it does:

1. Deploy a standard TEP-74 Jetton minter and mint the distributable supply
   to a wallet this contract will own.
2. Deploy `PointsClaim` with that wallet address, the backend public key, and
   caps sized to the float you are willing to lose on a bad day.
3. Test the whole path on testnet with a real wallet before mainnet.

The backend half — deducting points and signing the permit — is not built
yet; see the repository README.
