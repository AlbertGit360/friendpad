// Friendpad — UI. Real reads: wallet address, Friends, generation, tier, reward weight, Friend wallet, sprites.
// SIMULATED: everything economic (see sim.ts). No transactions, no signatures.
import * as chain from './chain.js';
import type { Friend, Collection } from './chain.js';
import * as sim from './sim.js';
import type { Token, FriendRef, Holder } from './sim.js';
import { ADDR, ECON, GRID_BY_GEN, GENESIS_GEN, GENESIS_PALETTE, tierName, weightMultiplier, DEFAULT_TAX, TAX_PRESETS, taxError, pct, type TaxConfig } from './config.js';
import { pixelize, bitsToDataURL, drawBits, toSources, bytesToB64, b64ToBytes, pixelizeColor, drawIndexed, indexedToDataURL } from './pixel.js';
import { buildSeedState, drawArt, SEED_FRIENDS, rng, BOT_COUNT, ensureSeeds } from './seeds.js';
import * as tx from './calldata.js';
import { $, $$, esc, short, fmt, fmtWeth, fmtPrice, ago, toast, reducedMotion, explorerAddr, explorerToken } from './util.js';
import { drawPriceChart } from './chart.js';
import { HolderWorld } from './holderworld.js';
import { readSprites } from './sprites.js';

const DEV = new URLSearchParams(location.search).has('dev');

// ---------------- session state ----------------
const S = {
  account: null as string | null,
  myFriends: [] as Friend[],
  friendsLoading: false,
  friendsError: '',
  friendsWarn: '',
  friendsProgress: '',
  friendsTab: 'earning' as 'earning' | 'not' | 'all',
  notShown: 60,
  lookup: null as Friend | null,
  lookupError: '',
};
const sprites = new Map<string, string>(); // friend key → image data URI
const spriteReq = new Set<string>();

const youKey = () => S.account?.toLowerCase() ?? '';
const app = () => $('#app')!;

// ---------------- helpers ----------------
function toRef(f: Friend): FriendRef {
  return {
    collection: f.collection, tokenId: f.tokenId,
    gen: f.collection === 'genesis' ? GENESIS_GEN : f.generation,
    weightRF: f.weightRF, tba: f.tba, owner: f.owner ?? undefined, verified: true,
  };
}
function drawGen(f: Friend) { return f.collection === 'genesis' ? GENESIS_GEN : f.generation; }
function canLaunch(f: Friend) { return !!f.tba && (DEV || (f.active && (f.collection === 'genesis' || f.generation > 0))); }

function requestSprite(collection: Collection, tokenId: string) {
  const k = sim.friendKey(collection, tokenId);
  if (sprites.has(k) || spriteReq.has(k)) return;
  spriteReq.add(k);
  chain.readFriend(collection, tokenId).then(f => {
    if (f.image) sprites.set(k, f.image);
    const st = sim.getState();
    if (st.holders[k]) {
      sim.ensureHolder({ ...st.holders[k], addr: f.tba, friend: { ...st.holders[k].friend!, tba: f.tba, owner: f.owner ?? undefined, weightRF: f.weightRF, gen: drawGen(f) || st.holders[k].friend!.gen, verified: true } });
    }
    for (const id of st.order) {
      const t = st.tokens[id];
      if (t.balances[k]) sim.refreshWeight(t, k);
      if (t.creatorKey === k) { t.creator.tba = f.tba; t.creator.owner = f.owner ?? undefined; t.creator.verified = true; }
    }
    scheduleSoftRender();
  }).catch(e => { console.warn('sprite read failed', k, e); spriteReq.delete(k); });
}

function friendSprite(collection: Collection, tokenId: string, cls = 'sprite') {
  const k = sim.friendKey(collection, tokenId);
  const src = sprites.get(k);
  if (!src) requestSprite(collection, tokenId);
  return src ? `<img class="${cls}" src="${src}" alt="Friend #${esc(tokenId)}" loading="lazy">` : `<span class="${cls} sprite-ph" aria-hidden="true"></span>`;
}

const artCache = new Map<string, string>();
function tokenArt(t: Token, gen = t.gen) {
  const k = `${t.id}:${gen}:${t.invert}`;
  if (!artCache.has(k)) {
    const grid = GRID_BY_GEN[gen] ?? 26;
    artCache.set(k, gen === 0 && t.srcRGB
      ? indexedToDataURL(pixelizeColor(b64ToBytes(t.srcRGB), grid, GENESIS_PALETTE), grid, GENESIS_PALETTE)
      : bitsToDataURL(pixelize(b64ToBytes(t.src), grid, { invert: t.invert }), grid));
  }
  return artCache.get(k)!;
}

export function holderInfo(key: string): { label: string; kind: string; friend?: FriendRef; addr: string } {
  const h = sim.getState().holders[key];
  if (key === youKey()) return { label: 'You', kind: 'you', addr: S.account ?? key };
  if (!h) return { label: short(key), kind: 'bot', addr: key };
  if (h.friend) {
    const mine = S.myFriends.some(f => sim.friendKey(f.collection, f.tokenId) === key);
    return { label: `Friend #${h.friend.tokenId}${mine ? ' (yours)' : ''}`, kind: mine ? 'yourFriend' : h.kind, friend: h.friend, addr: h.friend.tba ?? h.addr };
  }
  return { label: h.label, kind: h.kind, addr: h.addr };
}

function genBadge(gen: number, collection: Collection = 'generations') {
  const label = collection === 'genesis' ? 'Genesis' : gen === 0 ? 'Temp' : `Gen-${gen}`;
  return `<span class="badge gen g${collection === 'genesis' ? 'G' : gen}">${label}</span>`;
}
const SIM = `<span class="sim" title="Simulated in your browser — not on-chain">simulated</span>`;

let softTimer = 0;
function scheduleSoftRender() {
  clearTimeout(softTimer);
  softTimer = window.setTimeout(() => softRender(), 60);
}

// ---------------- router ----------------
type Route = { name: string; args: string[] };
function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...args] = h.split('/').filter(Boolean);
  return { name: name || 'home', args };
}
let current: Route = parseRoute();
let cleanup: (() => void) | null = null;

function render() {
  cleanup?.(); cleanup = null;
  current = parseRoute();
  $$('.nav a').forEach(a => a.classList.toggle('on', a.getAttribute('data-r') === current.name));
  renderHeader();
  const v = current.name;
  if (v === 'home') viewHome();
  else if (v === 'friends') viewFriends();
  else if (v === 'launch') viewLaunch();
  else if (v === 'token') viewToken(current.args[0]);
  else if (v === 'economy') viewEconomy();
  else viewHome();
  window.scrollTo({ top: 0 });
  $('#app')?.focus({ preventScroll: true });
}
/** Re-render only what depends on async data (sprites, state) without destroying inputs. */
function softRender() {
  renderHeader();
  const v = current.name;
  if (v === 'home') viewHome(true);
  else if (v === 'friends') viewFriends();
  else if (v === 'economy') viewEconomy();
  else if (v === 'token') updateToken();
  else if (v === 'launch') updateLaunchFriends();
}

// ---------------- header ----------------
function renderHeader() {
  const w = $('#wallet')!;
  if (!chain.hasInjectedWallet() && !S.account) {
    w.innerHTML = `<span class="muted small">View-only · no wallet detected</span>`;
    return;
  }
  if (!S.account) {
    w.innerHTML = `<button class="btn primary" data-act="connect">Connect wallet</button>`;
    return;
  }
  const bal = sim.wallet(youKey());
  w.innerHTML = `
    <span class="chip" title="Simulated WETH balance for trading on Friendpad">${fmtWeth(bal.weth)} WETH ${SIM}</span>
    <button class="btn ghost small" data-act="faucet" title="Simulated faucet: +1 WETH" aria-label="Simulated faucet: +1 WETH">+1</button>
    <button class="btn ghost" data-act="disconnect" title="Disconnect (forget address)">${short(S.account)}</button>`;
}

// ---------------- HOME ----------------
function tokenCard(t: Token) {
  const holders = sim.holdersSorted(t).length;
  return `<a class="card token-card" href="#/token/${t.id}">
    <img class="art" src="${tokenArt(t)}" alt="${esc(t.name)} pixel art">
    <div class="tc-body">
      <div class="row between"><span class="row gap-s"><b>$${esc(t.ticker)}</b>${t.seeded ? '<span class="badge" title="Seeded demo token">seeded demo</span>' : ''}</span><span class="muted small">${ago(t.createdAt)} ago</span></div>
      <div class="muted ellipsis">${esc(t.name)}</div>
      <div class="row gap-s creator-line">${friendSprite(t.creator.collection, t.creator.tokenId, 'sprite sm')}<span class="small">by Friend #${esc(t.creator.tokenId)}</span>${genBadge(t.creator.gen, t.creator.collection)}</div>
      <div class="row between small"><span>mcap ${fmtWeth(sim.marketCapWeth(t))} WETH</span><span>${holders} holders</span></div>
      <div class="row gap-s small wrap">${taxLabel(t)}${lockBadge(t)}</div>
      <div class="bar" role="progressbar" aria-valuenow="${Math.round(sim.curveProgress(t) * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Bonding curve progress"><i style="width:${sim.curveProgress(t) * 100}%"></i></div>
    </div></a>`;
}

/** "Tax 1% / 2%" (creator buy / sell tax; platform fee is extra) + warning badge. */
function taxLabel(t: Token) {
  const c = sim.taxOf(t);
  const warn = [c.sell > c.buy ? 'sell tax > buy tax' : '', Math.max(c.buy, c.sell) > ECON.warnTax ? `tax above ${pct(ECON.warnTax, 0)}` : ''].filter(Boolean).join(' · ');
  return `<span class="muted" title="Creator-set buy / sell tax, fixed at launch. Platform fee ${pct(ECON.platformFee)} is charged on top.">Tax ${pct(c.buy)} / ${pct(c.sell)}</span>${warn ? `<span class="badge warnb" title="${warn}">⚠ ${warn}</span>` : ''}`;
}
function lockBadge(t: Token) {
  const d = sim.lockDaysLeft(t);
  return d > 0 ? `<span class="badge lockb" title="${fmt(t.creatorBuy!.tokens)} creator-buy tokens locked in the creator Friend's wallet until ${new Date(t.creatorBuy!.lockedUntil).toLocaleDateString()}">🔒 Creator locked ${d}d</span>` : '';
}
function allocText(c: TaxConfig) {
  return `${pct(c.alloc.dividends, 0)} Friend dividends · ${pct(c.alloc.creator, 0)} creator · ${pct(c.alloc.burn, 0)} burn`;
}

