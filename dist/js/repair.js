// 背景修复调度：把蒙版区域交给 Worker 扩散；超时/失败给出明确提示。
import { backgroundField } from './analyze.js';

let seq = 0;
function runWorker(msg, transfer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./repair-worker.js', import.meta.url));
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('背景修复超时，请缩小选区，或改用纯色 / 复制附近背景')); }, 30000);
    worker.onmessage = e => { clearTimeout(timer); worker.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('背景修复失败，请改用纯色修复')); };
    worker.postMessage({ ...msg, id: ++seq }, transfer);
  });
}

/** 构造“未知像素”蒙版：文字 α > 阈值，再向外膨胀以覆盖抗锯齿与 JPEG 振铃 */
export function unknownMask(alpha, w, h, grow) {
  const base = new Uint8Array(w * h);
  for (let i = 0; i < base.length; i++) base[i] = alpha[i] > 0.06 ? 1 : 0;
  const r = Math.max(0, Math.round(grow));
  if (!r) return base;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { // 行方向
    for (let x = 0; x < w; x++) { if (!base[y * w + x]) continue; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) tmp[y * w + k] = 1; }
  }
  for (let x = 0; x < w; x++) { // 列方向
    for (let y = 0; y < h; y++) { if (!tmp[y * w + x]) continue; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) out[k * w + x] = 1; }
  }
  return out;
}

/** 修补 imageData（区域像素），返回新的 ImageData。unknown 为 Uint8Array(w*h)。 */
export async function inpaintRegion(imageData, unknown) {
  const { width: w, height: h } = imageData;
  const copy = new Uint8ClampedArray(imageData.data);
  const maxIter = Math.max(60, Math.min(400, Math.round(3e7 / Math.max(1, w * h))));
  const res = await runWorker({ rgba: copy.buffer, w, h, unknown: unknown.slice().buffer, maxIter }, [copy.buffer]);
  return new ImageData(new Uint8ClampedArray(res.out), w, h);
}

/** 矩形平滑背景（纯色/渐变），不依赖文字蒙版 */
export function rectBackground(imageData) {
  const { width: w, height: h, data } = imageData, f = backgroundField(data, w, h), out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) { out.data[i * 4] = f[i * 3]; out.data[i * 4 + 1] = f[i * 3 + 1]; out.data[i * 4 + 2] = f[i * 3 + 2]; out.data[i * 4 + 3] = 255; }
  return out;
}
