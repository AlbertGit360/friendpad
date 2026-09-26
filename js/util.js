export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function short(a, n = 4) {
    if (!a)
        return '—';
    return a.length > 2 * n + 4 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a;
}
export function fmt(n, digits = 2) {
    if (!isFinite(n))
        return '—';
    const a = Math.abs(n);
    if (a >= 1e9)
        return (n / 1e9).toFixed(digits) + 'B';
    if (a >= 1e6)
        return (n / 1e6).toFixed(digits) + 'M';
    if (a >= 1e4)
        return (n / 1e3).toFixed(digits === 0 ? 0 : 1) + 'K';
    if (a >= 100)
        return n.toFixed(0);
    if (a >= 1)
        return n.toFixed(digits);
    if (a === 0)
        return '0';
    return n.toPrecision(3);
}
export function fmtWeth(n) {
    if (!isFinite(n))
        return '—';
    if (Math.abs(n) >= 1)
        return n.toFixed(3);
    if (Math.abs(n) >= 0.001)
        return n.toFixed(4);
    if (n === 0)
        return '0';
    return n.toExponential(2);
}
/** Price per token in WETH, shown with a subscript-free compact form (e.g. 0.0₆28 → 2.8e-9). */
export function fmtPrice(n) { return n.toExponential(3); }
export function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60)
        return `${Math.floor(s)}s`;
    if (s < 3600)
        return `${Math.floor(s / 60)}m`;
    if (s < 86400)
        return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
}
export function toast(msg, kind = 'info') {
    let box = $('#toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toasts';
        box.setAttribute('aria-live', 'polite');
        document.body.append(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    box.append(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4400);
}
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function explorerAddr(a) { return `https://robinhoodchain.blockscout.com/address/${a}`; }
export function explorerToken(coll, id) { return `https://robinhoodchain.blockscout.com/token/${coll}/instance/${id}`; }
