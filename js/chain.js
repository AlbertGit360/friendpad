// Real on-chain reads (Robinhood Chain) + wallet connection. Never sends transactions, never asks for signatures.
import { createPublicClient, http, parseAbi, defineChain, getAddress } from 'viem';
import { ADDR, CHAIN } from './config.js';
export const robinhood = defineChain({
    id: CHAIN.id,
    name: CHAIN.name,
    nativeCurrency: CHAIN.nativeCurrency,
    rpcUrls: { default: { http: [CHAIN.rpc] } },
    blockExplorers: { default: { name: 'Blockscout', url: CHAIN.explorer } },
});
export const client = createPublicClient({ chain: robinhood, transport: http(CHAIN.rpc, { batch: { batchSize: 40, wait: 20 } }) });
export const generationsAbi = parseAbi([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function generation(uint256 tokenId) view returns (uint8)',
    'function tokenBoundAccount(uint256 tokenId) view returns (address)',
    'function temporaryFriend(address holder) view returns (uint256)',
    'function totalMinted() view returns (uint256)',
]);
export const activationAbi = parseAbi([
    'function positions(address collection, uint256 tokenId) view returns (uint8 tier, uint256 weight)',
    'function earned(address asset, address collection, uint256 tokenId) view returns (uint256)',
]);
export const registryAbi = parseAbi([
    'function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) view returns (address)',
]);
export const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
]);
export const tbaAbi = parseAbi([
    'function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)',
    'function owner() view returns (address)',
    'function state() view returns (uint256)',
]);
export function collectionAddress(c) {
    return c === 'genesis' ? ADDR.genesis : ADDR.generations;
}
export function genLabel(f) {
    if (f.collection === 'genesis')
        return 'Genesis';
    return f.generation === 0 ? 'Temporary' : `Gen-${f.generation}`;
}
function parseTokenURI(uri) {
    try {
        if (uri.startsWith('data:application/json;base64,'))
            return JSON.parse(atob(uri.slice(29)));
        if (uri.startsWith('data:application/json'))
            return JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
    }
    catch { /* ignore */ }
    return {};
}
function attr(m, k) {
    return m.attributes?.find(a => a.trait_type === k)?.value;
}
const friendCache = new Map();
/** Read everything Friendpad needs about one Friend, straight from the chain. */
export function readFriend(collection, tokenId, prefetchedMeta) {
    const key = `${collection}:${tokenId}`;
    if (!friendCache.has(key)) {
        const p = readFriendUncached(collection, BigInt(tokenId), prefetchedMeta);
        p.catch(() => friendCache.delete(key));
        friendCache.set(key, p);
    }
    return friendCache.get(key);
}
async function readFriendUncached(collection, id, meta) {
    const coll = collectionAddress(collection);
    const tbaP = collection === 'generations'
        ? client.readContract({ address: coll, abi: generationsAbi, functionName: 'tokenBoundAccount', args: [id] })
        : client.readContract({ address: ADDR.registry6551, abi: registryAbi, functionName: 'account',
            args: [ADDR.tbaImplementation, '0x' + '0'.repeat(64), BigInt(CHAIN.id), coll, id] });
    const [owner, gen, pos, tba, uri] = await Promise.all([
        client.readContract({ address: coll, abi: generationsAbi, functionName: 'ownerOf', args: [id] }).catch(() => null),
        collection === 'generations'
            ? client.readContract({ address: coll, abi: generationsAbi, functionName: 'generation', args: [id] }).catch(() => 0)
            : Promise.resolve(0),
        client.readContract({ address: ADDR.activationManager, abi: activationAbi, functionName: 'positions', args: [coll, id] }).catch(() => [0, 0n]),
        tbaP,
        client.readContract({ address: coll, abi: generationsAbi, functionName: 'tokenURI', args: [id] }).catch(() => ''),
    ]);
    // Always use the live tokenURI: indexer metadata can be stale (e.g. still shows the temporary sprite after hardwire).
    let m = parseTokenURI(uri);
    if (!m.image && meta?.image)
        m = meta;
    const code = await client.getCode({ address: tba }).catch(() => undefined);
    const weight = BigInt(pos[1] ?? 0n);
    return {
        collection,
        tokenId: id.toString(),
        owner: owner ? getAddress(owner) : null,
        generation: Number(gen),
        tier: Number(pos[0] ?? 0),
        weightRF: Number(weight) / 1e18,
        active: weight > 0n,
        state: collection === 'generations' && Number(gen) === 0 ? 'Temporary' : weight > 0n ? 'Activated' : 'Hardwired',
        character: String(attr(m, 'Character') ?? ''),
        tba: getAddress(tba),
        tbaDeployed: !!code && code !== '0x',
        image: m.image ?? '',
    };
}
/** Recompute a Friend wallet address from tokenId and compare. Never trust `token()` of an arbitrary holder. */
export async function verifyFriendWallet(collection, tokenId, holder) {
    const f = await readFriend(collection, tokenId);
    return f.tba.toLowerCase() === holder.toLowerCase();
}
// ---------- Friends by owner ----------
/** Lists Friends owned by `owner`: Blockscout NFT index (the collection is not enumerable) + temporaryFriend() fallback. */
export async function listFriendIds(owner) {
    const out = [];
    const seen = new Set();
    const push = (c, id, meta) => {
        const k = `${c}:${id}`;
        if (!seen.has(k)) {
            seen.add(k);
            out.push({ collection: c, tokenId: id, meta });
        }
    };
    try {
        let url = `${CHAIN.explorerApi}/addresses/${owner}/nft?type=ERC-721`;
        for (let page = 0; url && page < 30; page++) { // up to ~1500 NFTs
            const res = await fetch(url);
            if (!res.ok)
                break;
            const j = await res.json();
            for (const it of j.items ?? []) {
                const addr = String(it.token?.address_hash ?? it.token?.address ?? '').toLowerCase();
                if (addr === ADDR.generations)
                    push('generations', String(it.id), it.metadata ?? undefined);
                else if (addr === ADDR.genesis)
                    push('genesis', String(it.id), it.metadata ?? undefined);
            }
            url = j.next_page_params ? `${CHAIN.explorerApi}/addresses/${owner}/nft?type=ERC-721&${new URLSearchParams(j.next_page_params)}` : null;
        }
    }
    catch (e) {
        console.warn('Blockscout NFT index unavailable, using on-chain fallback', e);
    }
    try {
        const temp = await client.readContract({ address: ADDR.generations, abi: generationsAbi, functionName: 'temporaryFriend', args: [owner] });
        if (BigInt(temp) > 0n)
            push('generations', BigInt(temp).toString());
    }
    catch { /* ignore */ }
    return out;
}
export async function rfBalance(addr) {
    try {
        const b = await client.readContract({ address: ADDR.rf, abi: erc20Abi, functionName: 'balanceOf', args: [addr] });
        return Number(b) / 1e18;
    }
    catch {
        return NaN;
    }
}
const listeners = [];
let account = null;
export function getAccount() { return account; }
export function onAccount(l) { listeners.push(l); }
function setAccount(a) {
    account = a ? getAddress(a) : null;
    try {
        if (account)
            localStorage.setItem('friendpad.lastAccount', '1');
        else
            localStorage.removeItem('friendpad.lastAccount');
    }
    catch { /* ignore */ }
    listeners.forEach(l => l(account));
}
export function hasInjectedWallet() { return !!window.ethereum; }
export async function connectWallet() {
    const eth = window.ethereum;
    if (!eth)
        throw new Error('No injected wallet found. Install MetaMask or Rabby.');
    const accs = await eth.request({ method: 'eth_requestAccounts' });
    setAccount(accs[0] ?? null);
    return account;
}
export function disconnectWallet() { setAccount(null); }
/** Optional convenience: add/switch Robinhood Chain in the wallet (not a transaction, no signature). */
export async function addRobinhoodChain() {
    const eth = window.ethereum;
    if (!eth)
        return;
    try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hexId }] });
    }
    catch (e) {
        if (e?.code === 4902 || /Unrecognized|not been added/i.test(String(e?.message))) {
            await eth.request({ method: 'wallet_addEthereumChain', params: [{
                        chainId: CHAIN.hexId, chainName: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency,
                        rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer],
                    }] });
        }
        else
            throw e;
    }
}
export async function restoreWallet() {
    const eth = window.ethereum;
    if (!eth)
        return;
    eth.on?.('accountsChanged', (a) => setAccount(a[0] ?? null));
    let had = false;
    try {
        had = !!localStorage.getItem('friendpad.lastAccount');
    }
    catch { /* ignore */ }
    if (had) {
        const accs = await eth.request({ method: 'eth_accounts' }).catch(() => []);
        if (accs[0])
            setAccount(accs[0]);
    }
}
/**
 * Cheap read for large portfolios: generation + activation (tier, weight) only — no tokenURI (≈80 KB each), no wallet lookup.
 * Used to find the activated Friends among hundreds; full details are then read with readFriend() for those only.
 */
