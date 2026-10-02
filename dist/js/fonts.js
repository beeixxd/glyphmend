// 字体管理：系统字体探测、本机字体读取、导入文件、免费在线字体（Google Fonts 官方 CSS / GitHub 仓库）。
// 每个条目：{ id(画布使用的 family), label, source, weights[], range?, bytes?, getBytes? }
import { cv } from './util.js';

export const GENERIC = ['sans-serif', 'serif', 'monospace'];
const SYSTEM_CANDIDATES = [
  // 中文（Windows / macOS / Linux）
  'Microsoft YaHei', 'Microsoft JhengHei', 'SimSun', 'NSimSun', 'SimHei', 'KaiTi', 'FangSong', 'DengXian', 'YouYuan', 'LiSu', 'STXihei', 'STSong', 'STKaiti',
  'PingFang SC', 'PingFang TC', 'Hiragino Sans GB', 'Songti SC', 'Heiti SC', 'Kaiti SC', 'Yuanti SC', 'Hiragino Sans', 'Hiragino Mincho ProN',
  'Noto Sans CJK SC', 'Noto Serif CJK SC', 'Source Han Sans SC', 'Source Han Serif SC', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'IPAGothic', 'IPAMincho',
  // 拉丁
  'Arial', 'Arial Black', 'Arial Narrow', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Cambria', 'Candara', 'Consolas',
  'Courier New', 'Times New Roman', 'Georgia', 'Palatino Linotype', 'Garamond', 'Impact', 'Comic Sans MS', 'Lucida Sans', 'Century Gothic', 'Franklin Gothic Medium',
  'Gill Sans', 'Futura', 'Optima', 'Avenir', 'Menlo', 'Monaco', 'Roboto', 'Open Sans', 'Lato', 'Inter', 'Ubuntu',
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Carlito', 'Caladea', 'Lora', 'FreeSans', 'FreeSerif', 'FreeMono'
];
export const FREE_FAMILIES = ['Noto Sans SC', 'Noto Serif SC', 'Noto Sans TC', 'Noto Serif TC', 'Noto Sans JP', 'Noto Serif JP', 'Noto Sans KR', 'Noto Serif KR', 'Ma Shan Zheng', 'ZCOOL XiaoWei', 'ZCOOL QingKe HuangYou', 'ZCOOL KuaiLe', 'Long Cang', 'Liu Jian Mao Cao', 'Zhi Mang Xing', 'LXGW WenKai TC', 'Roboto', 'Inter', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Source Serif 4', 'Oswald', 'Raleway', 'Merriweather', 'Playfair Display', 'PT Sans', 'PT Serif', 'Nunito', 'Ubuntu', 'Fira Sans', 'Fira Code', 'JetBrains Mono', 'Bebas Neue', 'Anton', 'Rubik', 'Work Sans', 'IBM Plex Sans', 'IBM Plex Serif', 'IBM Plex Mono', 'Libre Baskerville', 'Libre Franklin', 'DM Sans', 'DM Serif Display'];

const probeCache = new Map();
function probeWidth(font, text) {
  const c = probeWidth.ctx || (probeWidth.ctx = cv(1, 1).getContext('2d'));
  c.font = font; return c.measureText(text).width;
}
/** 经典宽度探测：与三种回退字体都相同说明系统没有该字体 */
export function isSystemFontInstalled(name) {
  if (GENERIC.includes(name)) return true;
  if (probeCache.has(name)) return probeCache.get(name);
  const text = 'mmmmmmmmmmlliWWW中文字體あア한글0123', safe = name.replace(/["\\]/g, '');
  let found = false;
  for (const base of GENERIC) {
    if (probeWidth(`72px "${safe}", ${base}`, text) !== probeWidth(`72px ${base}`, text)) { found = true; break; }
  }
  probeCache.set(name, found);
  return found;
}
const coverCache = new Map();
/** 字体是否覆盖文本中的字符（用回退字体宽度差判断） */
export function fontCovers(family, text) {
  if (GENERIC.includes(family)) return true;
  const safe = family.replace(/["\\]/g, ''), chars = [...new Set(Array.from(text).filter(c => !/\s/.test(c)))].slice(0, 60);
  for (const ch of chars) {
    const key = family + '\u0001' + ch;
    let v = coverCache.get(key);
    if (v === undefined) {
      v = probeWidth(`64px "${safe}", monospace`, ch) === probeWidth(`64px "${safe}", serif`, ch);
      coverCache.set(key, v);
    }
    if (!v) return false;
  }
  return true;
}

export function styleWeight(style = '') {
  const s = style.toLowerCase().replace(/[ -]/g, '');
  if (s.includes('extrabold') || s.includes('ultrabold')) return 800;
  if (s.includes('semibold') || s.includes('demibold')) return 600;
  if (s.includes('bold')) return 700;
  if (s.includes('black') || s.includes('heavy')) return 900;
  if (s.includes('extralight') || s.includes('ultralight')) return 200;
  if (s.includes('thin')) return 100;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  return 400;
}

/** 读取 TTF/OTF 的 name / OS/2 / fvar，便于传给在线编辑器 */
export function fontNames(bytes) {
  try {
    const v = new DataView(bytes);
    if (bytes.byteLength < 12) return {};
    const n = v.getUint16(4);
    let offset = 0, length = 0, weight = 400, weightRange = null;
    for (let i = 0; i < n && 12 + i * 16 + 16 <= bytes.byteLength; i++) {
      const p = 12 + i * 16, tag = v.getUint32(p), off = v.getUint32(p + 8), len = v.getUint32(p + 12);
      if (off + len > bytes.byteLength) continue;
      if (tag === 0x4f532f32 && len >= 6) weight = v.getUint16(off + 4);
      if (tag === 0x66766172 && len >= 16) {
        const axes = v.getUint16(off + 4), count = v.getUint16(off + 8), size = v.getUint16(off + 10);
        if (size >= 20) for (let a = 0; a < count; a++) { const q = off + axes + a * size; if (q + 20 > off + len) break; if (v.getUint32(q) === 0x77676874) weightRange = [v.getInt32(q + 4) / 65536, v.getInt32(q + 12) / 65536]; }
      }
      if (tag === 0x6e616d65) { offset = off; length = len; }
    }
    if (!offset || offset + length > bytes.byteLength || length < 6) return { weight, weightRange };
    const count = v.getUint16(offset + 2), strings = offset + v.getUint16(offset + 4), found = new Map();
    for (let i = 0; i < count; i++) {
      const p = offset + 6 + i * 12;
      if (p + 12 > offset + length) break;
      const platform = v.getUint16(p), language = v.getUint16(p + 4), id = v.getUint16(p + 6), len = v.getUint16(p + 8), start = strings + v.getUint16(p + 10);
      if (![1, 4, 6, 16].includes(id) || start + len > offset + length) continue;
      let text = '';
      if (platform === 0 || platform === 3) { for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(v.getUint16(start + k)); }
      else { for (let k = 0; k < len; k++) text += String.fromCharCode(v.getUint8(start + k)); }
      if (!found.has(id) || language === 0x409) found.set(id, text);
    }
    return { weight, weightRange, family: found.get(16) || found.get(1), postScriptName: found.get(6), fullName: found.get(4) };
  } catch { return {}; }
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export class FontManager extends EventTarget {
  constructor() {
    super();
    this.list = [];
    this.serial = 0;
    this.catalogue = new Map();
    for (const g of GENERIC) this.list.push({ id: g, label: { 'sans-serif': '系统无衬线', serif: '系统衬线', monospace: '系统等宽' }[g], source: 'system', weights: [400, 700] });
  }
  get(id) { return this.list.find(f => f.id === id); }
  has(id) { return !!this.get(id); }
  add(entry) {
    const old = this.get(entry.id);
    if (old) Object.assign(old, entry); else this.list.push(entry);
    this.dispatchEvent(new Event('change'));
    return entry;
  }
  /** 探测常见系统字体并加入列表 */
  detectSystem() {
    let n = 0;
    for (const name of SYSTEM_CANDIDATES) if (!this.has(name) && isSystemFontInstalled(name)) { this.add({ id: name, label: name, source: 'system', weights: [400, 700] }); n++; }
    return n;
  }
  /** 用于匹配的候选 [{font, weight}] */
  candidates(text) {
    const out = [];
    for (const f of this.list) {
      if (!fontCovers(f.id, text)) continue;
      for (const weight of this.weightsOf(f)) out.push({ font: f.id, weight, label: f.label });
    }
    return out;
  }
  weightsOf(f) {
    if (f.range) {
      const [lo, hi] = f.range, ws = new Set();
      for (let w = Math.ceil(lo / 100) * 100; w <= hi; w += 100) ws.add(w);
      ws.add(Math.round(lo)); ws.add(Math.round(hi));
      return [...ws].filter(w => w >= lo && w <= hi).sort((a, b) => a - b);
    }
    return f.weights && f.weights.length ? f.weights : [400, 700];
  }
  css(style, size = style.size) {
    const raw = String(style.font), family = GENERIC.includes(raw) ? raw : `"${raw.replace(/["\\]/g, '')}"`; // 通用族名不能加引号
    return `${style.italic ? 'italic ' : ''}${Math.round(style.weight)} ${size}px ${family}, sans-serif`;
  }
  async ensure(style, text = 'Aa') {
    const e = this.get(style.font);
    if (!e || e.source === 'system') return;
    try { await document.fonts.load(`${style.italic ? 'italic ' : ''}${Math.round(style.weight)} 24px "${style.font}"`, text || 'Aa'); } catch { /* 忽略，渲染时使用回退字体 */ }
  }

  async queryLocal() {
    if (!window.queryLocalFonts) throw new Error('读取本机字体需要桌面 Chrome / Edge 与 HTTPS 或 localhost；也可批量导入字体文件');
    const data = await window.queryLocalFonts();
    let n = 0;
    for (const f of data) {
      const id = 'Local' + (++this.serial), weight = styleWeight(f.style || f.fullName);
      const face = new FontFace(id, `local("${f.postscriptName.replace(/["\\]/g, '')}")`, { weight: String(weight) });
      try { await face.load(); document.fonts.add(face); this.add({ id, label: f.fullName, source: 'local', weights: [weight], postScriptName: f.postscriptName, family: f.family, getBytes: async () => (await f.blob()).arrayBuffer() }); n++; } catch { /* 个别字体无法读取 */ }
    }
    return n;
  }
  async importFile(file) {
    if (file.size > 50 * 1024 * 1024) throw new Error('单个字体上限 50 MB');
    const bytes = await file.arrayBuffer(), id = 'Import' + (++this.serial), meta = fontNames(bytes);
    const range = meta.weightRange && meta.weightRange[0] < meta.weightRange[1] ? meta.weightRange : null;
    const face = new FontFace(id, bytes, { weight: range ? range.join(' ') : String(meta.weight || 400) });
    await face.load(); document.fonts.add(face);
    return this.add({ id, label: meta.fullName || file.name, source: 'import', weights: [meta.weight || 400], range, bytes, ...meta, family: meta.family });
  }
  async fetchOk(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('字体资源下载失败：HTTP ' + r.status);
    return r;
  }
  /** 通过 Google Fonts 官方 CSS 接口按名称加载（无需 API Key） */
  async loadGoogle(name) {
    name = name.trim();
    if (!name || name.length > 100) throw new Error('请输入有效的免费字体名称');
    if (this.has(name)) return this.get(name);
    const url = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@100..900&display=swap';
    let css;
    try { css = await (await this.fetchOk(url)).text(); }
    catch { css = await (await this.fetchOk('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + '&display=swap')).text(); }
    let range = null, count = 0;
    for (const m of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const b = m[1], fonturl = b.match(/src:\s*url\(([^)]+)\)/)?.[1]?.replace(/["']/g, ''),
        weight = b.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() || '400', style = b.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || 'normal', ur = b.match(/unicode-range:\s*([^;]+)/)?.[1]?.trim();
      if (!fonturl || new URL(fonturl).origin !== 'https://fonts.gstatic.com' || style !== 'normal') continue;
      const d = { weight, style }; if (ur) d.unicodeRange = ur;
      document.fonts.add(new FontFace(name, `url("${fonturl}")`, d));
      const ws = weight.split(/\s+/).map(Number).filter(Number.isFinite);
      if (ws.length === 2) range = ws; count++;
    }
    if (!count) throw new Error('未找到该免费字体，请检查名称');
    try { await document.fonts.load(`24px "${name}"`, 'Aa 字体'); } catch { throw new Error('字体文件加载失败，请检查网络'); }
    return this.add({ id: name, label: name, source: 'web', weights: range ? [] : [400, 700], range });
  }
  async loadRepository(record) {
    const meta = await (await this.fetchOk('https://raw.githubusercontent.com/google/fonts/main/' + record.path + '/METADATA.pb')).text();
    const family = meta.match(/^name:\s*"([^"]+)"/m)?.[1] || record.slug;
    const entries = [...meta.matchAll(/fonts\s*\{([^}]+)\}/g)].map(m => ({ file: m[1].match(/filename:\s*"([^"]+)"/)?.[1], weight: Number(m[1].match(/weight:\s*(\d+)/)?.[1]) || 400, style: m[1].match(/style:\s*"([^"]+)"/)?.[1] || 'normal' }))
      .filter(e => e.file && /\.(ttf|otf)$/.test(e.file) && e.style === 'normal');
    const chosen = entries.filter(e => e.file.includes('[') || [400, 700].includes(e.weight));
    if (!chosen.length && entries.length) chosen.push(entries[0]);
    if (!chosen.length) throw new Error('该字体目录没有支持的 TTF / OTF 文件');
    let info = {}, range = null; const weights = [];
    for (const e of chosen) {
      const bytes = await (await this.fetchOk('https://raw.githubusercontent.com/google/fonts/main/' + record.path + '/' + encodeURIComponent(e.file))).arrayBuffer();
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('单个字体文件超过 50 MB');
      info = { ...info, ...fontNames(bytes) };
      const r = info.weightRange && info.weightRange[0] < info.weightRange[1] ? info.weightRange : null;
      const face = new FontFace(family, bytes, { weight: r ? r.join(' ') : String(e.weight) });
      await face.load(); document.fonts.add(face);
      if (r) range = r; else weights.push(e.weight);
    }
    return this.add({ id: family, label: family, source: 'web', weights, range, ...info });
  }
  async loadNamed(name) {
    const rec = this.catalogue.get(norm(name));
    if (rec) { try { return await this.loadRepository(rec); } catch { /* 回退到 CSS 接口 */ } }
    return this.loadGoogle(name);
  }
  async loadChinese() {
    let ok = 0;
    for (const n of ['Noto Sans SC', 'Noto Serif SC']) { try { await this.loadGoogle(n); ok++; } catch { try { await this.loadRepository({ slug: norm(n), path: 'ofl/' + norm(n) }); ok++; } catch { /* 下一个 */ } } }
    if (!ok) throw new Error('免费中文字体下载失败（可能无法访问 Google / GitHub），请读取本机字体或批量导入字体文件');
    return ok;
  }
  async syncCatalogue() {
    const root = await (await this.fetchOk('https://api.github.com/repos/google/fonts/git/trees/main')).json();
    const branches = root.tree.filter(t => t.type === 'tree' && ['ofl', 'apache', 'ufl'].includes(t.path));
    const results = await Promise.allSettled(branches.map(async b => ({ branch: b.path, data: await (await this.fetchOk('https://api.github.com/repos/google/fonts/git/trees/' + b.sha)).json() })));
    let count = 0;
    for (const r of results) if (r.status === 'fulfilled') for (const e of r.value.data.tree || []) if (e.type === 'tree') { this.catalogue.set(norm(e.path), { slug: e.path, path: r.value.branch + '/' + e.path }); count++; }
    if (!count) throw new Error('免费字体目录同步失败（GitHub 未认证请求可能被限流），请按名称加载或导入字体');
    return count;
  }
}
export const fonts = new FontManager();
