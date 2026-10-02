// 多引擎结果融合：按位置聚类 → 按引擎先验 × 置信度加权投票 → 保留候选与分歧标记。
// 纯函数，不依赖 DOM，可在 Node 中测试。
import { iou } from '../util.js';

export const normText = s => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function levenshtein(a, b) {
  a = Array.from(a); b = Array.from(b);
  if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export function similarity(a, b) {
  const x = normText(a), y = normText(b), m = Math.max(Array.from(x).length, Array.from(y).length);
  return m ? 1 - levenshtein(x, y) / m : 1;
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const CJK_C = '\\u2e80-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\uac00-\\ud7af';
/**
 * 去掉汉字之间的“伪空格”（Tesseract 常在汉字间逐字加空格）。
 * 只有当汉字相邻处超过 40% 带空格时才清理；原图本来就有的少量词间空格（如“字境 图片文字 编辑”）会保留。
 */
export function cleanSpaces(t) {
  t = String(t);
  const pair = new RegExp(`[${CJK_C}][ \\t]*(?=[${CJK_C}])`, 'g'), spaced = new RegExp(`[${CJK_C}][ \\t]+(?=[${CJK_C}])`, 'g');
  const total = (t.match(pair) || []).length, sp = (t.match(spaced) || []).length;
  return total && sp / total >= 0.4 ? t.replace(new RegExp(`([${CJK_C}])[ \\t]+(?=[${CJK_C}])`, 'g'), '$1') : t;
}
/** 比较用的宽松键：忽略大小写、全半角与全部空白（PaddleOCR 常丢英文词间空格） */
export const looseKey = t => normText(cleanSpaces(t)).replace(/\s+/g, '');
const wsCount = t => (String(t).match(/\s/g) || []).length;
/** 引擎先验：含中日韩字符时偏向 PaddleOCR，纯拉丁/数字时 Tesseract 与 Paddle 接近 */
export function enginePrior(engine, text) {
  const cjk = CJK.test(text);
  if (engine === 'llm') return 1.15;
  if (engine === 'paddle') return cjk ? 1.0 : 0.95;
  if (engine === 'tesseract') return cjk ? 0.72 : 1.0;
  return 0.8;
}

function sameLine(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0), m = Math.min(a.w * a.h, b.w * b.h);
  return m > 0 && inter / m > 0.5 && iou(a, b) > 0.25;
}

/**
 * results: [{engine, lines:[{text,r,confidence,symbols?}]}]；返回融合后的行（按阅读顺序）。
 * 每行：{ text, r, confidence, symbols, engine, alts:[{engine,text,confidence}], disagree }
 */
export function fuse(results) {
  const clusters = [];
  for (const res of results) for (const line of res.lines) {
    if (!line.text || !line.text.trim()) continue;
    const item = { ...line, engine: res.engine };
    const c = clusters.find(c => !c.members.some(m => m.engine === res.engine) && sameLine(c.members[0].r, line.r));
    if (c) c.members.push(item); else clusters.push({ members: [item] });
  }
  const out = clusters.map(c => {
    const groups = new Map();
    for (const m of c.members) {
      const key = looseKey(m.text), score = Math.max(0.05, (m.confidence || 0) / 100) * enginePrior(m.engine, m.text);
      const g = groups.get(key) || { key, score: 0, members: [] };
      g.score += score; g.members.push(m); groups.set(key, g);
    }
    const ranked = [...groups.values()].sort((a, b) => b.score - a.score);
    // 同一组内只有空白不同：取词间空格最完整的写法（通常来自 Tesseract），置信度作次序
    const win = ranked[0], best = win.members.slice().sort((a, b) => wsCount(cleanSpaces(b.text)) - wsCount(cleanSpaces(a.text)) || (b.confidence || 0) - (a.confidence || 0))[0];
    const withSymbols = win.members.find(m => m.symbols && m.symbols.length && !m.symbols[0].approx) || win.members.find(m => m.symbols && m.symbols.length);
    return {
      text: cleanSpaces(best.text), r: { ...win.members.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0].r }, confidence: Math.min(100, win.members.reduce((n, m) => n + (m.confidence || 0), 0) / win.members.length + (win.members.length > 1 ? 4 : 0)),
      symbols: withSymbols ? withSymbols.symbols : [], engine: win.members.map(m => m.engine).join('+'),
      alts: ranked.slice(1).flatMap(g => g.members.map(m => ({ engine: m.engine, text: m.text, confidence: m.confidence || 0 }))),
      disagree: ranked.length > 1
    };
  });
  out.sort((a, b) => (a.r.y + a.r.h / 2) - (b.r.y + b.r.h / 2) || a.r.x - b.r.x);
  // 行级阅读顺序：同一水平带内按 x 排序
  out.sort((a, b) => Math.abs((a.r.y + a.r.h / 2) - (b.r.y + b.r.h / 2)) < Math.min(a.r.h, b.r.h) * 0.5 ? a.r.x - b.r.x : (a.r.y + a.r.h / 2) - (b.r.y + b.r.h / 2));
  return out;
}

/** 将视觉大模型的逐行转写并入结果：与本地结果足够相近才采纳，避免幻觉整体替换 */
export function applyLLMRows(lines, rows, { minSimilarity = 0.35 } = {}) {
  let changed = 0, rejected = 0;
  for (const row of rows) {
    const line = lines[row.i - 1];
    if (!line || typeof row.text !== 'string') continue;
    const t = row.text.replace(/\s+$/g, '').replace(/^\s+/g, '');
    line.hints = { bold: !!row.bold, italic: !!row.italic, family: ['sans', 'serif', 'mono', 'handwriting', 'display'].includes(row.family) ? row.family : undefined };
    if (!t) continue;
    if (looseKey(t) === looseKey(line.text)) { line.llmAgrees = true; line.confidence = Math.min(100, (line.confidence || 0) + 6); continue; }
    if (similarity(t, line.text) >= minSimilarity || (line.confidence || 0) < 55) {
      line.alts = [{ engine: line.engine, text: line.text, confidence: line.confidence || 0 }, ...(line.alts || [])];
      line.text = t; line.engine = 'llm'; line.symbols = []; line.disagree = true; changed++;
    } else {
      (line.alts = line.alts || []).unshift({ engine: 'llm', text: t, confidence: 0, rejected: true }); line.disagree = true; rejected++;
    }
  }
  return { changed, rejected };
}