export async function readFriendsLite(items, onProgress) {
    const out = [];
    const CHUNK = 60;
    for (let i = 0; i < items.length; i += CHUNK) {
        const part = items.slice(i, i + CHUNK);
        const res = await Promise.all(part.map(async (it) => {
            const coll = collectionAddress(it.collection);
            const id = BigInt(it.tokenId);
            const [gen, pos] = await Promise.all([
                it.collection === 'generations'
                    ? client.readContract({ address: coll, abi: generationsAbi, functionName: 'generation', args: [id] }).catch(() => 0)
                    : Promise.resolve(0),
                client.readContract({ address: ADDR.activationManager, abi: activationAbi, functionName: 'positions', args: [coll, id] }).catch(() => [0, 0n]),
            ]);
            const weight = BigInt(pos[1] ?? 0n);
            const f = {
                collection: it.collection, tokenId: it.tokenId, owner: null, generation: Number(gen), tier: Number(pos[0] ?? 0),
                weightRF: Number(weight) / 1e18, active: weight > 0n,
                state: it.collection === 'generations' && Number(gen) === 0 ? 'Temporary' : weight > 0n ? 'Activated' : 'Hardwired',
                character: '', tba: '', tbaDeployed: false, image: '',
            };
            return f;
        }));
        out.push(...res);
        onProgress?.(Math.min(items.length, i + CHUNK), items.length);
    }
    return out;
}