function viewHome(soft = false) {
  const st = sim.getState();
  const e = sim.economyTotals();
  const html = `
  <section class="hero">
    <h1>Every token is launched, drawn and held by a Rare Friend.</h1>
    <p class="muted">Friendpad is a memepad for the Rare Friends ecosystem. A Friend's own ERC-6551 wallet is the token creator; its generation decides how sharp the meme is drawn; Friend wallets that hold the token earn $RAREFRIENDS dividends.</p>
    <div class="row gap"><a class="btn primary" href="#/launch">Launch a token</a><a class="btn" href="#/friends">My Friends</a><a class="btn ghost" href="#/economy">Economy</a></div>
  </section>
  <section class="strip">
    ${stat('RF burned', fmt(e.rfBurnedLaunch + e.rfBurnedBuyback), 'launch fees + tax buybacks')}
    ${stat('RF to Friend holders', fmt(e.dividendsRF), 'dividends credited')}
    ${stat('WETH to creator Friends', fmtWeth(e.creatorWeth), 'accrued in Friend wallets')}
    ${stat('Volume', fmtWeth(e.volume) + ' WETH', `${st.order.length} tokens`)}
  </section>
  <p class="note">All balances, trades and fees are ${SIM} in your browser. Friends, generations, tiers, reward weights and Friend wallets are read live from Robinhood Chain.</p>
  <section><h2>Tokens</h2><div class="grid">${st.order.map(id => tokenCard(st.tokens[id])).join('')}</div></section>
  <section><h2>Friends leaderboard ${SIM}</h2>${leaderTable(8)}</section>`;
  if (soft && current.name !== 'home') return;
  app().innerHTML = html;
}

function stat(label: string, value: string, sub = '') {
  return `<div class="stat"><div class="muted small">${label}</div><div class="big">${value}</div><div class="muted small">${sub}</div></div>`;
}

function leaderTable(n = 20) {
  const rows = sim.leaderboard().slice(0, n);
  if (!rows.length) return `<p class="muted">No Friends earning yet.</p>`;
  const seeded = new Set(SEED_FRIENDS.map(f => sim.friendKey(f.collection, f.tokenId)));
  return `<p class="muted small">Sorted by total earned: creator fees (WETH, converted at the simulated ${fmt(ECON.rfPerWeth)} RF/WETH) + RF dividends. Only activated Friends earn dividends.</p>
  <table class="tbl"><thead><tr><th>#</th><th>Friend</th><th class="r">Creator fees (WETH)</th><th class="r">Dividends (RF)</th><th class="r">Tokens launched</th></tr></thead><tbody>
  ${rows.map((r, i) => {
    const [, c, id] = r.key.split(':');
    return `<tr><td>${i + 1}</td><td><span class="row gap-s">${friendSprite(c as Collection, id, 'sprite xs')} Friend #${esc(id)}${S.myFriends.some(f => f.tokenId === id && f.collection === c) ? ' <span class="badge you">yours</span>' : ''}${seeded.has(r.key) ? ' <span class="badge" title="Real Friend used as a simulated holder in seeded demo data">seeded demo</span>' : ''}</span></td>
    <td class="r">${fmtWeth(r.creatorWeth)}</td><td class="r">${fmt(r.dividendsRF)}</td><td class="r">${r.tokens}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// ---------------- ECONOMY ----------------
function viewEconomy() {
  const e = sim.economyTotals();
  const st = sim.getState();
  app().innerHTML = `
  <h1>Economy ${SIM}</h1>
  <p class="muted">Each token has its own buy and sell tax (0–${pct(ECON.maxTax, 0)}), set by its creator at launch and fixed afterwards. The creator allocates it between Friend dividends (RF), the creator Friend (WETH) and RF buyback & burn; dividends + burn must be at least ${pct(ECON.ecosystemFloor, 0)} of it. A fixed ${pct(ECON.platformFee)} platform fee is charged on top of every trade. Launches pay ${ECON.launchFeeRF} RF: ${ECON.launchBurnShare * 100}% is burned (<b>Proof of Burn</b>), the rest seeds that token's Friend-dividend pool — the same 50/50 burn-and-reward rule the Rare Friends ActivationManager applies to every RF payment.</p>
  <section class="strip">
    ${stat('RF burned at launch', fmt(e.rfBurnedLaunch), `${e.launches} launches × ${ECON.launchFeeRF * ECON.launchBurnShare} RF`)}
    ${stat('RF bought back & burned', fmt(e.rfBurnedBuyback), 'from token taxes')}
    ${stat('RF dividends to Friends', fmt(e.dividendsRF), `${fmt(e.rfToDividendPoolsFromLaunch)} RF seeded by launch fees · claimed ${fmt(e.dividendsClaimedRF)}${e.pooled > 0 ? ` · ${fmt(e.pooled)} RF waiting for a first eligible Friend holder` : ''}`)}
    ${stat('WETH to creator Friends', fmtWeth(e.creatorWeth), 'from token taxes')}
    ${stat('Platform', fmtWeth(e.platformWeth) + ' WETH', `fixed ${pct(ECON.platformFee)} of volume`)}
    ${stat('Volume', fmtWeth(e.volume) + ' WETH', `RF price ${SIM}: ${fmt(ECON.rfPerWeth)} RF/WETH`)}
  </section>
  <section><h2>Tax per token</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Creator</th><th class="r">Buy / sell</th><th>Allocation</th><th class="r">RF to Friends</th><th class="r">WETH to creator</th><th class="r">RF burned</th><th class="r">Platform</th></tr></thead><tbody>
    ${st.order.map(id => st.tokens[id]).map(t => { const c = sim.taxOf(t); return `<tr><td><a href="#/token/${t.id}">$${esc(t.ticker)}</a></td><td><span class="row gap-s">${friendSprite(t.creator.collection, t.creator.tokenId, 'sprite xs')} #${esc(t.creator.tokenId)}</span></td>
      <td class="r">${pct(c.buy)} / ${pct(c.sell)}</td><td class="small">${c.buy || c.sell ? allocText(c) : '<span class="muted">no creator tax</span>'}</td>
      <td class="r">${fmt(t.div.distributed)}</td><td class="r">${fmtWeth(t.creatorFeesWeth)}</td><td class="r">${fmt(t.burnedRF ?? 0)}</td><td class="r">${fmtWeth(t.platformWeth ?? 0)}</td></tr>`; }).join('')}
    </tbody></table></div>
  </section>
  <section><h2>Friends leaderboard</h2>${leaderTable(25)}</section>
  <section class="row gap"><button class="btn ghost" data-act="reset-sim">Reset simulation</button><span class="muted small">Clears local state and re-seeds the demo tokens.</span></section>`;
}

// ---------------- MY FRIENDS ----------------
function friendCard(f: Friend, mine: boolean) {
  const key = sim.friendKey(f.collection, f.tokenId);
  const w = sim.getState().wallets[key];
  const gen = drawGen(f);
  const inactive = !f.active;
  const created = sim.getState().order.map(id => sim.getState().tokens[id]).filter(t => t.creatorKey === key);
  if (f.image) sprites.set(key, f.image);
  return `<article class="card friend ${inactive ? 'inactive' : ''}">
    <a href="${explorerToken(chain.collectionAddress(f.collection), f.tokenId)}" target="_blank" rel="noopener">${f.image ? `<img class="sprite lg" src="${f.image}" alt="Friend #${esc(f.tokenId)}">` : `<span class="sprite lg sprite-ph"></span>`}</a>
    <div class="fbody">
      <div class="row between"><b>Friend #${esc(f.tokenId)}</b>${genBadge(f.generation, f.collection)}</div>
      <dl class="kv">
        <dt>Status</dt><dd>${f.active ? '<span class="ok">● earning</span>' : '<span class="muted">○ not activated</span>'} <span class="muted small">· ${esc(f.state.toLowerCase())}</span></dd>
        <dt>Tier</dt><dd>${f.active ? f.tier : '—'}</dd>
        <dt>Reward weight</dt><dd>${f.active ? fmt(f.weightRF) : '0'}${f.active ? `<br><span class="muted small">×${weightMultiplier(f.weightRF).toFixed(2)} dividend boost</span>` : ''}</dd>
        <dt>Wallet</dt><dd><a class="mono" href="${explorerAddr(f.tba)}" target="_blank" rel="noopener">${short(f.tba)}</a> ${f.tbaDeployed ? '<span class="ok small">deployed</span>' : '<span class="warn small">not deployed yet</span>'}</dd>
        ${!mine ? `<dt>Owner</dt><dd class="mono">${short(f.owner)}</dd>` : ''}
        ${w && (w.weth > 0 || w.rf > 0) ? `<dt>Balance</dt><dd>${fmtWeth(w.weth)} WETH · ${fmt(w.rf)} RF ${SIM}</dd>` : ''}
        ${created.length ? `<dt>Launched</dt><dd>${created.map(t => `<a href="#/token/${t.id}">$${esc(t.ticker)}</a>`).join(' ')}</dd>` : ''}
      </dl>
      <div class="row gap-s wrap">
        ${mine && canLaunch(f) ? `<a class="btn primary small" href="#/launch/${f.collection}/${f.tokenId}">Launch token</a>` : ''}
        ${mine && inactive ? `<a class="btn small" href="https://rarefriends.com/portfolio" target="_blank" rel="noopener">Activate on rarefriends.com ↗</a>` : ''}
        ${mine && w && w.weth > 1e-9 ? `<button class="btn small" data-act="claim-weth" data-k="${key}">Claim ${fmtWeth(w.weth)} WETH</button>` : ''}
        ${mine && w && w.rf > 1e-9 ? `<button class="btn small" data-act="withdraw-rf" data-k="${key}">Withdraw ${fmt(w.rf)} RF</button>` : ''}
      </div>
      ${mine && inactive ? `<p class="muted small">Only activated Friends can launch tokens.</p>` : ''}
    </div></article>`;
}

function viewFriends() {
  let body = '';
  if (!S.account) {
    body = chain.hasInjectedWallet()
      ? `<div class="empty"><p>Connect your wallet to see your Friends. Friendpad only reads your address — it never asks for a signature or sends a transaction.</p><button class="btn primary" data-act="connect">Connect wallet</button> <button class="btn ghost" data-act="add-chain">Add Robinhood Chain to wallet</button></div>`
      : `<div class="empty"><p>No injected wallet found (MetaMask / Rabby). You can still browse tokens and look up any Friend below.</p></div>`;
  } else if (S.friendsLoading) {
    body = `<p class="muted">${esc(S.friendsProgress || 'Reading your Friends from Robinhood Chain…')}</p>`;
  } else if (S.friendsError) {
    body = `<p class="warn">${esc(S.friendsError)}</p>`;
  } else if (!S.myFriends.length) {
    body = `<div class="empty"><p>No Friends found for ${short(S.account)}. Hold ≥1 RF to get a temporary Friend, then hardwire and activate it on <a href="https://rarefriends.com" target="_blank" rel="noopener">rarefriends.com</a>. If you know a tokenId you own, look it up below.</p></div>`;
  } else {
    const rank = (f: Friend) => (f.collection === 'genesis' ? 0 : f.generation || 9);
    const earning = S.myFriends.filter(f => f.active).sort((a, b) => rank(a) - rank(b) || b.weightRF - a.weightRF);
    const notE = S.myFriends.filter(f => !f.active).sort((a, b) => rank(a) - rank(b));
    const tab = S.friendsTab;
    const tabs = (S.friendsWarn ? `<p class="warn small">${esc(S.friendsWarn)}</p>` : '') + `<div class="ftabs" role="tablist">
      ${([['all', 'All', S.myFriends.length], ['earning', 'Earning', earning.length], ['not', 'Not earning', notE.length]] as const).map(([k, l, n]) => `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="ftab" data-t="${k}">${l} <span class="muted">${n}</span></button>`).join('')}
    </div>`;
    const showE = tab !== 'not', showN = tab !== 'earning';
    body = tabs
      + (showE ? (earning.length ? `<div class="grid friends">${earning.map(f => friendCard(f, true)).join('')}</div>` : '<p class="muted">No activated Friends yet. Activate one on rarefriends.com to launch tokens and earn dividends.</p>') : '')
      + (showN && notE.length ? `<h2>Not earning · ${notE.length}</h2><p class="muted small">Hardwired or temporary Friends without an activation. They can't launch tokens or earn Friend dividends until activated on <a href="https://rarefriends.com/portfolio" target="_blank" rel="noopener">rarefriends.com ↗</a>.</p>
          <div class="ftiles">${notE.slice(0, S.notShown).map(friendTile).join('')}</div>
          ${notE.length > S.notShown ? `<button class="btn ghost small" data-act="more-friends">Show ${Math.min(120, notE.length - S.notShown)} more (${notE.length - S.notShown} hidden)</button>` : ''}` : '');
  }
  const lk = S.lookup;
  const lookupOwned = lk && S.account && lk.owner?.toLowerCase() === youKey();
  const focused = document.activeElement?.id;
  const prevVal = ($('#lk-id') as HTMLInputElement | null)?.value ?? '';
  app().innerHTML = `
  <h1>My Friends</h1>
  <p class="muted">Read live from Robinhood Chain: ownership, generation, tier, reward weight (ActivationManager.positions) and each Friend's ERC-6551 wallet.</p>
  ${body}
  <section class="lookup">
    <h2>Look up a Friend by tokenId</h2>
    <form class="row gap-s wrap" data-form="lookup">
      <select id="lk-coll" aria-label="Collection"><option value="generations">Generations</option><option value="genesis">Genesis</option></select>
      <input id="lk-id" inputmode="numeric" placeholder="tokenId, e.g. 88135" aria-label="tokenId" value="${esc(prevVal)}">
      <button class="btn" type="submit">Read from chain</button>
    </form>
    ${S.lookupError ? `<p class="warn">${esc(S.lookupError)}</p>` : ''}
    ${lk ? `<div class="grid friends">${friendCard(lk, !!lookupOwned)}</div>${lookupOwned ? '' : '<p class="muted small">Not owned by the connected wallet — read-only.</p>'}` : ''}
  </section>`;
  if (focused === 'lk-id') ($('#lk-id') as HTMLInputElement).focus();
  loadThumbs(app());
}

async function loadMyFriends() {
  if (!S.account) { S.myFriends = []; softRender(); return; }
  const acct = S.account;
  S.friendsLoading = true; S.friendsError = ''; S.friendsWarn = ''; S.friendsProgress = 'Listing your Friends…'; softRender();
  try {
    const ids = await chain.listFriendIds(acct);
    if (S.account !== acct) return;
    // 1) cheap pass over ALL Friends: generation + activation only
    const { friends: lite, failed } = await chain.readFriendsLite(ids, (d, n) => { S.friendsProgress = `Reading activation status… ${d} / ${n}`; if (current.name === 'friends') viewFriends(); });
    if (S.account !== acct) return;
    // 2) full details (sprite, Friend wallet, deployed?, live ownerOf) only for activated Friends
    const act = lite.filter(f => f.active);
    S.friendsProgress = `Reading ${act.length} activated Friends…`; softRender();
    const full: PromiseSettledResult<Friend>[] = [];
    for (let i = 0; i < act.length; i += 4) { // small groups: each detail read includes a large tokenURI
      full.push(...await Promise.allSettled(act.slice(i, i + 4).map(f => chain.readFriend(f.collection, f.tokenId))));
      S.friendsProgress = `Reading activated Friends… ${full.length} / ${act.length}`; if (current.name === 'friends') viewFriends();
      if (S.account !== acct) return;
    }
    if (S.account !== acct) return;
    // a failed detail read keeps the Friend (with its real activation) instead of silently dropping it
    const actFull = full.flatMap((r, i) => r.status === 'fulfilled' ? (r.value.owner?.toLowerCase() === acct.toLowerCase() ? [r.value] : []) : [act[i]]);
    const detailFailed = full.filter(r => r.status === 'rejected').length;
    const inactive = lite.filter(f => !f.active);
    S.myFriends = [...actFull, ...inactive];
    if (failed || detailFailed) S.friendsWarn = `The public RPC did not answer for ${failed + detailFailed} Friend(s)${failed ? ` (${failed} not listed)` : ''}. Reload the page to retry.`;
    S.friendsTab = actFull.length ? 'earning' : 'all';
    for (const f of actFull) {
      const k = sim.friendKey(f.collection, f.tokenId);
      if (f.image) sprites.set(k, f.image);
      sim.ensureHolder({ key: k, kind: 'yourFriend', label: `Friend #${f.tokenId}`, addr: f.tba, friend: toRef(f) });
    }
    // refresh dividend weights with real reward weights (only Friends that already hold something matter)
    const st = sim.getState();
    for (const id of st.order) for (const f of S.myFriends) {
      const k = sim.friendKey(f.collection, f.tokenId);
      if (st.tokens[id].balances[k] || st.tokens[id].div.weight[k]) {
        if (!f.active && st.holders[k]?.friend) st.holders[k].friend!.weightRF = 0;
        sim.refreshWeight(st.tokens[id], k);
      }
    }
    sim.commit();
  } catch (e: any) {
    S.friendsError = `Could not read Friends: ${e?.shortMessage ?? e?.message ?? e}`;
  } finally {
    S.friendsLoading = false; S.friendsProgress = '';
    softRender();
  }
}

/** Canonical sprite (FriendSDK registry) as a small thumbnail — used for not-activated Friends instead of the 80 KB tokenURI. */
const thumbCache = new Map<string, string>();
function loadThumbs(root: ParentNode) {
  $$<HTMLImageElement>('img[data-thumb]', root).forEach(img => {
    const id = img.dataset.thumb!;
    if (thumbCache.has(id)) { img.src = thumbCache.get(id)!; return; }
    readSprites(id).then(sp => {
      const c = document.createElement('canvas'); c.width = c.height = 18;
      const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, 18, 18); g.drawImage(sp.clips.idle.down[0], 0, 0);
      const url = c.toDataURL(); thumbCache.set(id, url);
      $$<HTMLImageElement>(`img[data-thumb="${id}"]`).forEach(x => { x.src = url; });
    }).catch(() => { /* keep placeholder */ });
  });
}

