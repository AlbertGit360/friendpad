import { holdersSorted, circulating } from './sim.js';
import { ECON } from './config.js';
import { esc, fmt } from './util.js';
const NS = 'http://www.w3.org/2000/svg';
export function renderHolderMap(box, t, ctx) {
    const supply = Math.max(1, circulating(t));
    const all = holdersSorted(t);
    const others = all.filter(([k]) => k !== t.creatorKey);
    const top = others.slice(0, ECON.holderMapTopN);
    const rest = others.slice(ECON.holderMapTopN);
    const creatorBal = t.balances[t.creatorKey] ?? 0;
    const R = (share) => 8 + 95 * Math.sqrt(share);
    const items = [];
    const cInfo = ctx.info(t.creatorKey);
    items.push({ key: t.creatorKey, r: Math.max(30, R(creatorBal / supply) + 10), x: 0, y: 0, share: creatorBal / supply, bal: creatorBal, kind: 'creator', label: cInfo.label + ' · creator', friend: t.creator });
    for (const [k, b] of top) {
        const i = ctx.info(k);
        items.push({ key: k, r: R(b / supply), x: 0, y: 0, share: b / supply, bal: b, kind: k === ctx.you ? 'you' : i.friend ? 'friend' : 'dot', label: i.label, friend: i.friend });
    }
    if (rest.length) {
        const b = rest.reduce((a, [, v]) => a + v, 0);
        items.push({ key: '__others', r: Math.max(`+${rest.length} others`.length * 3.4 + 6, R(b / supply) * 0.8), x: 0, y: 0, share: b / supply, bal: b, kind: 'others', label: `+${rest.length} others`, others: rest.length });
    }
    // Greedy spiral placement. Each node reserves a box for its shape AND its label, so nothing overlaps or gets covered.
    const LABEL_H = 14, CHAR_W = 6.2, PAD = 6;
    const labelOf = (it) => it.kind === 'dot' || it.kind === 'others' ? '' : it.kind === 'you' ? 'you' : it.kind === 'creator' ? `#${it.friend?.tokenId ?? ''} · creator` : it.label.replace(' (yours)', '').replace('Friend ', '');
    const fp = (it, x, y) => {
        const lw = labelOf(it).length * CHAR_W;
        const hw = Math.max(it.r, lw / 2);
        return { x0: x - hw - PAD, x1: x + hw + PAD, y0: y - it.r - PAD, y1: y + it.r + (lw ? LABEL_H + 2 : 0) + PAD };
    };
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const placed = [items[0]];
    const boxes = [fp(items[0], 0, 0)];
    for (const it of items.slice(1)) {
        const off = (hash(it.key) % 360) * (Math.PI / 180);
        let done = false;
        for (let d = items[0].r + it.r + 8; !done && d < 3000; d += 5) {
            const steps = Math.max(16, Math.floor((2 * Math.PI * d) / 9));
            for (let s = 0; s < steps; s++) {
                const a = off + (s / steps) * Math.PI * 2;
                const x = Math.cos(a) * d * 1.3, y = Math.sin(a) * d * 0.8;
                const bx = fp(it, x, y);
                if (!boxes.some(o => hit(o, bx))) {
                    it.x = x;
                    it.y = y;
                    boxes.push(bx);
                    done = true;
                    break;
                }
            }
        }
        placed.push(it);
    }
    let minX = -230, maxX = 230, minY = -150, maxY = 150;
    for (const b of boxes) {
        minX = Math.min(minX, b.x0);
        maxX = Math.max(maxX, b.x1);
        minY = Math.min(minY, b.y0);
        maxY = Math.max(maxY, b.y1);
    }
    let svg = box.querySelector('svg');
    if (!svg) {
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('role', 'img');
        box.append(svg);
        const legend = document.createElement('div');
        legend.className = 'legend small muted';
        legend.innerHTML = `<span><i class="lg-sq"></i>Friend wallet (sprite)</span><span><i class="lg-dot"></i>other holder</span><span><i class="lg-you"></i>you</span>`;
        box.append(legend);
    }
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    svg.setAttribute('aria-label', `Holder map: ${all.length} holders, creator Friend #${t.creator.tokenId} in the center`);
    const keep = new Set(placed.map(p => p.key));
    svg.querySelectorAll('g.node').forEach(n => { if (!keep.has(n.dataset.k))
        n.remove(); });
    for (const it of placed) {
        let n = svg.querySelector(`g.node[data-k="${cssEsc(it.key)}"]`);
        const fresh = !n;
        if (!n) {
            n = document.createElementNS(NS, 'g');
            n.dataset.k = it.key;
            n.innerHTML = `<g class="sc"></g><text class="lbl" text-anchor="middle"></text><title></title>`;
            svg.append(n);
            n.style.transform = `translate(${it.x}px, ${it.y}px)`;
        }
        n.setAttribute('class', `node ${it.kind}`);
        const sc = n.querySelector('.sc');
        const spr = it.kind === 'creator' ? (ctx.creatorSprite ?? (it.friend ? ctx.sprite(it.friend.collection, it.friend.tokenId) : undefined))
            : it.friend ? ctx.sprite(it.friend.collection, it.friend.tokenId) : undefined;
        const want = shapeKey(it, spr);
        if (sc.dataset.shape !== want) {
            sc.innerHTML = shape(it, spr);
            sc.dataset.shape = want;
        }
        const lbl = n.querySelector('text');
        lbl.textContent = labelOf(it);
        lbl.setAttribute('y', String(it.r + 12));
        n.style.setProperty('--r', String(it.r));
        n.querySelector('title').textContent = `${it.label}: ${fmt(it.bal)} ${t.ticker} (${(it.share * 100).toFixed(2)}%)`;
        if (it.kind === 'others') {
            sc.querySelector('text')?.remove();
        }
        const apply = () => {
            n.style.transform = `translate(${it.x}px, ${it.y}px)`;
            sc.style.transform = `scale(${it.r})`;
        };
        if (fresh && !ctx.reduced) {
            sc.style.transform = 'scale(0.01)';
            requestAnimationFrame(() => requestAnimationFrame(apply));
        }
        else
            apply();
        if (it.kind === 'others') {
            let tx = n.querySelector('text.oth');
            if (!tx) {
                tx = document.createElementNS(NS, 'text');
                tx.setAttribute('class', 'oth');
                tx.setAttribute('text-anchor', 'middle');
                tx.setAttribute('dy', '4');
                n.append(tx);
            }
            tx.textContent = it.label;
        }
    }
    // keep creator on top
    const c = svg.querySelector('g.node.creator');
    if (c)
        svg.append(c);
}
function shapeKey(it, spr) { return `${it.kind}:${spr ? spr.length : 0}`; }
function shape(it, spr) {
    if ((it.kind === 'friend' || it.kind === 'creator' || (it.kind === 'you' && it.friend)) && spr) {
        return `<rect x="-1" y="-1" width="2" height="2" class="frame" vector-effect="non-scaling-stroke"/><image href="${esc(spr)}" x="-0.94" y="-0.94" width="1.88" height="1.88" preserveAspectRatio="xMidYMid slice" style="image-rendering:pixelated"/>`;
    }
    if (it.kind === 'friend' || it.kind === 'creator')
        return `<rect x="-1" y="-1" width="2" height="2" class="frame ph" vector-effect="non-scaling-stroke"/>`;
    if (it.kind === 'others')
        return `<circle r="1" class="others" vector-effect="non-scaling-stroke"/>`;
    return `<circle r="1" class="${it.kind === 'you' ? 'you' : 'dot'}" vector-effect="non-scaling-stroke"/>`;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function cssEsc(s) { return s.replace(/["\\]/g, '\\$&'); }
