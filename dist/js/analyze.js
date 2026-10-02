// 原图文字分析：提取文字蒙版(alpha)、前景/背景色、墨迹包围盒、行带、笔画粗细、倾斜度。
// 这些函数只依赖 TypedArray，既可在浏览器使用，也可在 Node 里做单元测试。
import { median, hex } from './util.js';

const median3 = arr => { if (!arr.length) return 0; const a = Float32Array.from(arr).sort(); return a[Math.floor(a.length / 2)]; };

/** 由区域四边估计平滑背景场（纯色 / 线性渐变 / 双线性渐变均能还原） */
export function backgroundField(rgba, w, h) {
  const edge = 2, field = new Float32Array(w * h * 3);
  const L = new Float32Array(h * 3), R = new Float32Array(h * 3), T = new Float32Array(w * 3), B = new Float32Array(w * 3);
  const px = (x, y, c) => rgba[(y * w + x) * 4 + c];
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      const l = [], r = [];
      for (let k = 0; k < Math.min(edge, w); k++) { l.push(px(k, y, c)); r.push(px(w - 1 - k, y, c)); }
      L[y * 3 + c] = median3(l); R[y * 3 + c] = median3(r);
    }
    for (let x = 0; x < w; x++) {
      const t = [], b = [];
      for (let k = 0; k < Math.min(edge, h); k++) { t.push(px(x, k, c)); b.push(px(x, h - 1 - k, c)); }
      T[x * 3 + c] = median3(t); B[x * 3 + c] = median3(b);
    }
  }
  for (let y = 0; y < h; y++) {
    const ty = h > 1 ? y / (h - 1) : 0;
    for (let x = 0; x < w; x++) {
      const tx = w > 1 ? x / (w - 1) : 0;
      for (let c = 0; c < 3; c++)
        field[(y * w + x) * 3 + c] = ((1 - tx) * L[y * 3 + c] + tx * R[y * 3 + c] + (1 - ty) * T[x * 3 + c] + ty * B[x * 3 + c]) / 2;
    }
  }
  return field;
}

/**
 * 从区域 RGBA 数据提取文字蒙版。
 * 返回 { alpha:Float32Array(0..1), fg:[r,g,b], bg:[r,g,b], ink:{x,y,w,h} }，对比度不足时抛错。
 */
export function extractMask(rgba, w, h) {
  const field = backgroundField(rgba, w, h);
  const n = w * h, dist = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(rgba[i * 4] - field[i * 3], rgba[i * 4 + 1] - field[i * 3 + 1], rgba[i * 4 + 2] - field[i * 3 + 2]);
    dist[i] = d; if (d > max) max = d;
  }
  if (max < 20) throw new Error('文字与背景对比不足，无法可靠分析');
  const strong = [[], [], []], bgc = [[], [], []];
  for (let i = 0; i < n; i++) {
    if (dist[i] > max * 0.72) for (let c = 0; c < 3; c++) strong[c].push(rgba[i * 4 + c]);
    for (let c = 0; c < 3; c++) bgc[c].push(field[i * 3 + c]);
  }
  if (!strong[0].length) throw new Error('未检测到可分析的字形');
  const fg = strong.map(median3), bgMed = bgc.map(median3);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 以每个像素自身的背景场为基准，在 (前景 - 局部背景) 方向上投影
    let num = 0, den = 0;
    for (let c = 0; c < 3; c++) { const d = fg[c] - field[i * 3 + c]; num += (rgba[i * 4 + c] - field[i * 3 + c]) * d; den += d * d; }
    alpha[i] = den > 1 ? Math.max(0, Math.min(1, num / den)) : 0;
  }
  const ink = inkBox(alpha, w, h, 0.22);
  if (!ink) throw new Error('未检测到可分析的字形');
  return { alpha, fg, bg: bgMed, ink, inkF: inkBoxSub(alpha, w, h) || ink, fgHex: hex(...fg), bgHex: hex(...bgMed) };
}

export function inkBox(alpha, w, h, thr = 0.22, region = null) {
  const x0r = region ? region.x : 0, y0r = region ? region.y : 0, x1r = region ? region.x + region.w : w, y1r = region ? region.y + region.h : h;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = y0r; y < y1r; y++) for (let x = x0r; x < x1r; x++) if (alpha[y * w + x] > thr) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 亚像素墨迹包围盒：边缘像素的覆盖率（行/列最大 α）折算为小数位，
 * 避免整像素取整造成的约 0.5–1.5 px 系统性偏大（字号反推会因此偏大 3% 左右）。
 */
export function inkBoxSub(alpha, w, h, region = null, thr = 0.12) {
  const x0r = region ? region.x : 0, y0r = region ? region.y : 0, x1r = region ? region.x + region.w : w, y1r = region ? region.y + region.h : h;
  const rowMax = new Float32Array(h), colMax = new Float32Array(w);
  for (let y = y0r; y < y1r; y++) for (let x = x0r; x < x1r; x++) { const a = alpha[y * w + x]; if (a > rowMax[y]) rowMax[y] = a; if (a > colMax[x]) colMax[x] = a; }
  let ya = -1, yb = -1, xa = -1, xb = -1;
  for (let y = y0r; y < y1r; y++) if (rowMax[y] > thr) { if (ya < 0) ya = y; yb = y; }
  for (let x = x0r; x < x1r; x++) if (colMax[x] > thr) { if (xa < 0) xa = x; xb = x; }
  if (ya < 0 || xa < 0) return null;
  const top = ya + (1 - Math.min(1, rowMax[ya])), bottom = yb + Math.min(1, rowMax[yb]);
  const left = xa + (1 - Math.min(1, colMax[xa])), right = xb + Math.min(1, colMax[xb]);
  return { x: left, y: top, w: Math.max(0.5, right - left), h: Math.max(0.5, bottom - top) };
}

