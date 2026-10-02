// 字体 / 字号 / 字重 / 字距 / 倾斜 自动拟合。
// 做法：对每个候选字体与字重，按原行墨迹高度反推字号、按宽度反推字距，用与最终渲染完全相同的路径绘制，
// 再与原图蒙版做“容错像素距离”；最优候选再用笔画粗细做连续字重微调（embolden，±px），
// 因此即使系统里没有对应字重，也能让笔画粗细与原图吻合。
import { cv, clamp, rafWait } from './util.js';
import { rowBands, strokeWidth, slantOf, maskDistance, inkBox, inkBoxSub } from './analyze.js';
import { fonts, fontCovers } from './fonts.js';
import { DEFAULT_STYLE, renderInk, measureLine } from './render.js';

const probeCtx = (() => { let c; return () => c || (c = cv(1, 1).getContext('2d')); })();

export function classifyFont(label) {
  const s = String(label);
  if (/mono|courier|consolas|menlo|monaco|等宽|code/i.test(s)) return 'mono';
  if (/serif(?!.*sans)|times|georgia|garamond|cambria|palatino|baskerville|lora|caladea|song|ming|mincho|宋|明|kai|楷|fang|仿|playfair|merriweather/i.test(s) && !/sans/i.test(s)) return 'serif';
  return 'sans';
}

function targetCrop(src, band, s) {
  const W = src.r.w, pad = Math.ceil(band.h * 0.35) + 2, y0 = Math.max(0, band.y - pad), y1 = Math.min(src.r.h, band.y + band.h + pad);
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round((y1 - y0) * s));
  const full = cv(W, y1 - y0), fx = full.getContext('2d'), img = fx.createImageData(W, y1 - y0);
  for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < W; x++) img.data[(y * W + x) * 4 + 3] = Math.round(src.alpha[(y0 + y) * W + x] * 255);
  fx.putImageData(img, 0, 0);
  let c = full;
  if (s !== 1) { c = cv(w, h); c.getContext('2d').drawImage(full, 0, 0, w, h); }
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, a = new Float32Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return { alpha: a, w: c.width, h: c.height, y0, scale: s };
}