function friendTile(f: Friend) {
  const thumb = f.collection === 'generations' && f.generation > 0;
  return `<a class="ftile" href="${explorerToken(chain.collectionAddress(f.collection), f.tokenId)}" target="_blank" rel="noopener" title="Not activated — activate on rarefriends.com to earn and launch">
    ${thumb ? `<img class="sprite sm" data-thumb="${esc(f.tokenId)}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">` : '<span class="sprite sm sprite-ph"></span>'}
    <span>#${esc(f.tokenId)}</span>${genBadge(f.generation, f.collection)}</a>`;
}

// ---------------- LAUNCH ----------------
const L = {
  friendKey: '' as string,
  gray: null as Uint8Array | null,
  previewGen: null as number | null,
  rgb: null as Uint8Array | null,
  tax: structuredClone(DEFAULT_TAX) as TaxConfig,
  cb: 0,
  invert: false,
  contrast: 1.15,
  sampleIdx: 0,
};
function launchFriends() { return S.myFriends.filter(f => canLaunch(f)); }
function selectedLaunchFriend(): Friend | null {
  const all = [...S.myFriends, ...(DEV && S.lookup ? [S.lookup] : [])];
  return all.find(f => sim.friendKey(f.collection, f.tokenId) === L.friendKey) ?? null;
}

