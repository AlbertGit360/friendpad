// Real on-chain reads (Robinhood Chain) + wallet connection. Never sends transactions, never asks for signatures.
import { createPublicClient, http, parseAbi, defineChain, getAddress } from 'viem';
import { ADDR, CHAIN } from './config.js';

export const robinhood = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [CHAIN.rpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: CHAIN.explorer } },
  contracts: { multicall3: { address: ADDR.multicall3 } },
});

// Reads are aggregated through Multicall3: one eth_call per batch instead of hundreds of JSON-RPC requests,
// which the public RPC rate-limits (a wallet with ~200 Friends used to fail most calls).
export const client = createPublicClient({ chain: robinhood, batch: { multicall: { batchSize: 4096, wait: 16 } }, transport: http(CHAIN.rpc, { retryCount: 4, retryDelay: 400 }) });

/** tokenURI returns ~50 KB of SVG per Friend, too large to aggregate: read it without Multicall. */
const uriClient = createPublicClient({ chain: robinhood, transport: http(CHAIN.rpc, { retryCount: 4, retryDelay: 400 }) });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

export type Collection = 'generations' | 'genesis';

export interface Friend {
  collection: Collection;
  tokenId: string;
  owner: string | null;
  /** 0 = temporary (not hardwired), 1..6 = generation. Genesis Friends are reported as 0 here with collection='genesis'. */
  generation: number;
  tier: number;
  /** On-chain reward weight from ActivationManager.positions, in RF (18 decimals). */
  weightRF: number;
  /** weight > 0 → activated / earning. */
  active: boolean;
  state: string; // from tokenURI attributes (Temporary / Active / ...)
  character: string;
  tba: string;
  tbaDeployed: boolean;
  image: string; // data: URI from tokenURI
}

export function collectionAddress(c: Collection): string {
  return c === 'genesis' ? ADDR.genesis : ADDR.generations;
}

export function genLabel(f: Pick<Friend, 'collection' | 'generation'>): string {
  if (f.collection === 'genesis') return 'Genesis';
  return f.generation === 0 ? 'Temporary' : `Gen-${f.generation}`;
}

// ---------- tokenURI / metadata ----------
interface Meta { image?: string; attributes?: { trait_type: string; value: unknown }[] }

function parseTokenURI(uri: string): Meta {
  try {
    if (uri.startsWith('data:application/json;base64,')) return JSON.parse(atob(uri.slice(29)));
    if (uri.startsWith('data:application/json')) return JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
  } catch { /* ignore */ }
  return {};
}
function attr(m: Meta, k: string): unknown {
  return m.attributes?.find(a => a.trait_type === k)?.value;
}

function isHomeScene(image?: string): boolean {
  if (!image?.startsWith('data:image/svg+xml;base64,')) return false;
  try { const svg = atob(image.slice(26)); return svg.includes('id="landscape"') || svg.includes('A Rare Friend at home'); } catch { return false; }
}

const friendCache = new Map<string, Promise<Friend>>();

/** Read everything Friendpad needs about one Friend, straight from the chain. */
export function readFriend(collection: Collection, tokenId: string | bigint, prefetchedMeta?: Meta): Promise<Friend> {
  const key = `${collection}:${tokenId}`;
  if (!friendCache.has(key)) {
    const p = readFriendUncached(collection, BigInt(tokenId), prefetchedMeta);
    p.catch(() => friendCache.delete(key));
    friendCache.set(key, p);
  }
  return friendCache.get(key)!;
}

