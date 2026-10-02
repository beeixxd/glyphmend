// 通用工具：画布、颜色、数学、异步辅助
export const $ = id => document.getElementById(id);
export const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const median = arr => {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  return a[Math.floor(a.length / 2)];
};
export const hex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export const parseHex = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rafWait = () => new Promise(r => requestAnimationFrame(() => r()));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => { s.remove(); no(new Error('脚本加载失败：' + src)); };
    document.head.append(s);
  });
}
export const canvasToBlob = (c, type = 'image/png', q) => new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('图片编码失败')), type, q));
export function copyCanvas(src) {
  const c = cv(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
export function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}
export const uid = (() => { let n = 0; return (p = 'id') => p + (++n) + '_' + Math.random().toString(36).slice(2, 6); })();
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
