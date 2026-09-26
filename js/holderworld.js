// Holder world: every token gets a FriendSDK isometric location. Holders that are ACTIVATED Friends walk around it as
// their canonical on-chain sprites (SDK sprite registry + SDK movement/path finding); wallets without an active Friend
// float above it as balls. Size = share of circulating supply. Creator Friend is highlighted.
import { WORLD_PRESETS, renderWorldLayers, project, isWorldWalkable } from '../vendor/friendsdk/friend-world.js';
import { createWorldMovement } from '../vendor/friendsdk/movement.js';
import { holdersSorted, circulating } from './sim.js';
import { readSprites, spriteFrame } from './sprites.js';
import { esc, fmt } from './util.js';
const TOP_N = 24;
const ACCENT = '#CCFF00';
const prepCache = new Map();
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function worldForToken(t) {
    const complete = WORLD_PRESETS.filter(w => w.variant === 'complete');
    return complete[hash(t.id + t.ticker) % complete.length];
}
function svgImage(svg) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    return img.decode().then(() => { URL.revokeObjectURL(url); return img; });
}
function cropFor(world) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const poly of world.geometry.polygons)
        for (const [x, y] of poly) {
            const [sx, sy] = project(x, y);
            x0 = Math.min(x0, sx);
            x1 = Math.max(x1, sx);
            y0 = Math.min(y0, sy);
            y1 = Math.max(y1, sy);
        }
    y0 -= 150; // room for props, characters and floating wallets
    y1 += world.geometry.depth + 20;
    x0 -= 30;
    x1 += 30;
    let w = x1 - x0, h = y1 - y0;
    if (w / h > 1.5) {
        const nh = w / 1.5;
        y0 -= (nh - h) * 0.75;
        h = nh;
    }
    else {
        const nw = h * 1.5;
        x0 -= (nw - w) / 2;
        w = nw;
    }
    return { x: x0, y: y0, w, h };
}
async function prepare(world, res) {
    const key = `${world.id}@${res.toFixed(2)}`;
    if (!prepCache.has(key))
        prepCache.set(key, (async () => {
            const crop = cropFor(world);
            const layers = renderWorldLayers(world, { background: 'black', signals: false });
            const raster = (img) => {
                const c = document.createElement('canvas');
                c.width = Math.ceil(crop.w * res);
                c.height = Math.ceil(crop.h * res);
                const g = c.getContext('2d', { willReadFrequently: true });
                g.setTransform(res, 0, 0, res, -crop.x * res, -crop.y * res);
                g.drawImage(img, 0, 0, 1600, 1200);
                return c;
            };
            const terrain = raster(await svgImage(layers.terrainSvg));
            const props = [];
            for (const o of layers.objects) {
                const full = raster(await svgImage(o.svg));
                const d = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
                let bx0 = full.width, by0 = full.height, bx1 = -1, by1 = -1;
                for (let y = 0; y < full.height; y++)
                    for (let x = 0; x < full.width; x++)
                        if (d[(y * full.width + x) * 4 + 3]) {
                            if (x < bx0)
                                bx0 = x;
                            if (x > bx1)
                                bx1 = x;
                            if (y < by0)
                                by0 = y;
                            if (y > by1)
                                by1 = y;
                        }
                if (bx1 < 0)
                    continue;
                const c = document.createElement('canvas');
                c.width = bx1 - bx0 + 1;
                c.height = by1 - by0 + 1;
                c.getContext('2d').drawImage(full, -bx0, -by0);
                props.push({ depth: o.depth, canvas: c, x: crop.x + bx0 / res, y: crop.y + by0 / res, w: c.width / res, h: c.height / res });
            }
            return { world, crop, terrain, props, res };
        })());
    return prepCache.get(key);
}
function randomWalkable(world, r) {
    for (let i = 0; i < 300; i++) {
        const p = [8 + r() * 560, 8 + r() * 368];
        if (isWorldWalkable(world, p, 8))
            return p;
    }
    return null;
}
export class HolderWorld {
    box;
    canvas;
    g;
    tip;
    caption;
    list;
    prep = null;
    actors = new Map();
    raf = 0;
    last = 0;
    visible = true;
    io;
    rnd;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    mouse = null;
    token;
    ctx;
    world;
    constructor(box, token, ctx) {
        this.box = box;
        this.token = token;
        this.ctx = ctx;
        this.world = worldForToken(token);
        let s = hash(token.id) || 1;
        this.rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        box.innerHTML = `<div class="hw-stage"><canvas class="hw" role="img"></canvas><div class="hw-tip" hidden></div><div class="hw-loading muted small">Loading ${esc(this.world.name)}…</div></div>
      <div class="legend small muted"><span><i class="lg-sq"></i>activated Friend — walks</span><span><i class="lg-dot"></i>wallet without an active Friend — floats</span><span><i class="lg-you"></i>you</span><span>size = share</span><span class="hw-cap"></span></div>
      <details class="hw-list small"><summary>Holder list</summary><ol></ol></details>`;
        this.canvas = box.querySelector('canvas');
        this.g = this.canvas.getContext('2d');
        this.tip = box.querySelector('.hw-tip');
        this.caption = box.querySelector('.hw-cap');
        this.list = box.querySelector('.hw-list ol');
        this.canvas.width = 960 * this.dpr;
        this.canvas.height = 640 * this.dpr;
        this.canvas.addEventListener('mousemove', e => { const r = this.canvas.getBoundingClientRect(); this.mouse = { x: (e.clientX - r.left) / r.width * 960, y: (e.clientY - r.top) / r.height * 640 }; if (ctx.reduced)
            this.draw(); });
        this.canvas.addEventListener('mouseleave', () => { this.mouse = null; this.tip.hidden = true; if (ctx.reduced)
            this.draw(); });
        this.io = new IntersectionObserver(es => { this.visible = es.some(e => e.isIntersecting); if (this.visible)
            this.kick(); });
        this.io.observe(this.canvas);
        const res = 960 / cropFor(this.world).w * this.dpr;
        prepare(this.world, res).then(p => {
            this.prep = p;
            box.querySelector('.hw-loading')?.remove();
            this.sync(this.token, this.ctx);
            this.kick();
        }).catch(e => { console.error(e); const l = box.querySelector('.hw-loading'); if (l)
            l.textContent = 'World failed to load'; });
    }
    destroy() { cancelAnimationFrame(this.raf); this.raf = 0; this.io?.disconnect(); }
    kick() {
        if (this.raf || !this.prep)
            return;
        this.last = performance.now();
        const loop = (now) => {
            this.raf = 0;
            if (!this.box.isConnected)
                return this.destroy();
            const dt = Math.max(0, Math.min(50, now - this.last));
            this.last = now;
            this.step(dt, now);
            this.draw();
            if (this.visible && !this.ctx.reduced)
                this.raf = requestAnimationFrame(loop);
        };
        this.raf = requestAnimationFrame(loop);
    }
    /** Recompute who is on the map and how big they are. Cheap; call on every state change. */
    sync(token, ctx) {
        this.token = token;
        this.ctx = ctx;
        if (!this.prep)
            return;
        const supply = Math.max(1, circulating(token));
        const all = holdersSorted(token);
        const shown = all.slice(0, TOP_N);
        if (!shown.some(([k]) => k === token.creatorKey))
            shown.push([token.creatorKey, token.balances[token.creatorKey] ?? 0]);
        const keep = new Set();
        for (const [key, bal] of shown) {
            keep.add(key);
            const inf = ctx.info(key);
            const f = inf.friend;
            const creator = key === token.creatorKey;
            const walking = !!f && f.collection === 'generations' && (f.weightRF > 0 || creator);
            const share = bal / supply;
            let a = this.actors.get(key);
            if (a && (a.kind === 'friend') !== walking) {
                this.actors.delete(key);
                a = undefined;
            }
            if (!a)
                a = this.spawn(key, walking ? 'friend' : 'ball', f?.tokenId);
            a.label = creator ? `${inf.label.replace(' (yours)', '')} · creator` : inf.label;
            a.genesis = f?.collection === 'genesis';
            a.bal = bal;
            a.share = share;
            a.creator = creator;
            a.you = key === ctx.you;
            a.mine = ctx.myFriendKeys.has(key) || a.you;
            a.target = a.kind === 'friend' ? Math.max(creator ? 6 : 4, Math.min(11, 4 + 12 * Math.sqrt(share))) : Math.max(7, Math.min(75, 7 + 85 * Math.sqrt(share)));
            a.alive = true;
        }
        for (const [k, a] of this.actors)
            if (!keep.has(k))
                a.alive = false;
        const rest = Math.max(0, all.length - TOP_N);
        this.caption.textContent = rest > 0 ? `+${rest} more holders not shown` : '';
        this.canvas.setAttribute('aria-label', `${this.world.name}: ${all.length} holders of $${token.ticker}. ${[...this.actors.values()].filter(a => a.kind === 'friend').length} activated Friends walking, creator Friend #${token.creator.tokenId}.`);
        this.list.innerHTML = all.slice(0, 40).map(([k, b]) => { const i = ctx.info(k); return `<li>${esc(i.label)}${k === token.creatorKey ? ' (creator)' : ''} — ${fmt(b)} (${(b / supply * 100).toFixed(2)}%)</li>`; }).join('');
        if (this.ctx.reduced)
            this.draw();
    }
    spawn(key, kind, friendId) {
        const w = this.world, r = this.rnd, crop = this.prep.crop;
        const a = { key, kind, label: '', bal: 0, share: 0, creator: false, you: false, mine: false, genesis: false, friendId, idleUntil: 0, lastSide: 'right', frameT: r() * 1000,
            scale: 0, target: 0, x: 0, y: 0, vx: 0, vy: 0, phase: r() * Math.PI * 2, alive: true, alpha: 0 };
        if (kind === 'friend') {
            const anchor = key === this.token.creatorKey ? w.actors.find(p => isWorldWalkable(w, [p.x, p.y], 8)) : undefined;
            const p = anchor ? [anchor.x, anchor.y] : randomWalkable(w, r);
            if (p) {
                try {
                    a.mover = createWorldMovement(w, p, { speed: 40 + r() * 35, radius: 7 });
                }
                catch { /* not walkable */ }
            }
            a.idleUntil = performance.now() + 400 + r() * 2500;
            if (friendId)
                readSprites(friendId).then(s => { a.sprites = s; if (this.ctx.reduced)
                    this.draw(); }).catch(() => { a.sprites = null; });
        }
        else {
            a.x = crop.x + crop.w * (0.1 + r() * 0.8);
            a.y = crop.y + crop.h * (0.08 + r() * 0.45);
            const ang = r() * Math.PI * 2, sp = 8 + r() * 14;
            a.vx = Math.cos(ang) * sp;
            a.vy = Math.sin(ang) * sp * 0.6;
        }
        this.actors.set(key, a);
        return a;
    }
    step(dt, now) {
        const crop = this.prep.crop;
        for (const [k, a] of this.actors) {
            const k1 = 1 - Math.pow(0.004, dt / 1000); // smooth growth
            a.scale = Math.max(0, a.scale + ((a.alive ? a.target : 0) - a.scale) * k1);
            a.alpha = Math.min(1, Math.max(0, a.alpha + ((a.alive ? 1 : 0) - a.alpha) * k1));
            if (!a.alive && a.alpha < 0.02) {
                this.actors.delete(k);
                continue;
            }
            a.frameT += dt;
            if (a.kind === 'friend' && a.mover) {
                const st = a.mover.state;
                if (!st.walking && !st.destination && now > a.idleUntil) {
                    const p = randomWalkable(this.world, this.rnd);
                    if (!p || !a.mover.moveTo(p))
                        a.idleUntil = now + 800;
                    else
                        a.idleUntil = Infinity;
                }
                a.mover.update(dt);
                const s2 = a.mover.state;
                if (!s2.walking && !s2.destination && a.idleUntil === Infinity)
                    a.idleUntil = now + 1500 + this.rnd() * 4500;
                if (s2.facing === 'left' || s2.facing === 'right')
                    a.lastSide = s2.facing;
            }
            else if (a.kind === 'ball') {
                a.x += a.vx * dt / 1000;
                a.y += a.vy * dt / 1000;
                const r = a.scale;
                if (a.x < crop.x + r) {
                    a.x = crop.x + r;
                    a.vx = Math.abs(a.vx);
                }
                if (a.x > crop.x + crop.w - r) {
                    a.x = crop.x + crop.w - r;
                    a.vx = -Math.abs(a.vx);
                }
                if (a.y < crop.y + r) {
                    a.y = crop.y + r;
                    a.vy = Math.abs(a.vy);
                }
                if (a.y > crop.y + crop.h * 0.8 - r) {
                    a.y = crop.y + crop.h * 0.8 - r;
                    a.vy = -Math.abs(a.vy);
                }
            }
        }
        this.separate();
    }
    /** Keep floating wallets clear of each other, of walking Friends (sprite + label) and of the top edge (label room). */
    separate() {
        const crop = this.prep.crop, k = 960 / crop.w;
        const labelH = 20 / k; // label height in native units
        const balls = [...this.actors.values()].filter(a => a.kind === 'ball' && a.alive);
        const boxes = [...this.actors.values()].filter(a => a.kind === 'friend' && a.mover && a.alive).map(a => {
            const [sx, sy] = project(a.mover.state.position[0], a.mover.state.position[1]);
            const s = a.scale;
            return { x0: sx - 9 * s - 4, x1: sx + 9 * s + 4, y0: sy - 16 * s - labelH - (a.creator || a.mine ? 12 / k : 0), y1: sy + 2 * s };
        });
        for (let iter = 0; iter < 2; iter++) {
            for (let i = 0; i < balls.length; i++) {
                const a = balls[i];
                for (let j = i + 1; j < balls.length; j++) {
                    const b = balls[j];
                    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01;
                    const min = a.scale + b.scale + 6 + labelH * 0.5;
                    if (dist < min) {
                        const push = (min - dist) / 2, ux = dx / dist, uy = dy / dist;
                        a.x -= ux * push;
                        a.y -= uy * push;
                        b.x += ux * push;
                        b.y += uy * push;
                        if ((b.vx - a.vx) * ux + (b.vy - a.vy) * uy < 0) {
                            [a.vx, b.vx] = [b.vx, a.vx];
                            [a.vy, b.vy] = [b.vy, a.vy];
                        }
                    }
                }
                for (const bx of boxes) {
                    const nx = Math.min(bx.x1, Math.max(bx.x0, a.x)), ny = Math.min(bx.y1, Math.max(bx.y0, a.y));
                    const dx = a.x - nx, dy = a.y - ny, dist = Math.hypot(dx, dy);
                    const r = a.scale + 4;
                    if (dist >= r)
                        continue;
                    if (dist < 0.01) {
                        a.y = bx.y0 - r;
                        a.vy = -Math.abs(a.vy);
                        continue;
                    } // centre inside the box: lift it out
                    a.x += dx / dist * (r - dist);
                    a.y += dy / dist * (r - dist);
                    if (dx * a.vx + dy * a.vy < 0) {
                        a.vx = dx / dist * Math.abs(a.vx) || a.vx;
                        a.vy = dy / dist * Math.abs(a.vy) || a.vy;
                    }
                }
                const r = a.scale;
                a.x = Math.min(crop.x + crop.w - r, Math.max(crop.x + r, a.x));
                a.y = Math.min(crop.y + crop.h * 0.8 - r, Math.max(crop.y + r + labelH, a.y));
            }
        }
    }
    draw() {
        const p = this.prep;
        if (!p)
            return;
        const g = this.g, k = 960 / p.crop.w, d = this.dpr;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#000';
        g.fillRect(0, 0, this.canvas.width, this.canvas.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(p.terrain, 0, 0);
        // world transform: native coords → canvas
        const T = (x, y) => [(x - p.crop.x) * k * d, (y - p.crop.y) * k * d];
        const items = p.props.map(pr => ({ depth: pr.depth, draw: () => { const [x, y] = T(pr.x, pr.y); g.drawImage(pr.canvas, Math.round(x), Math.round(y)); } }));
        const labels = [];
        const now = performance.now();
        for (const a of this.actors.values()) {
            if (a.kind !== 'friend' || !a.mover)
                continue;
            const st = a.mover.state;
            items.push({ depth: st.position[0] + st.position[1], draw: () => {
                    const [sx, sy] = project(st.position[0], st.position[1]);
                    const [cx, cy] = T(sx, sy);
                    const px = a.scale * k * d; // canvas px per sprite pixel
                    const w = 18 * px;
                    const x = cx - 9 * px, y = cy - 16 * px;
                    g.globalAlpha = a.alpha;
                    // ground shadow
                    g.fillStyle = 'rgba(0,0,0,.35)';
                    g.beginPath();
                    g.ellipse(cx, cy, 6 * px, 2 * px, 0, 0, Math.PI * 2);
                    g.fill();
                    if (a.sprites) {
                        const fps = st.walking ? 10 : 4;
                        const frame = Math.floor(a.frameT / (1000 / fps)) % 8;
                        g.drawImage(spriteFrame(a.sprites, st.facing, st.walking, this.ctx.reduced ? 0 : frame, a.lastSide), x, y, w, w);
                    }
                    else {
                        g.fillStyle = '#fff';
                        g.fillRect(x + 4 * px, y + 3 * px, 10 * px, 13 * px);
                        g.fillStyle = '#000';
                        g.fillRect(x + 5 * px, y + 4 * px, 8 * px, 11 * px);
                    }
                    if (a.creator || a.mine) {
                        g.fillStyle = ACCENT;
                        const mx = cx, my = y - 3 * d;
                        g.beginPath();
                        g.moveTo(mx - 4 * d, my - 6 * d);
                        g.lineTo(mx + 4 * d, my - 6 * d);
                        g.lineTo(mx, my);
                        g.closePath();
                        g.fill();
                    }
                    g.globalAlpha = 1;
                    a.hit = { x: x / d, y: y / d, w: w / d, h: w / d };
                    labels.push({ text: a.creator ? a.label.replace('Friend ', '') : a.label.replace('Friend ', '').replace(' (yours)', ''), x: cx / d, y: (y / d) - (a.creator || a.mine ? 12 : 3), strong: a.creator, accent: a.mine });
                } });
        }
        items.sort((a, b) => a.depth - b.depth).forEach(i => i.draw());
        // floating wallets (above the world)
        for (const a of this.actors.values()) {
            if (a.kind !== 'ball')
                continue;
            const bob = this.ctx.reduced ? 0 : Math.sin(now / 900 + a.phase) * 4;
            const [cx, cy] = T(a.x, a.y + bob);
            const r = a.scale * k * d;
            g.globalAlpha = a.alpha * 0.9;
            g.fillStyle = a.you ? ACCENT : a.genesis ? '#F2CE68' : '#2b2b29';
            g.strokeStyle = a.you || a.genesis ? '#000' : '#8a8a86';
            g.lineWidth = 1.2 * d;
            g.beginPath();
            g.arc(cx, cy, r, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.globalAlpha = 1;
            a.hit = { cx: cx / d, cy: cy / d, r: r / d };
            if (a.you || a.mine || a.genesis || a.creator || a.share > 0.08)
                labels.push({ text: a.you ? 'you' : a.label.replace('Friend ', ''), x: cx / d, y: cy / d - r / d - 4, strong: false, accent: a.you || a.mine });
        }
        // labels last, greedy de-overlap: creator & yours first
        g.setTransform(d, 0, 0, d, 0, 0);
        g.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        const placed = [];
        labels.sort((a, b) => Number(b.strong || b.accent) - Number(a.strong || a.accent));
        for (const l of labels) {
            const w = g.measureText(l.text).width + 8, h = 15;
            // clamp inside the canvas so edge labels are never clipped
            const cw = this.canvas.width / d, ch = this.canvas.height / d;
            const r = { x: Math.min(cw - w - 2, Math.max(2, l.x - w / 2)), y: Math.min(ch - h - 2, Math.max(2, l.y - h)), w, h };
            l.x = r.x + w / 2;
            l.y = r.y + h;
            if (placed.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h))
                continue;
            placed.push(r);
            g.fillStyle = 'rgba(0,0,0,.75)';
            g.fillRect(r.x, r.y, r.w, r.h);
            g.fillStyle = l.accent || l.strong ? ACCENT : '#f4f4f0';
            g.fillText(l.text, l.x, l.y - 2);
        }
        this.hover();
    }
    hover() {
        const m = this.mouse;
        if (!m)
            return;
        let hit = null;
        const arr = [...this.actors.values()].filter(a => a.alive && a.hit);
        for (const a of arr.reverse()) {
            const h = a.hit;
            if ('r' in h ? Math.hypot(m.x - h.cx, m.y - h.cy) <= h.r + 3 : m.x >= h.x && m.x <= h.x + h.w && m.y >= h.y && m.y <= h.y + h.h) {
                hit = a;
                break;
            }
        }
        if (!hit) {
            this.tip.hidden = true;
            this.canvas.style.cursor = '';
            return;
        }
        this.canvas.style.cursor = 'pointer';
        this.tip.hidden = false;
        this.tip.innerHTML = `<b>${esc(hit.you ? 'You' : hit.label)}</b><br>${fmt(hit.bal)} $${esc(this.token.ticker)} · ${(hit.share * 100).toFixed(2)}%<br><span class="muted">${hit.kind === 'friend' ? 'activated Friend wallet' : hit.genesis ? 'Genesis Friend wallet (Genesis has no walking sprite)' : 'wallet without an active Friend'}</span>`;
        const r = this.canvas.getBoundingClientRect();
        const sx = r.width / 960;
        this.tip.style.left = `${Math.min(r.width - 180, m.x * sx + 12)}px`;
        this.tip.style.top = `${Math.max(0, m.y * sx - 10)}px`;
    }
}
