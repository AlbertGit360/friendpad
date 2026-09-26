// SIMULATED economy. Everything in this file lives in the browser (localStorage) and never touches the chain.
import { ECON, STORAGE_KEY, weightMultiplier, DEFAULT_TAX, TAX_PRESETS, type TaxConfig } from './config.js';
import type { Collection } from './chain.js';

export type HolderKind = 'you' | 'yourFriend' | 'bot' | 'botFriend';

export interface FriendRef {
  collection: Collection;
  tokenId: string;
  gen: number; // 0 temp, 1..6, genesis → 1
  weightRF: number;
  tba?: string; // resolved from chain (tokenBoundAccount)
  owner?: string;
  verified?: boolean; // tba recomputed on-chain and matched the holder wallet
}

export interface Holder {
  key: string; // stable id: wallet address (lowercase) | F:<collection>:<tokenId> | bot:<n>
  kind: HolderKind;
  label: string;
  addr: string; // display address (may be unresolved for Friend wallets until chain read completes)
  friend?: FriendRef;
}

export interface Trade { t: number; key: string; side: 'buy' | 'sell'; tokens: number; weth: number; price: number; bot: boolean; creatorBuy?: boolean }

export interface DivState {
  acc: number; // RF per unit of weight (dividends-per-share accumulator)
  totalWeight: number;
  weight: Record<string, number>;
  debt: Record<string, number>;
  pending: Record<string, number>; // settled but unclaimed RF
  claimed: Record<string, number>;
  undistributed: number; // RF waiting for the first eligible Friend holder
  distributed: number; // total RF credited to holders
}

export interface Token {
  id: string;
  name: string;
  ticker: string;
  desc: string;
  createdAt: number;
  creator: FriendRef;
  creatorKey: string; // F:<collection>:<tokenId>
  launchedBy?: string; // human owner address at launch (display only)
  genAtLaunch: number;
  gen: number; // current drawing generation (promotion re-renders sharper)
  src: string; // base64 gray SRC×SRC buffer
  srcRGB?: string; // base64 RGB SRC×SRC×3 buffer — Genesis colour tier only
  invert: boolean;
  minDivBalance: number;
  reserveWeth: number;
  sold: number;
  balances: Record<string, number>;
  trades: Trade[];
  /** Creator-set tax, fixed at launch (read-only afterwards). Missing on tokens saved before per-token taxes → DEFAULT_TAX. */
  tax?: TaxConfig;
  /** Per-token tax accounting */
  burnedRF?: number;
  platformWeth?: number;
  creatorFeesWeth: number;
  creatorClaimedWeth: number;
  volumeWeth: number;
  div: DivState;
  seeded?: boolean;
  /** Seed data version; seeded tokens from older versions are re-created (see migrate). */
  seedV?: number;
  /** Optional creator buy at launch: tokens bought (untaxed) into the creator Friend's wallet, optionally locked. */
  creatorBuy?: { weth: number; tokens: number; lockedUntil: number; lockDays: number };
}
export const SEED_VERSION = 3;

export interface Economy {
  rfBurnedLaunch: number;
  rfToDividendPoolsFromLaunch: number;
  rfBurnedBuyback: number;
  platformWeth: number;
  launches: number;
}

export interface State {
  version: 1;
  tokens: Record<string, Token>;
  order: string[];
  holders: Record<string, Holder>;
  wallets: Record<string, { weth: number; rf: number }>; // simulated balances
  econ: Economy;
  nonce: number;
}

