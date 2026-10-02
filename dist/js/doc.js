// 文档模型：基础图像 + 非破坏式文字图层 + 撤销历史。预览/导出永远由 base + layers 重新合成。
import { cv, uid, copyCanvas, clamp } from './util.js';
import { fonts } from './fonts.js';
import { extractMask } from './analyze.js';
import { DEFAULT_STYLE, buildPatch, layerKey } from './render.js';
import { fitStyle, styleFromFit } from './fit.js';

export const MAX_PIXELS = 16_000_000;

export class Doc {
  constructor(canvas, name) {
    this.id = uid('doc');
    this.name = name;
    this.base = canvas;               // 当前基础图像（合并/在线编辑返回后会被替换）
    this.original = copyCanvas(canvas); // 打开时的原图，用于左侧对比（尺寸变化时同步更新）
    this.layers = [];
    this.lines = [];                  // OCR 文字行
    this.sel = null;                  // 当前选中图层
    this.composite = null;            // 最近一次渲染结果
    this.dirty = false;
    this.zoom = 'fit';
    this.scroll = { x: 0, y: 0 };
    this.ocr = { status: 'idle', message: '', token: 0 };
    this.mode = 'click';
    this.history = new History(this);
    this.history.commit('打开');
  }
  get W() { return this.base.width; }
  get H() { return this.base.height; }
  get pixels() { return this.base.width * this.base.height; }
}

const layerData = l => ({ id: l.id, kind: l.kind, text: l.text, style: l.style, offset: l.offset, pos: l.pos, visible: l.visible, touched: l.touched, fitSize: l.fitSize, lineId: l.lineId, srcId: l.src ? l.src.id : null, name: l.name });
export function cloneLayer(l) {
  return { ...l, style: { ...l.style }, offset: { ...l.offset }, pos: { ...l.pos }, candidates: l.candidates, _cache: null, bounds: l.bounds ? { ...l.bounds } : null };
}

class History {
  constructor(doc) { this.doc = doc; this.stack = []; this.index = -1; this.max = 60; }
  key() { return JSON.stringify(this.doc.layers.map(layerData)) + '|' + (this.doc.base._hid ||= uid('b')); }
  snapshot(label) { return { label, key: this.key(), layers: this.doc.layers.map(cloneLayer), sel: this.doc.sel ? this.doc.sel.id : null, base: this.doc.base }; }
  /** 状态与栈顶相同则忽略，返回是否新增了记录 */
  commit(label = '编辑') {
    const k = this.key();
    if (this.index >= 0 && this.stack[this.index].key === k) return false;
    this.stack.length = this.index + 1;
    this.stack.push(this.snapshot(label)); this.index++;
    while (this.stack.length > this.max) { this.stack.shift(); this.index--; }
    return true;
  }
  get canUndo() { return this.index > 0 || (this.index === 0 && this.key() !== this.stack[0].key); }
  get canRedo() { return this.index < this.stack.length - 1; }
  undo() {
    this.commit('未提交的修改');
    if (this.index <= 0) return false;
    this.index--; this.restore(this.stack[this.index]); return true;
  }
  redo() { if (!this.canRedo) return false; this.index++; this.restore(this.stack[this.index]); return true; }
  restore(s) {
    const d = this.doc;
    d.base = s.base;
    if (d.original.width !== d.base.width || d.original.height !== d.base.height) d.original = copyCanvas(d.base);
    d.layers = s.layers.map(cloneLayer);
    d.sel = d.layers.find(l => l.id === s.sel) || null;
    d.dirty = true;
  }
}

/** 取得与屏幕无关的像素：region 内 RGBA */
function readRegion(canvas, r) { return canvas.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h); }