function viewLaunch() {
  const [c, id] = current.args;
  if (c && id) L.friendKey = sim.friendKey(c as Collection, id);
  if (!S.account && !DEV) {
    app().innerHTML = `<h1>Launch a token</h1><div class="empty"><p>Launching needs your own wallet and an <b>activated</b> Friend. Friendpad only reads your address — no signatures, no transactions.</p>${chain.hasInjectedWallet() ? '<button class="btn primary" data-act="connect">Connect wallet</button>' : '<p class="muted">No injected wallet found.</p>'}</div>`;
    return;
  }
  app().innerHTML = `
  <h1>Launch a token</h1>
  <div class="launch">
    <div class="col">
      <h2>1 · Creator Friend</h2>
      <div id="lf-list" class="friend-pick"></div>
      <h2>2 · Meme image</h2>
      <label class="drop" id="drop" tabindex="0">
        <input type="file" id="file" accept="image/*" hidden>
        <span>Drop an image, paste it, or <u>choose a file</u></span>
      </label>
      <div class="row gap-s wrap"><span class="muted small">or try a sample:</span>
        <button class="btn ghost small" data-act="sample" data-s="toast">toast</button>
        <button class="btn ghost small" data-act="sample" data-s="ghost">ghost</button>
        <button class="btn ghost small" data-act="sample" data-s="rock">rock</button>
        <button class="btn ghost small" data-act="sample" data-s="candle">candle</button></div>
      <div class="row gap wrap controls">
        <label class="row gap-s"><input type="checkbox" id="inv" ${L.invert ? 'checked' : ''}> Invert</label>
        <label class="row gap-s">Contrast <input type="range" id="con" min="0.7" max="2" step="0.05" value="${L.contrast}"></label>
      </div>
      <h2>3 · Details</h2>
      <form data-form="launch" class="form">
        <label>Name <input id="f-name" maxlength="32" required placeholder="gm ghost"></label>
        <label>Ticker <input id="f-ticker" maxlength="10" required placeholder="BOO" autocomplete="off" aria-describedby="ticker-hint"><span id="ticker-hint" class="small muted">2–10 letters or digits, must be unique</span></label>
        <label>Description <textarea id="f-desc" maxlength="200" rows="2" placeholder="What is this meme about?"></textarea></label>

        <fieldset class="taxbox" aria-describedby="tax-err">
          <legend>Tax <span class="muted small">— fixed after launch</span></legend>
          <div class="row gap-s wrap"><span class="muted small">Presets:</span>${Object.keys(TAX_PRESETS).map(k => `<button type="button" class="btn ghost small" data-act="tax-preset" data-p="${k}">${k}</button>`).join('')}</div>
          <div class="taxrow"><label for="tx-buy">Buy tax</label><input id="tx-buy" type="range" min="0" max="${ECON.maxTax * 100}" step="0.1"><output id="tx-buy-o"></output></div>
          <div class="taxrow"><label for="tx-sell">Sell tax</label><input id="tx-sell" type="range" min="0" max="${ECON.maxTax * 100}" step="0.1"><output id="tx-sell-o"></output></div>
          <p class="muted small">Capped at ${pct(ECON.maxTax, 0)} each, so a token can never become a honeypot with a punitive sell tax.</p>
          <div class="alloc">
            <div class="alloc-title">Allocation of the tax</div>
            <div class="alloc-err" id="alloc-err" role="alert" hidden>⚠ Total allocation must be 100%</div>
            <div class="alloc-grid">
              <div class="donut-col">
                <svg id="alloc-donut" viewBox="0 0 120 120" role="img" aria-label="Tax allocation chart"></svg>
                <ul id="alloc-legend" class="alloc-legend small"></ul>
              </div>
              <div class="alloc-ctrl">
                <div class="alloc-top"><span id="tx-total" class="small"></span><button type="button" class="btn small" data-act="alloc-reset">Reset</button></div>
                ${ALLOC_ROWS.map(r => `<div class="arow">
                  <div class="arow-h"><label for="${r.id}">${r.label} <span class="muted small">(${r.hint})</span></label><span class="pctbox"><input id="${r.id}-n" type="number" min="0" max="100" step="1" inputmode="numeric" aria-label="${r.label} percent">%</span></div>
                  <input id="${r.id}" type="range" min="0" max="100" step="1" style="--c:${r.color}">
                  ${r.note ? `<div class="muted small">${r.note}</div>` : ''}
                </div>`).join('')}
              </div>
            </div>
          </div>
          <div class="minbal"><label class="minbal-l">Min. balance for Friend dividends <input id="f-min" type="text" inputmode="numeric" value="${ECON.defaultMinDividendBalance.toLocaleString('en-US')}" aria-describedby="min-hint"><span id="min-hint" class="small muted"></span></label><span class="muted small">Friend wallets holding less than this earn no dividends.</span></div>
          <p class="muted small"><b>Ecosystem floor:</b> Friend dividends + RF burn must be at least ${pct(ECON.ecosystemFloor, 0)} of the tax. Every taxed token keeps feeding Rare Friends holders and RF scarcity, so it can't be a pure creator cash machine. Dividends are always paid in RF, only to activated Friend wallets.</p>
          <p class="muted small">+ a fixed ${pct(ECON.platformFee)} platform fee on every trade, charged on top of your tax (not part of the 100%).</p>
          <p class="small" id="tx-example"></p>
          <p class="warn small" id="tax-err" role="alert"></p>
        </fieldset>
        <fieldset class="taxbox" aria-describedby="cb-err">
          <legend>Creator buy <span class="muted small">(optional)</span></legend>
          <p class="muted small">Buy your own token as the very first trade on the curve, atomically with creation and before any bot can trade. <b>No tax.</b> Tokens go straight into your creator Friend's wallet, so they earn RF dividends like any Friend holding. Max ${pct(ECON.creatorBuyMaxShare, 0)} of supply. Paid in WETH only.</p>
          <div class="taxrow"><label for="cb-amt">Amount (WETH)</label><input id="cb-amt" type="number" min="0" step="any" value="0" inputmode="decimal"><span></span></div>
          <p class="muted small" id="cb-bal"></p>
          <div class="row gap-s">${[25, 50, 75].map(v => `<button type="button" class="btn ghost small" data-act="cb-pct" data-v="${v}">${v}%</button>`).join('')}<button type="button" class="btn ghost small" data-act="cb-pct" data-v="100">MAX</button></div>
          <p class="small" id="cb-est"></p>
          <div class="taxrow"><label for="cb-lock">Lock</label><select id="cb-lock">${ECON.creatorLockDays.map(d => `<option value="${d}">${d ? `${d} day${d > 1 ? 's' : ''}` : 'none'}</option>`).join('')}</select><span></span></div>
          <p class="muted small">While locked, these tokens can't be sold from or moved out of the Friend wallet. Buyers see a “Creator locked Nd” badge.</p>
          <p class="warn small" id="cb-err" role="alert"></p>
        </fieldset>
        <div class="fee">
          <div class="row between"><span>Total</span><b id="fee-total">${ECON.launchFeeRF} RF launch fee</b></div>
          <div class="row between"><span>Launch fee</span><b>${ECON.launchFeeRF} RF ${SIM}</b></div>
          <div class="row between small"><span>🔥 Proof of Burn</span><span>${ECON.launchFeeRF * ECON.launchBurnShare} RF burned</span></div>
          <div class="row between small"><span>Friend-dividend pool</span><span>${ECON.launchFeeRF * (1 - ECON.launchBurnShare)} RF</span></div>
          <div class="row between small"><span>Token creator</span><span class="mono" id="creator-addr">—</span></div>
        </div>
        <button class="btn primary big" type="submit" id="launch-btn">Launch</button>
        <p class="muted small">No transaction is sent. In production the Friend wallet would call the Friendpad factory via <span class="mono">execute()</span>.</p>
      </form>
    </div>
    <div class="col">
      <h2>Preview</h2>
      <div class="preview"><canvas id="pv" width="384" height="384" aria-label="Pixelized preview"></canvas><div id="pv-cap" class="muted small"></div></div>
      <div class="gens" id="gens" role="group" aria-label="Compare generations"></div>
      <p class="muted small">The creator Friend's generation sets the grid: Gen-6 draws at ${GRID_BY_GEN[6]}×${GRID_BY_GEN[6]}, Gen-1 at ${GRID_BY_GEN[1]}×${GRID_BY_GEN[1]}. <span class="genesis-txt">Genesis</span> Friends draw at ${GRID_BY_GEN[0]}×${GRID_BY_GEN[0]} in colour. Click a tier to compare.</p>
    </div>
  </div>`;
  updateLaunchFriends();
  bindLaunch();
  renderPreview();
}

function updateLaunchFriends() {
  const box = $('#lf-list');
  if (!box) return;
  const lb = $('#launch-btn') as HTMLButtonElement | null;
  if (lb) lb.disabled = true;
  const inactiveCount = S.myFriends.filter(f => !canLaunch(f)).length;
  const list = [...S.myFriends.filter(canLaunch), ...(DEV && S.lookup && !S.myFriends.includes(S.lookup) ? [S.lookup] : [])];
  if (S.friendsLoading) { box.innerHTML = `<p class="muted">${esc(S.friendsProgress || 'Reading your Friends…')}</p>`; return; }
  if (!list.length && inactiveCount) { box.innerHTML = `<p class="muted">None of your ${inactiveCount} Friends is activated. <a href="https://rarefriends.com/portfolio" target="_blank" rel="noopener">Activate one on rarefriends.com ↗</a></p>`; return; }
  if (!list.length) { box.innerHTML = `<p class="muted">No Friends found for this wallet. ${DEV ? 'Dev mode: look up any Friend on the My Friends page.' : ''}</p>`; return; }
  if (!L.friendKey || !list.some(f => sim.friendKey(f.collection, f.tokenId) === L.friendKey)) {
    const first = list.find(canLaunch);
    L.friendKey = first ? sim.friendKey(first.collection, first.tokenId) : '';
  }
  box.innerHTML = list.map(f => {
    const k = sim.friendKey(f.collection, f.tokenId);
    const ok = canLaunch(f);
    return `<button class="fp ${k === L.friendKey ? 'on' : ''} ${ok ? '' : 'inactive'}" data-act="pick-friend" data-k="${k}" ${ok ? '' : 'disabled'} title="${ok ? '' : 'Activate on rarefriends.com to launch'}">
      ${f.image ? `<img class="sprite sm" src="${f.image}" alt="">` : '<span class="sprite sm sprite-ph"></span>'}
      <span>#${esc(f.tokenId)}</span>${genBadge(f.generation, f.collection)}${ok ? '' : '<span class="small muted">not activated</span>'}</button>`;
  }).join('') + (inactiveCount ? `<p class="muted small">+${inactiveCount} not activated Friends hidden. <a href="https://rarefriends.com/portfolio" target="_blank" rel="noopener">Activate on rarefriends.com ↗</a></p>` : '');
  const f = selectedLaunchFriend();
  const ca = $('#creator-addr');
  if (ca) ca.textContent = f ? `Friend #${f.tokenId} wallet ${short(f.tba)}` : '—';
  updateLaunchButton();
  if (f && L.previewGen === null) { L.previewGen = ownTier(f); renderPreview(); }
}

/** Drawing tier of a Friend: 0 = Genesis (colour), 1…6 = its generation. */
function ownTier(f: Friend) { return f.collection === 'genesis' ? 0 : (f.generation || 6); }

function renderPreview() {
  const cv = $('#pv') as HTMLCanvasElement | null;
  if (!cv) return;
  const f = selectedLaunchFriend();
  const own = f ? ownTier(f) : 6;
  const gen = L.previewGen ?? own;
  const gens = $('#gens')!;
  if (!L.gray) {
    const g = cv.getContext('2d')!; cv.width = cv.height = 384; g.fillStyle = '#000'; g.fillRect(0, 0, 384, 384);
    g.fillStyle = '#666'; g.font = '14px monospace'; g.textAlign = 'center'; g.fillText('upload an image', 192, 192);
    gens.innerHTML = ''; $('#pv-cap')!.textContent = '';
    return;
  }
  const opts = { invert: L.invert, contrast: L.contrast };
  if (gen === 0 && L.rgb) drawIndexed(cv, pixelizeColor(L.rgb, GRID_BY_GEN[0], GENESIS_PALETTE, opts), GRID_BY_GEN[0], 384, GENESIS_PALETTE);
  else drawBits(cv, pixelize(L.gray, GRID_BY_GEN[gen], opts), GRID_BY_GEN[gen], 384);
  const note = gen === 0 ? ' · colour' : '';
  $('#pv-cap')!.innerHTML = `${tierName(gen)} · ${GRID_BY_GEN[gen]}×${GRID_BY_GEN[gen]}${note} ${gen === own ? '— your Friend\'s tier' : gen === 0 ? '<span class="genesis-txt">preview only — Genesis holders draw in colour</span>' : `<span class="warn">preview only — your Friend draws at ${tierName(own)}</span>`}`;
  gens.innerHTML = [0, 1, 2, 3, 4, 5, 6].map(g => `<button class="gbtn ${g === gen ? 'on' : ''} ${g === own ? 'own' : ''} ${g === 0 ? 'genesis' : ''}" data-act="pv-gen" data-g="${g}" aria-pressed="${g === gen}" title="${g === 0 ? 'Genesis: 128×128, colour palette — only Genesis Friends' : `${tierName(g)}: ${GRID_BY_GEN[g]}×${GRID_BY_GEN[g]}`}">
    <img src="${g === 0 && L.rgb ? indexedToDataURL(pixelizeColor(L.rgb, GRID_BY_GEN[0], GENESIS_PALETTE, opts), GRID_BY_GEN[0], GENESIS_PALETTE, 128) : bitsToDataURL(pixelize(L.gray!, GRID_BY_GEN[g], opts), GRID_BY_GEN[g], 96)}" alt="${tierName(g)} preview"><span>${tierName(g)}${g === own ? ' ★' : ''}</span></button>`).join('');
}

async function setLaunchImage(src: Blob | string) {
  try {
    const srcs = await toSources(src);
    L.gray = srcs.gray; L.rgb = srcs.rgb;
    // auto-invert: light images (white background) → dark areas become ink; dark images → light areas become ink
    const mean = L.gray.reduce((a, b) => a + b, 0) / L.gray.length;
    L.invert = mean < 110;
    ($('#inv') as HTMLInputElement).checked = L.invert;
    renderPreview();
  } catch { toast('Could not read that image', 'err'); }
}

