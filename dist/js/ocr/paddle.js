// PP-OCRv4（PaddleOCR 模型）：onnxruntime-web 在浏览器内本地推理，模型文件在 dist/vendor/paddle，不上传图片。
// 检测：DB 概率图 → 连通域 → 外扩；识别：CTC 贪心解码，并给出逐字符的时间步位置（近似字框）。
import { loadScript, cv, clamp } from '../util.js';

const ORT_BASE = new URL('../../vendor/ort/', import.meta.url).href, MODEL_BASE = new URL('../../vendor/paddle/', import.meta.url).href;
let ready = null;

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`模型文件加载失败 ${url} (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

export function init(onProgress) {
  if (ready) return ready;
  ready = (async () => {
    onProgress && onProgress('加载 ONNX Runtime…');
    if (!window.ort) await loadScript(ORT_BASE + 'ort.wasm.min.js');
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1; // 不依赖跨域隔离（COOP/COEP），保证在普通静态站点可用
    ort.env.wasm.proxy = false;
    onProgress && onProgress('加载 PP-OCRv4 检测模型…');
    const det = await ort.InferenceSession.create(await fetchBuf(MODEL_BASE + 'ch_PP-OCRv4_det_infer.onnx'), { executionProviders: ['wasm'] });
    onProgress && onProgress('加载 PP-OCRv4 识别模型…');
    const rec = await ort.InferenceSession.create(await fetchBuf(MODEL_BASE + 'ch_PP-OCRv4_rec_infer.onnx'), { executionProviders: ['wasm'] });
    const keys = (await (await fetch(MODEL_BASE + 'ppocr_keys_v1.txt')).text()).split(/\r?\n/);
    while (keys.length && keys[keys.length - 1] === '') keys.pop();
    return { ort, det, rec, dict: ['', ...keys, ' '] }; // 0 = CTC blank，末尾 = 空格
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

function toTensorData(canvas, mean, std) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data, n = w * h, out = new Float32Array(3 * n);
  // PaddleOCR 以 BGR 通道序训练：平面顺序 B,G,R
  for (let i = 0; i < n; i++) {
    out[i] = (d[i * 4 + 2] / 255 - mean[0]) / std[0];
    out[n + i] = (d[i * 4 + 1] / 255 - mean[1]) / std[1];
    out[2 * n + i] = (d[i * 4] / 255 - mean[2]) / std[2];
  }
  return out;
}

// 连通域（8 邻域），返回外接矩形与平均概率
function components(prob, w, h, thr) {
  const seen = new Uint8Array(w * h), boxes = [], stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || prob[s] <= thr) continue;
    let sp = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0, cnt = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      sum += prob[p]; cnt++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && prob[q] > thr) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, score: sum / cnt, count: cnt });
  }
  return boxes;
}

export async function detect(canvas, { limit = 960, thr = 0.3, unclip = 1.6, minScore = 0.55 } = {}, onProgress) {
  const { ort, det } = await init(onProgress);
  const scale0 = Math.min(1, limit / Math.max(canvas.width, canvas.height));
  const W = Math.max(32, Math.ceil(canvas.width * scale0 / 32) * 32), H = Math.max(32, Math.ceil(canvas.height * scale0 / 32) * 32);
  const input = cv(W, H), ictx = input.getContext('2d');
  ictx.fillStyle = '#fff'; ictx.fillRect(0, 0, W, H);
  ictx.drawImage(canvas, 0, 0, W, H);
  const data = toTensorData(input, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, H, W]) });
  const prob = out[det.outputNames[0]].data;
  const sx = canvas.width / W, sy = canvas.height / H, result = [];
  for (const b of components(prob, W, H, thr)) {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (Math.min(bw, bh) < 3 || b.score < minScore) continue;
    const d = (bw * bh * unclip) / (2 * (bw + bh)); // DB unclip：distance = A·ratio / L
    const x0 = clamp((b.x0 - d) * sx, 0, canvas.width), y0 = clamp((b.y0 - d) * sy, 0, canvas.height);
    const x1 = clamp((b.x1 + d) * sx, 0, canvas.width), y1 = clamp((b.y1 + d) * sy, 0, canvas.height);
    if (x1 - x0 < 3 || y1 - y0 < 3) continue;
    result.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, score: b.score });
  }
  return result;
}

export async function recognizeCrop(canvas, r, onProgress) {
  const { ort, rec, dict } = await init(onProgress);
  const x = Math.floor(r.x), y = Math.floor(r.y), w = Math.max(1, Math.ceil(r.w)), h = Math.max(1, Math.ceil(r.h));
  const H = 48, W = clamp(Math.ceil(H * w / h), 16, 2400);
  const input = cv(W, H), c = input.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  c.drawImage(canvas, x, y, w, h, 0, 0, W, H);
  const data = toTensorData(input, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, H, W]) });
  const t = out[rec.outputNames[0]], T = t.dims[1], C = t.dims[2], v = t.data;
  const chars = [];
  let prev = 0;
  for (let i = 0; i < T; i++) {
    let best = 0, bv = -Infinity;
    for (let k = 0; k < C; k++) { const q = v[i * C + k]; if (q > bv) { bv = q; best = k; } }
    if (best !== 0 && best !== prev) chars.push({ ch: dict[best] ?? '', t0: i, t1: i, p: bv });
    else if (best !== 0 && best === prev && chars.length) { chars[chars.length - 1].t1 = i; chars[chars.length - 1].p = Math.max(chars[chars.length - 1].p, bv); }
    prev = best;
  }
  const text = chars.map(c => c.ch).join('');
  const confidence = chars.length ? chars.reduce((n, c) => n + c.p, 0) / chars.length * 100 : 0;
  // 逐字符近似字框：以时间步中心为锚，相邻中心的中点为分界
  const symbols = [];
  const centers = chars.map(c => ((c.t0 + c.t1 + 1) / 2) / T * w);
  chars.forEach((c, i) => {
    if (!c.ch.trim()) return;
    const left = i === 0 ? Math.max(0, centers[i] - (centers[1] !== undefined ? (centers[1] - centers[0]) / 2 : w / 2)) : (centers[i - 1] + centers[i]) / 2;
    const right = i === chars.length - 1 ? Math.min(w, centers[i] + (centers[i] - left)) : (centers[i] + centers[i + 1]) / 2;
    symbols.push({ text: c.ch, b: { x: r.x + left, y: r.y, w: Math.max(1, right - left), h: r.h }, approx: true });
  });
  return { text, confidence, symbols, dims: [T, C] };
}

export const paddleEngine = {
  id: 'paddle',
  label: 'PaddleOCR PP-OCRv4 · 本地 · 离线',
  async recognize(canvas, { onProgress, offset = { x: 0, y: 0 }, scale = 1 } = {}) {
    const boxes = await detect(canvas, {}, onProgress);
    boxes.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
    const lines = [];
    let i = 0;
    for (const b of boxes) {
      onProgress && onProgress(`PP-OCRv4 识别 ${++i}/${boxes.length}`);
      const rr = await recognizeCrop(canvas, b, onProgress);
      if (!rr.text.trim()) continue;
      const map = q => ({ x: offset.x + q.x / scale, y: offset.y + q.y / scale, w: q.w / scale, h: q.h / scale });
      lines.push({
        text: rr.text, r: map(b), confidence: rr.confidence, engine: 'paddle',
        symbols: rr.symbols.map(s => ({ text: s.text, b: map(s.b), approx: true }))
      });
    }
    return lines;
  },
  async dispose() { /* 会话常驻，页面关闭自动释放 */ }
};
