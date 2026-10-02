// 渲染核心：文字排版 → 墨迹画布（字体重绘 / 原字形 / 智能混合）→ 局部补丁（含背景修复、阴影、旋转、模糊）。
// 预览、导出、字体匹配共用同一条路径，保证“所见即所得”。
import { cv, clamp, parseHex } from './util.js';
import { fonts } from './fonts.js';
import { wrapText } from './layout.js';
import { buildAtlas } from './glyphs.js';
import { unknownMask, inpaintRegion, rectBackground } from './repair.js';

export const DEFAULT_STYLE = Object.freeze({
  font: 'sans-serif', size: 24, weight: 400, italic: false, skew: 0, embolden: 0, spacing: 0, leading: 0, align: 'left',
  color: '#222222', stroke: 0, strokeColor: '#ffffff', blur: 0, opacity: 1, angle: 0,
  shadowOn: false, shadowX: 2, shadowY: 2, shadowBlur: 3, shadowColor: '#000000', shadowAlpha: 0.45,
  mode: 'font', repair: 'smooth', bgcolor: '#ffffff', dx: 0, dy: -60, wrap: true, wrapW: 0
});

const HAS_LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
const HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const scratch = (() => { let c; return () => c || (c = cv(1, 1).getContext('2d')); })();

function applyFont(ctx, st) {
  ctx.font = fonts.css(st);
  ctx.fontKerning = 'normal';
  if (HAS_LS) ctx.letterSpacing = (st.spacing || 0) + 'px';
}

/** 一行文字（整串绘制，保留字体字距/连字）：返回 {adv, left, right, ascent, descent} */
export function measureLine(ctx, s, st) {
  applyFont(ctx, st);
  if (HAS_LS) {
    const m = ctx.measureText(s), sp = st.spacing || 0;
    return { adv: Math.max(0, m.width - (s.length ? sp : 0)), left: m.actualBoundingBoxLeft || 0, right: m.actualBoundingBoxRight || 0, ascent: m.actualBoundingBoxAscent || 0, descent: m.actualBoundingBoxDescent || 0 };
  }
  let adv = 0, left = 0, right = 0, ascent = 0, descent = 0; const chars = Array.from(s);
  chars.forEach((ch, i) => {
    const m = ctx.measureText(ch);
    if (i === 0) left = m.actualBoundingBoxLeft || 0;
    right = adv + (m.actualBoundingBoxRight || m.width);
    ascent = Math.max(ascent, m.actualBoundingBoxAscent || 0); descent = Math.max(descent, m.actualBoundingBoxDescent || 0);
    adv += m.width + (i < chars.length - 1 ? (st.spacing || 0) : 0);
  });
  return { adv, left, right, ascent, descent };
}
function drawLine(ctx, s, x, y, st, stroke, lw) {
  applyFont(ctx, st);
  const op = stroke ? 'strokeText' : 'fillText';
  if (stroke) { ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.miterLimit = 2; }
  if (HAS_LS) { ctx[op](s, x, y); return; }
  let cx = x;
  for (const ch of Array.from(s)) { ctx[op](ch, cx, y); cx += ctx.measureText(ch).width + (st.spacing || 0); }
}