// ---------------- persistence ----------------
let state: State;
const subs: (() => void)[] = [];
export function subscribe(f: () => void) { subs.push(f); }
let saveTimer = 0;
export function commit() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
  }, 150);
  subs.forEach(f => f());
}
export function getState() { return state; }
export function load(seed: () => State): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const s = JSON.parse(raw); if (s?.version === 1) { state = s; migrate(s); return state; } }
  } catch { /* ignore */ }
  state = seed();
  commit();
  return state;
}
/** Upgrade states saved before per-token taxes: seeded tokens get their demo configs, others the old default. */
const SEED_TAX: Record<string, TaxConfig> = {
  TOAST: DEFAULT_TAX, ROCK: TAX_PRESETS['burn-heavy'], BOO: TAX_PRESETS['dividend-heavy'], WICK: TAX_PRESETS['no tax'],
  CROWN: { buy: 0.01, sell: 0.02, alloc: { dividends: 0.5, creator: 0.3, burn: 0.2 } },
};
function migrate(s: State) {
  for (const id of [...s.order]) {
    const t = s.tokens[id];
    if (t.seeded && (t.seedV ?? 1) < SEED_VERSION) { // seeded by an older version → drop; seeds.ensureSeeds() re-creates it
      delete s.tokens[id];
      s.order = s.order.filter(x => x !== id);
      continue;
    }
    if (!t.tax) {
      t.tax = DEFAULT_TAX;
      // history before the migration was taxed with the old global 0.4/0.3/0.2/0.1 split
      t.burnedRF ??= t.volumeWeth * 0.002 * ECON.rfPerWeth;
      t.platformWeth ??= t.volumeWeth * 0.001;
    }
  }
}
export const seedTax = (ticker: string) => SEED_TAX[ticker];
export function taxOf(t: Token): TaxConfig { return t.tax ?? DEFAULT_TAX; }

export function reset(seed: () => State) {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  state = seed();
  commit();
}
export function emptyState(): State {
  return {
    version: 1, tokens: {}, order: [], holders: {}, wallets: {}, nonce: 1,
    econ: { rfBurnedLaunch: 0, rfToDividendPoolsFromLaunch: 0, rfBurnedBuyback: 0, platformWeth: 0, launches: 0 },
  };
}
export function useState(s: State) { state = s; }

export function friendKey(c: Collection, id: string) { return `F:${c}:${id}`; }
export function wallet(key: string) { return (state.wallets[key] ??= { weth: 0, rf: 0 }); }
export function ensureHolder(h: Holder): Holder {
  const cur = state.holders[h.key];
  if (!cur) { state.holders[h.key] = h; return h; }
  // merge newer info (e.g. resolved tba / verification)
  if (h.friend) cur.friend = { ...cur.friend, ...h.friend };
  if (h.addr && !h.addr.startsWith('F:')) cur.addr = h.addr;
  if (h.kind === 'yourFriend' || h.kind === 'you') { cur.kind = h.kind; cur.label = h.label; }
  return cur;
}

// ---------------- bonding curve ----------------
const K = ECON.virtualWeth * ECON.virtualTokens;
export function spotPrice(t: Token) {
  const x = ECON.virtualWeth + t.reserveWeth, y = ECON.virtualTokens - t.sold;
  return x / y;
}
export function marketCapWeth(t: Token) { return spotPrice(t) * ECON.totalSupply; }
export function curveProgress(t: Token) { return Math.min(1, t.reserveWeth / ECON.graduationWeth); }
export function quoteBuy(t: Token, wethIn: number) {
  const tax = wethIn * (taxOf(t).buy + ECON.platformFee);
  const net = wethIn - tax;
  const x = ECON.virtualWeth + t.reserveWeth, y = ECON.virtualTokens - t.sold;
  let out = y - K / (x + net);
  out = Math.min(out, ECON.curveSupply - t.sold);
  return { tokens: Math.max(0, out), tax, net };
}
export function quoteSell(t: Token, tokensIn: number) {
  const x = ECON.virtualWeth + t.reserveWeth, y = ECON.virtualTokens - t.sold;
  const gross = Math.min(t.reserveWeth, x - K / (y + tokensIn));
  const tax = gross * (taxOf(t).sell + ECON.platformFee);
  return { weth: Math.max(0, gross - tax), gross, tax };
}

