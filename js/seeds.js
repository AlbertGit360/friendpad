// Seeded demo content (SIMULATED): 4 memes launched by real Rare Friends, with simulated bot trading history.
// Creator/holder Friends are real tokenIds on Robinhood Chain; their balances and trades are simulated.
import { SRC, grayFromCanvas, rgbFromCanvas, bytesToB64 } from './pixel.js';
import { ECON } from './config.js';
import { emptyState, useState, launch, seedTax, creatorBuy, buy, sell, ensureHolder, friendKey, refreshWeight, } from './sim.js';
export function rng(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Real Friends (verified on-chain 2026-09-26) used as seeded creators and simulated Friend holders. */
export const SEED_FRIENDS = [
    { collection: 'generations', tokenId: '88135', gen: 1, weightRF: 987187.5 },
    { collection: 'generations', tokenId: '10436', gen: 3, weightRF: 3375 },
    { collection: 'generations', tokenId: '36727', gen: 4, weightRF: 464.0625 },
    { collection: 'generations', tokenId: '335533', gen: 6, weightRF: 1.1 },
    { collection: 'generations', tokenId: '5216', gen: 1, weightRF: 270000 },
    { collection: 'generations', tokenId: '4538', gen: 2, weightRF: 24375 },
    { collection: 'generations', tokenId: '67356', gen: 2, weightRF: 37125 },
    { collection: 'generations', tokenId: '6035', gen: 3, weightRF: 7846.875 },
    { collection: 'generations', tokenId: '330187', gen: 3, weightRF: 1450 },
    { collection: 'generations', tokenId: '329996', gen: 4, weightRF: 198.75 },
    { collection: 'genesis', tokenId: '1', gen: 0, weightRF: 2000000 }, // Rare Friends Genesis #1 (verified: activated, wallet deployed)
];
const ART = {
    crown: g => {
        const sky = g.createLinearGradient(0, 0, 0, SRC);
        sky.addColorStop(0, '#2F4F7F');
        sky.addColorStop(1, '#B3A0D8');
        g.fillStyle = sky;
        g.fillRect(0, 0, SRC, SRC);
        for (let i = 0; i < 26; i++) {
            g.fillStyle = i % 3 ? '#F4F4F0' : '#CCFF00';
            g.fillRect((i * 47) % 128, (i * 29) % 60, 2, 2);
        }
        g.fillStyle = '#7A4A3A';
        g.fillRect(18, 98, 92, 12);
        const gold = g.createLinearGradient(20, 40, 108, 100);
        gold.addColorStop(0, '#F2CE68');
        gold.addColorStop(0.6, '#e0a93a');
        gold.addColorStop(1, '#8a5a2b');
        g.fillStyle = gold;
        g.beginPath();
        g.moveTo(22, 96);
        g.lineTo(22, 50);
        g.lineTo(42, 70);
        g.lineTo(64, 34);
        g.lineTo(86, 70);
        g.lineTo(106, 50);
        g.lineTo(106, 96);
        g.closePath();
        g.fill();
        g.strokeStyle = '#000';
        g.lineWidth = 3;
        g.stroke();
        const gem = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.fillRect(x - r / 2, y - r / 2, 2, 2); };
        gem(64, 76, 8, '#ED927E');
        gem(40, 82, 5, '#7DB4DB');
        gem(88, 82, 5, '#B9D984');
        gem(22, 48, 4, '#CCFF00');
        gem(64, 32, 5, '#ED927E');
        gem(106, 48, 4, '#CCFF00');
    },
    toast: g => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, SRC, SRC);
        const grad = g.createRadialGradient(64, 70, 10, 64, 70, 60);
        grad.addColorStop(0, '#e8c690');
        grad.addColorStop(1, '#8a5a2b');
        g.fillStyle = '#3b2412';
        g.beginPath();
        g.arc(40, 42, 22, Math.PI, 0);
        g.arc(88, 42, 22, Math.PI, 0);
        g.lineTo(108, 112);
        g.lineTo(20, 112);
        g.closePath();
        g.fill();
        g.fillStyle = grad;
        g.beginPath();
        g.arc(40, 46, 16, Math.PI, 0);
        g.arc(88, 46, 16, Math.PI, 0);
        g.lineTo(100, 106);
        g.lineTo(28, 106);
        g.closePath();
        g.fill();
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(50, 70, 6, 0, 7);
        g.arc(78, 70, 6, 0, 7);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(52, 68, 2, 0, 7);
        g.arc(80, 68, 2, 0, 7);
        g.fill();
        g.strokeStyle = '#111';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(64, 80, 12, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
        g.fillStyle = '#f6e27a';
        g.fillRect(52, 20, 24, 14);
        g.fillStyle = '#c9a53a';
        g.fillRect(52, 30, 24, 4);
    },
    rock: g => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, SRC, SRC);
        for (let i = 0; i < 40; i++) {
            g.fillStyle = '#fff';
            g.fillRect((i * 37) % 128, (i * 71) % 128, 2, 2);
        }
        const grad = g.createRadialGradient(48, 44, 6, 64, 64, 52);
        grad.addColorStop(0, '#f0f0f0');
        grad.addColorStop(1, '#3a3a3a');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(64, 64, 46, 0, 7);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,.45)';
        [[48, 50, 9], [80, 42, 6], [74, 80, 12], [44, 82, 5]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
        g.strokeStyle = '#ddd';
        g.lineWidth = 5;
        g.beginPath();
        g.ellipse(64, 66, 62, 14, -0.3, 0.1 * Math.PI, 0.95 * Math.PI);
        g.stroke();
        g.fillStyle = '#000';
        g.beginPath();
        g.arc(56, 60, 4, 0, 7);
        g.arc(72, 60, 4, 0, 7);
        g.fill();
    },
    ghost: g => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, SRC, SRC);
        const grad = g.createLinearGradient(0, 16, 0, 116);
        grad.addColorStop(0, '#d8d8d8');
        grad.addColorStop(1, '#6d6d6d');
        g.fillStyle = '#1a1a1a';
        g.beginPath();
        g.arc(60, 54, 36, Math.PI, 0);
        g.lineTo(96, 110);
        for (let i = 0; i < 6; i++)
            g.lineTo(96 - i * 12 - 6, i % 2 ? 110 : 100);
        g.lineTo(24, 110);
        g.closePath();
        g.fill();
        g.fillStyle = grad;
        g.beginPath();
        g.arc(60, 56, 31, Math.PI, 0);
        g.lineTo(91, 104);
        for (let i = 0; i < 6; i++)
            g.lineTo(91 - i * 11 - 5, i % 2 ? 104 : 96);
        g.lineTo(29, 104);
        g.closePath();
        g.fill();
        g.fillStyle = '#000';
        g.beginPath();
        g.ellipse(48, 52, 5, 8, 0, 0, 7);
        g.ellipse(70, 52, 5, 8, 0, 0, 7);
        g.fill();
        g.fillStyle = '#222';
        g.fillRect(88, 70, 26, 30);
        g.strokeStyle = '#222';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(114, 84, 8, -1.4, 1.4);
        g.stroke();
        g.strokeStyle = '#888';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(96, 64);
        g.bezierCurveTo(92, 56, 102, 52, 98, 44);
        g.stroke();
    },
    candle: g => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, SRC, SRC);
        g.strokeStyle = '#555';
        g.lineWidth = 1;
        for (let y = 16; y < 128; y += 16) {
            g.beginPath();
            g.moveTo(0, y);
            g.lineTo(128, y);
            g.stroke();
        }
        const bars = [[14, 80, 96], [30, 70, 90], [46, 76, 100], [62, 60, 84]];
        bars.forEach(([x, a, b]) => { g.fillStyle = '#777'; g.fillRect(x, a, 10, b - a); g.fillRect(x + 4, a - 8, 2, b - a + 16); });
        const grad = g.createLinearGradient(80, 0, 110, 0);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(1, '#9a9a9a');
        g.fillStyle = grad;
        g.fillRect(82, 36, 26, 86);
        g.fillStyle = '#ccc';
        g.fillRect(94, 26, 2, 12);
        const fl = g.createRadialGradient(95, 18, 1, 95, 18, 12);
        fl.addColorStop(0, '#fff');
        fl.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = fl;
        g.beginPath();
        g.ellipse(95, 16, 7, 13, 0, 0, 7);
        g.fill();
    },
};
function artCanvas(name) {
    const c = document.createElement('canvas');
    c.width = c.height = SRC;
    ART[name](c.getContext('2d'));
    return c;
}
export function drawArt(name) { return bytesToB64(grayFromCanvas(artCanvas(name))); }
export function drawArtRGB(name) { return bytesToB64(rgbFromCanvas(artCanvas(name))); }
const MEMES = [
    { art: 'toast', name: 'Toasty', ticker: 'TOAST', desc: 'gm. the bread is warm and so is the curve.', creator: 0, invert: false, hoursAgo: 70, trades: 90, heat: 1.4 },
    { art: 'rock', name: 'Moon Rock', ticker: 'ROCK', desc: 'A literal rock that went to the moon. Held by Friends, drawn by a Gen-3.', creator: 1, invert: true, hoursAgo: 46, trades: 60, heat: 1 },
    { art: 'ghost', name: 'gm ghost', ticker: 'BOO', desc: 'Haunts your wallet only before coffee. Creator bought 0.25 WETH at launch and locked it for 30 days.', creator: 2, invert: false, hoursAgo: 20, trades: 45, heat: 0.8, cbWeth: 0.25, cbLock: 30 },
    { art: 'candle', name: 'Last Candle', ticker: 'WICK', desc: 'One green candle to rule them all. Gen-6 art: fewer pixels, more conviction.', creator: 3, invert: true, hoursAgo: 6, trades: 26, heat: 0.6 },
];
export const BOT_COUNT = 14;
export function botHolder(i, r = rng(1000 + i)) {
    const hex = Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
    return { key: `bot:${i}`, kind: 'bot', label: `bot ${hex.slice(0, 4)}`, addr: `0x${hex}` };
}
export function botFriendHolder(f) {
    return { key: friendKey(f.collection, f.tokenId), kind: 'botFriend', label: `Friend #${f.tokenId}`, addr: f.tba ?? '', friend: { ...f, verified: undefined } };
}
function seedMeme(m, mi) {
    const now = Date.now();
    const r = rng(42 + mi * 7);
    const creator = SEED_FRIENDS[m.creator];
    const start = now - m.hoursAgo * 3600_000;
    const t = launch({ name: m.name, ticker: m.ticker, desc: m.desc, creator: { ...creator }, src: drawArt(m.art), srcRGB: m.rgb ? drawArtRGB(m.art) : undefined, invert: m.invert, createdAt: start, seeded: true, tax: seedTax(m.ticker) });
    t.minDivBalance = ECON.defaultMinDividendBalance;
    const friendHolders = SEED_FRIENDS.filter((_, i) => i !== m.creator && r() < 0.6).map(f => friendKey(f.collection, f.tokenId));
    const bots = Array.from({ length: BOT_COUNT }, (_, i) => `bot:${i}`).filter(() => r() < 0.75);
    const pool = [...friendHolders, ...bots];
    const creatorKey = friendKey(creator.collection, creator.tokenId);
    // creator buy: first trade on the curve, untaxed, into the creator Friend's wallet (paid by the demo creator, not by you)
    creatorBuy(t, m.cbWeth ?? 0.05 + r() * 0.15, null, m.cbLock ?? 0, start);
    for (let k = 0; k < m.trades; k++) {
        const at = start + ((k + 1) / (m.trades + 1)) * (now - start - 60_000);
        const who = pool[Math.floor(r() * pool.length)];
        const bal = t.balances[who] ?? 0;
        if (bal > 0 && r() < 0.28)
            sell(t, who, bal * (0.2 + r() * 0.6), true, at);
        else
            buy(t, who, (0.01 + r() * r() * 0.6) * m.heat, true, at);
    }
    Object.keys(t.balances).forEach(k => refreshWeight(t, k));
    return t;
}
const GENESIS_MEME = { art: 'crown', name: 'Genesis Crown', ticker: 'CROWN', desc: 'Launched by Genesis Friend #1 — the only tier drawn at 128×128, in colour.', creator: 10, invert: false, hoursAgo: 30, trades: 55, heat: 1.2, rgb: true };
/** Makes sure every seeded demo token exists (older saves may miss the Genesis token or had tokens re-seeded for per-token taxes). */
export function ensureSeeds(s) {
    useState(s);
    SEED_FRIENDS.forEach(f => ensureHolder(botFriendHolder(f)));
    const have = new Set(s.order.map(id => s.tokens[id]).filter(t => t.seeded).map(t => t.ticker));
    let added = false;
    [...MEMES, GENESIS_MEME].forEach((m, i) => { if (!have.has(m.ticker)) {
        seedMeme(m, i === MEMES.length ? 9 : i);
        added = true;
    } });
    s.genesisSeeded = true;
    if (added)
        s.order.sort((a, b) => s.tokens[b].createdAt - s.tokens[a].createdAt);
    return added;
}
export function buildSeedState() {
    const s = emptyState();
    useState(s);
    for (let i = 0; i < BOT_COUNT; i++)
        ensureHolder(botHolder(i));
    SEED_FRIENDS.forEach(f => ensureHolder(botFriendHolder(f)));
    const now = Date.now();
    ensureSeeds(s);
    // newest first
    s.order.sort((a, b) => s.tokens[b].createdAt - s.tokens[a].createdAt);
    return s;
}
