// 背景修复（经典方法，无模型、无网络）：只修补“文字像素”，保留其余背景纹理。
// 1) 以最近已知像素做多源 BFS 初始化；2) 对未知像素做带 SOR 加速的 Laplace 扩散。
// 同一文件既是 Worker 脚本，也可在 Node 里 require 进行单元测试。
function inpaint(rgba, w, h, unknown, maxIter) {
  const n = w * h, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2]; }
  let unk = 0;
  for (let i = 0; i < n; i++) if (unknown[i]) unk++;
  if (!unk) return { out: Uint8ClampedArray.from(rgba), iterations: 0 };
  if (unk === n) throw new Error('整个区域都需要修补，没有可参考的背景；请改用纯色或复制附近背景');
  // 多源 BFS：把最近的已知颜色传播到未知像素
  const known = new Uint8Array(n), queue = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (!unknown[i]) { known[i] = 1; queue[qt++] = i; }
  while (qh < qt) {
    const p = queue[qh++], x = p % w, y = (p - x) / w;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (known[q]) continue;
      known[q] = 1; out[q * 3] = out[p * 3]; out[q * 3 + 1] = out[p * 3 + 1]; out[q * 3 + 2] = out[p * 3 + 2]; queue[qt++] = q;
    }
  }
  // 未知像素列表
  const list = new Int32Array(unk); let li = 0;
  for (let i = 0; i < n; i++) if (unknown[i]) list[li++] = i;
  const omega = 1.7;
  let it = 0;
  for (; it < maxIter; it++) {
    let delta = 0;
    for (let k = 0; k < unk; k++) {
      const p = list[k], x = p % w, y = (p - x) / w;
      let cnt = 0, r = 0, g = 0, b = 0;
      if (x > 0) { r += out[(p - 1) * 3]; g += out[(p - 1) * 3 + 1]; b += out[(p - 1) * 3 + 2]; cnt++; }
      if (x < w - 1) { r += out[(p + 1) * 3]; g += out[(p + 1) * 3 + 1]; b += out[(p + 1) * 3 + 2]; cnt++; }
      if (y > 0) { r += out[(p - w) * 3]; g += out[(p - w) * 3 + 1]; b += out[(p - w) * 3 + 2]; cnt++; }
      if (y < h - 1) { r += out[(p + w) * 3]; g += out[(p + w) * 3 + 1]; b += out[(p + w) * 3 + 2]; cnt++; }
      r /= cnt; g /= cnt; b /= cnt;
      const dr = (r - out[p * 3]) * omega, dg = (g - out[p * 3 + 1]) * omega, db = (b - out[p * 3 + 2]) * omega;
      out[p * 3] += dr; out[p * 3 + 1] += dg; out[p * 3 + 2] += db;
      const d = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
      if (d > delta) delta = d;
    }
    if (delta < 0.05) { it++; break; }
  }
  const res = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    res[i * 4] = out[i * 3]; res[i * 4 + 1] = out[i * 3 + 1]; res[i * 4 + 2] = out[i * 3 + 2];
    res[i * 4 + 3] = unknown[i] ? 255 : rgba[i * 4 + 3];
  }
  return { out: res, iterations: it };
}
/** 以 r 为半径膨胀二值蒙版（盒式） */
function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) last = x, tmp[y * w + x] = 1; else tmp[y * w + x] = (x - last <= r) ? 1 : 0;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) if (mask[y * w + x]) last = x; else if (last - x <= r) tmp[y * w + x] = 1;
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) last = y, out[y * w + x] = 1; else out[y * w + x] = (y - last <= r) ? 1 : 0;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) last = y; else if (last - y <= r) out[y * w + x] = 1;
  }
  return out;
}
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = e => {
    try {
      const { rgba, w, h, unknown, maxIter } = e.data;
      const r = inpaint(new Uint8ClampedArray(rgba), w, h, new Uint8Array(unknown), maxIter);
      self.postMessage({ out: r.out.buffer, iterations: r.iterations }, [r.out.buffer]);
    } catch (err) { self.postMessage({ error: err.message }); }
  };
}
if (typeof module !== 'undefined') module.exports = { inpaint, dilate };