// ---------------- dividends (Friends only) ----------------
function eligibleWeight(t: Token, key: string): number {
  const h = state.holders[key];
  const bal = t.balances[key] ?? 0;
  if (!h?.friend || h.friend.verified === false) return 0;
  if (!(h.friend.weightRF > 0)) return 0; // only ACTIVATED Friends (on-chain reward weight > 0) earn
  if (bal < t.minDivBalance) return 0;
  return bal * weightMultiplier(h.friend.weightRF);
}
function settle(t: Token, key: string) {
  const d = t.div;
  const w = d.weight[key] ?? 0;
  const owed = w * d.acc - (d.debt[key] ?? 0);
  if (owed > 1e-12) d.pending[key] = (d.pending[key] ?? 0) + owed;
  d.debt[key] = w * d.acc;
}
export function refreshWeight(t: Token, key: string) {
  const d = t.div;
  settle(t, key);
  const nw = eligibleWeight(t, key);
  d.totalWeight += nw - (d.weight[key] ?? 0);
  if (nw > 0) d.weight[key] = nw; else delete d.weight[key];
  d.debt[key] = nw * d.acc;
  if (d.totalWeight > 1e-9 && d.undistributed > 0) {
    d.acc += d.undistributed / d.totalWeight;
    d.distributed += d.undistributed;
    d.undistributed = 0;
  }
}
function distribute(t: Token, rf: number) {
  const d = t.div;
  if (d.totalWeight > 1e-9) { d.acc += rf / d.totalWeight; d.distributed += rf; } else d.undistributed += rf;
}
export function claimableDividends(t: Token, key: string) {
  const d = t.div;
  const w = d.weight[key] ?? 0;
  return (d.pending[key] ?? 0) + Math.max(0, w * d.acc - (d.debt[key] ?? 0));
}
export function claimDividends(t: Token, key: string): number {
  settle(t, key);
  const amt = t.div.pending[key] ?? 0;
  t.div.pending[key] = 0;
  t.div.claimed[key] = (t.div.claimed[key] ?? 0) + amt;
  wallet(key).rf += amt; // RF lands in the Friend's own wallet (like ActivationManager.claim)
  return amt;
}

// ---------------- tax ----------------
/** Where one trade's tax goes, using the token's own config. Platform fee is on top of the creator tax. */
export function taxBreakdown(t: Token, volume: number, side: 'buy' | 'sell') {
  const c = taxOf(t);
  const creatorTax = volume * (side === 'buy' ? c.buy : c.sell);
  return {
    creatorTax,
    divRF: creatorTax * c.alloc.dividends * ECON.rfPerWeth,
    creatorWeth: creatorTax * c.alloc.creator,
    burnRF: creatorTax * c.alloc.burn * ECON.rfPerWeth,
    platformWeth: volume * ECON.platformFee,
  };
}
function applyTax(t: Token, volume: number, side: 'buy' | 'sell') {
  const b = taxBreakdown(t, volume, side);
  const creator = b.creatorWeth, burnRF = b.burnRF, platform = b.platformWeth;
  if (b.divRF > 0) distribute(t, b.divRF);
  t.burnedRF = (t.burnedRF ?? 0) + burnRF;
  t.platformWeth = (t.platformWeth ?? 0) + platform;
  t.creatorFeesWeth += creator;
  wallet(t.creatorKey).weth += creator; // accrues inside the creator Friend's wallet
  state.econ.rfBurnedBuyback += burnRF;
  state.econ.platformWeth += platform;
}

// ---------------- trading ----------------
export function buy(t: Token, key: string, wethIn: number, bot = false, at = Date.now(), payer = key): Trade | null {
  const w = wallet(payer);
  if (!bot && w.weth < wethIn - 1e-12) throw new Error('Not enough simulated WETH');
  const q = quoteBuy(t, wethIn);
  if (q.tokens <= 0) return null;
  if (!bot) w.weth -= wethIn;
  t.reserveWeth += q.net;
  t.sold += q.tokens;
  t.balances[key] = (t.balances[key] ?? 0) + q.tokens;
  applyTax(t, wethIn, 'buy');
  t.volumeWeth += wethIn;
  refreshWeight(t, key);
  const tr: Trade = { t: at, key, side: 'buy', tokens: q.tokens, weth: wethIn, price: spotPrice(t), bot };
  pushTrade(t, tr);
  return tr;
}
/** Creator-buy tokens still locked in the creator Friend's wallet. */
export function lockedAmount(t: Token, key: string, now = Date.now()) {
  const cb = t.creatorBuy;
  return cb && key === t.creatorKey && now < cb.lockedUntil ? cb.tokens : 0;
}
export function lockDaysLeft(t: Token, now = Date.now()) {
  const cb = t.creatorBuy;
  return cb && now < cb.lockedUntil ? Math.ceil((cb.lockedUntil - now) / 86_400_000) : 0;
}
/** Balance the holder can sell or move out right now. */
export function unlockedBalance(t: Token, key: string, now = Date.now()) {
  return Math.max(0, (t.balances[key] ?? 0) - lockedAmount(t, key, now));
}
/** WETH needed on a fresh curve to buy `tokens` (no tax) — used for the creator-buy cap. */
export function wethForTokensFresh(tokens: number) {
  return K / (ECON.virtualTokens - tokens) - ECON.virtualWeth;
}
export function creatorBuyMaxWeth() { return wethForTokensFresh(ECON.totalSupply * ECON.creatorBuyMaxShare); }
export function quoteCreatorBuy(wethIn: number) {
  const x = ECON.virtualWeth, y = ECON.virtualTokens;
  return Math.max(0, y - K / (x + wethIn));
}
/**
 * Optional creator buy: executed atomically right after creation as the FIRST trade on the curve, untaxed.
 * Tokens go straight into the creator Friend's wallet (earning Friend dividends like any Friend holding).
 */