function bindLaunch() {
  const drop = $('#drop')!, file = $('#file') as HTMLInputElement;
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => file.files?.[0] && setLaunchImage(file.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) setLaunchImage(f); });
  const onPaste = (e: ClipboardEvent) => { const it = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/')); const f = it?.getAsFile(); if (f) setLaunchImage(f); };
  document.addEventListener('paste', onPaste);
  cleanup = () => document.removeEventListener('paste', onPaste);
  const minEl = $('#f-min') as HTMLInputElement, minHint = $('#min-hint')!;
  const updMin = () => {
    const n = parseMinBalance(minEl.value);
    const caret = minEl.value.length - (minEl.selectionStart ?? minEl.value.length);
    minEl.value = n.toLocaleString('en-US');
    const pos = Math.max(0, minEl.value.length - caret); minEl.setSelectionRange(pos, pos);
    minHint.textContent = `= ${(n / ECON.totalSupply * 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}% of the ${ECON.totalSupply.toLocaleString('en-US')} supply`;
  };
  minEl.addEventListener('input', updMin); updMin();
  const tk = $('#f-ticker') as HTMLInputElement, tkHint = $('#ticker-hint')!;
  tk.addEventListener('input', () => {
    tk.value = tk.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const err = tickerError(tk.value);
    tk.setCustomValidity(err);
    tkHint.textContent = err || (tk.value ? `$${tk.value} is available` : '2–10 letters or digits, must be unique');
    tkHint.className = `small ${err ? 'warn' : 'muted'}`;
  });
  const bindTax = (id: string, fn: (v: number) => void) => $(id)!.addEventListener('input', e => { fn(+(e.target as HTMLInputElement).value / 100); renderTaxUI(); });
  bindTax('#tx-buy', v => { L.tax.buy = v; }); bindTax('#tx-sell', v => { L.tax.sell = v; });
  ALLOC_ROWS.forEach(r => {
    const range = $('#' + r.id) as HTMLInputElement, num = $(`#${r.id}-n`) as HTMLInputElement;
    range.addEventListener('input', () => { L.tax.alloc[r.key] = +range.value / 100; num.value = range.value; renderTaxUI(); });
    num.addEventListener('input', () => { const v = Math.max(0, Math.min(100, Math.round(+num.value || 0))); L.tax.alloc[r.key] = v / 100; range.value = String(v); renderTaxUI(); });
  });
  setTaxInputs();
  L.cb = 0;
  $('#cb-amt')!.addEventListener('input', e => { L.cb = Math.max(0, +(e.target as HTMLInputElement).value || 0); renderCreatorBuy(); });
  renderCreatorBuy();
  $('#inv')!.addEventListener('change', e => { L.invert = (e.target as HTMLInputElement).checked; renderPreview(); });
  $('#con')!.addEventListener('input', e => { L.contrast = +(e.target as HTMLInputElement).value; renderPreview(); });
}

function parseMinBalance(v: string) { const n = Math.floor(+v.replace(/[^0-9]/g, '') || 0); return Math.min(n, ECON.totalSupply); }
function tickerError(t: string): string {
  if (!t) return '';
  if (t.length < 2) return 'Ticker needs at least 2 characters';
  const st = sim.getState();
  if (st.order.some(id => st.tokens[id].ticker.toUpperCase() === t.toUpperCase())) return `$${t} is already used — pick another ticker`;
  return '';
}

const ALLOC_ROWS = [
  { id: 'tx-div', key: 'dividends', label: 'Friend dividends', hint: 'paid in RF', color: '#CCFF00', note: 'Distributed to activated Friend wallets holding the token.' },
  { id: 'tx-cre', key: 'creator', label: 'Creator Friend', hint: 'WETH to its wallet', color: '#F4F4F0', note: '' },
  { id: 'tx-burn', key: 'burn', label: 'RF buyback & burn', hint: 'reduces RF supply', color: '#FF6B5A', note: '' },
] as const;

