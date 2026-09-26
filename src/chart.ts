// Single-series price line (canvas). Thin 2px line, recessive grid, crosshair + tooltip on hover.
export interface Pt { t: number; p: number }

function css(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function drawPriceChart(c: HTMLCanvasElement, pts: Pt[], hoverX: number | null): string | null {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 600, h = c.clientHeight || 220;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const ink = css('--ink', '#f4f4f0'), muted = css('--muted', '#8a8a86'), grid = css('--line', '#222'), accent = css('--accent', '#b8ff5a');
  const padL = 8, padR = 72, padT = 10, padB = 22;
  if (pts.length < 2) {
    g.fillStyle = muted; g.font = '12px ui-monospace, monospace'; g.fillText('No trades yet', padL + 4, h / 2);
    return null;
  }
  const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.p); hi = Math.max(hi, p.p); }
  const span = hi - lo || hi * 0.1 || 1;
  lo -= span * 0.08; hi += span * 0.08;
  const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (w - padL - padR);
  const Y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (h - padT - padB);

  // grid + y labels
  g.font = '11px ui-monospace, monospace';
  g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, y = Math.round(Y(v)) + 0.5;
    g.strokeStyle = grid; g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR + 4, y); g.stroke();
    g.fillStyle = muted; g.fillText(v.toExponential(2), w - padR + 8, y + 4);
  }
  // x labels (start / end)
  g.fillStyle = muted;
  g.fillText(new Date(t0).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }), padL, h - 6);
  const endLbl = 'now';
  g.fillText(endLbl, w - padR - g.measureText(endLbl).width, h - 6);

  // area + line (step-free, price after each trade)
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.p)) : g.moveTo(X(p.t), Y(p.p))));
  const lastX = X(pts[pts.length - 1].t);
  g.lineTo(lastX, h - padB); g.lineTo(X(t0), h - padB); g.closePath();
  const grad = g.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, hexA(accent, 0.18)); grad.addColorStop(1, hexA(accent, 0));
  g.fillStyle = grad; g.fill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.p)) : g.moveTo(X(p.t), Y(p.p))));
  g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  // last point marker
  const last = pts[pts.length - 1];
  dot(g, X(last.t), Y(last.p), accent, css('--bg', '#000'));

  if (hoverX == null || hoverX < padL || hoverX > w - padR) return null;
  // nearest point
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = Math.abs(X(p.t) - hoverX); if (d < bd) { bd = d; best = p; } }
  const x = Math.round(X(best.t)) + 0.5;
  g.strokeStyle = muted; g.lineWidth = 1; g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke(); g.setLineDash([]);
  dot(g, X(best.t), Y(best.p), accent, css('--bg', '#000'));
  g.fillStyle = ink;
  return `${best.p.toExponential(3)} WETH · ${new Date(best.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, fill: string, ring: string) {
  g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
  g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
}
function hexA(hex: string, a: number) {
  const m = hex.replace('#', '');
  if (m.length !== 6) return `rgba(184,255,90,${a})`;
  return `rgba(${parseInt(m.slice(0, 2), 16)},${parseInt(m.slice(2, 4), 16)},${parseInt(m.slice(4, 6), 16)},${a})`;
}