/** 由 OCR 行创建“编辑图层”（尚未触碰：不改变像素） */
export function makeEditLayer(doc, line) {
  const pad = clamp(Math.round(line.r.h * 0.18), 3, 8);
  const x = Math.max(0, Math.floor(line.r.x - pad)), y = Math.max(0, Math.floor(line.r.y - pad));
  const r = { x, y, w: Math.min(doc.W - x, Math.ceil(line.r.w + pad * 2)), h: Math.min(doc.H - y, Math.ceil(line.r.h + pad * 2)) };
  if (r.w < 3 || r.h < 3) throw new Error('请选择至少 3 × 3 像素的区域');
  if (r.w * r.h > 1_500_000) throw new Error('选区过大，请缩小到一行或一小段文字');
  const img = readRegion(doc.base, r);
  const mask = extractMask(img.data, r.w, r.h);
  const src = { id: uid('src'), text: line.text, r, alpha: mask.alpha, ink: mask.ink, inkF: mask.inkF, fg: mask.fg, fgHex: mask.fgHex, bgHex: mask.bgHex, symbols: line.symbols || [], hints: line.hints };
  return {
    id: uid('layer'), kind: 'edit', name: line.text.split('\n')[0].slice(0, 24), text: line.text, lineId: line.id || null,
    style: { ...DEFAULT_STYLE, color: mask.fgHex, bgcolor: mask.bgHex },
    offset: { x: 0, y: 0 }, pos: { x: r.x + mask.inkF.x, y: r.y + mask.inkF.y }, src, touched: false, visible: true, fitSize: null, candidates: [], bounds: null, _cache: null
  };
}

/** 新增文字图层（无原文，不清除背景） */
export function makeAddLayer(doc, x, y) {
  const px = doc.base.getContext('2d', { willReadFrequently: true }).getImageData(clamp(Math.round(x), 0, doc.W - 1), clamp(Math.round(y), 0, doc.H - 1), 1, 1).data;
  const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
  return {
    id: uid('layer'), kind: 'add', name: '新文字', text: '', lineId: null,
    style: { ...DEFAULT_STYLE, size: clamp(Math.round(doc.H / 22), 16, 96), color: lum > 140 ? '#222222' : '#f5f5f5', repair: 'keep' },
    offset: { x: 0, y: 0 }, pos: { x: Math.round(x), y: Math.round(y) }, src: null, touched: true, visible: true, fitSize: null, candidates: [], bounds: null, _cache: null
  };
}

/** 自动匹配字体/字号/字重并写入样式（不触碰像素：touched 保持不变） */
export async function fitLayer(layer, opts = {}) {
  if (!layer.src) return null;
  const cands = await fitStyle({ ...layer.src, text: layer.src.text }, { hints: layer.src.hints, ...opts });
  layer.candidates = cands;
  applyCandidate(layer, cands[0]);
  return cands;
}
export function applyCandidate(layer, c) {
  const keep = { color: layer.style.color, bgcolor: layer.style.bgcolor, repair: layer.style.repair, mode: layer.style.mode, align: layer.style.align };
  layer.style = { ...styleFromFit(c, layer.style), ...keep, color: layer.style.color };
  layer.fitSize = c.size; layer.fit = c;
  if (layer.src) layer.pos = { x: layer.src.r.x + layer.src.inkF.x + (c.dx || 0), y: layer.src.r.y + layer.src.inkF.y + (c.dy || 0) };
  layer._cache = null;
}

/** 合成全部可见图层。返回 {canvas, errors} */
export async function renderDoc(doc) {
  const env = { W: doc.W, H: doc.H }, out = cv(doc.W, doc.H), ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(doc.base, 0, 0);
  let prev = 'base'; const errors = [];
  for (const layer of doc.layers) {
    if (layer.visible === false) { layer.bounds = null; continue; }
    const key = layerKey(layer, prev, env);
    let entry = layer._cache;
    if (!entry || entry.key !== key) {
      try {
        await fonts.ensure(layer.style, layer.text);
        entry = { key, patch: await buildPatch(layer, out, { ...env, prevKey: prev }) };
        layer.error = null;
      } catch (e) { layer.error = e.message; entry = { key, patch: null }; }
      layer._cache = entry;
    }
    if (layer.error) errors.push(`「${layer.name}」${layer.error}`);
    const p = entry.patch;
    layer.bounds = p ? p.textRect : null;
    if (p && !p.empty) { ctx.clearRect(p.x, p.y, p.canvas.width, p.canvas.height); ctx.drawImage(p.canvas, p.x, p.y); }
    prev = key;
  }
  return { canvas: out, errors };
}