function candidateAlpha(first, style, band, crop, s) {
  const layer = {
    text: first, offset: { x: 0, y: 0 }, touched: true,
    style: { ...DEFAULT_STYLE, ...style, wrap: false, color: '#000000', blur: 0, size: style.size * s, spacing: style.spacing * s, embolden: (style.embolden || 0) * s },
    pos: { x: band.x * s, y: band.y * s },
    src: { text: first, ink: { x: band.x * s, y: band.y * s, w: band.w * s, h: band.h * s } }
  };
  const ink = renderInk(layer, { W: crop.w + 4000, H: crop.h + 4000 });
  const c = cv(crop.w, crop.h), cx = c.getContext('2d', { willReadFrequently: true });
  if (style.blur > 0) cx.filter = `blur(${style.blur * s}px)`;
  cx.drawImage(ink.canvas, ink.x, ink.y - crop.y0 * s);
  const d = cx.getImageData(0, 0, crop.w, crop.h).data, a = new Float32Array(crop.w * crop.h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}

/** 为候选 (font, weight) 以给定 embolden / skew 计算字号与字距 */
function geometry(first, cand, band, emb, skewTan) {
  const ctx = probeCtx(), n = Array.from(first).length;
  const m100 = measureLine(ctx, first, { ...DEFAULT_STYLE, font: cand.font, weight: cand.weight, size: 100, spacing: 0 });
  const h100 = m100.ascent + m100.descent;
  if (h100 <= 0) return null;
  const targetH = Math.max(1, band.h - emb);
  const size = clamp(100 * targetH / h100, 3, 1000);
  const m = measureLine(ctx, first, { ...DEFAULT_STYLE, font: cand.font, weight: cand.weight, size, spacing: 0 });
  const targetW = band.w - emb - skewTan * band.h * 0.85;
  const spacing = n > 1 ? (targetW - (m.left + m.right)) / (n - 1) : 0;
  if (spacing < -size * 0.28 || spacing > size * 0.7) return null;
  return { size, spacing };
}

export async function fitStyle(src, { onProgress, hints, maxCandidates = 6 } = {}) {
  const lines = String(src.text).split('\n'), first = lines[0];
  if (!first.trim()) throw new Error('原文为空，无法匹配字体');
  const bands = rowBands(src.alpha, src.r.w, src.r.h, lines.length);
  if (!bands.length) throw new Error('未检测到可分析的字形');
  const bandInt = bands[0].ink, rowRegion = { x: 0, y: bands[0].y0, w: src.r.w, h: bands[0].y1 - bands[0].y0 + 1 };
  const band = inkBoxSub(src.alpha, src.r.w, src.r.h, rowRegion) || bandInt; // 亚像素墨迹框（消除整像素取整的系统偏差）
  const stemTarget = strokeWidth(src.alpha, src.r.w, src.r.h, rowRegion);
  const tilt = slantOf(src.alpha, src.r.w, src.r.h, rowRegion);
  const skewTan = Math.abs(tilt) > 0.1 && Math.abs(tilt) < 0.7 ? tilt : 0;
  const skew = Math.atan(skewTan) * 180 / Math.PI;
  let leading = 0;
  if (bands.length > 1) { const d = bands.slice(1).map((q, i) => q.ink.y - bands[i].ink.y).filter(v => v > 0).sort((x, y) => x - y); leading = d.length ? d[Math.floor(d.length / 2)] : 0; }

  const cands = fonts.candidates(first);
  if (!cands.length) throw new Error('没有可用字体覆盖该文字，请读取本机字体或导入字体文件');
  const s1 = cands.length > 80 ? Math.min(1, 30 / band.h) : 1;
  const crop1 = targetCrop(src, bandInt, s1);
  const tol = Math.max(1, Math.round(band.h / 40));
  const results = [];
  let count = 0;
  const stemTarget1 = stemTarget * s1;
  for (const c of cands) {
    const g = geometry(first, c, band, 0, skewTan);
    if (!g) continue;
    const style = { font: c.font, weight: c.weight, size: g.size, spacing: g.spacing, embolden: 0, skew, blur: 0 };
    let best;
    try {
      const a0 = candidateAlpha(first, style, band, crop1, s1);
      best = { style, err: maskDistance(crop1.alpha, a0, crop1.w, crop1.h, { blur: s1 < 1 ? 1 : tol, shift: 2 }) };
      // 字重归一：先按笔画粗细估计 embolden 再比较，避免“只有字重恰好对上的字体才能入围”
      const e0 = clamp((stemTarget1 - strokeWidth(a0, crop1.w, crop1.h)) / s1, -stemTarget * 0.6, stemTarget * 0.9);
      if (Math.abs(e0) > 0.25) {
        const g2 = geometry(first, c, band, e0, skewTan);
        if (g2) {
          const st2 = { ...style, size: g2.size, spacing: g2.spacing, embolden: e0 };
          const err2 = maskDistance(crop1.alpha, candidateAlpha(first, st2, band, crop1, s1), crop1.w, crop1.h, { blur: s1 < 1 ? 1 : tol, shift: 2 });
          if (err2 < best.err) best = { style: st2, err: err2 };
        }
      }
    } catch { continue; }
    results.push({ ...c, ...best.style, error: best.err });
    if (++count % 12 === 0) { onProgress && onProgress(`比较字体 ${count}/${cands.length}`); await rafWait(); }
  }
  if (!results.length) throw new Error('没有可用字体能排出该行文字（宽高比不合理），请手动选择字体');
  if (hints && hints.family) for (const r of results) { const k = classifyFont(r.label); r.error *= k === hints.family ? 0.93 : 1.04; if (hints.bold && r.weight >= 600) r.error *= 0.97; }
  results.sort((a, b) => a.error - b.error);
  const top = results.slice(0, maxCandidates);

  // 第二阶段（原始分辨率）：连续字重微调(embolden) + 柔化(blur) + 字距修正
  const crop = targetCrop(src, bandInt, 1);
  const n = Array.from(first).length, refined = [];
  for (const c of top) {
    const evalAt = (emb, blur) => {
      const g = geometry(first, c, band, emb, skewTan); if (!g) return null;
      const style = { font: c.font, weight: c.weight, size: g.size, spacing: g.spacing, embolden: emb, skew, blur };
      const a = candidateAlpha(first, style, band, crop, 1);
      return { style, a, err: maskDistance(crop.alpha, a, crop.w, crop.h, { blur: tol, shift: 2 }) };
    };
    let best = null;
    for (const blur of [0, 0.6, 1.2]) {
      const b0 = evalAt(0, blur); if (!b0) continue;
      const e0 = clamp(stemTarget - strokeWidth(b0.a, crop.w, crop.h), -stemTarget * 0.6, stemTarget * 0.9);
      let local = b0; const tried = new Set([0]);
      const tryE = e => { e = Math.round(e * 20) / 20; if (tried.has(e)) return; tried.add(e); const r = evalAt(e, blur); if (r && r.err < local.err) local = r; };
      for (const e of [e0, e0 * 0.5, e0 * 1.4, e0 - 0.4, e0 + 0.4]) tryE(e);
      for (const d of [0.25, -0.25, 0.12, -0.12]) tryE(local.style.embolden + d);
      if (!best || local.err < best.err - 0.012) best = local; // 柔化只有在明显更接近原图时才启用
    }
    if (!best) continue;
    for (let i = 0; i < 2 && n > 1; i++) { // 字距修正：用实测墨迹宽度对齐
      const bb = inkBoxSub(best.a, crop.w, crop.h);
      if (!bb) break;
      const dw = band.w - bb.w;
      if (Math.abs(dw) < 0.4) break;
      const style = { ...best.style, spacing: best.style.spacing + dw / (n - 1) };
      const a = candidateAlpha(first, style, band, crop, 1), err = maskDistance(crop.alpha, a, crop.w, crop.h, { blur: tol, shift: 2 });
      if (err <= best.err + 0.002) best = { style, a, err }; else break;
    }
    // 亚像素位置微调（坐标下降）：让重绘与原图边缘覆盖率对齐，而不仅是整像素对齐
    let sx = 0, sy = 0;
    const shifted = (dx, dy) => { const bb = { ...band, x: band.x + dx, y: band.y + dy }; const a = candidateAlpha(first, best.style, bb, crop, 1); return { a, err: maskDistance(crop.alpha, a, crop.w, crop.h, { blur: 1, shift: 0 }) }; };
    let cur = shifted(0, 0);
    for (const axis of ['x', 'y', 'x']) for (const d of [-0.5, -0.25, 0.25, 0.5]) {
      const t = axis === 'x' ? shifted(sx + d, sy) : shifted(sx, sy + d);
      if (t.err < cur.err - 0.0005) { cur = t; if (axis === 'x') sx += d; else sy += d; }
    }
    if (sx || sy) best = { ...best, a: cur.a, err: cur.err };
    refined.push({ ...c, ...best.style, error: best.err, stemTarget, stemFit: strokeWidth(best.a, crop.w, crop.h), leading, tilt, color: src.fgHex, dx: sx, dy: sy });
    await rafWait();
  }
  if (!refined.length) throw new Error('字体匹配失败，请手动选择字体');
  refined.sort((a, b) => a.error - b.error);
  // 系统别名（Arial≡Liberation Sans 等）会产生完全相同的结果，合并后再展示
  const seen = new Set(), unique = [];
  for (const r of refined) { const k = r.error.toFixed(5) + '|' + r.size.toFixed(2); if (!seen.has(k)) { seen.add(k); unique.push(r); } }
  return unique;
}

/** 把拟合结果写入样式（保留用户已设置的外观参数） */
export function styleFromFit(c, base = DEFAULT_STYLE) {
  return {
    ...base, font: c.font, weight: c.weight, size: +c.size.toFixed(2), spacing: +c.spacing.toFixed(2), embolden: +(c.embolden || 0).toFixed(2),
    skew: +(c.skew || 0).toFixed(1), blur: +(c.blur || 0).toFixed(1), leading: c.leading ? +c.leading.toFixed(2) : 0, color: c.color || base.color
  };
}
