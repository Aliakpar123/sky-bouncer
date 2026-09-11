// PointsClaim — the bridge from off-chain points to on-chain Jettons.
//
// Points are earned by walking and by catching bonuses, both of which are
// judged off-chain: no contract can verify that someone took 8,000 steps or
// stood in a cafe. So the backend decides who may claim what and signs a
// permit; this contract's job is to make that signature the *only* way value
// leaves, and to bound the damage if the signing key is ever stolen.
//
// The bounds matter more than the happy path. A leaked key with no ceiling
// mints the supply in one transaction; with these, an attacker is limited to
// maxPerClaim per permit and dailyMintCap per day, which buys time to notice
// and rotate.
import "@stdlib/tvm-dicts"


const ERROR_EXPIRED = 101;
const ERROR_NONCE_USED = 102;
const ERROR_BAD_SIGNATURE = 103;
const ERROR_ABOVE_PER_CLAIM_CAP = 104;
const ERROR_ABOVE_DAILY_CAP = 105;
const ERROR_NOT_ADMIN = 106;
const ERROR_INSUFFICIENT_VALUE = 107;

// TEP-74 internal_transfer, used to move Jettons out of this contract's own
// Jetton wallet to the claimer.
const OP_JETTON_TRANSFER = 0xf8a7ea5;

const SECONDS_PER_DAY = 86400;

// Forwarded with the Jetton transfer to pay for its onward messages. The
// claimer's message must carry at least this much plus a margin for our own
// storage and gas.
const JETTON_TRANSFER_VALUE = ton("0.05");
const MIN_CLAIM_VALUE = ton("0.1");

// Settings that change rarely. Held in a ref because the whole of storage
// would otherwise exceed a cell's 1023 bits — two addresses alone are 534.
struct Config {
    // May rotate the key and adjust the caps.
    admin: address,
    // This contract's Jetton wallet, holding the distributable supply.
    jettonWallet: address,
    // Ceiling for a single claim.
    maxPerClaim: coins,
    // Ceiling for everything claimed within one rolling day.
    dailyCap: coins,
}

struct Storage {
    // Ed25519 public key whose signature authorises a claim.
    backendPublicKey: uint256,
    claimedToday: coins,
    dayStartedAt: uint32,
    // Nonces already spent, so a permit cannot be replayed.
    usedNonces: dict,
    config: Cell<Config>,
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData())
}

fun Storage.save(self) {
    contract.setData(self.toCell())
}

// The claimer forwards a permit the backend signed for them.
struct (0x50434c4d) Claim {
    queryId: uint64,
    amount: coins,
    nonce: uint64,
    validUntil: uint32,
    signature: bits512,
}

struct (0x41444d31) RotateKey {
    queryId: uint64,
    newPublicKey: uint256,
}

struct (0x41444d32) SetCaps {
    queryId: uint64,
    maxPerClaim: coins,
    dailyCap: coins,
}

/**
 * The bytes the backend signs. The recipient is bound into the payload, so a
 * permit intercepted in transit cannot be redeemed by anyone else.
 */
fun buildPermit(amount: coins, nonce: uint64, validUntil: uint32, recipient: address): cell {
    return beginCell()
        .storeCoins(amount)
        .storeUint(nonce, 64)
        .storeUint(validUntil, 32)
        .storeAddress(recipient)
        .endCell()
}

fun onInternalMessage(in: InMessage) {
    val op = in.body.remainingBitsCount() >= 32
        ? in.body.preloadUint(32)
        : 0;

    if (op == 0) {
        // Plain top-up, so the contract can be funded for gas.
        return;
    }

    var st = Storage.load();

    if (op == 0x50434c4d) {
        val msg = lazy Claim.fromSlice(in.body);

        assert (blockchain.now() < msg.validUntil) throw ERROR_EXPIRED;
        assert (in.valueCoins >= MIN_CLAIM_VALUE) throw ERROR_INSUFFICIENT_VALUE;

        val (_, nonceFound) = st.usedNonces.uDictGet(64, msg.nonce);
        assert (!nonceFound) throw ERROR_NONCE_USED;

        val permit = buildPermit(msg.amount, msg.nonce, msg.validUntil, in.senderAddress);
        assert (
            isSignatureValid(permit.hash(), msg.signature as slice, st.backendPublicKey)
        ) throw ERROR_BAD_SIGNATURE;

        val cfg = st.config.load();
        assert (msg.amount <= cfg.maxPerClaim) throw ERROR_ABOVE_PER_CLAIM_CAP;

        // Roll the daily window forward before testing the cap, so a quiet
        // day does not leave yesterday's total blocking today's claims.
        var claimedToday = st.claimedToday;
        var dayStartedAt = st.dayStartedAt;
        if (blockchain.now() - dayStartedAt >= SECONDS_PER_DAY) {
            claimedToday = 0;
            dayStartedAt = blockchain.now() as uint32;
        }
        assert (claimedToday + msg.amount <= cfg.dailyCap) throw ERROR_ABOVE_DAILY_CAP;

        // Burn the nonce and bank the amount before sending: the send is the
        // last thing that happens, so a failure downstream cannot leave the
        // permit reusable.
        st.usedNonces.uDictSet(64, msg.nonce, beginCell().endCell().beginParse());
        st.claimedToday = claimedToday + msg.amount;
        st.dayStartedAt = dayStartedAt;
        st.save();

        val transferBody = beginCell()
            .storeUint(OP_JETTON_TRANSFER, 32)
            .storeUint(msg.queryId, 64)
            .storeCoins(msg.amount)
            .storeAddress(in.senderAddress)   // destination
            .storeAddress(in.senderAddress)   // response_destination
            .storeMaybeRef(null)              // custom_payload
            .storeCoins(1)                    // forward_ton_amount
            .storeBool(false)                 // forward_payload, inline empty
            .endCell();

        createMessage({
            bounce: true,
            dest: cfg.jettonWallet,
            value: JETTON_TRANSFER_VALUE,
            body: transferBody,
        }).send(SEND_MODE_REGULAR);
        return;
    }

    if (op == 0x41444d31) {
        val msg = lazy RotateKey.fromSlice(in.body);
        val cfg = st.config.load();
        assert (in.senderAddress == cfg.admin) throw ERROR_NOT_ADMIN;
        st.backendPublicKey = msg.newPublicKey;
        st.save();
        return;
    }

    if (op == 0x41444d32) {
        val msg = lazy SetCaps.fromSlice(in.body);
        var cfg = st.config.load();
        assert (in.senderAddress == cfg.admin) throw ERROR_NOT_ADMIN;
        cfg.maxPerClaim = msg.maxPerClaim;
        cfg.dailyCap = msg.dailyCap;
        st.config = cfg.toCell();
        st.save();
        return;
    }

    throw 0xffff;
}

get fun claimState(): (uint256, address, coins, coins, coins, uint32) {
    val st = Storage.load();
    val cfg = st.config.load();
    return (
        st.backendPublicKey,
        cfg.jettonWallet,
        cfg.maxPerClaim,
        cfg.dailyCap,
        st.claimedToday,
        st.dayStartedAt
    )
}

get fun isNonceUsed(nonce: uint64): bool {
    val st = Storage.load();
    val (_, found) = st.usedNonces.uDictGet(64, nonce);
    return found
}