export function creatorBuy(t: Token, wethIn: number, payer: string | null, lockDays: number, at = t.createdAt): Trade | null {
  if (t.trades.length || t.sold > 0) throw new Error('Creator buy must be the first trade');
  wethIn = Math.min(wethIn, creatorBuyMaxWeth());
  if (!(wethIn > 0)) return null;
  if (payer) {
    const w = wallet(payer);
    if (w.weth < wethIn - 1e-12) throw new Error('Not enough simulated WETH for the creator buy');
    w.weth -= wethIn;
  }
  const tokens = quoteCreatorBuy(wethIn);
  t.reserveWeth += wethIn;
  t.sold += tokens;
  t.balances[t.creatorKey] = (t.balances[t.creatorKey] ?? 0) + tokens;
  t.volumeWeth += wethIn;
  t.creatorBuy = { weth: wethIn, tokens, lockDays, lockedUntil: lockDays > 0 ? at + lockDays * 86_400_000 : 0 };
  refreshWeight(t, t.creatorKey);
  const tr: Trade = { t: at, key: t.creatorKey, side: 'buy', tokens, weth: wethIn, price: spotPrice(t), bot: !payer, creatorBuy: true };
  pushTrade(t, tr);
  return tr;
}

export function sell(t: Token, key: string, tokensIn: number, bot = false, at = Date.now(), recipient = key): Trade | null {
  const bal = t.balances[key] ?? 0;
  tokensIn = Math.min(tokensIn, unlockedBalance(t, key, at));
  if (tokensIn <= 0) return null;
  const q = quoteSell(t, tokensIn);
  t.reserveWeth -= q.gross;
  t.sold -= tokensIn;
  t.balances[key] = bal - tokensIn;
  if (t.balances[key] < 1e-6) delete t.balances[key];
  if (!bot) wallet(recipient).weth += q.weth;
  applyTax(t, q.gross, 'sell');
  t.volumeWeth += q.gross;
  refreshWeight(t, key);
  const tr: Trade = { t: at, key, side: 'sell', tokens: tokensIn, weth: q.weth, price: spotPrice(t), bot };
  pushTrade(t, tr);
  return tr;
}
/** Move tokens between two holders of the same human (wallet → Friend wallet, or back). */
export function move(t: Token, from: string, to: string, amount: number) {
  const bal = t.balances[from] ?? 0;
  amount = Math.min(amount, unlockedBalance(t, from));
  if (amount <= 0) return;
  t.balances[from] = bal - amount;
  if (t.balances[from] < 1e-6) delete t.balances[from];
  t.balances[to] = (t.balances[to] ?? 0) + amount;
  refreshWeight(t, from);
  refreshWeight(t, to);
}
function pushTrade(t: Token, tr: Trade) {
  t.trades.push(tr);
  if (t.trades.length > 500) t.trades.splice(0, t.trades.length - 500);
}