async function readFriendUncached(collection: Collection, id: bigint, meta?: Meta): Promise<Friend> {
  const coll = collectionAddress(collection) as `0x${string}`;
  const tbaP: Promise<string> = collection === 'generations'
    ? client.readContract({ address: coll, abi: generationsAbi, functionName: 'tokenBoundAccount', args: [id] })
    : client.readContract({ address: ADDR.registry6551, abi: registryAbi, functionName: 'account',
        args: [ADDR.tbaImplementation, '0x' + '0'.repeat(64), BigInt(CHAIN.id), coll, id] });
  const [owner, gen, pos, tba, uri] = await Promise.all([
    client.readContract({ address: coll, abi: generationsAbi, functionName: 'ownerOf', args: [id] }).catch(() => null),
    collection === 'generations'
      ? client.readContract({ address: coll, abi: generationsAbi, functionName: 'generation', args: [id] })
      : Promise.resolve(0),
    client.readContract({ address: ADDR.activationManager, abi: activationAbi, functionName: 'positions', args: [coll, id] }),
    tbaP,
    uriClient.readContract({ address: coll, abi: generationsAbi, functionName: 'tokenURI', args: [id] }).catch(() => ''),
  ]);
  // Always use the live tokenURI: indexer metadata can be stale (e.g. still shows the temporary sprite after hardwire).
  let m: Meta = parseTokenURI(uri as string);
  if (!m.image && meta?.image) m = meta;
  // Hardwired Friends' tokenURI is a whole isometric scene ("A Rare Friend at home") where the character is tiny;
  // cards use the canonical character sprite from the FriendSDK sprite registry instead.
  if (collection === 'generations' && isHomeScene(m.image)) {
    const portrait = await import('./sprites.js').then(s => s.portraitDataURL(id.toString())).catch(() => '');
    if (portrait) m = { ...m, image: portrait };
  }
  const code: string | undefined = await client.getCode({ address: tba }).catch(() => undefined);
  const weight = BigInt((pos as any)[1] ?? 0n);
  return {
    collection,
    tokenId: id.toString(),
    owner: owner ? getAddress(owner as string) : null,
    generation: Number(gen),
    tier: Number((pos as any)[0] ?? 0),
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
export async function verifyFriendWallet(collection: Collection, tokenId: string, holder: string): Promise<boolean> {
  const f = await readFriend(collection, tokenId);
  return f.tba.toLowerCase() === holder.toLowerCase();
}

// ---------- Friends by owner ----------
/** Lists Friends owned by `owner`: Blockscout NFT index (the collection is not enumerable) + temporaryFriend() fallback. */
export async function listFriendIds(owner: string): Promise<{ collection: Collection; tokenId: string; meta?: Meta }[]> {
  const out: { collection: Collection; tokenId: string; meta?: Meta }[] = [];
  const seen = new Set<string>();
  const push = (c: Collection, id: string, meta?: Meta) => {
    const k = `${c}:${id}`;
    if (!seen.has(k)) { seen.add(k); out.push({ collection: c, tokenId: id, meta }); }
  };
  try {
    let url: string | null = `${CHAIN.explorerApi}/addresses/${owner}/nft?type=ERC-721`;
    for (let page = 0; url && page < 30; page++) { // up to ~1500 NFTs
      const res: Response = await fetch(url);
      if (!res.ok) break;
      const j: any = await res.json();
      for (const it of j.items ?? []) {
        const addr = String(it.token?.address_hash ?? it.token?.address ?? '').toLowerCase();
        if (addr === ADDR.generations) push('generations', String(it.id), it.metadata ?? undefined);
        else if (addr === ADDR.genesis) push('genesis', String(it.id), it.metadata ?? undefined);
      }
      url = j.next_page_params ? `${CHAIN.explorerApi}/addresses/${owner}/nft?type=ERC-721&${new URLSearchParams(j.next_page_params)}` : null;
    }
  } catch (e) {
    console.warn('Blockscout NFT index unavailable, using on-chain fallback', e);
  }
  try {
    const temp = await client.readContract({ address: ADDR.generations, abi: generationsAbi, functionName: 'temporaryFriend', args: [owner] });
    if (BigInt(temp) > 0n) push('generations', BigInt(temp).toString());
  } catch { /* ignore */ }
  return out;
}

export async function rfBalance(addr: string): Promise<number> {
  try {
    const b = await client.readContract({ address: ADDR.rf, abi: erc20Abi, functionName: 'balanceOf', args: [addr] });
    return Number(b) / 1e18;
  } catch { return NaN; }
}

// ---------- Wallet (address only) ----------
type Listener = (addr: string | null) => void;
const listeners: Listener[] = [];
let account: string | null = null;
export function getAccount() { return account; }
export function onAccount(l: Listener) { listeners.push(l); }
function setAccount(a: string | null) {
  account = a ? getAddress(a) : null;
  try { if (account) localStorage.setItem('friendpad.lastAccount', '1'); else localStorage.removeItem('friendpad.lastAccount'); } catch { /* ignore */ }
  listeners.forEach(l => l(account));
}
export function hasInjectedWallet(): boolean { return !!(window as any).ethereum; }

export async function connectWallet(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('No injected wallet found. Install MetaMask or Rabby.');
  const accs: string[] = await eth.request({ method: 'eth_requestAccounts' });
  setAccount(accs[0] ?? null);
  return account;
}
export function disconnectWallet() { setAccount(null); }

/** Optional convenience: add/switch Robinhood Chain in the wallet (not a transaction, no signature). */
export async function addRobinhoodChain() {
  const eth = (window as any).ethereum;
  if (!eth) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hexId }] });
  } catch (e: any) {
    if (e?.code === 4902 || /Unrecognized|not been added/i.test(String(e?.message))) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CHAIN.hexId, chainName: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency,
        rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer],
      }] });
    } else throw e;
  }
}