/** 水平投影切分为 count 条行带；通过合并最小间隙得到恰好 count 条 */
export function rowBands(alpha, w, h, count = 1, thr = 0.22) {
  const rows = new Uint8Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > thr) { rows[y] = 1; break; }
  let runs = [], s = -1;
  for (let y = 0; y <= h; y++) {
    if (y < h && rows[y]) { if (s < 0) s = y; } else if (s >= 0) { runs.push({ y0: s, y1: y - 1 }); s = -1; }
  }
  if (!runs.length) return [];
  while (runs.length > count) { // 合并间隙最小的相邻两段
    let gi = 0, gv = Infinity;
    for (let i = 0; i < runs.length - 1; i++) { const g = runs[i + 1].y0 - runs[i].y1; if (g < gv) { gv = g; gi = i; } }
    runs.splice(gi, 2, { y0: runs[gi].y0, y1: runs[gi + 1].y1 });
  }
  return runs.map(r => {
    const ink = inkBox(alpha, w, h, thr, { x: 0, y: r.y0, w, h: r.y1 - r.y0 + 1 });
    return { y0: r.y0, y1: r.y1, ink };
  });
}

/** 平均笔画粗细：由余面积公式 w ≈ 2·面积 / 周长，周长取 α 的总变差（对抗锯齿 / 模糊 / JPEG 稳健） */
export function strokeWidth(alpha, w, h, region = null) {
  const x0 = region ? region.x : 0, y0 = region ? region.y : 0, x1 = region ? region.x + region.w : w, y1 = region ? region.y + region.h : h;
  let area = 0, tv = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : alpha[y * w + x];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = alpha[y * w + x]; area += a;
    const gx = (at(x + 1, y) - at(x - 1, y)) / 2, gy = (at(x, y + 1) - at(x, y - 1)) / 2;
    tv += Math.hypot(gx, gy);
  }
  return tv > 1e-6 ? 2 * area / tv : 0;
}

/**
 * 倾斜度 tan(θ)：正值表示向右倾斜（斜体）。
 * 用“剪切后列投影能量最大”估计：竖直笔画被摆正时列和最集中。比协方差法稳健——
 * 协方差会被 M / W / g 这类字形误导成假倾斜。能量提升不明显时返回 0。
 */
export function slantOf(alpha, w, h, region = null) {
  const x0 = region ? region.x : 0, y0 = region ? region.y : 0, x1 = region ? region.x + region.w : w, y1 = region ? region.y + region.h : h;
  const yc = (y0 + y1) / 2, pts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = alpha[y * w + x]; if (a > 0.2) pts.push(x, y, a); }
  if (pts.length < 30) return 0;
  const energy = k => {
    const bins = new Float32Array(Math.ceil((x1 - x0) * 1.0 + Math.abs(k) * (y1 - y0) + 8));
    const off = Math.abs(k) * (y1 - y0) / 2 + 2;
    for (let i = 0; i < pts.length; i += 3) {
      const xs = pts[i] - k * (yc - pts[i + 1]) - x0 + off, bi = Math.floor(xs), f = xs - bi;
      bins[bi] += pts[i + 2] * (1 - f); bins[bi + 1] += pts[i + 2] * f;
    }
    let e = 0; for (let i = 0; i < bins.length; i++) e += bins[i] * bins[i];
    return e;
  };
  const e0 = energy(0);
  let best = 0, bestE = e0;
  for (let k = -0.2; k <= 0.62; k += 0.02) { const e = energy(k); if (e > bestE) { bestE = e; best = k; } }
  // 细化
  for (let k = best - 0.02; k <= best + 0.02; k += 0.005) { const e = energy(k); if (e > bestE) { bestE = e; best = k; } }
  return bestE > e0 * 1.05 && Math.abs(best) > 0.06 ? best : 0;
}

/** 可分离盒式模糊（两遍近似高斯），用于容忍亚像素错位的比较 */
export function boxBlur(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  r = Math.round(r);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), d = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    const from = pass ? out : src;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += from[y * w + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / d;
        acc += from[y * w + Math.min(w - 1, x + r + 1)] - from[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
  return out;
}

/** 两张同尺寸 α 图的差异：联合 L1，允许 ±shift 像素整体平移取最小值。越小越接近。 */
export function maskDistance(a, b, w, h, { blur = 1, shift = 2 } = {}) {
  const A = boxBlur(a, w, h, blur), B = boxBlur(b, w, h, blur);
  let best = Infinity;
  for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) {
    let diff = 0, uni = 0;
    const xa = Math.max(0, -dx), xb = Math.min(w, w - dx), ya = Math.max(0, -dy), yb = Math.min(h, h - dy);
    for (let y = ya; y < yb; y++) {
      const ra = y * w, rb = (y + dy) * w + dx;
      for (let x = xa; x < xb; x++) {
        const p = A[ra + x], q = B[rb + x];
        diff += Math.abs(p - q); uni += p > q ? p : q;
      }
    }
    const e = uni > 0 ? diff / uni : 1;
    if (e < best) best = e;
  }
  return best;
}

/** 将 RGBA 画布像素中的 alpha 通道读成 Float32(0..1) */
export function alphaFromRGBA(rgba, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4 + 3] / 255;
  return out;
}

export { median };