/** 版面：返回 lines=[{kind:'font',text,...}|{kind:'glyph',items:[...]}] 与每行墨迹框，坐标以 (originX, baseline0) 为参照 */
function layoutText(layer, env) {
  const st = layer.style, src = layer.src, ctx = scratch(), mode = src ? st.mode : 'font';
  const text = String(layer.text || '');
  const off = layer.offset || { x: 0, y: 0 };
  let left0 = layer.pos.x + off.x, top0 = layer.pos.y + off.y;
  const leading = st.leading > 0 ? st.leading : st.size * 1.2;
  let atlas = null, scale = 1;
  if (mode !== 'font') {
    atlas = buildAtlas(src);
    scale = st.size / (layer.fitSize || st.size);
    // 原字形模式以原图整数像素位置为原点，再叠加用户的移动量（不含字体拟合带来的亚像素修正）
    left0 = src.r.x + atlas.left0 + (layer.pos.x - (src.r.x + src.inkF.x + (layer.fit ? layer.fit.dx || 0 : 0))) + off.x;
    top0 = src.r.y + atlas.top0 + (layer.pos.y - (src.r.y + src.inkF.y + (layer.fit ? layer.fit.dy || 0 : 0))) + off.y;
  }
  const maxW = st.wrap ? (st.wrapW > 0 ? st.wrapW : Math.max(8, env.W - left0 - 2)) : Infinity;
  const spExtra = (st.spacing || 0) - (layer.fit ? layer.fit.spacing || 0 : 0); // 原字形的额外字距 = 相对拟合值的增量
  // 行宽度函数
  let widthOf, lines;
  const glyphAdv = ch => { const g = atlas.entries.get(ch); return g.w * scale + atlas.gap * scale + spExtra; };
  const fontAdv = ch => { applyFont(ctx, st); return ctx.measureText(ch).width + (st.spacing || 0); };
  const spaceAdv = () => { applyFont(ctx, st); return ctx.measureText(' ').width + (st.spacing || 0); };
  const charAdv = ch => /\s/.test(ch) ? spaceAdv() : (atlas.entries.has(ch) ? glyphAdv(ch) : fontAdv(ch));
  if (mode === 'font') widthOf = s => measureLine(ctx, s, st).adv;
  else widthOf = s => Array.from(s).reduce((n, ch) => n + charAdv(ch), 0) - (s.length ? atlas.gap * scale + spExtra : 0);
  if (mode === 'glyph') for (const ch of Array.from(text)) if (!/\s/.test(ch) && !atlas.entries.has(ch)) throw new Error(`原图选中区域没有「${ch}」字形，无法凭空复用。请切换为“智能混合”（缺字用匹配字体补画）或“字体重绘”。`);
  lines = wrapText(text, widthOf, maxW);
  // 原行首行基线：用源文字在“当前样式”下的上升高度，使改字号时顶部保持对齐
  const srcFirst = src ? String(src.text).split('\n')[0] : null;
  let A0;
  if (mode !== 'font') A0 = Math.max(...[...atlas.entries.values()].map(g => g.dy)) * scale;
  else if (src) A0 = measureLine(ctx, srcFirst, st).ascent;
  else A0 = measureLine(ctx, lines[0] || 'Mg', st).ascent;
  if (!A0) A0 = st.size * 0.8;
  const base0 = top0 + A0;
  const out = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const blockW = src ? src.ink.w : null;
  const widths = lines.map(l => mode === 'font' ? measureLine(ctx, l, st) : null);
  const inkWidths = lines.map((l, i) => mode === 'font' ? widths[i].left + widths[i].right : Math.max(0, widthOf(l)));
  const bw = blockW ?? Math.max(1, ...inkWidths);
  lines.forEach((l, i) => {
    const by = base0 + i * leading, iw = inkWidths[i];
    let lx = left0;
    if (st.align === 'center') lx = left0 + (bw - iw) / 2; else if (st.align === 'right') lx = left0 + bw - iw;
    if (mode === 'font') {
      const m = widths[i], ox = lx + m.left;
      out.push({ kind: 'font', text: l, x: ox, y: by });
      if (l.length) { minX = Math.min(minX, lx); maxX = Math.max(maxX, lx + iw); minY = Math.min(minY, by - m.ascent); maxY = Math.max(maxY, by + m.descent); }
    } else {
      const items = [], chars = Array.from(l); let cx = lx;
      const useExact = mode !== 'font' && atlas.exact && i === 0 && lines[0] === text.split('\n')[0];
      for (let j = 0; j < chars.length; j++) {
        const ch = chars[j];
        if (/\s/.test(ch)) { cx += spaceAdv(); continue; }
        // 与原文同一位置、同一字符：直接取原图里的真实位置（保留字距调整）；其余字符顺排
        if (useExact && atlas.srcChars[j] === ch && atlas.idxLeft.has(j)) cx = lx + (atlas.idxLeft.get(j) - atlas.left0) * scale;
        const g = atlas.entries.get(ch);
        if (g && mode !== 'font') {
          items.push({ kind: 'src', ch, g, x: cx, y: by - g.dy * scale, w: g.w * scale, h: g.h * scale });
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx + g.w * scale); minY = Math.min(minY, by - g.dy * scale); maxY = Math.max(maxY, by - g.dy * scale + g.h * scale);
          cx += glyphAdv(ch);
        } else {
          const m = measureLine(ctx, ch, st);
          items.push({ kind: 'font', ch, x: cx, y: by });
          minX = Math.min(minX, cx - m.left); maxX = Math.max(maxX, cx + m.right); minY = Math.min(minY, by - m.ascent); maxY = Math.max(maxY, by + m.descent);
          cx += fontAdv(ch);
        }
      }
      out.push({ kind: 'items', items });
    }
  });
  if (!isFinite(minX)) { minX = left0; maxX = left0 + 1; minY = top0; maxY = top0 + 1; }
  return { lines: out, box: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }, atlas, scale, base0, leading };
}

