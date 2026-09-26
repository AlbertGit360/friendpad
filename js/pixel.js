// Pixelizer: any image → Rare Friends-style 1-bit pixel art (Atkinson diffusion on Gen-1…3, ordered Bayer on Gen-4…6).
// Grid size depends on the creator Friend's generation (see GRID_BY_GEN).
export const SRC = 128; // normalized grayscale source kept per token (lets us re-render on promotion)
export const INK = '#f4f4f0';
export const PAPER = '#000000';
/** Load a File/Blob or URL into a square, center-cropped grayscale buffer (SRC×SRC, 0..255). */
export async function toGraySource(src) {
    return (await toSources(src)).gray;
}
/** Gray + RGB (SRC×SRC×3) sources in one decode. RGB is only kept for Genesis tokens (colour tier). */
export async function toSources(src) {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = SRC;
    const g = c.getContext('2d', { willReadFrequently: true });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, SRC, SRC);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SRC, SRC);
    if (typeof src !== 'string')
        URL.revokeObjectURL(url);
    return { gray: grayFromCanvas(c), rgb: rgbFromCanvas(c) };
}
export function rgbFromCanvas(c) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array(c.width * c.height * 3);
    for (let i = 0; i < c.width * c.height; i++) {
        const a = d[i * 4 + 3] / 255;
        for (let k = 0; k < 3; k++)
            out[i * 3 + k] = Math.round(d[i * 4 + k] * a + 255 * (1 - a));
    }
    return out;
}
export function grayFromCanvas(c) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array(c.width * c.height);
    for (let i = 0; i < out.length; i++) {
        const a = d[i * 4 + 3] / 255;
        const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        out[i] = Math.round(l * a + 255 * (1 - a));
    }
    return out;
}
const BAYER8 = (() => {
    const m = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
    return m.map(r => r.map(v => (v + 0.5) / 64));
})();
/** Grids at or above this size (Gen-1…3, Genesis) use Atkinson error diffusion; smaller grids use ordered Bayer. */
export const DIFFUSE_MIN_GRID = 56;
/** Area-weighted (fractional box) downsample of an SRC×SRC buffer to grid×grid, 0..1. Exact for non-integer ratios like 128→96. */
function resample(src, grid, channels = 1, ch = 0) {
    const scale = SRC / grid;
    // per-output-index source spans with fractional edge weights (same for x and y)
    const spans = [];
    for (let o = 0; o < grid; o++) {
        const a = o * scale, b = (o + 1) * scale;
        const i0 = Math.floor(a), i1 = Math.min(SRC, Math.ceil(b));
        const w = [];
        for (let i = i0; i < i1; i++)
            w.push(Math.min(b, i + 1) - Math.max(a, i));
        spans.push({ i0, w });
    }
    const row = new Float32Array(SRC * grid); // horizontal pass
    for (let y = 0; y < SRC; y++)
        for (let x = 0; x < grid; x++) {
            const { i0, w } = spans[x];
            let s = 0;
            for (let k = 0; k < w.length; k++)
                s += src[(y * SRC + i0 + k) * channels + ch] * w[k];
            row[y * grid + x] = s / scale;
        }
    const out = new Float32Array(grid * grid);
    for (let y = 0; y < grid; y++)
        for (let x = 0; x < grid; x++) {
            const { i0, w } = spans[y];
            let s = 0;
            for (let k = 0; k < w.length; k++)
                s += row[(i0 + k) * grid + x] * w[k];
            out[y * grid + x] = s / scale / 255;
        }
    return out;
}
/** Level normalization: stretch 1st–99th percentile to 0..1, then pull the median toward mid-grey with a gentle gamma. */
function normalizeLevels(v) {
    const n = v.length;
    const sorted = Float32Array.from(v).sort();
    const lo = sorted[Math.floor(n * 0.01)], hi = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    const span = Math.max(0.05, hi - lo);
    const med = Math.min(0.95, Math.max(0.05, (sorted[n >> 1] - lo) / span));
    const gamma = Math.min(1.5, Math.max(0.67, Math.sqrt(Math.log(0.5) / Math.log(med)))); // half-strength correction
    for (let i = 0; i < n; i++)
        v[i] = Math.pow(Math.min(1, Math.max(0, (v[i] - lo) / span)), gamma);
}
/** 3×3 box blur (edge-clamped by averaging only in-bounds neighbours). */
function blur3(v, grid) {
    const out = new Float32Array(v.length);
    for (let y = 0; y < grid; y++)
        for (let x = 0; x < grid; x++) {
            let s = 0, k = 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx >= 0 && yy >= 0 && xx < grid && yy < grid) {
                        s += v[yy * grid + xx];
                        k++;
                    }
                }
            out[y * grid + x] = s / k;
        }
    return out;
}
// Atkinson kernel: 6 neighbours × 1/8 each; 1/4 of the error is dropped, which keeps flats clean and edges crisp.
const ATKINSON = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
/**
 * Pixelize a gray source to a grid×grid bitmap (1 = ink).
 * Pipeline: area-weighted downsample → level normalization → unsharp mask → contrast →
 *   Atkinson error diffusion (grid ≥ DIFFUSE_MIN_GRID: Gen-1…3) or ordered Bayer 8×8 (Gen-4…6).
 * Higher generations get both more pixels and cleaner tones, so sharpness grows monotonically Gen-6 → Gen-1.
 * By default dark areas of the source become ink (light on black), matching the Friends' white-on-black look.
 */
