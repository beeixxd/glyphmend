// OCR 调度：多引擎并行/串行运行 → 融合 → 可选视觉大模型校对。支持整图与区域两种模式。
import { cv, clamp } from '../util.js';
import { tesseractEngine } from './tesseract.js';
import { paddleEngine } from './paddle.js';
import { fuse } from './fusion.js';
import { llmVerify } from './llm.js';

export const ENGINES = { paddle: paddleEngine, tesseract: tesseractEngine };
export const ENGINE_LABELS = { paddle: 'PaddleOCR', tesseract: 'Tesseract', llm: '视觉大模型' };

export function resolveLang(sel) {
  return sel === 'auto' ? 'eng+chi_sim' : sel;
}

/**
 * opts: { engines:['paddle','tesseract'], lang, llm:cfg|null, onProgress, signal }
 * 返回 { lines, errors:[字符串], perEngine:{id:行数}, llm?:{changed,rejected} }
 */
export async function recognizeImage(canvas, opts = {}) {
  const { engines = ['paddle', 'tesseract'], lang = 'eng+chi_sim', llm = null, onProgress, signal } = opts;
  const results = [], errors = [], perEngine = {};
  for (const id of engines) {
    if (signal?.aborted) throw new Error('已取消');
    const eng = ENGINES[id];
    if (!eng) continue;
    try {
      onProgress && onProgress(`${ENGINE_LABELS[id]} 识别中…`);
      const lines = await eng.recognize(canvas, { lang, onProgress: m => onProgress && onProgress(`${ENGINE_LABELS[id]} · ${m}`) });
      results.push({ engine: id, lines }); perEngine[id] = lines.length;
    } catch (e) { errors.push(`${ENGINE_LABELS[id]}：${e.message}`); }
  }
  if (!results.length && !llm) throw new Error(errors.join('；') || '没有启用任何识别引擎');
  let lines = fuse(results), llmResult = null;
  if (llm && lines.length) {
    try { llmResult = await llmVerify(canvas, lines, llm, { onProgress, signal }); }
    catch (e) { errors.push(`视觉大模型：${e.message}`); }
  }
  return { lines, errors, perEngine, llm: llmResult };
}

/** 区域识别：裁剪 + 放大（小字更准），结果坐标映射回原图。mode: 'line' | 'block' */
export async function recognizeRegion(canvas, r, opts = {}) {
  const { engines = ['paddle', 'tesseract'], lang = 'eng+chi_sim', mode = 'block', llm = null, onProgress, signal } = opts;
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const w = Math.min(canvas.width - x, Math.ceil(r.w)), h = Math.min(canvas.height - y, Math.ceil(r.h));
  const scale = clamp(80 / Math.max(1, h), 1, 3);
  const crop = cv(Math.round(w * scale), Math.round(h * scale)), cx = crop.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, crop.width, crop.height);
  cx.imageSmoothingQuality = 'high'; cx.drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
  const results = [], errors = [];
  for (const id of engines) {
    const eng = ENGINES[id]; if (!eng) continue;
    try {
      const lines = await eng.recognize(crop, { lang, psm: mode === 'line' ? '7' : '6', offset: { x, y }, scale, onProgress: m => onProgress && onProgress(`${ENGINE_LABELS[id]} · ${m}`) });
      results.push({ engine: id, lines });
    } catch (e) { errors.push(`${ENGINE_LABELS[id]}：${e.message}`); }
  }
  let lines = fuse(results);
  if (llm && lines.length) { try { await llmVerify(canvas, lines, llm, { onProgress, signal }); } catch (e) { errors.push(`视觉大模型：${e.message}`); } }
  return { lines, errors };
}