function colorize(canvas, color) {
  const c = cv(canvas.width, canvas.height), x = c.getContext('2d');
  x.drawImage(canvas, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** 绘制墨迹画布（含描边/加粗/变薄/斜体变形）。返回 {canvas,x,y,box}，x,y 为画布左上角的图像坐标。 */
export function renderInk(layer, env) {
  const st = layer.style, lay = layoutText(layer, env), emb = st.embolden || 0;
  const pad = Math.ceil(Math.max(0, st.stroke) + Math.max(emb, 0) / 2 + 2 + Math.abs(Math.tan((st.skew || 0) * Math.PI / 180)) * st.size * 0.6);
  const x0 = Math.floor(lay.box.x - pad), y0 = Math.floor(lay.box.y - pad);
  const w = Math.ceil(lay.box.x + lay.box.w + pad) - x0, h = Math.ceil(lay.box.y + lay.box.h + pad) - y0;
  if (w * h > 16e6) throw new Error('文字区域超过安全内存上限，请降低字号或缩短文字');
  const F = cv(w, h), O = cv(w, h), fx = F.getContext('2d'), ox = O.getContext('2d');
  const k = Math.tan((st.skew || 0) * Math.PI / 180);
  const withSkew = (ctx, y0b, fn) => { ctx.save(); if (k) ctx.transform(1, 0, -k, 1, k * y0b, 0); fn(); ctx.restore(); };
  const outlineW = st.stroke > 0 ? 2 * st.stroke + Math.max(emb, 0) : 0;
  const outlineColor = st.strokeColor || st.color;
  for (const line of lay.lines) {
    if (line.kind === 'font') {
      if (!line.text) continue;
      const lx = line.x - x0, ly = line.y - y0;
      if (outlineW) { ox.strokeStyle = outlineColor; withSkew(ox, ly, () => drawLine(ox, line.text, lx, ly, st, true, outlineW)); }
      fx.fillStyle = st.color; fx.strokeStyle = st.color;
      withSkew(fx, ly, () => {
        drawLine(fx, line.text, lx, ly, st, false);
        if (emb > 0) drawLine(fx, line.text, lx, ly, st, true, emb);
      });
      if (emb < 0) { // 变薄：沿轮廓擦除 |emb|/2
        fx.save(); fx.globalCompositeOperation = 'destination-out'; fx.strokeStyle = '#000';
        withSkew(fx, ly, () => drawLine(fx, line.text, lx, ly, st, true, -emb));
        fx.restore();
      }
    } else {
      for (const it of line.items) {
        if (it.kind === 'src') {
          const g = it.g, tint = colorize(g.canvas, st.color), gx = it.x - x0, gy = it.y - y0;
          if (st.stroke > 0) { const oc = colorize(g.canvas, outlineColor); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ox.drawImage(oc, gx + Math.cos(a) * st.stroke, gy + Math.sin(a) * st.stroke, it.w, it.h); } }
          if (emb > 0) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; fx.drawImage(tint, gx + Math.cos(a) * emb / 2, gy + Math.sin(a) * emb / 2, it.w, it.h); }
          fx.save(); if (k) { fx.transform(1, 0, -k, 1, k * (gy + it.h), 0); } fx.drawImage(tint, gx, gy, it.w, it.h); fx.restore();
        } else {
          const lx = it.x - x0, ly = it.y - y0;
          if (outlineW) { ox.strokeStyle = outlineColor; withSkew(ox, ly, () => drawLine(ox, it.ch, lx, ly, st, true, outlineW)); }
          fx.fillStyle = st.color; fx.strokeStyle = st.color;
          withSkew(fx, ly, () => { drawLine(fx, it.ch, lx, ly, st, false); if (emb > 0) drawLine(fx, it.ch, lx, ly, st, true, emb); });
          if (emb < 0) { fx.save(); fx.globalCompositeOperation = 'destination-out'; withSkew(fx, ly, () => drawLine(fx, it.ch, lx, ly, st, true, -emb)); fx.restore(); }
        }
      }
    }
  }
  const out = cv(w, h), c = out.getContext('2d');
  if (outlineW || st.stroke > 0) c.drawImage(O, 0, 0);
  c.drawImage(F, 0, 0);
  return { canvas: out, x: x0, y: y0, box: lay.box, layout: lay };
}