export function pixelize(gray, grid, opts = {}) {
    const n = grid * grid;
    const v = resample(gray, grid);
    normalizeLevels(v);
    const diffuse = grid >= DIFFUSE_MIN_GRID;
    // unsharp mask: strong on tiny grids (legibility), lighter on diffused grids (diffusion already preserves edges)
    const amt = diffuse ? 0.5 : grid <= 32 ? 0.9 : 0.6;
    const bl = blur3(v, grid);
    const contrast = opts.contrast ?? 1.15;
    const ink = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let l = v[i] + amt * (v[i] - bl[i]);
        l = (l - 0.5) * contrast + 0.5;
        ink[i] = 1 - l; // dark source → ink
    }
    const out = new Uint8Array(n);
    if (diffuse) {
        for (let y = 0; y < grid; y++) {
            const rtl = (y & 1) === 1; // serpentine scan avoids directional worms
            for (let j = 0; j < grid; j++) {
                const x = rtl ? grid - 1 - j : j;
                const i = y * grid + x;
                const bit = ink[i] > 0.5 ? 1 : 0;
                const err = (ink[i] - bit) / 8;
                for (const [dx, dy] of ATKINSON) {
                    const xx = x + (rtl ? -dx : dx), yy = y + dy;
                    if (xx >= 0 && xx < grid && yy < grid)
                        ink[yy * grid + xx] += err;
                }
                out[i] = opts.invert ? bit ^ 1 : bit;
            }
        }
        return out;
    }
    // Dither strength: full Bayer on big grids, near-threshold on tiny ones so flat mid-tones don't turn into noise.
    const strength = Math.min(1, Math.max(0.3, (grid - 20) / 70));
    for (let y = 0; y < grid; y++)
        for (let x = 0; x < grid; x++) {
            const i = y * grid + x;
            const t = 0.5 + (BAYER8[y % 8][x % 8] - 0.5) * strength;
            let bit = ink[i] > t ? 1 : 0;
            if (opts.invert)
                bit ^= 1;
            out[i] = bit;
        }
    return out;
}
/** Render a bitmap to a canvas at an integer scale (nearest-neighbour). */
export function drawBits(canvas, bits, grid, px) {
    const size = Math.max(1, Math.floor(px / grid)) * grid;
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(grid, grid);
    const ink = [0xf4, 0xf4, 0xf0], paper = [0, 0, 0];
    for (let i = 0; i < bits.length; i++) {
        const c = bits[i] ? ink : paper;
        img.data[i * 4] = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = 255;
    }
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = grid;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0, size, size);
}
/** Bitmap → PNG data URL (for <img>), upscaled so it stays crisp. */
export function bitsToDataURL(bits, grid, px = 384) {
    const c = document.createElement('canvas');
    drawBits(c, bits, grid, px);
    return c.toDataURL('image/png');
}
// compact storage helpers
export function bytesToB64(b) {
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000)
        s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
}
export function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
// ---------------- Genesis colour tier ----------------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/**
 * Colour pixelization for Genesis creators: area-weighted downsample → luminance level stretch →
 * saturation/contrast boost → Atkinson error diffusion onto the nearest palette colour (redmean distance).
 * Returns palette indices (grid×grid).
 */
export function pixelizeColor(rgb, grid, palette, opts = {}) {
    const pal = palette.map(hex);
    const n = grid * grid;
    const contrast = opts.contrast ?? 1.15;
    const ch = [0, 1, 2].map(k => resample(rgb, grid, 3, k));
    // shared level stretch on luminance keeps hues intact
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++)
        lum[i] = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
    const sorted = Float32Array.from(lum).sort();
    const lo = sorted[Math.floor(n * 0.01)], span = Math.max(0.05, sorted[Math.min(n - 1, Math.floor(n * 0.99))] - lo);
    const sat = 1.25;
    const buf = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const l = (lum[i] - lo) / span;
        for (let k = 0; k < 3; k++)
            buf[i * 3 + k] = (l + ((ch[k][i] - lo) / span - l) * sat - 0.5) * contrast * 255 + 128;
    }
    const out = new Uint8Array(n);
    for (let y = 0; y < grid; y++) {
        const rtl = (y & 1) === 1;
        for (let j = 0; j < grid; j++) {
            const x = rtl ? grid - 1 - j : j;
            const i = y * grid + x;
            const c = [0, 1, 2].map(k => Math.min(255, Math.max(0, buf[i * 3 + k])));
            let best = 0, bd = Infinity;
            for (let p = 0; p < pal.length; p++) {
                const [pr, pg, pb] = pal[p];
                const rm = (c[0] + pr) / 2;
                const dr = c[0] - pr, dg = c[1] - pg, db = c[2] - pb;
                const dist = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db; // "redmean" perceptual distance
                if (dist < bd) {
                    bd = dist;
                    best = p;
                }
            }
            out[i] = best;
            for (let k = 0; k < 3; k++) {
                const err = (c[k] - pal[best][k]) / 8;
                for (const [dx, dy] of ATKINSON) {
                    const xx = x + (rtl ? -dx : dx), yy = y + dy;
                    if (xx >= 0 && xx < grid && yy < grid)
                        buf[(yy * grid + xx) * 3 + k] += err;
                }
            }
        }
    }
    return out;
}
export function drawIndexed(canvas, idx, grid, px, palette) {
    const pal = palette.map(hex);
    const size = Math.max(1, Math.floor(px / grid)) * grid;
    canvas.width = canvas.height = size;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = grid;
    const tg = tmp.getContext('2d');
    const img = tg.createImageData(grid, grid);
    for (let i = 0; i < idx.length; i++) {
        const [r, g, b] = pal[idx[i]];
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, size, size);
}
export function indexedToDataURL(idx, grid, palette, px = 384) {
    const c = document.createElement('canvas');
    drawIndexed(c, idx, grid, px, palette);
    return c.toDataURL('image/png');
}