// ---------------- launch ----------------
export interface LaunchInput {
  name: string; ticker: string; desc: string; creator: FriendRef; launchedBy?: string;
  src: string; srcRGB?: string; invert: boolean; minDivBalance?: number; tax?: TaxConfig; createdAt?: number; seeded?: boolean;
}
export function launch(inp: LaunchInput): Token {
  const id = `t${state.nonce++}`;
  const creatorKey = friendKey(inp.creator.collection, inp.creator.tokenId);
  // Drawing tier: 0 = Genesis (colour, 128×128), 1…6 = Generations
  const gen = inp.creator.collection === 'genesis' ? 0 : (inp.creator.gen || 6);
  const t: Token = {
    id, name: inp.name, ticker: inp.ticker.toUpperCase(), desc: inp.desc, createdAt: inp.createdAt ?? Date.now(),
    creator: inp.creator, creatorKey, launchedBy: inp.launchedBy, genAtLaunch: gen, gen,
    src: inp.src, srcRGB: inp.creator.collection === 'genesis' ? inp.srcRGB : undefined, invert: inp.invert, minDivBalance: inp.minDivBalance ?? ECON.defaultMinDividendBalance,
    tax: structuredClone(inp.tax ?? DEFAULT_TAX), burnedRF: 0, platformWeth: 0,
    reserveWeth: 0, sold: 0, balances: {}, trades: [], creatorFeesWeth: 0, creatorClaimedWeth: 0, volumeWeth: 0,
    div: { acc: 0, totalWeight: 0, weight: {}, debt: {}, pending: {}, claimed: {}, undistributed: 0, distributed: 0 },
    seeded: inp.seeded, seedV: inp.seeded ? SEED_VERSION : undefined,
  };
  // Proof of Burn: launch fee in RF, half burned, half seeds this token's Friend-dividend pool.
  const burn = ECON.launchFeeRF * ECON.launchBurnShare;
  state.econ.rfBurnedLaunch += burn;
  state.econ.rfToDividendPoolsFromLaunch += ECON.launchFeeRF - burn;
  t.div.undistributed += ECON.launchFeeRF - burn;
  state.econ.launches++;
  state.tokens[id] = t;
  state.order.unshift(id);
  return t;
}

export function promote(t: Token) {
  if (t.gen > 1) t.gen--;
}

// ---------------- derived views ----------------
export function holdersSorted(t: Token) {
  return Object.entries(t.balances).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
}
export function circulating(t: Token) { return t.sold; }

export interface LeaderRow { key: string; creatorWeth: number; dividendsRF: number; tokens: number }
export function leaderboard(): LeaderRow[] {
  const rows = new Map<string, LeaderRow>();
  const row = (k: string) => { if (!rows.has(k)) rows.set(k, { key: k, creatorWeth: 0, dividendsRF: 0, tokens: 0 }); return rows.get(k)!; };
  for (const id of state.order) {
    const t = state.tokens[id];
    const r = row(t.creatorKey); r.creatorWeth += t.creatorFeesWeth; r.tokens++;
    const keys = new Set([...Object.keys(t.div.weight), ...Object.keys(t.div.pending), ...Object.keys(t.div.claimed)]);
    for (const k of keys) {
      if (!k.startsWith('F:')) continue;
      row(k).dividendsRF += claimableDividends(t, k) + (t.div.claimed[k] ?? 0);
    }
  }
  return [...rows.values()].sort((a, b) => (b.creatorWeth * ECON.rfPerWeth + b.dividendsRF) - (a.creatorWeth * ECON.rfPerWeth + a.dividendsRF));
}

export function economyTotals() {
  let creatorWeth = 0, dividendsRF = 0, dividendsClaimedRF = 0, volume = 0, pooled = 0, burnedTax = 0, platform = 0;
  for (const id of state.order) {
    const t = state.tokens[id];
    creatorWeth += t.creatorFeesWeth;
    dividendsRF += t.div.distributed;
    pooled += t.div.undistributed;
    dividendsClaimedRF += Object.values(t.div.claimed).reduce((a, b) => a + b, 0);
    volume += t.volumeWeth;
    burnedTax += t.burnedRF ?? 0;
    platform += t.platformWeth ?? 0;
  }
  const launches = state.order.length, burn = ECON.launchFeeRF * ECON.launchBurnShare;
  return { ...state.econ, launches, rfBurnedLaunch: launches * burn, rfToDividendPoolsFromLaunch: launches * (ECON.launchFeeRF - burn), rfBurnedBuyback: burnedTax, platformWeth: platform, creatorWeth, dividendsRF, dividendsClaimedRF, volume, pooled };
}
