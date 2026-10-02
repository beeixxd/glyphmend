// 原字形图集：从原图文字蒙版里切出每个字符的真实像素，供“复用原字形 / 智能混合”使用。
// 来源优先级：OCR 单字符坐标 → 像素投影切分（仅当字符数与连通段数一致时才可靠）。
import { cv } from './util.js';

/**
 * 构建图集。src = { text, r:{x,y,w,h}, alpha:Float32Array(w*h), symbols:[{text,b:{x,y,w,h},approx?}] }
 * 返回 { entries:Map(ch→{canvas,w,h,top,baselineDist}), baseline, gap, method }
 */
export function buildAtlas(src) {
  if (src.atlas) return src.atlas;
  const { alpha, r } = src, W = r.w, H = r.h;
  const chars = Array.from(src.text.replace(/\n/g, '')).filter(c => !/\s/.test(c));
  if (src.text.includes('\n')) throw new Error('多行文字暂不支持复用原字形，请使用“字体重绘”');
  let boxes = null, method = '';
  const syms = (src.symbols || []).filter(s => s.b && s.text && Array.from(s.text).length === 1 && !/\s/.test(s.text) && s.b.w > 0 && s.b.h > 0);
  if (syms.length && syms.length === chars.length && syms.every((s, i) => s.text === chars[i])) {
    boxes = syms.map(s => ({ ch: s.text, x0: Math.floor(s.b.x - r.x - (s.approx ? 0 : 1)), x1: Math.ceil(s.b.x + s.b.w - r.x + (s.approx ? 0 : 1)) }));
    method = syms[0].approx ? 'ocr-approx' : 'ocr';
  }
  // 列投影分段（用于直接切分或校验近似字框）
  const col = new Uint8Array(W);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (alpha[y * W + x] > 0.16) { col[x] = 1; break; }
  const runs = []; let s = -1;
  for (let x = 0; x <= W; x++) { if (x < W && col[x]) { if (s < 0) s = x; } else if (s >= 0) { runs.push({ x0: s, x1: x }); s = -1; } }
  if (!boxes || method === 'ocr-approx') {
    if (runs.length === chars.length) { boxes = runs.map((q, i) => ({ ch: chars[i], x0: q.x0, x1: q.x1 })); method = 'projection'; }
    else if (!boxes) throw new Error('无法可靠切分原字形（字形粘连/断裂/数量不符）。请改用“字体重绘”，或用本地 OCR 框选单行重新识别。');
    else method = 'ocr-approx';
  }
  const entries = new Map(), gaps = [], bottoms = [];
  let prevRight = null;
  const items = [];
  for (const b of boxes) {
    const x0 = Math.max(0, b.x0), x1 = Math.min(W, b.x1);
    let l = x1, rr = -1, t = H, bt = -1;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (alpha[y * W + x] > 0.06) { if (x < l) l = x; if (x > rr) rr = x; if (y < t) t = y; if (y > bt) bt = y; }
    if (rr < l || bt < t) continue;
    items.push({ ch: b.ch, l, r: rr + 1, t, b: bt + 1 });
  }
  if (!items.length) throw new Error('没有可用的原字形');
  items.forEach((it, i) => { if (i) gaps.push(it.l - items[i - 1].r); });
  const noDescender = items.filter(it => !/[gjpqyQ,;()\[\]{}|_]/.test(it.ch));
  const baseline = medianOf((noDescender.length ? noDescender : items).map(it => it.b));
  for (const it of items) {
    if (entries.has(it.ch)) continue;
    const c = cv(it.r - it.l, it.b - it.t), cx = c.getContext('2d'), img = cx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) img.data[(y * c.width + x) * 4 + 3] = Math.round(Math.min(1, alpha[(it.t + y) * W + it.l + x]) * 255);
    cx.putImageData(img, 0, 0);
    entries.set(it.ch, { canvas: c, w: c.width, h: c.height, top: it.t, dy: baseline - it.t });
  }
  // 原字符在原行中的真实位置（含字距调整）：文字未变的部分直接按原位置排字，才能逐像素复用
  const srcChars = Array.from(src.text.replace(/\n/g, '')), nonSpace = [];
  srcChars.forEach((c, i) => { if (!/\s/.test(c)) nonSpace.push(i); });
  const exact = items.length === nonSpace.length && items.every((it, k) => it.ch === srcChars[nonSpace[k]]);
  const idxLeft = new Map(); if (exact) items.forEach((it, k) => idxLeft.set(nonSpace[k], it.l));
  src.atlas = { entries, baseline, gap: gaps.length ? Math.max(0, medianOf(gaps)) : 1, method, count: items.length, exact, srcChars, idxLeft, left0: Math.min(...items.map(i => i.l)), top0: Math.min(...items.map(i => i.t)) };
  return src.atlas;
}
function medianOf(a) { const s = Float64Array.from(a).sort(); return s[Math.floor(s.length / 2)] || 0; }