/** 清理被替换文字的背景：返回与 src.r 同尺寸的画布 */
async function cleanRegion(layer, below, env) {
  const st = layer.style, r = layer.src.r;
  // 清理结果只取决于：区域、修复方式、背景色、复制偏移、下方图层状态 —— 与新文字内容无关，输入文字时无需重跑修补
  const ckey = JSON.stringify([layer.src.id, r, st.repair, st.bgcolor, st.dx, st.dy, env.prevKey]);
  if (layer._clean && layer._clean.key === ckey) return layer._clean.canvas;
  const c = await cleanRegionRaw(layer, below);
  layer._clean = { key: ckey, canvas: c };
  return c;
}
async function cleanRegionRaw(layer, below) {
  const st = layer.style, r = layer.src.r, c = cv(r.w, r.h), ctx = c.getContext('2d');
  ctx.drawImage(below, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (st.repair === 'keep') return c;
  if (st.repair === 'solid') { ctx.fillStyle = st.bgcolor; ctx.fillRect(0, 0, r.w, r.h); return c; }
  if (st.repair === 'clone') {
    const x = r.x + st.dx, y = r.y + st.dy;
    if (x < 0 || y < 0 || x + r.w > below.width || y + r.h > below.height) throw new Error('复制来源超出图像，请调整复制偏移');
    ctx.clearRect(0, 0, r.w, r.h); ctx.drawImage(below, x, y, r.w, r.h, 0, 0, r.w, r.h); return c;
  }
  const data = ctx.getImageData(0, 0, r.w, r.h);
  if (st.repair === 'rect') { ctx.putImageData(rectBackground(data), 0, 0); return c; }
  const grow = clamp(Math.round(layer.src.ink.h * 0.05), 1, 4);
  const unk = unknownMask(layer.src.alpha, r.w, r.h, grow);
  ctx.putImageData(await inpaintRegion(data, unk), 0, 0);
  return c;
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export function layerKey(layer, prevKey, env) {
  return hashStr(JSON.stringify([layer.text, layer.style, layer.offset, layer.pos, layer.touched, layer.src ? [layer.src.id, layer.src.text] : null, layer.fitSize, prevKey, env.W, env.H]));
}

/** 生成图层补丁：{canvas,x,y,textRect}；未触碰的识别图层返回 null（保留原像素） */
export async function buildPatch(layer, below, env) {
  if (layer.src && !layer.touched) return null;
  if (!layer.src && !String(layer.text || '').length) return null;
  const st = layer.style, ink = renderInk(layer, env);
  const ang = (st.angle || 0) * Math.PI / 180, co = Math.abs(Math.cos(ang)), si = Math.abs(Math.sin(ang));
  const cx = ink.x + ink.canvas.width / 2, cy = ink.y + ink.canvas.height / 2;
  const hw = (co * ink.canvas.width + si * ink.canvas.height) / 2, hh = (si * ink.canvas.width + co * ink.canvas.height) / 2;
  const sh = st.shadowOn ? Math.abs(st.shadowX) + Math.abs(st.shadowY) + st.shadowBlur * 2 + 2 : 0;
  const blurPad = st.blur > 0 ? Math.ceil(st.blur * 3) : 0;
  let x0 = cx - hw - sh - blurPad, y0 = cy - hh - sh - blurPad, x1 = cx + hw + sh + blurPad, y1 = cy + hh + sh + blurPad;
  const region = layer.src && st.repair !== 'keep' ? layer.src.r : null;
  if (region) { x0 = Math.min(x0, region.x); y0 = Math.min(y0, region.y); x1 = Math.max(x1, region.x + region.w); y1 = Math.max(y1, region.y + region.h); }
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0)), bx1 = Math.min(env.W, Math.ceil(x1)), by1 = Math.min(env.H, Math.ceil(y1));
  const textRect = { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh };
  if (bx1 <= bx || by1 <= by) return { canvas: cv(1, 1), x: 0, y: 0, textRect, empty: true, ink: ink.box };
  const patch = cv(bx1 - bx, by1 - by), ctx = patch.getContext('2d');
  ctx.drawImage(below, bx, by, patch.width, patch.height, 0, 0, patch.width, patch.height);
  if (region) {
    const clean = await cleanRegion(layer, below, env);
    ctx.clearRect(region.x - bx, region.y - by, region.w, region.h);
    ctx.drawImage(clean, region.x - bx, region.y - by);
  }
  ctx.save();
  ctx.translate(cx - bx, cy - by); ctx.rotate(ang);
  ctx.globalAlpha = clamp(st.opacity, 0, 1);
  if (st.blur > 0 && HAS_FILTER) ctx.filter = `blur(${st.blur}px)`;
  if (st.shadowOn) {
    const [r, g, b] = parseHex(st.shadowColor);
    ctx.shadowColor = `rgba(${r},${g},${b},${st.shadowAlpha})`; ctx.shadowOffsetX = st.shadowX; ctx.shadowOffsetY = st.shadowY; ctx.shadowBlur = st.shadowBlur;
  }
  ctx.drawImage(ink.canvas, -ink.canvas.width / 2, -ink.canvas.height / 2);
  ctx.restore();
  return { canvas: patch, x: bx, y: by, textRect, ink: ink.box };
}