function drawAllocDonut(c: TaxConfig) {
  const svg = $('#alloc-donut'); if (!svg) return;
  const total = c.alloc.dividends + c.alloc.creator + c.alloc.burn;
  const scale = total > 1 ? 1 / total : 1; // over 100%: show proportions, centre turns red
  const r = 45, C = 2 * Math.PI * r;
  let off = 0, arcs = '';
  const seg = (frac: number, color: string) => {
    if (frac <= 0) return;
    arcs += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="22" stroke-dasharray="${frac * C} ${C}" stroke-dashoffset="${-off * C}" transform="rotate(-90 60 60)"/>`;
    off += frac;
  };
  seg(1, '#232323'); off = 0; // track (unallocated)
  ALLOC_ROWS.forEach(row => seg(c.alloc[row.key] * scale, row.color));
  const ok = Math.abs(total - 1) < 1e-6;
  svg.innerHTML = `${arcs}<text x="60" y="66" text-anchor="middle" font-size="17" font-weight="800" font-family="JetBrains Mono, monospace" fill="${ok ? '#F4F4F0' : '#FF6B5A'}">${Math.round(total * 100)}%</text>`;
  $('#alloc-legend')!.innerHTML = ALLOC_ROWS.map(row => `<li><i style="background:${row.color}"></i>${row.label}<b>${Math.round(c.alloc[row.key] * 100)}%</b></li>`).join('')
    + `<li><i style="background:#232323;border:1px solid #444"></i>Unallocated<b class="${ok ? '' : 'bad'}">${Math.round((1 - total) * 100)}%</b></li>`;
}

function setTaxInputs() {
  const set = (id: string, v: number) => { const el = $(id) as HTMLInputElement | null; if (el) el.value = String(+v.toFixed(1)); };
  set('#tx-buy', L.tax.buy * 100); set('#tx-sell', L.tax.sell * 100);
  ALLOC_ROWS.forEach(r => { set('#' + r.id, L.tax.alloc[r.key] * 100); set(`#${r.id}-n`, Math.round(L.tax.alloc[r.key] * 100)); });
  renderTaxUI();
}
function renderTaxUI() {
  if (!$('#tx-buy')) return;
  const c = L.tax;
  $('#tx-buy-o')!.textContent = pct(c.buy); $('#tx-sell-o')!.textContent = pct(c.sell);
  const total = c.alloc.dividends + c.alloc.creator + c.alloc.burn;
  const un = 1 - total;
  const off = Math.abs(un) > 1e-6 && (c.buy > 0 || c.sell > 0);
  $('#tx-total')!.innerHTML = `Total: <b>${Math.round(total * 100)}%</b> &nbsp; ${un >= 0 ? 'Unallocated' : 'Over by'}: <b class="${Math.abs(un) < 1e-6 ? '' : 'bad'}">${Math.round(Math.abs(un) * 100)}%</b>`;
  $('#alloc-err')!.hidden = !off;
  $('#alloc-err')!.textContent = `⚠ Total allocation must be 100%${un < 0 ? ` (over by ${Math.round(-un * 100)}%)` : ''}`;
  drawAllocDonut(c);
  ALLOC_ROWS.forEach(r => { const el = $(`#${r.id}`) as HTMLInputElement | null; if (el) el.style.setProperty('--p', `${c.alloc[r.key] * 100}%`); });
  const b = { div: c.buy * c.alloc.dividends * ECON.rfPerWeth, cre: c.buy * c.alloc.creator, burn: c.buy * c.alloc.burn * ECON.rfPerWeth };
  $('#tx-example')!.innerHTML = c.buy || c.sell
    ? `Per 1 WETH bought: <b>${fmt(b.div)}</b> RF to Friend holders · <b>${fmtWeth(b.cre)}</b> WETH to your Friend · <b>${fmt(b.burn)}</b> RF burned · ${fmtWeth(ECON.platformFee)} WETH platform ${SIM}`
    : `No creator tax: only the ${pct(ECON.platformFee)} platform fee applies. Friend holders then earn only from the launch-fee pool.`;
  $('#tax-err')!.textContent = taxError(c);
  updateLaunchButton();
}
function cbMax() { return Math.max(0, Math.min(sim.creatorBuyMaxWeth(), S.account ? sim.wallet(youKey()).weth : 0)); }
function cbError(): string {
  if (!(L.cb > 0)) return '';
  if (!S.account) return 'Connect a wallet to fund the creator buy';
  if (L.cb > sim.wallet(youKey()).weth + 1e-12) return `Not enough simulated WETH (you have ${fmtWeth(sim.wallet(youKey()).weth)})`;
  if (L.cb > sim.creatorBuyMaxWeth() + 1e-12) return `Creator buy is capped at ${pct(ECON.creatorBuyMaxShare, 0)} of supply (${fmtWeth(sim.creatorBuyMaxWeth())} WETH)`;
  return '';
}
function renderCreatorBuy() {
  if (!$('#cb-amt')) return;
  const tokens = sim.quoteCreatorBuy(Math.min(L.cb, sim.creatorBuyMaxWeth()));
  const f = selectedLaunchFriend();
  $('#cb-bal')!.innerHTML = `Your balance: ${fmtWeth(S.account ? sim.wallet(youKey()).weth : 0)} WETH ${SIM} · cap ${fmtWeth(sim.creatorBuyMaxWeth())} WETH (${pct(ECON.creatorBuyMaxShare, 0)} of supply)`;
  $('#cb-est')!.innerHTML = L.cb > 0
    ? `Estimated receive: <b>${fmt(tokens)}</b> tokens (${pct(tokens / ECON.totalSupply, 2)} of supply) → ${f ? `Friend #${esc(f.tokenId)}'s wallet` : 'the creator Friend\'s wallet'}`
    : `<span class="muted">No creator buy. Max: ${fmtWeth(sim.creatorBuyMaxWeth())} WETH ≈ ${fmt(ECON.totalSupply * ECON.creatorBuyMaxShare)} tokens (${pct(ECON.creatorBuyMaxShare, 0)}).</span>`;
  $('#cb-err')!.textContent = cbError();
  $('#fee-total')!.textContent = `${ECON.launchFeeRF} RF launch fee${L.cb > 0 ? ` + ${fmtWeth(L.cb)} WETH creator buy` : ''}`;
  updateLaunchButton();
}

function updateLaunchButton() {
  const btn = $('#launch-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const f = selectedLaunchFriend();
  const err = taxError(L.tax) || cbError();
  btn.disabled = !f || !canLaunch(f) || !!err;
  btn.title = err || (!f ? 'Pick an activated Friend' : '');
}

function doLaunch() {
  const f = selectedLaunchFriend();
  if (!f || !canLaunch(f)) return toast('Pick an activated Friend', 'err');
  if (!L.gray) return toast('Upload an image first', 'err');
  const name = ($('#f-name') as HTMLInputElement).value.trim();
  const ticker = ($('#f-ticker') as HTMLInputElement).value.trim().replace(/[^A-Za-z0-9]/g, '');
  if (!name || ticker.length < 2) return toast('Name and ticker (2–10 letters) are required', 'err');
  const tErr = tickerError(ticker.toUpperCase());
  if (tErr) return toast(tErr, 'err');
  const taxErr = taxError(L.tax) || cbError();
  if (taxErr) return toast(taxErr, 'err');
  const lockDays = +(($('#cb-lock') as HTMLSelectElement | null)?.value ?? 0);
  // bake the contrast into the stored source so re-renders (promotion) look the same
  const bake = (a: Uint8Array) => L.contrast === 1.15 ? a : a.map(v => Math.max(0, Math.min(255, (v - 128) * (L.contrast / 1.15) + 128)));
  const src = bake(L.gray);
  const srcRGB = f.collection === 'genesis' && L.rgb ? bytesToB64(bake(L.rgb)) : undefined;
  const t = sim.launch({
    name, ticker, desc: ($('#f-desc') as HTMLTextAreaElement).value.trim(),
    creator: toRef(f), launchedBy: S.account ?? undefined,
    src: bytesToB64(src), srcRGB, invert: L.invert, minDivBalance: parseMinBalance(($('#f-min') as HTMLInputElement).value), tax: structuredClone(L.tax),
  });
  sim.ensureHolder({ key: t.creatorKey, kind: 'yourFriend', label: `Friend #${f.tokenId}`, addr: f.tba, friend: toRef(f) });
  // optional creator buy: first trade on the curve, same "transaction" as the launch, untaxed, into the Friend wallet
  const cbTrade = L.cb > 0 && S.account ? sim.creatorBuy(t, L.cb, youKey(), lockDays, t.createdAt) : null;
  sim.commit();
  if (cbTrade) toast(`Creator buy: ${fmt(cbTrade.tokens)} $${t.ticker} into Friend #${f.tokenId}'s wallet${lockDays ? `, locked ${lockDays}d` : ''} (simulated)`);
  L.gray = null; L.rgb = null; L.previewGen = null;
  toast(`🔥 Proof of Burn: ${ECON.launchFeeRF * ECON.launchBurnShare} RF burned. $${t.ticker} is live (simulated).`, 'burn');
  location.hash = `#/token/${t.id}`;
}

// ---------------- TOKEN ----------------
let tradeSide: 'buy' | 'sell' = 'buy';
let chartHover: number | null = null;

let holderWorld: HolderWorld | null = null;
function worldCtx() {
  return { info: holderInfo, you: youKey(), myFriendKeys: new Set(S.myFriends.map(f => sim.friendKey(f.collection, f.tokenId))), reduced: reducedMotion() };
}

function viewToken(id: string) {
  const t = sim.getState().tokens[id];
  if (!t) { app().innerHTML = `<p>Token not found. <a href="#/">Back</a></p>`; return; }
  app().innerHTML = `
  <div class="token-page">
    <section class="tk-head">
      <img class="art big" id="tk-art" src="${tokenArt(t)}" alt="${esc(t.name)} pixel art">
      <div class="tk-meta">
        <div class="row gap-s wrap"><h1>$${esc(t.ticker)}</h1><span class="muted">${esc(t.name)}</span>${t.seeded ? '<span class="badge">seeded demo</span>' : ''}</div>
        <p>${esc(t.desc)}</p>
        <div id="tk-creator"></div>
        <div id="tk-stats" class="strip small-strip"></div>
      </div>
    </section>
    <section class="tk-main">
      <div class="panel chart-panel"><div class="row between"><h2>Price (WETH per token) ${SIM}</h2><span class="muted small" id="chart-tip"></span></div>
        <canvas id="chart" height="220" aria-label="Price chart"></canvas></div>
      <div class="panel trade" id="tk-trade"></div>
    </section>
    <section class="tk-main">
      <div class="panel"><div class="row between wrap"><h2>Holder world · <span id="hw-name"></span></h2><span class="muted small">activated Friends walk · other wallets float · size = share</span></div><div id="tk-map" class="map"></div></div>
      <div class="panel"><h2>Trades ${SIM}</h2><ol id="tk-feed" class="feed"></ol></div>
    </section>
    <section class="tk-main">
      <div class="panel" id="tk-pos"></div>
      <div class="panel" id="tk-tax"></div>
    </section>
  </div>`;
  renderTrade(t);
  holderWorld = new HolderWorld($('#tk-map')!, t, worldCtx());
  $('#hw-name')!.textContent = holderWorld.world.name;
  updateToken();
  const chart = $('#chart') as HTMLCanvasElement;
  chart.addEventListener('mousemove', e => { chartHover = e.offsetX; drawChart(t); });
  chart.addEventListener('mouseleave', () => { chartHover = null; drawChart(t); });
  const onResize = () => drawChart(t);
  window.addEventListener('resize', onResize);
  // simulated market: bots trade while the page is open
  let alive = true;
  const r = rng(Date.now() & 0xffff);
  const loop = () => {
    if (!alive) return;
    botTrade(t, r);
    setTimeout(loop, 3500 + r() * 4500);
  };
  const timer = setTimeout(loop, 2500);
  cleanup = () => { alive = false; clearTimeout(timer); window.removeEventListener('resize', onResize); holderWorld?.destroy(); holderWorld = null; };
}

function botTrade(t: Token, r: () => number, forceBuy = false) {
  const st = sim.getState();
  const pool = [...Array.from({ length: BOT_COUNT }, (_, i) => `bot:${i}`), ...SEED_FRIENDS.map(f => sim.friendKey(f.collection, f.tokenId)).filter(k => k !== t.creatorKey)];
  const who = pool[Math.floor(r() * pool.length)];
  if (!st.holders[who]) return;
  const bal = t.balances[who] ?? 0;
  if (!forceBuy && bal > 0 && r() < 0.33) sim.sell(t, who, bal * (0.15 + r() * 0.5), true);
  else sim.buy(t, who, 0.005 + r() * r() * 0.25, true);
  sim.commit();
}

function drawChart(t: Token) {
  const c = $('#chart') as HTMLCanvasElement | null;
  if (!c) return;
  const tip = drawPriceChart(c, t.trades.map(x => ({ t: x.t, p: x.price })), chartHover);
  const el = $('#chart-tip');
  if (el) el.textContent = tip ?? `now ${fmtPrice(sim.spotPrice(t))}`;
}

function renderTrade(t: Token) {
  const box = $('#tk-trade')!;
  if (!S.account) {
    box.innerHTML = `<h2>Trade</h2><div class="empty"><p>View-only. Connect your wallet to trade with simulated WETH.</p>${chain.hasInjectedWallet() ? '<button class="btn primary" data-act="connect">Connect wallet</button>' : ''}</div>`;
    return;
  }
  const dests = [`<option value="${youKey()}">My wallet</option>`, ...S.myFriends.filter(f => f.active || (t.balances[sim.friendKey(f.collection, f.tokenId)] ?? 0) > 0).map(f => `<option value="${sim.friendKey(f.collection, f.tokenId)}" ${f.tbaDeployed ? '' : 'disabled'}>Friend #${f.tokenId} wallet${!f.tbaDeployed ? ' — wallet not deployed' : f.active ? '' : ' (not activated, earns nothing)'}</option>`)];
  box.innerHTML = `
    <div class="tabs" role="tablist">
      <button role="tab" class="${tradeSide === 'buy' ? 'on' : ''}" aria-selected="${tradeSide === 'buy'}" data-act="side" data-s="buy">Buy</button>
      <button role="tab" class="${tradeSide === 'sell' ? 'on' : ''}" aria-selected="${tradeSide === 'sell'}" data-act="side" data-s="sell">Sell</button>
    </div>
    <form data-form="trade" class="form">
      ${tradeSide === 'buy' ? `
        <label><span>Pay (WETH) ${SIM}</span><input id="amt" type="number" min="0" step="any" value="0.05" inputmode="decimal"></label>
        <div class="row gap-s">${[0.01, 0.05, 0.1, 0.5].map(v => `<button type="button" class="btn ghost small" data-act="amt" data-v="${v}">${v}</button>`).join('')}</div>
        <label>Receive to <select id="dest">${dests.join('')}</select></label>
      ` : `
        <label><span>Sell ${esc(t.ticker)} from my wallet</span><input id="amt" type="number" min="0" step="any" value="${Math.floor((t.balances[youKey()] ?? 0) / 2)}" inputmode="decimal"></label>
        <div class="row gap-s">${[25, 50, 100].map(v => `<button type="button" class="btn ghost small" data-act="pct" data-v="${v}">${v}%</button>`).join('')}</div>
        <p class="muted small">To sell tokens held by a Friend wallet, use “Sell from Friend” below.</p>
      `}
      <div id="quote" class="quote small"></div>
      <button class="btn primary big" type="submit">${tradeSide === 'buy' ? 'Buy' : 'Sell'} (simulated)</button>
    </form>`;
  updateQuote(t);
  $('#amt')!.addEventListener('input', () => updateQuote(t));
}

function updateQuote(t: Token) {
  const q = $('#quote'); const a = +(($('#amt') as HTMLInputElement | null)?.value ?? 0);
  if (!q) return;
  const c = sim.taxOf(t);
  const split = (b: ReturnType<typeof sim.taxBreakdown>) => `<br><span class="muted">→ ${fmt(b.divRF)} RF to Friend holders · ${fmtWeth(b.creatorWeth)} WETH to creator Friend · ${fmt(b.burnRF)} RF burned · ${fmtWeth(b.platformWeth)} WETH platform</span>`;
  if (tradeSide === 'buy') {
    const r = sim.quoteBuy(t, a);
    q.innerHTML = `≈ <b>${fmt(r.tokens)}</b> ${esc(t.ticker)} · tax ${pct(c.buy)} + ${pct(ECON.platformFee)} = ${fmtWeth(r.tax)} WETH${split(sim.taxBreakdown(t, a, 'buy'))}`;
  } else {
    const r = sim.quoteSell(t, a);
    q.innerHTML = `≈ <b>${fmtWeth(r.weth)}</b> WETH · tax ${pct(c.sell)} + ${pct(ECON.platformFee)} = ${fmtWeth(r.tax)} WETH${split(sim.taxBreakdown(t, r.gross, 'sell'))}`;
  }
}

function updateToken() {
  const id = current.args[0];
  const t = sim.getState().tokens[id];
  if (!t || !$('#tk-stats')) return;
  const holders = sim.holdersSorted(t);
  const art = $('#tk-art') as HTMLImageElement;
  const url = tokenArt(t);
  if (art && art.getAttribute('src') !== url) art.src = url;
  const mineCreator = S.myFriends.find(f => sim.friendKey(f.collection, f.tokenId) === t.creatorKey);
  const cw = sim.getState().wallets[t.creatorKey];
  $('#tk-creator')!.innerHTML = `<div class="creator">
    ${friendSprite(t.creator.collection, t.creator.tokenId, 'sprite md')}
    <div><div>Created by <b>Friend #${esc(t.creator.tokenId)}</b> ${genBadge(t.creator.gen, t.creator.collection)} ${mineCreator ? '<span class="badge you">yours</span>' : ''}</div>
    <div class="small muted">creator = Friend wallet <a class="mono" href="${t.creator.tba ? explorerAddr(t.creator.tba) : '#'}" target="_blank" rel="noopener">${short(t.creator.tba ?? 'resolving…')}</a>${t.creator.verified ? ' <span class="ok">✓ tokenBoundAccount verified</span>' : ''}</div>
    <div class="small muted">drawn at ${tierName(t.gen)} (${GRID_BY_GEN[t.gen]}×${GRID_BY_GEN[t.gen]}${t.gen === 0 ? ', colour' : ''})${t.gen < t.genAtLaunch ? ` · promoted from ${tierName(t.genAtLaunch)}` : ''}</div>
    ${t.creatorBuy ? `<div class="small muted row gap-s wrap">Creator buy at launch: ${fmtWeth(t.creatorBuy.weth)} WETH → ${fmt(t.creatorBuy.tokens)} tokens (${pct(t.creatorBuy.tokens / ECON.totalSupply, 2)}), untaxed, into the Friend wallet ${lockBadge(t) || (t.creatorBuy.lockDays ? '<span class="badge">lock expired</span>' : '<span class="badge">no lock</span>')}</div>` : ''}
    ${mineCreator ? `<div class="row gap-s wrap" style="margin-top:6px">
      <button class="btn small" data-act="claim-weth" data-k="${t.creatorKey}" ${cw && cw.weth > 1e-9 ? '' : 'disabled'}>Claim ${fmtWeth(cw?.weth ?? 0)} WETH</button>
      <button class="btn ghost small" data-act="promote" ${t.gen > 1 ? '' : 'disabled'} ${t.gen <= 1 ? `title="${t.gen === 0 ? 'Genesis is the top tier' : 'Gen-1 is the top Generations tier — only Genesis draws sharper, in colour'}"` : ''} title="Simulated: re-draw the meme one generation sharper">Simulate promotion</button></div>` : ''}
    </div></div>`;
  $('#tk-stats')!.innerHTML = [
    stat('Price', fmtPrice(sim.spotPrice(t)), 'WETH'),
    stat('Market cap', fmtWeth(sim.marketCapWeth(t)), 'WETH'),
    stat('Holders', String(holders.length), `${Object.keys(t.div.weight).length} Friend wallets earning`),
    stat('Curve', Math.round(sim.curveProgress(t) * 100) + '%', `${fmtWeth(t.reserveWeth)} / ${ECON.graduationWeth} WETH`),
    stat('Tax', `${pct(sim.taxOf(t).buy)} / ${pct(sim.taxOf(t).sell)}`, `buy / sell · +${pct(ECON.platformFee)} platform`),
    stat('Creator fees', fmtWeth(t.creatorFeesWeth), 'WETH to creator Friend'),
    stat('Friend dividends', fmt(t.div.distributed), `RF · pool ${fmt(t.div.undistributed)}`),
  ].join('');
  drawChart(t);
  holderWorld?.sync(t, worldCtx());
  $('#tk-feed')!.innerHTML = t.trades.slice(-40).reverse().map(tr => {
    const h = holderInfo(tr.key);
    return `<li class="${tr.side}"><span class="side">${tr.side}</span><span class="who">${h.friend ? friendSprite(h.friend.collection, h.friend.tokenId, 'sprite xxs') : ''}<span class="nm">${esc(h.label)}</span>${tr.creatorBuy ? ' <span class="badge" title="Creator buy at launch: first trade on the curve, untaxed">creator buy</span>' : ''}${tr.bot && !tr.creatorBuy ? (h.friend ? ' <span class="sim" title="Seeded demo trade: a real Friend is used as a simulated holder">demo</span>' : ' <span class="sim" title="Simulated bot">bot</span>') : ''}</span><span class="r">${fmt(tr.tokens)}</span><span class="r">${fmtWeth(tr.weth)} Ξ</span><span class="muted r">${ago(tr.t)}</span></li>`;
  }).join('');
  renderPositions(t);
  renderTax(t);
  updateQuote(t);
}

function renderPositions(t: Token) {
  const box = $('#tk-pos')!;
  if (!S.account) { box.innerHTML = `<h2>Your positions</h2><p class="muted">Connect a wallet to hold ${esc(t.ticker)} in your Friends' wallets and earn RF dividends.</p>`; return; }
  const you = t.balances[youKey()] ?? 0;
  const posFriends = S.myFriends.filter(f => f.active || (t.balances[sim.friendKey(f.collection, f.tokenId)] ?? 0) > 0);
  const hiddenCount = S.myFriends.length - posFriends.length;
  const rows = posFriends.map(f => {
    const k = sim.friendKey(f.collection, f.tokenId);
    const bal = t.balances[k] ?? 0;
    const w = t.div.weight[k] ?? 0;
    const claim = sim.claimableDividends(t, k);
    const eligible = bal >= t.minDivBalance;
    const noWallet = !f.tbaDeployed;
    const free = sim.unlockedBalance(t, k);
    const locked = sim.lockedAmount(t, k);
    const lockWhy = locked > 0 ? `${fmt(locked)} creator-buy tokens locked for ${sim.lockDaysLeft(t)} more day(s)` : '';
    const why = noWallet ? 'Wallet not deployed — hardwire on rarefriends.com' : '';
    const boost = !f.active
      ? `<span class="warn small" title="Only activated Friends earn dividends">Activate to earn</span>`
      : w > 0 ? `×${weightMultiplier(f.weightRF).toFixed(2)}` : `<span class="muted small">${bal > 0 && !eligible ? `min ${fmt(t.minDivBalance)}` : '—'}</span>`;
    return `<tr class="${f.active ? '' : 'inactive-row'}">
      <td><span class="row gap-s">${f.image ? `<img class="sprite xs" src="${f.image}" alt="">` : ''}#${esc(f.tokenId)} ${genBadge(f.generation, f.collection)}</span></td>
      <td class="r">${fmt(bal)}${locked > 0 ? `<br><span class="small warn" title="${lockWhy}">🔒 ${fmt(locked)}</span>` : ''}</td>
      <td class="r">${boost}</td>
      <td class="r">${fmt(f.active ? claim : 0)} RF</td>
      <td class="acts">
        <span title="${why}"><button class="btn ghost small" data-act="move-to" data-k="${k}" ${you > 0 && !noWallet ? '' : 'disabled'}>Move to Friend</button></span>
        <span title="${why || lockWhy}"><button class="btn ghost small" data-act="sell-from" data-k="${k}" ${free > 0 && !noWallet ? '' : 'disabled'}>Sell from Friend</button></span>
        <span title="${why || lockWhy}"><button class="btn ghost small" data-act="move-out" data-k="${k}" ${free > 0 && !noWallet ? '' : 'disabled'}>Move out</button></span>
        <span title="${why || (f.active ? '' : 'Activate to earn')}"><button class="btn small" data-act="claim-div" data-k="${k}" ${claim > 1e-9 && !noWallet && f.active ? '' : 'disabled'}>Claim</button></span>
      </td></tr>`;
  }).join('');
  box.innerHTML = `<h2>Your positions</h2>
    <p class="small">My wallet: <b>${fmt(you)}</b> ${esc(t.ticker)} <span class="muted">— tokens in a personal wallet earn nothing. Move them into a Friend wallet to earn RF dividends.</span></p>
    ${hiddenCount ? `<p class="muted small">${hiddenCount} not-activated Friends without a balance are hidden.</p>` : ''}
    ${posFriends.length ? `<table class="tbl"><thead><tr><th>Friend wallet</th><th class="r">Balance</th><th class="r">Boost</th><th class="r">Dividends</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">No Friends in this wallet.</p>'}
    <p class="muted small">Dividends: ${pct(sim.taxOf(t).alloc.dividends, 0)} of this token's ${pct(sim.taxOf(t).buy)} / ${pct(sim.taxOf(t).sell)} tax, paid in RF, only to <b>activated</b> Friend wallets holding ≥ ${fmt(t.minDivBalance)} ${esc(t.ticker)}. Weight = balance × reward-weight boost. You earn only from fees after you entered (dividends-per-share).</p>`;
}

function renderTax(t: Token) {
  const c = sim.taxOf(t);
  const none = !c.buy && !c.sell;
  $('#tk-tax')!.innerHTML = `<h2>Where the tax goes ${SIM}</h2>
  <p class="small">Buy tax <b>${pct(c.buy)}</b> · sell tax <b>${pct(c.sell)}</b> <span class="muted">+ ${pct(ECON.platformFee)} platform fee on every trade · fixed at launch</span> ${taxLabel(t).includes('warnb') ? taxLabel(t).slice(taxLabel(t).indexOf('<span class="badge')) : ''}</p>
  ${none ? '<p class="muted small">This token has no creator tax — only the platform fee applies, so Friend holders earn only from the launch-fee pool.</p>' : ''}
  <ul class="split">
    <li><span class="dot d1"></span>${pct(c.alloc.dividends, 0)} → RF dividends to activated Friend holders <b class="r">${fmt(t.div.distributed)} RF${t.div.undistributed > 0 ? ` <span class="muted" title="Waiting for the first eligible Friend holder">+${fmt(t.div.undistributed)} pooled</span>` : ''}</b></li>
    <li><span class="dot d2"></span>${pct(c.alloc.creator, 0)} → WETH to Friend #${esc(t.creator.tokenId)} <b class="r">${fmtWeth(t.creatorFeesWeth)} WETH</b></li>
    <li><span class="dot d3"></span>${pct(c.alloc.burn, 0)} → RF buyback & burn <b class="r">${fmt(t.burnedRF ?? 0)} RF</b></li>
    <li><span class="dot d4"></span>+${pct(ECON.platformFee)} of volume → platform <b class="r">${fmtWeth(t.platformWeth ?? 0)} WETH</b></li>
  </ul>
  <p class="muted small">Launch: ${ECON.launchFeeRF} RF paid, ${ECON.launchFeeRF * ECON.launchBurnShare} RF burned (Proof of Burn), ${ECON.launchFeeRF * (1 - ECON.launchBurnShare)} RF seeded into this token's dividend pool.</p>`;
}

// ---------------- tx preview modal ----------------
function showTx(p: tx.TxPreview, apply?: { label: string; run: () => void }) {
  const d = $('#txmodal') as HTMLDialogElement;
  d.innerHTML = `<form method="dialog" class="tx">
    <h2>${esc(p.title)}</h2>
    <p class="warn small">Would be sent in production. Friendpad never sends transactions or asks for signatures.</p>
    <dl class="kv mono small">
      <dt>from</dt><dd>${esc(p.from)} <span class="muted">(NFT owner)</span></dd>
      <dt>to</dt><dd>${esc(p.to)}</dd>
      <dt>value</dt><dd>${esc(p.value)}</dd>
    </dl>
    <pre class="decoded">${p.decoded.map(esc).join('\n')}</pre>
    <label class="small">calldata</label>
    <textarea class="calldata mono" readonly rows="4">${esc(p.data)}</textarea>
    <ul class="small muted">${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <div class="row gap-s end">
      <button class="btn ghost" type="button" data-act="copy-cd">Copy calldata</button>
      ${apply ? `<button class="btn primary" type="button" data-act="tx-apply">${esc(apply.label)}</button>` : ''}
      <button class="btn" value="close">Close</button>
    </div></form>`;
  d.querySelector('[data-act="copy-cd"]')!.addEventListener('click', () => { navigator.clipboard?.writeText(p.data); toast('Calldata copied'); });
  if (apply) d.querySelector('[data-act="tx-apply"]')!.addEventListener('click', () => { apply.run(); d.close(); });
  d.showModal();
}

function askAmount(title: string, max: number, unit: string): Promise<number | null> {
  const d = $('#txmodal') as HTMLDialogElement;
  d.innerHTML = `<form method="dialog" class="tx amount">
    <h2>${esc(title)}</h2>
    <label>Amount (${esc(unit)}) <input id="ask-amt" type="number" min="0" max="${max}" step="any" value="${Math.floor(max)}" inputmode="decimal"></label>
    <div class="row gap-s">${[25, 50, 100].map(v => `<button type="button" class="btn ghost small" data-pct="${v}">${v}%</button>`).join('')}<span class="muted small">max ${fmt(max)}</span></div>
    <div class="row gap-s end"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Continue</button></div></form>`;
  const inp = d.querySelector('#ask-amt') as HTMLInputElement;
  d.querySelectorAll<HTMLButtonElement>('[data-pct]').forEach(b => b.addEventListener('click', () => { inp.value = String(Math.floor(max * +b.dataset.pct! / 100)); }));
  return new Promise(res => {
    d.addEventListener('close', () => {
      const n = Math.min(max, Math.max(0, +inp.value));
      res(d.returnValue === 'ok' && isFinite(n) && n > 0 ? n : null);
    }, { once: true });
    d.returnValue = '';
    d.showModal();
    inp.select();
  });
}

function myFriendByKey(k: string) { return S.myFriends.find(f => sim.friendKey(f.collection, f.tokenId) === k); }

// ---------------- actions ----------------
async function onAction(el: HTMLElement) {
  const act = el.dataset.act!;
  const st = sim.getState();
  const t = current.name === 'token' ? st.tokens[current.args[0]] : undefined;
  switch (act) {
    case 'connect':
      try { await chain.connectWallet(); } catch (e: any) { toast(e?.message ?? String(e), 'err'); }
      break;
    case 'disconnect': chain.disconnectWallet(); break;
    case 'add-chain': chain.addRobinhoodChain().catch(e => toast(e?.message ?? String(e), 'err')); break;
    case 'faucet': sim.wallet(youKey()).weth += 1; sim.commit(); toast('+1 WETH (simulated)'); break;
    case 'reset-sim':
      if (el.dataset.confirm === '1') { sim.reset(buildSeedState); artCache.clear(); render(); toast('Simulation reset'); }
      else { el.dataset.confirm = '1'; el.textContent = 'Click again to confirm reset'; }
      break;
    case 'sample': {
      const url = sampleURL(el.dataset.s!);
      await setLaunchImage(url);
      break;
    }
    case 'pick-friend': L.friendKey = el.dataset.k!; L.previewGen = null; updateLaunchFriends(); renderPreview(); break;
    case 'ftab': S.friendsTab = el.dataset.t as any; viewFriends(); break;
    case 'more-friends': S.notShown += 120; viewFriends(); break;
    case 'alloc-reset': L.tax.alloc = structuredClone(DEFAULT_TAX.alloc); setTaxInputs(); break;
    case 'cb-pct': {
      L.cb = Math.floor(cbMax() * +el.dataset.v! / 100 * 1e6) / 1e6;
      ($('#cb-amt') as HTMLInputElement).value = String(L.cb);
      renderCreatorBuy();
      break;
    }
    case 'tax-preset': {
      const p = TAX_PRESETS[el.dataset.p!];
      if (p) { L.tax = structuredClone(p); setTaxInputs(); }
      break;
    }
    case 'pv-gen': L.previewGen = +el.dataset.g!; renderPreview(); break;
    case 'side': tradeSide = el.dataset.s as any; if (t) renderTrade(t); break;
    case 'amt': ($('#amt') as HTMLInputElement).value = el.dataset.v!; if (t) updateQuote(t); break;
    case 'pct': if (t) { ($('#amt') as HTMLInputElement).value = String(Math.floor((t.balances[youKey()] ?? 0) * +el.dataset.v! / 100)); updateQuote(t); } break;
    case 'promote':
      if (t) { sim.promote(t); sim.commit(); toast(`Simulated promotion: $${t.ticker} is now drawn at ${tierName(t.gen)} (${GRID_BY_GEN[t.gen]}×${GRID_BY_GEN[t.gen]}). On-chain, ActivationManager.promote() does this for real.`); }
      break;
    case 'claim-weth': {
      const k = el.dataset.k!; const f = myFriendByKey(k); const w = sim.wallet(k);
      if (!f || !S.account) return;
      showTx(tx.claimCreatorFees(f.tba, S.account, w.weth), { label: 'Apply (simulated)', run: () => { const x = w.weth; w.weth = 0; sim.wallet(youKey()).weth += x; sim.commit(); toast(`Claimed ${fmtWeth(x)} WETH to your wallet (simulated)`); } });
      break;
    }
    case 'withdraw-rf': {
      const k = el.dataset.k!; const f = myFriendByKey(k); const w = sim.wallet(k);
      if (!f || !S.account) return;
      showTx(tx.withdrawRF(f.tba, S.account, w.rf), { label: 'Apply (simulated)', run: () => { const x = w.rf; w.rf = 0; sim.wallet(youKey()).rf += x; sim.commit(); toast(`Withdrew ${fmt(x)} RF (simulated)`); } });
      break;
    }
    case 'move-to': {
      if (!t || !S.account) return;
      const k = el.dataset.k!; const f = myFriendByKey(k)!;
      if (!f.tbaDeployed) return toast('Wallet not deployed — hardwire on rarefriends.com', 'err');
      const n = await askAmount(`Move ${t.ticker} from your wallet to Friend #${f.tokenId}'s wallet`, t.balances[youKey()] ?? 0, t.ticker);
      if (!n) return;
      // verify the destination really is this Friend's wallet: recompute tokenBoundAccount(tokenId) on-chain
      const ok = await chain.verifyFriendWallet(f.collection, f.tokenId, f.tba).catch(() => false);
      if (!ok) return toast('Could not verify the Friend wallet on-chain', 'err');
      showTx(tx.moveToFriend(S.account, f.tba, n), { label: 'Apply (simulated)', run: () => { sim.move(t, youKey(), k, n); sim.commit(); toast(`Moved ${fmt(n)} ${t.ticker} into Friend #${f.tokenId} — wallet verified via tokenBoundAccount()`); } });
      break;
    }
    case 'sell-from': {
      if (!t || !S.account) return;
      const k = el.dataset.k!; const f = myFriendByKey(k)!;
      if (!f.tbaDeployed) return toast('Wallet not deployed — hardwire on rarefriends.com', 'err');
      const n = await askAmount(`Sell ${t.ticker} from Friend #${f.tokenId}'s wallet`, sim.unlockedBalance(t, k), t.ticker);
      if (!n) return;
      const q = sim.quoteSell(t, n);
      showTx(tx.sellFromFriend(f.tba, S.account, n, q.weth * 0.98), { label: 'Apply (simulated)', run: () => { sim.sell(t, k, n, false, Date.now(), k); sim.commit(); toast(`Sold from Friend #${f.tokenId}: ${fmtWeth(q.weth)} WETH landed in the Friend wallet`); } });
      break;
    }
    case 'move-out': {
      if (!t || !S.account) return;
      const k = el.dataset.k!; const f = myFriendByKey(k)!;
      if (!f.tbaDeployed) return toast('Wallet not deployed — hardwire on rarefriends.com', 'err');
      const n = await askAmount(`Move ${t.ticker} out of Friend #${f.tokenId}'s wallet to your wallet`, sim.unlockedBalance(t, k), t.ticker);
      if (!n) return;
      showTx(tx.moveFromFriend(f.tba, S.account, n), { label: 'Apply (simulated)', run: () => { sim.move(t, k, youKey(), n); sim.commit(); toast(`Moved ${fmt(n)} ${t.ticker} to your wallet — they no longer earn Friend dividends`); } });
      break;
    }
    case 'claim-div': {
      if (!t || !S.account) return;
      const k = el.dataset.k!; const f = myFriendByKey(k)!;
      if (!f.tbaDeployed) return toast('Wallet not deployed — hardwire on rarefriends.com', 'err'); 
      if (!f.active) return toast('Activate this Friend on rarefriends.com to earn dividends', 'err');
      showTx(tx.claimDividendsTx(f.tba, S.account), { label: 'Apply (simulated)', run: () => { const x = sim.claimDividends(t, k); sim.commit(); toast(`Claimed ${fmt(x)} RF into Friend #${f.tokenId}'s wallet (simulated)`); } });
      break;
    }
  }
}

const sampleCache = new Map<string, string>();
function sampleURL(name: string) {
  if (!sampleCache.has(name)) {
    const bytes = b64ToBytes(drawArt(name));
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!; const img = g.createImageData(128, 128);
    bytes.forEach((v, i) => { img.data.set([v, v, v, 255], i * 4); });
    g.putImageData(img, 0, 0);
    sampleCache.set(name, c.toDataURL());
  }
  return sampleCache.get(name)!;
}

function onSubmit(form: HTMLFormElement) {
  const kind = form.dataset.form;
  if (kind === 'launch') return doLaunch();
  if (kind === 'lookup') {
    const coll = ($('#lk-coll') as HTMLSelectElement).value as Collection;
    const id = ($('#lk-id') as HTMLInputElement).value.trim();
    if (!/^\d+$/.test(id)) { S.lookupError = 'Enter a numeric tokenId'; return viewFriends(); }
    S.lookupError = ''; S.lookup = null; viewFriends();
    chain.readFriend(coll, id).then(f => {
      if (!f.owner) throw new Error('ownerOf reverted — this tokenId does not exist (or was burned).');
      S.lookup = f; viewFriends();
    }).catch(e => { S.lookupError = e?.shortMessage ?? e?.message ?? String(e); viewFriends(); });
    return;
  }
  if (kind === 'trade') {
    const t = sim.getState().tokens[current.args[0]];
    if (!t || !S.account) return;
    const a = +($('#amt') as HTMLInputElement).value;
    if (!(a > 0)) return toast('Enter an amount', 'err');
    try {
      if (tradeSide === 'buy') {
        const dest = ($('#dest') as HTMLSelectElement).value;
        sim.ensureHolder({ key: youKey(), kind: 'you', label: 'You', addr: S.account });
        const tr = sim.buy(t, dest, a, false, Date.now(), youKey());
        if (!tr) return toast('Curve is sold out', 'err');
        toast(`Bought ${fmt(tr.tokens)} ${t.ticker}${dest !== youKey() ? ' into your Friend wallet' : ''} (simulated)`);
        // bots notice and pile in
        const r = rng(Date.now() & 0xffff);
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) setTimeout(() => { if (current.name === 'token' && current.args[0] === t.id) botTrade(t, r, true); }, 900 + i * 1100 + r() * 800);
      } else {
        const tr = sim.sell(t, youKey(), a, false);
        if (!tr) return toast('Nothing to sell', 'err');
        toast(`Sold for ${fmtWeth(tr.weth)} WETH (simulated)`);
      }
      sim.commit();
    } catch (e: any) { toast(e?.message ?? String(e), 'err'); }
  }
}

// ---------------- boot ----------------
function boot() {
  sim.load(buildSeedState);
  if (ensureSeeds(sim.getState())) sim.commit();
  sim.subscribe(() => softRender());
  chain.onAccount(a => {
    const changed = a !== S.account;
    S.account = a;
    if (a) {
      sim.ensureHolder({ key: a.toLowerCase(), kind: 'you', label: 'You', addr: a });
      const w = sim.wallet(a.toLowerCase());
      if (!(w as any).funded) { w.weth += 1; (w as any).funded = true; toast('Welcome! 1 simulated WETH added to trade with.'); }
      sim.commit();
    }
    if (changed) { S.myFriends = []; loadMyFriends(); }
    render();
  });
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (el && !(el as HTMLButtonElement).disabled) { e.preventDefault(); onAction(el); }
  });
  document.addEventListener('submit', e => {
    const form = e.target as HTMLFormElement;
    if (form.method === 'dialog') return; // let <dialog> forms close natively (Cancel / Continue / Close)
    e.preventDefault(); onSubmit(form);
  });
  window.addEventListener('hashchange', render);
  render();
  chain.restoreWallet();
  // resolve seeded Friend holders (real tokenIds) → real Friend wallets + sprites
  for (const f of SEED_FRIENDS) requestSprite(f.collection, f.tokenId);
  setInterval(() => { if (current.name === 'token') { const t = sim.getState().tokens[current.args[0]]; if (t) { const feed = $('#tk-feed'); if (feed) updateToken(); } } }, 15000);
}

boot();