export async function restoreWallet() {
  const eth = (window as any).ethereum;
  if (!eth) return;
  eth.on?.('accountsChanged', (a: string[]) => setAccount(a[0] ?? null));
  let had = false;
  try { had = !!localStorage.getItem('friendpad.lastAccount'); } catch { /* ignore */ }
  if (had) {
    const accs: string[] = await eth.request({ method: 'eth_accounts' }).catch(() => []);
    if (accs[0]) setAccount(accs[0]);
  }
}

/**
 * Cheap pass over ALL of a wallet's Friends: generation + activation only (no tokenURI, no wallet lookup), via explicit Multicall3 chunks.
 * Full details are then read with readFriend() for the activated ones only.
 * Failed reads are retried and never reported as "temporary" or "not activated"; unreadable Friends are returned in `failed`.
 */
export async function readFriendsLite(items: { collection: Collection; tokenId: string }[], onProgress?: (done: number, total: number) => void): Promise<{ friends: Friend[]; failed: number }> {
  const out: Friend[] = [];
  const CHUNK = 100;
  let failed = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    let todo = items.slice(i, i + CHUNK);
    for (let attempt = 0; attempt < 4 && todo.length; attempt++) {
      if (attempt) await sleep(500 * 2 ** attempt);
      const contracts = todo.flatMap(it => {
        const coll = collectionAddress(it.collection) as `0x${string}`;
        const id = BigInt(it.tokenId);
        return [
          { address: coll, abi: generationsAbi, functionName: 'generation', args: [id] },
          { address: ADDR.activationManager, abi: activationAbi, functionName: 'positions', args: [coll, id] },
        ] as const;
      });
      let res: { status: 'success' | 'failure'; result?: unknown }[];
      try { res = await client.multicall({ contracts: contracts as any, allowFailure: true }) as any; } catch { continue; }
      const retry: typeof todo = [];
      todo.forEach((it, j) => {
        const g = res[2 * j], p = res[2 * j + 1];
        const genOk = it.collection === 'genesis' || g.status === 'success';
        if (!genOk || p.status !== 'success') { retry.push(it); return; }
        const gen = it.collection === 'generations' ? Number(g.result) : 0;
        const pos = p.result as readonly [number, bigint];
        const weight = BigInt(pos[1] ?? 0n);
        out.push({
          collection: it.collection, tokenId: it.tokenId, owner: null, generation: gen, tier: Number(pos[0] ?? 0),
          weightRF: Number(weight) / 1e18, active: weight > 0n,
          state: it.collection === 'generations' && gen === 0 ? 'Temporary' : weight > 0n ? 'Activated' : 'Hardwired',
          character: '', tba: '', tbaDeployed: false, image: '',
        });
      });
      todo = retry;
    }
    failed += todo.length;
    onProgress?.(Math.min(items.length, i + CHUNK), items.length);
  }
  return { friends: out, failed };
}
