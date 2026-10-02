// Tesseract.js 本地引擎：脚本、WASM 内核、语言包都在 dist/vendor/tesseract，可完全离线。
import { loadScript, cv } from '../util.js';

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href; // 相对模块定位，不受页面路径影响
const workers = new Map(); // lang -> Promise<worker>
let localLangCache = new Map();

async function hasLocalLang(l) {
  if (localLangCache.has(l)) return localLangCache.get(l);
  let ok = false;
  try { ok = (await fetch(`${BASE}lang/${l}.traineddata.gz`, { method: 'HEAD' })).ok; } catch { ok = false; }
  localLangCache.set(l, ok);
  return ok;
}

async function getWorker(lang, onProgress) {
  if (workers.has(lang)) return workers.get(lang);
  const p = (async () => {
    if (!window.Tesseract) await loadScript(BASE + 'tesseract.min.js');
    const langs = lang.split('+');
    const local = (await Promise.all(langs.map(hasLocalLang))).every(Boolean);
    const options = {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE + 'core/',
      logger: m => onProgress && onProgress(`${m.status} ${Math.round((m.progress || 0) * 100)}%`)
    };
    if (local) options.langPath = BASE + 'lang/'; // 否则回退到 Tesseract.js 默认的 CDN 语言包
    const w = await window.Tesseract.createWorker(lang, 1, options);
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  })();
  workers.set(lang, p);
  p.catch(() => workers.delete(lang));
  return p;
}

export function normalizeTesseract(data, offset = { x: 0, y: 0 }, scale = 1) {
  const lines = [];
  for (const block of data.blocks || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+$/g, '').replace(/^\s+/g, '');
        if (!text) continue;
        const b = line.bbox;
        const r = { x: offset.x + b.x0 / scale, y: offset.y + b.y0 / scale, w: (b.x1 - b.x0) / scale, h: (b.y1 - b.y0) / scale };
        const symbols = [];
        for (const w of line.words || []) for (const s of w.symbols || []) {
          if (!s.bbox || !s.text) continue;
          symbols.push({ text: s.text, b: { x: offset.x + s.bbox.x0 / scale, y: offset.y + s.bbox.y0 / scale, w: (s.bbox.x1 - s.bbox.x0) / scale, h: (s.bbox.y1 - s.bbox.y0) / scale } });
        }
        lines.push({ text, r, confidence: Number(line.confidence) || 0, symbols, engine: 'tesseract' });
      }
  return lines;
}

export const tesseractEngine = {
  id: 'tesseract',
  label: 'Tesseract · 本地 · 离线',
  async recognize(canvas, { lang = 'eng+chi_sim', psm = '11', onProgress, offset, scale } = {}) {
    const w = await getWorker(lang, onProgress);
    await w.setParameters({ tessedit_pageseg_mode: String(psm) });
    const { data } = await w.recognize(canvas, {}, { blocks: true });
    return normalizeTesseract(data, offset, scale);
  },
  async dispose() {
    for (const p of workers.values()) { try { (await p).terminate(); } catch { /* ignore */ } }
    workers.clear();
  }
};
