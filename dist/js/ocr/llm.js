// 视觉大模型“校对 + 字体提示”：把各行截图拼成一张带序号的拼接图，一次请求逐行转写并判断粗体/斜体/字体族。
// 坐标始终来自本地检测（PaddleOCR / Tesseract），大模型只负责文字，避免它凭空编造文字位置。
// 网络请求由浏览器直接发往你填写的服务商，本站没有任何中转服务器。
import { cv, clamp, canvasToBlob } from '../util.js';
import { applyLLMRows } from './fusion.js';

export const PRESETS = [
  { id: 'gemini', label: 'Google Gemini（AI Studio，有免费额度）', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', note: '到 aistudio.google.com 获取 Key。免费层可能要求同意数据用于改进模型。' },
  { id: 'zhipu', label: '智谱 GLM 视觉（Flash 系列免费）', kind: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash', note: '到 open.bigmodel.cn 获取 Key；免费模型名以官网为准（如 glm-4v-flash / glm-4.6v-flash）。' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow（部分视觉模型免费）', kind: 'openai', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-7B-Instruct', note: '免费模型清单以 cloud.siliconflow.cn/models 为准。' },
  { id: 'openrouter', label: 'OpenRouter（:free 视觉模型，限频）', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'qwen/qwen2.5-vl-72b-instruct:free', note: '免费模型随时增减，请在 openrouter.ai/models 筛选“免费 + 图片输入”。' },
  { id: 'ollama', label: 'Ollama 本机（完全本地、免费）', kind: 'openai', base: 'http://localhost:11434/v1', model: 'qwen2.5vl', needsKey: false, note: '先 ollama pull qwen2.5vl（或 minicpm-v / llama3.2-vision）；需设置环境变量 OLLAMA_ORIGINS=* 允许浏览器跨域。' },
  { id: 'lmstudio', label: 'LM Studio 本机（完全本地、免费）', kind: 'openai', base: 'http://localhost:1234/v1', model: 'qwen2.5-vl-7b-instruct', needsKey: false, note: '在 LM Studio 中加载视觉模型并启用本地服务器与 CORS。' },
  { id: 'custom', label: '自定义（OpenAI 兼容接口）', kind: 'openai', base: '', model: '', note: '任何兼容 /chat/completions 且支持图片输入的服务。' }
];

export const PROMPT = `这是一张“文字行拼接图”：每一行左侧是序号（1、2、3…），右侧是一张文字行截图。
请逐行如实转写右侧文字：保持大小写、数字、标点与空格；不要翻译、不要纠错、不要补全、不要合并行。
同时判断每行字体：bold（是否粗体 true/false）、italic（是否斜体 true/false）、family（sans 无衬线 / serif 衬线 / mono 等宽 / handwriting 手写 / display 艺术字）。
只输出 JSON，不要任何解释，格式：{"rows":[{"i":1,"text":"…","bold":false,"italic":false,"family":"sans"}]}`;

export function checkEndpoint(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('接口地址无效'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('接口必须使用 HTTPS（本机 localhost 除外）');
  return u;
}

/** 把若干行截图拼成一张图。返回 [{canvas, indices}]，每张最多 maxRows 行 */
export function buildSheets(source, lines, { maxRows = 20, maxW = 1280 } = {}) {
  const sheets = [];
  for (let start = 0; start < lines.length; start += maxRows) {
    const idx = [], rows = [];
    for (let i = start; i < Math.min(lines.length, start + maxRows); i++) {
      const r = lines[i].r, pad = 3, sx = Math.max(0, Math.floor(r.x - pad)), sy = Math.max(0, Math.floor(r.y - pad));
      const sw = Math.min(source.width - sx, Math.ceil(r.w + pad * 2)), sh = Math.min(source.height - sy, Math.ceil(r.h + pad * 2));
      if (sw < 2 || sh < 2) continue;
      let s = clamp(56 / sh, 1, 3);
      if (sw * s > maxW - 90) s = (maxW - 90) / sw;
      rows.push({ i: i + 1, sx, sy, sw, sh, s, h: Math.ceil(sh * s) + 14 });
      idx.push(i);
    }
    if (!rows.length) continue;
    const H = rows.reduce((n, r) => n + r.h, 0), W = Math.min(maxW, Math.max(...rows.map(r => Math.ceil(r.sw * r.s))) + 90);
    const c = cv(W, H), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    let y = 0;
    for (const r of rows) {
      x.fillStyle = '#eef0f6'; x.fillRect(0, y, 64, r.h);
      x.fillStyle = '#111'; x.font = 'bold 22px sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(String(r.i), 32, y + r.h / 2);
      x.imageSmoothingQuality = 'high';
      x.drawImage(source, r.sx, r.sy, r.sw, r.sh, 72, y + 7, Math.ceil(r.sw * r.s), Math.ceil(r.sh * r.s));
      x.strokeStyle = '#c9ccd8'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, y + r.h - .5); x.lineTo(W, y + r.h - .5); x.stroke();
      y += r.h;
    }
    sheets.push({ canvas: c, indices: idx });
  }
  return sheets;
}

export function parseRows(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('模型返回内容不是 JSON');
  let obj;
  try { obj = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('模型返回的 JSON 无法解析'); }
  const rows = Array.isArray(obj) ? obj : obj.rows;
  if (!Array.isArray(rows)) throw new Error('模型返回缺少 rows 数组');
  return rows.filter(r => r && Number.isInteger(Number(r.i))).map(r => ({ ...r, i: Number(r.i) }));
}

async function toBase64(canvas) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92), buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 发送一张拼接图，返回模型原始文本 */
export async function askModel(cfg, canvas, { signal } = {}) {
  const b64 = await toBase64(canvas), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90000);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    let url, headers = { 'Content-Type': 'application/json' }, body;
    if (cfg.kind === 'gemini') {
      url = checkEndpoint(`${cfg.base.replace(/\/+$/, '')}/models/${encodeURIComponent(cfg.model)}:generateContent`);
      if (cfg.key) headers['x-goog-api-key'] = cfg.key;
      body = { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } };
    } else {
      url = checkEndpoint(`${cfg.base.replace(/\/+$/, '')}/chat/completions`);
      if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
      body = { model: cfg.model, temperature: 0, max_tokens: 3000, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }] }] };
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', signal: controller.signal });
    if (!res.ok) {
      let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      throw new Error(`视觉模型 HTTP ${res.status}${res.status === 401 || res.status === 403 ? '（Key 无效或无权限）' : res.status === 429 ? '（触发限频，请稍后重试）' : ''} ${detail}`.trim());
    }
    const data = await res.json();
    if (cfg.kind === 'gemini') {
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts) throw new Error('Gemini 没有返回内容（可能被安全策略拦截）');
      return parts.map(p => p.text || '').join('');
    }
    const content = data.choices?.[0]?.message?.content;
    if (Array.isArray(content)) return content.map(p => p.text || '').join('');
    if (typeof content !== 'string') throw new Error('模型响应格式不符合 OpenAI 兼容规范');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('视觉模型请求超时或已取消');
    throw e;
  } finally { clearTimeout(timer); }
}

/** 对融合后的行做大模型校对；返回 {changed, rejected, sheets} */
export async function llmVerify(source, lines, cfg, { onProgress, signal } = {}) {
  if (!cfg || !cfg.model || !cfg.base) throw new Error('请先填写视觉模型的接口地址与模型名');
  const sheets = buildSheets(source, lines);
  let changed = 0, rejected = 0, n = 0;
  for (const sheet of sheets) {
    onProgress && onProgress(`视觉大模型校对 ${++n}/${sheets.length}`);
    const text = await askModel(cfg, sheet.canvas, { signal });
    // 拼接图左侧序号即全局行号（从 1 开始），可直接映射回 lines[i-1]
    const direct = parseRows(text);
    const r = applyLLMRows(lines, direct);
    changed += r.changed; rejected += r.rejected;
  }
  return { changed, rejected, sheets: sheets.length };
}
