// 主控制器：标签页、对比视图、选择/框选、表单 ↔ 图层、实时预览、撤销、批量替换、导出、字体与模型配置。
import { $, cv, clamp, debounce, canvasToBlob, copyCanvas, uid, escapeHtml, sleep } from './util.js';
import { fonts, FREE_FAMILIES } from './fonts.js';
import { Doc, makeEditLayer, makeAddLayer, fitLayer, applyCandidate, renderDoc, MAX_PIXELS } from './doc.js';
import { DEFAULT_STYLE, renderInk } from './render.js';
import { recognizeImage, recognizeRegion, resolveLang, ENGINE_LABELS } from './ocr/index.js';
import { PRESETS, askModel, parseRows, checkEndpoint } from './ocr/llm.js';
import { initPhotopea } from './photopea.js';

const A = { docs: [], doc: null, layout: 'lr', showBoxes: true, mode: 'click', busy: 0, rendering: false, pending: false, fitting: false, ocrRunning: 0, ocrQueue: Promise.resolve(), llm: null, dragRect: null };
const MAX_FILE = 25 * 1024 * 1024, TOTAL_PIXELS = 48_000_000;

/* ───────── 状态提示 ───────── */
function setStatus(text, err = false) { $('status').textContent = text; $('status').classList.toggle('error', err); }
function busyOn(text) { A.busy++; $('busy').hidden = false; $('busy').textContent = text || '处理中'; }
function busyOff() { A.busy = Math.max(0, A.busy - 1); if (!A.busy) $('busy').hidden = true; }
async function withBusy(label, fn) { busyOn(label); try { return await fn(); } finally { busyOff(); } }
export async function whenIdle() { while (A.rendering || A.pending || A.fitting || A.ocrRunning || A.busy) await sleep(25); }

/* ───────── 视图尺寸 ───────── */
function zoomValue() {
  const doc = A.doc; if (!doc) return 1;
  const sel = $('zoom').value;
  if (sel !== 'fit') return Number(sel);
  const v = $('viewport'), cw = Math.max(200, v.clientWidth - 48), ch = Math.max(200, v.clientHeight - 80);
  const two = A.layout === 'lr' || A.layout === 'diff';
  const z = two ? Math.min((cw - 22) / 2 / doc.W, ch / doc.H) : A.layout === 'tb' ? Math.min(cw / doc.W, (ch - 40) / 2 / doc.H) : Math.min(cw / doc.W, ch / doc.H);
  return clamp(z, 0.02, 1);
}
function layoutSizes() {
  const doc = A.doc; if (!doc) return;
  const z = zoomValue(), w = doc.W * z, h = doc.H * z, cmp = $('compare');
  cmp.className = 'compare ' + (A.layout === 'diff' ? 'lr' : A.layout) + (A.mode === 'box' ? ' boxmode' : '');
  cmp.style.setProperty('--z', z + 'px');
  for (const [pane, canvas, svg] of [['paneOrig', 'cvOrig', 'svgOrig'], ['panePrev', 'cvPrev', 'svgPrev']]) {
    $(pane).style.width = w + 'px'; $(pane).style.height = h + 'px';
    $(canvas).style.width = w + 'px'; $(canvas).style.height = h + 'px';
    $(svg).setAttribute('viewBox', `0 0 ${doc.W} ${doc.H}`);
    $(pane).classList.toggle('pix', z >= 4); $(pane).classList.toggle('grid', z >= 8);
  }
  $('swipeHandle').hidden = A.layout !== 'swipe';
  if (A.layout === 'swipe' && !cmp.style.getPropertyValue('--cut')) cmp.style.setProperty('--cut', '50%');
  $('prevTitle').textContent = A.layout === 'diff' ? '差异热力图（越红改动越大）' : '实时预览';
  $('origMeta').textContent = `${doc.original.width} × ${doc.original.height}`;
}

/* ───────── 渲染 ───────── */
export function requestRender() {
  if (!A.doc) return;
  A.pending = true; if (A.rendering) return; A.rendering = true;
  (async () => {
    try { while (A.pending) { A.pending = false; const doc = A.doc; if (!doc) break; await renderOnce(doc); } }
    catch (e) { setStatus('渲染失败：' + e.message, true); }
    finally { A.rendering = false; }
  })();
}
async function renderOnce(doc) {
  const r = await renderDoc(doc);
  if (doc !== A.doc) return;
  doc.composite = r.canvas; doc.errors = r.errors;
  paintCanvases(); updateBoxes();
  const sel = doc.sel;
  $('prevMeta').textContent = `${doc.composite.width} × ${doc.composite.height} · 图层 ${doc.layers.filter(l => l.visible !== false && (l.touched)).length}`;
  if (r.errors.length) setStatus(r.errors[0], true); else if ($('status').classList.contains('error')) setStatus(sel ? '预览已更新' : '就绪');
  drawCompare();
}
function paintCanvases() {
  const doc = A.doc; if (!doc || !doc.composite) return;
  layoutSizes();
  const o = $('cvOrig'), p = $('cvPrev');
  if (o.width !== doc.original.width || o.height !== doc.original.height) { o.width = doc.original.width; o.height = doc.original.height; }
  o.getContext('2d').clearRect(0, 0, o.width, o.height); o.getContext('2d').drawImage(doc.original, 0, 0);
  const c = doc.composite;
  if (p.width !== c.width || p.height !== c.height) { p.width = c.width; p.height = c.height; }
  const px = p.getContext('2d'); px.clearRect(0, 0, p.width, p.height);
  if (A.layout === 'diff') drawDiff(px, doc); else px.drawImage(c, 0, 0);
}
function drawDiff(ctx, doc) {
  const { width: w, height: h } = doc.composite;
  ctx.drawImage(doc.original, 0, 0, w, h); ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, w, h);
  const a = copyCanvas(doc.original).getContext('2d').getImageData(0, 0, doc.original.width, doc.original.height), b = doc.composite.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  if (a.width !== w || a.height !== h) return;
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));
    if (d > 8) { out.data[i * 4] = 255; out.data[i * 4 + 1] = Math.max(0, 200 - d); out.data[i * 4 + 2] = 40; out.data[i * 4 + 3] = clamp(90 + d, 0, 255); }
  }
  const t = cv(w, h); t.getContext('2d').putImageData(out, 0, 0); ctx.drawImage(t, 0, 0);
}

/* ───────── 文字框 / 选择 ───────── */
function layerRect(l) {
  if (l.bounds) return l.bounds;
  if (l.src) return { x: l.pos.x + l.offset.x, y: l.pos.y + l.offset.y, w: l.src.inkF.w, h: l.src.inkF.h };
  return { x: l.pos.x + l.offset.x, y: l.pos.y + l.offset.y, w: 60, h: 30 };
}
function rectEl(svg, r, cls) { const e = document.createElementNS(svg.namespaceURI, 'rect'); e.setAttribute('x', r.x); e.setAttribute('y', r.y); e.setAttribute('width', r.w); e.setAttribute('height', r.h); e.setAttribute('class', cls); svg.append(e); return e; }
export function updateBoxes() {
  const doc = A.doc; if (!doc) return;
  for (const svg of [$('svgOrig'), $('svgPrev')]) {
    const isOrig = svg.id === 'svgOrig';
    svg.replaceChildren();
    if (A.showBoxes) for (const line of doc.lines) {
      const used = doc.layers.some(l => l.lineId === line.id && l.touched);
      const e = rectEl(svg, line.r, 'tbox' + (line.disagree ? ' dis' : '') + (used ? ' layer' : ''));
      e.dataset.line = line.id; e.onclick = ev => { ev.stopPropagation(); if (A.mode === 'click') selectLine(line); };
      const t = document.createElementNS(svg.namespaceURI, 'title'); t.textContent = line.text; e.append(t);
    }
    const sel = doc.sel;
    if (sel && sel.visible !== false) {
      const r = layerRect(sel), orig = sel.src ? { x: sel.src.r.x + sel.src.inkF.x, y: sel.src.r.y + sel.src.inkF.y, w: sel.src.inkF.w, h: sel.src.inkF.h } : r;
      rectEl(svg, isOrig ? orig : r, 'selbox'); // 左侧框住“原文所在位置”，右侧框住“当前文字”
      if (A.mode === 'click') { const h = rectEl(svg, r, 'drag-hit'); h.dataset.drag = '1'; }
    }
    if (A.dragRect) rectEl(svg, A.dragRect, 'selbox region');
  }
}
function pointOf(e, svg) { const b = svg.getBoundingClientRect(), d = A.doc; return { x: (e.clientX - b.left) / b.width * d.W, y: (e.clientY - b.top) / b.height * d.H }; }
function bindSvg(svg) {
  svg.addEventListener('pointerdown', e => {
    if (!A.doc || e.button !== 0) return;
    if (A.mode === 'box') return startBox(e, svg);
    if (e.target.classList.contains('drag-hit')) return startDrag(e, svg);
    if (e.target.classList.contains('tbox')) return;
    startPan(e);
  });
  svg.addEventListener('dblclick', e => { if (!A.doc || A.fitting || e.target.classList.contains('tbox')) return; const p = pointOf(e, svg); addText(p.x, p.y); });
  svg.addEventListener('pointermove', e => { if (!A.doc) return; const p = pointOf(e, svg), z = zoomValue(); for (const x of [$('xhOrig'), $('xhPrev')]) { x.style.display = 'block'; x.style.left = p.x * z + 'px'; x.style.top = p.y * z + 'px'; } });
  svg.addEventListener('pointerleave', () => { $('xhOrig').style.display = $('xhPrev').style.display = 'none'; });
}
function startPan(e) {
  const v = $('viewport'), sx = e.clientX, sy = e.clientY, ox = v.scrollLeft, oy = v.scrollTop; let moved = false;
  v.classList.add('panning');
  const mv = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; v.scrollLeft = ox - (ev.clientX - sx); v.scrollTop = oy - (ev.clientY - sy); };
  const up = () => { v.classList.remove('panning'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (!moved && A.doc?.sel) { A.doc.sel = null; refreshSide(); updateBoxes(); } };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function startDrag(e, svg) {
  const doc = A.doc, layer = doc.sel; if (!layer) return;
  e.preventDefault(); svg.setPointerCapture(e.pointerId);
  const start = pointOf(e, svg), o = { ...layer.offset }; let moved = false;
  const mv = ev => { const p = pointOf(ev, svg); layer.offset = { x: Math.round(o.x + p.x - start.x), y: Math.round(o.y + p.y - start.y) }; layer.touched = true; moved = true; showOffset(); requestRender(); };
  const up = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); if (moved) commit('移动文字'); };
  svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}
function startBox(e, svg) {
  e.preventDefault(); svg.setPointerCapture(e.pointerId);
  const a = pointOf(e, svg); A.dragRect = null;
  const mv = ev => { const b = pointOf(ev, svg); A.dragRect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; updateBoxes(); };
  const done = ev => {
    svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', done); svg.removeEventListener('pointercancel', cancel);
    const r = A.dragRect; A.dragRect = null; updateBoxes();
    if (!r || r.w < 6 || r.h < 6) return setStatus('框选区域太小，请拖出至少 6 × 6 像素', true);
    regionOCR(r);
  };
  const cancel = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', done); svg.removeEventListener('pointercancel', cancel); A.dragRect = null; updateBoxes(); };
  svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', done); svg.addEventListener('pointercancel', cancel);
}
function setMode(m) {
  A.mode = m; $('modeClick').classList.toggle('on', m === 'click'); $('modeBox').classList.toggle('on', m === 'box');
  layoutSizes(); updateBoxes(); setStatus(m === 'box' ? '拖动框选一段文字，松开后自动识别并带入原文。' : '点击文字框选择；双击空白处添加文字；拖动已选文字框可移动。');
}

async function selectLine(line) {
  const doc = A.doc; if (!doc || A.fitting) return;
  let layer = doc.layers.find(l => l.lineId === line.id);
  if (layer) return selectLayer(layer);
  try { layer = makeEditLayer(doc, line); } catch (e) { return setStatus(e.message + '。可双击图片空白处添加文字。', true); }
  layer.line = line; layer.lineId = line.id; doc.layers.push(layer); doc.sel = layer;
  await fitAndShow(layer, doc);
}
async function fitAndShow(layer, doc) {
  A.fitting = true; refreshSide(); busyOn('匹配字体 / 字号 / 字重…');
  try { await fitLayer(layer, { onProgress: m => setStatus(m) }); const f = layer.fit; setStatus(`已匹配：${f.label} ${Math.round(f.weight)}${f.embolden ? `（微调 ${f.embolden > 0 ? '+' : ''}${f.embolden.toFixed(2)}px）` : ''} · ${f.size.toFixed(1)}px · 差异 ${Math.round(f.error * 100)}%。直接输入新文字即可实时预览。`); }
  catch (e) { setStatus('字体匹配失败：' + e.message + '。可在右侧手动选择字体。', true); }
  finally { A.fitting = false; busyOff(); }
  commit('选择文字');
  if (A.doc === doc) { refreshSide(); updateBoxes(); requestRender(); }
}
function selectLayer(layer) { const doc = A.doc; doc.sel = layer; refreshSide(); updateBoxes(); }
function addText(x, y) {
  const doc = A.doc; if (!doc) return;
  const layer = makeAddLayer(doc, x ?? doc.W * 0.1, y ?? doc.H * 0.1); doc.layers.push(layer); doc.sel = layer;
  commit('添加文字'); refreshSide(); updateBoxes(); requestRender(); $('newText').focus(); setStatus('已添加文字层：输入内容即可实时预览。');
}

/* ───────── 表单 ↔ 图层 ───────── */
const NUM = { size: [1, 1000], weight: [1, 1000], embolden: [-8, 12], spacing: [-100, 200], leading: [0, 2000], skew: [-45, 45], blur: [0, 8], stroke: [0, 20], opacity: [0, 1], angle: [-180, 180], shadowX: [-200, 200], shadowY: [-200, 200], shadowBlur: [0, 100], dx: [-5000, 5000], dy: [-5000, 5000] };
const TXT = ['font', 'align', 'color', 'strokeColor', 'shadowColor', 'mode', 'repair', 'bgcolor'], CHK = ['italic', 'shadowOn', 'wrap'];
const commitSoon = debounce(() => commit('编辑'), 500);
function commit(label) { const d = A.doc; if (!d) return; if (d.history.commit(label)) d.dirty = true; updateButtons(); renderTabs(); }
function markTouched(l) { if (!l.touched) l.touched = true; }
function onField(id) {
  const doc = A.doc, l = doc?.sel; if (!l || A.fitting) return;
  const el = $(id);
  if (NUM[id]) { const v = Number(el.value); if (el.value === '' || !Number.isFinite(v)) return; l.style[id] = clamp(v, ...NUM[id]); }
  else if (TXT.includes(id)) l.style[id] = el.value;
  else if (CHK.includes(id)) l.style[id] = el.checked;
  markTouched(l); commitSoon(); requestRender(); drawCompare();
}
function fillFonts() {
  const sel = $('font'), keep = sel.value; sel.replaceChildren();
  for (const f of fonts.list) sel.add(new Option(f.label || f.id, f.id));
  const l = A.doc?.sel; if (l && !fonts.has(l.style.font)) sel.add(new Option(l.style.font, l.style.font));
  if (l) sel.value = l.style.font; else if (keep) sel.value = keep;
  const dl = $('fNames'); dl.replaceChildren(); for (const n of new Set([...FREE_FAMILIES, ...[...fonts.catalogue.values()].map(r => r.slug)])) dl.append(Object.assign(document.createElement('option'), { value: n }));
}
function showOffset() { const l = A.doc?.sel; $('offX').value = l ? l.offset.x : 0; $('offY').value = l ? l.offset.y : 0; }
export function refreshSide() {
  const doc = A.doc, l = doc?.sel;
  $('form').disabled = !l || A.fitting;
  $('btnBatch').disabled = !doc || !doc.lines.length; $('btnOCR').disabled = !doc;
  fillFonts();
  if (l) {
    if (document.activeElement !== $('newText')) $('newText').value = l.text;
    if (document.activeElement !== $('srcText')) $('srcText').value = l.src ? l.src.text : '';
    $('srcText').disabled = !l.src;
    for (const k of Object.keys(NUM)) if (document.activeElement !== $(k)) $(k).value = Number.isInteger(l.style[k]) ? l.style[k] : +Number(l.style[k]).toFixed(2);
    for (const k of TXT) if (k !== 'font') $(k).value = l.style[k];
    for (const k of CHK) $(k).checked = !!l.style[k];
    $('font').value = l.style.font;
    $('mode').disabled = !l.src; $('repair').disabled = !l.src; $('btnFit').disabled = !l.src; $('btnRevert').disabled = !l.src;
    const f = l.fit;
    $('fitNote').textContent = f ? `匹配：${f.label} ${Math.round(f.weight)} · ${f.size.toFixed(1)}px · 字重微调 ${f.embolden >= 0 ? '+' : ''}${f.embolden.toFixed(2)}px · 形状差异 ${Math.round(f.error * 100)}%。笔画粗细 原图 ${f.stemTarget.toFixed(2)}px → 重绘 ${f.stemFit.toFixed(2)}px（差异越低越接近；不是字体识别置信度）。` : l.src ? '尚未匹配，点击上方按钮。' : '新增文字没有原图可匹配，请手动选择字体。';
    const c = $('cands'); c.replaceChildren();
    (l.candidates || []).slice(0, 6).forEach((cand, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = (l.fit === cand ? 'on' : ''); b.textContent = `${cand.label} ${Math.round(cand.weight)} · ${Math.round(cand.error * 100)}%`; b.onclick = () => { applyCandidate(l, cand); markTouched(l); commit('切换字体候选'); refreshSide(); requestRender(); }; c.append(b); });
    const alts = $('alts'); alts.replaceChildren();
    for (const a of (l.line?.alts || []).slice(0, 4)) { const b = document.createElement('button'); b.type = 'button'; b.title = '改用该识别结果作为原文'; b.textContent = `${ENGINE_LABELS[a.engine] || a.engine}: ${a.text.slice(0, 18)}`; b.onclick = () => useSourceText(l, a.text); alts.append(b); }
  } else { $('newText').value = ''; $('srcText').value = ''; $('cands').replaceChildren(); $('alts').replaceChildren(); $('fitNote').textContent = '选中文字后自动匹配；候选可点击切换。'; }
  showOffset(); renderLists(); drawCompare(); updateButtons();
}
async function useSourceText(l, text) { if (!l.src || A.fitting) return; l.src.text = text; l.src.atlas = null; if (!l.touched) l.text = text; await fitAndShow(l, A.doc); }
function drawCompare() {
  const l = A.doc?.sel, c = $('cmpCanvas'); if (!l || !l.src) { c.width = c.height = 1; return; }
  try {
    const r = l.src.r; c.width = r.w; c.height = r.h; const x = c.getContext('2d');
    const mask = cv(r.w, r.h), mx = mask.getContext('2d'), img = mx.createImageData(r.w, r.h);
    for (let i = 0; i < r.w * r.h; i++) { img.data[i * 4] = 0x58; img.data[i * 4 + 1] = 0xdc; img.data[i * 4 + 2] = 0xe4; img.data[i * 4 + 3] = Math.round(l.src.alpha[i] * 255); }
    mx.putImageData(img, 0, 0); x.drawImage(mask, 0, 0);
    const tmp = { ...l, text: l.src.text, offset: { x: 0, y: 0 }, style: { ...l.style, color: '#ff4d8d', stroke: 0, blur: 0, shadowOn: false, opacity: 0.6, angle: 0, wrap: false, mode: l.src ? l.style.mode : 'font' }, touched: true };
    tmp.pos = { x: l.src.r.x + l.src.inkF.x + (l.fit?.dx || 0), y: l.src.r.y + l.src.inkF.y + (l.fit?.dy || 0) };
    const ink = renderInk(tmp, { W: A.doc.W, H: A.doc.H }); x.drawImage(ink.canvas, ink.x - r.x, ink.y - r.y);
  } catch { c.width = c.height = 1; }
}
function renderLists() {
  const doc = A.doc, L = $('lines'); L.replaceChildren();
  $('lineCount').textContent = doc ? `(${doc.lines.length})` : '';
  if (!doc || !doc.lines.length) { L.innerHTML = `<p class="note">${doc?.ocr.status === 'running' ? '识别中…可以先编辑，不必等待。' : '没有识别到文字：可框选识别，或双击图片添加文字。'}</p>`; }
  else doc.lines.forEach(line => {
    const it = document.createElement('div'); it.className = 'item' + (doc.sel && doc.sel.lineId === line.id ? ' sel' : '');
    const b = document.createElement('button'); b.className = 'main'; b.type = 'button';
    const engines = String(line.engine).split('+').map(e => ENGINE_LABELS[e] || e).join(' + ');
    b.innerHTML = `<b>${escapeHtml(line.text.replace(/\n/g, ' ↵ '))}</b><small>${line.disagree ? '<span class="badge warn">有分歧</span>' : ''}<span class="badge">${escapeHtml(engines)}</span>${Math.round(line.confidence || 0)}%</small>`;
    b.onclick = () => selectLine(line); it.append(b); L.append(it);
  });
  const M = $('layerList'); M.replaceChildren();
  const ls = doc ? doc.layers : [];
  $('layerCount').textContent = ls.length ? `(${ls.length})` : '';
  if (!ls.length) M.innerHTML = '<p class="note">选中文字或添加文字后在此出现。</p>';
  ls.forEach(l => {
    const it = document.createElement('div'); it.className = 'item' + (doc.sel === l ? ' sel' : '');
    const b = document.createElement('button'); b.className = 'main'; b.type = 'button';
    b.innerHTML = `<b>${escapeHtml((l.text || l.name || '').slice(0, 28) || '（空文字）')}</b><small>${l.kind === 'add' ? '<span class="badge ok">新增</span>' : l.touched ? '<span class="badge ok">已修改</span>' : '<span class="badge">未修改</span>'}${l.visible === false ? '<span class="badge warn">隐藏</span>' : ''}${l.error ? '<span class="badge warn">出错</span>' : ''}</small>`;
    b.onclick = () => selectLayer(l);
    const eye = document.createElement('button'); eye.className = 'tiny'; eye.type = 'button'; eye.title = '显示 / 隐藏'; eye.textContent = l.visible === false ? '○' : '●';
    eye.onclick = () => { l.visible = l.visible === false; commit('显示/隐藏'); renderLists(); requestRender(); };
    const del = document.createElement('button'); del.className = 'tiny'; del.type = 'button'; del.title = '删除图层'; del.textContent = '×'; del.onclick = () => deleteLayer(l);
    it.append(b, eye, del); M.append(it);
  });
}
function deleteLayer(l) { const doc = A.doc; if (!doc) return; doc.layers = doc.layers.filter(x => x !== l); if (doc.sel === l) doc.sel = null; commit('删除图层'); refreshSide(); updateBoxes(); requestRender(); }
async function revertLayer() {
  const l = A.doc?.sel; if (!l || !l.src) return;
  l.text = l.src.text; l.touched = false; l.offset = { x: 0, y: 0 }; l.visible = true; l.style = { ...DEFAULT_STYLE, color: l.src.fgHex, bgcolor: l.src.bgHex };
  await fitAndShow(l, A.doc);
}

/* ───────── 历史 / 标签页 ───────── */
function updateButtons() {
  const d = A.doc; $('btnUndo').disabled = !d || !d.history.canUndo; $('btnRedo').disabled = !d || !d.history.canRedo; $('btnExport').disabled = !d;
}
function afterHistory() { const d = A.doc; if (!d) return; d.dirty = true; refreshSide(); updateBoxes(); layoutSizes(); requestRender(); renderTabs(); }
function undo() { const d = A.doc; if (d && !A.fitting && d.history.undo()) { setStatus('已撤销'); afterHistory(); } }
function redo() { const d = A.doc; if (d && !A.fitting && d.history.redo()) { setStatus('已恢复'); afterHistory(); } }
function renderTabs() {
  const root = $('tabs'); root.replaceChildren();
  for (const d of A.docs) {
    const t = document.createElement('div'); t.className = 'tab' + (d === A.doc ? ' active' : ''); t.setAttribute('role', 'tab');
    const b = document.createElement('button'); b.className = 't'; b.textContent = d.name + (d.dirty ? ' •' : ''); b.title = d.name; b.onclick = () => switchDoc(d);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', '关闭 ' + d.name); x.onclick = () => closeDoc(d);
    t.append(b, x); root.append(t);
  }
  if (!A.docs.length) root.innerHTML = '<span class="hint">文件 → 新建 / 打开；每张图片一个标签页</span>';
}
function switchDoc(d) {
  if (A.fitting) return;
  if (A.doc) { A.doc.scroll = { x: $('viewport').scrollLeft, y: $('viewport').scrollTop }; A.doc.zoom = $('zoom').value; }
  A.doc = d; $('zoom').value = d?.zoom || 'fit';
  const has = !!d; $('welcome').hidden = has; $('compare').hidden = !has;
  $('info').textContent = d ? `${d.name} · ${d.W} × ${d.H}` : '新建或打开图片';
  refreshSide(); renderTabs(); updateButtons();
  if (d) { layoutSizes(); requestRender(); requestAnimationFrame(() => { $('viewport').scrollLeft = d.scroll.x; $('viewport').scrollTop = d.scroll.y; }); } else setStatus('打开图片或粘贴截图开始');
}
function closeDoc(d) {
  if (A.fitting) return;
  if (!confirm(`确认关闭「${d.name}」？\n未导出的修改将丢失，本地原文件不会被删除。`)) return;
  d.ocr.token++; const i = A.docs.indexOf(d); A.docs.splice(i, 1);
  if (A.doc === d) { A.doc = null; switchDoc(A.docs[Math.min(i, A.docs.length - 1)] || null); } else renderTabs();
}
function addDoc(canvas, name) {
  const total = A.docs.reduce((n, d) => n + d.pixels, 0);
  if (total + canvas.width * canvas.height > TOTAL_PIXELS) throw new Error('已打开图片总像素超过 4800 万，请先导出并关闭一些标签页');
  const d = new Doc(canvas, name); A.docs.push(d); switchDoc(d); return d;
}

/* ───────── 打开 / 新建 / 示例 ───────── */
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { return await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('无法读取图片')); i.src = url; }); } finally { URL.revokeObjectURL(url); }
  }
}
export async function openFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) throw new Error(`「${file.name}」不是支持的图片格式`);
  if (file.size > MAX_FILE) throw new Error(`「${file.name}」超过 25 MB`);
  const im = await decode(file);
  if (im.width * im.height > MAX_PIXELS) throw new Error(`「${file.name}」超过 1600 万像素`);
  const c = cv(im.width, im.height); c.getContext('2d').drawImage(im, 0, 0);
  const d = addDoc(c, file.name || '未命名图片');
  setStatus('图片已打开，可立即编辑；识别在后台进行。'); runOCR(d); return d;
}
async function openFiles(files) { for (const f of files) { try { await openFile(f); } catch (e) { setStatus(e.message, true); } } }
function demoCanvas() {
  const c = cv(1000, 600), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 1000, 600); g.addColorStop(0, '#efe9dd'); g.addColorStop(1, '#d4dde8'); x.fillStyle = g; x.fillRect(0, 0, 1000, 600);
  x.fillStyle = '#263b36'; x.font = '700 56px "Segoe UI","Microsoft YaHei",Arial,sans-serif'; x.fillText('LOCAL TEXT STUDIO', 90, 200);
  x.font = '400 32px "Segoe UI","Microsoft YaHei",Arial,sans-serif'; x.fillText('2026 / CREATE SOMETHING NEW', 90, 290); x.fillText('图片文字 · 实时对比 · 字重一致', 90, 380); return c;
}

/* ───────── OCR ───────── */
function llmConfig() {
  if (!$('engLLM').checked) return null;
  const c = A.llm; if (!c || !c.base || !c.model) { setStatus('已勾选视觉大模型，但尚未配置：请点“配置视觉模型…”', true); return null; }
  return c;
}
function engineList() { const e = []; if ($('engPaddle').checked) e.push('paddle'); if ($('engTess').checked) e.push('tesseract'); return e; }
function runOCR(doc) {
  const token = ++doc.ocr.token; doc.ocr.status = 'queued';
  A.ocrQueue = A.ocrQueue.catch(() => {}).then(async () => {
    if (token !== doc.ocr.token || !A.docs.includes(doc)) return;
    const engines = engineList(), llm = llmConfig();
    if (!engines.length && !llm) { doc.ocr.status = 'idle'; return setStatus('请至少启用一个识别引擎', true); }
    A.ocrRunning++; doc.ocr.status = 'running'; if (A.doc === doc) renderLists();
    const src = copyCanvas(doc.base);
    try {
      const r = await recognizeImage(src, { engines, lang: resolveLang($('lang').value), llm, onProgress: m => { if (A.doc === doc) setStatus('识别中 · ' + m); } });
      if (token !== doc.ocr.token || !A.docs.includes(doc)) return;
      doc.lines = r.lines.map(l => ({ ...l, id: uid('ln') })); doc.ocr.status = 'done';
      if (A.doc === doc) { renderLists(); updateBoxes(); const parts = Object.entries(r.perEngine).map(([k, v]) => `${ENGINE_LABELS[k]} ${v} 行`).join('，'); setStatus(`识别完成：合并后 ${doc.lines.length} 行（${parts}）${r.llm ? `；大模型校对改动 ${r.llm.changed} 行` : ''}${r.errors.length ? '；部分引擎失败：' + r.errors.join('；') : ''}。点击文字框开始编辑。`, !doc.lines.length && !!r.errors.length); }
    } catch (e) { doc.ocr.status = 'error'; if (A.doc === doc) { renderLists(); setStatus('识别未完成：' + e.message + '。图片仍可编辑；可框选识别或添加文字。', true); } }
    finally { A.ocrRunning--; }
  });
  return A.ocrQueue;
}
async function regionOCR(r) {
  const doc = A.doc; if (!doc || A.fitting) return;
  const engines = engineList(), llm = llmConfig(); if (!engines.length && !llm) return setStatus('请至少启用一个识别引擎', true);
  A.ocrRunning++; busyOn('识别选区…');
  try {
    await A.ocrQueue.catch(() => {});
    const res = await recognizeRegion(copyCanvas(doc.base), r, { engines, lang: resolveLang($('lang').value), mode: $('boxMode').value, llm, onProgress: m => setStatus('识别选区 · ' + m) });
    if (!res.lines.length) return setStatus('选区内没有识别到文字。' + (res.errors.length ? res.errors.join('；') : '可扩大选区，或双击添加文字。'), true);
    const ls = res.lines.slice().sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
    const x0 = Math.min(...ls.map(l => l.r.x)), y0 = Math.min(...ls.map(l => l.r.y)), x1 = Math.max(...ls.map(l => l.r.x + l.r.w)), y1 = Math.max(...ls.map(l => l.r.y + l.r.h));
    const line = { id: uid('ln'), text: ls.map(l => l.text).join('\n'), r: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, symbols: ls.length === 1 ? ls[0].symbols : [], confidence: ls.reduce((n, l) => n + l.confidence, 0) / ls.length, engine: ls[0].engine, alts: ls.length === 1 ? ls[0].alts : [], disagree: ls.some(l => l.disagree), hints: ls[0].hints };
    doc.lines.push(line); renderLists();
    await selectLine(line);
  } catch (e) { setStatus('框选识别失败：' + e.message, true); }
  finally { A.ocrRunning--; busyOff(); }
}

/* ───────── 批量替换 ───────── */
function buildMatcher() {
  const find = $('bFind').value; if (!find) return null;
  const flags = $('bCase').checked ? '' : 'i';
  const src = $('bRegex').checked ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { test: new RegExp(src, flags), all: new RegExp(src, flags + 'g') };
}
function updateBatchPreview() {
  const doc = A.doc; let n = 0, err = '';
  try { const m = buildMatcher(); if (m && doc) n = doc.lines.filter(l => m.test.test(l.text)).length; } catch (e) { err = '正则无效：' + e.message; }
  $('bPreview').textContent = err || (n ? `将替换 ${n} 行文字。` : '没有匹配的文字行。'); $('bGo').disabled = !!err || !n;
}
async function batchReplace() {
  const doc = A.doc, m = buildMatcher(), repl = $('bRepl').value; if (!doc || !m) return;
  const hits = doc.lines.filter(l => m.test.test(l.text)); let ok = 0; const fails = [];
  A.fitting = true; refreshSide(); busyOn('批量替换…');
  try {
    let i = 0;
    for (const line of hits) {
      setStatus(`批量替换 ${++i}/${hits.length}…`);
      let layer = doc.layers.find(l => l.lineId === line.id);
      if (!layer) {
        try { layer = makeEditLayer(doc, line); } catch (e) { fails.push(`「${line.text.slice(0, 10)}」${e.message}`); continue; }
        layer.line = line; doc.layers.push(layer);
        try { await fitLayer(layer); } catch (e) { fails.push(`「${line.text.slice(0, 10)}」字体匹配失败：${e.message}`); }
      }
      layer.text = layer.text.replace(m.all, () => repl); layer.touched = true; ok++;
    }
  } finally { A.fitting = false; busyOff(); }
  commit('批量替换'); refreshSide(); updateBoxes(); requestRender();
  setStatus(`批量替换完成：${ok} 行成功${fails.length ? `，${fails.length} 行失败（${fails[0]}）` : ''}。可 Ctrl+Z 一次撤销全部。`, !!fails.length && !ok);
}

/* ───────── 导出 ───────── */
async function composite() { const doc = A.doc; await whenIdle(); const r = await renderDoc(doc); return r.canvas; }
async function exportAs(type) {
  const doc = A.doc; if (!doc) return;
  try {
    let c = await composite();
    if (type === 'image/jpeg') { const f = cv(c.width, c.height), x = f.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height); x.drawImage(c, 0, 0); c = f; }
    const blob = await canvasToBlob(c, type, 0.95), ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = doc.name.replace(/\.[^.]+$/, '') + '-edited.' + ext; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus(`已导出 ${ext.toUpperCase()}（${c.width} × ${c.height}）。`);
  } catch (e) { setStatus('导出失败：' + e.message, true); }
}
async function copyImage() {
  try { const c = await composite(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvasToBlob(c) })]); setStatus('已复制到剪贴板'); }
  catch (e) { setStatus('复制失败：' + e.message + '（需要 HTTPS / localhost 与剪贴板权限）', true); }
}
async function replaceBase(canvas, label) {
  const doc = A.doc; if (!doc) return;
  doc.base = canvas; doc.layers = []; doc.sel = null; doc.lines = []; doc.history.commit(label); doc.dirty = true;
  refreshSide(); layoutSizes(); requestRender(); renderTabs(); runOCR(doc);
  setStatus(label + '：已作为新的底图（图层已合并），正在重新识别文字。可撤销。');
}
async function flatten() {
  const doc = A.doc; if (!doc) return;
  if (!doc.layers.some(l => l.touched && l.visible !== false)) return setStatus('没有需要合并的修改', true);
  const c = await composite(); await replaceBase(copyCanvas(c), '合并图层');
}

/* ───────── 字体 / 模型对话框 ───────── */
function bindFonts() {
  fonts.addEventListener('change', () => fillFonts());
  const run = (label, fn) => async () => { if (A.busy) return; busyOn(label); try { await fn(); } catch (e) { setStatus(e.message, true); $('fStatus').textContent = e.message; } finally { busyOff(); } };
  $('fLocal').onclick = run('读取本机字体…', async () => { const n = await fonts.queryLocal(); setStatus(`已加载 ${n} 个本机字体，点“重新匹配”比较。`); });
  $('fImport').onclick = () => $('fontInput').click();
  $('fontInput').onchange = () => { const fs = [...$('fontInput').files]; $('fontInput').value = ''; run('导入字体…', async () => { for (const f of fs) await fonts.importFile(f); setStatus(`已导入 ${fs.length} 个字体，点“重新匹配”比较。`); })(); };
  $('fZh').onclick = run('下载免费中文字体…', async () => { const n = await fonts.loadChinese(); setStatus(`已加载 ${n} 个免费中文字体系列，点“重新匹配”比较。`); });
  $('fLoad').onclick = run('加载字体…', async () => { const f = await fonts.loadNamed($('fName').value); $('fStatus').textContent = '已加载：' + f.label; setStatus('已加载免费字体：' + f.label + '，点“重新匹配”比较。'); });
  $('fSync').onclick = run('同步字体目录…', async () => { const n = await fonts.syncCatalogue(); $('fStatus').textContent = `已同步 ${n} 个字体目录；按名称加载，无需 API Key。`; fillFonts(); });
  $('fName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('fLoad').click(); } });
  fillFonts();
}
const LS = 'textstudio6.llm';
function loadLLM() { try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); return o && o.base ? o : null; } catch { return null; } }
function bindLLM() {
  A.llm = loadLLM();
  const sel = $('llmPreset'); for (const p of PRESETS) sel.add(new Option(p.label, p.id));
  const fill = () => { const p = PRESETS.find(x => x.id === sel.value); if (p.id !== 'custom' || !$('llmBase').value) { $('llmBase').value = p.base; $('llmModel').value = p.model; } $('llmNote').textContent = p.note; };
  sel.onchange = () => { $('llmBase').value = ''; $('llmModel').value = ''; fill(); };
  const read = () => { const p = PRESETS.find(x => x.id === sel.value); return { preset: p.id, kind: p.kind, base: $('llmBase').value.trim(), model: $('llmModel').value.trim(), key: $('llmKey').value.trim(), remember: $('llmRemember').checked, needsKey: p.needsKey !== false }; };
  $('btnLLMCfg').onclick = () => { const c = A.llm; sel.value = c?.preset || 'gemini'; fill(); if (c) { $('llmBase').value = c.base; $('llmModel').value = c.model; $('llmKey').value = c.key || ''; $('llmRemember').checked = !!c.remember; } $('dlgLLM').showModal(); };
  $('llmCancel').onclick = () => $('dlgLLM').close();
  $('llmTest').onclick = async () => {
    const c = read();
    try {
      checkEndpoint(c.base); if (!c.model) throw new Error('请填写模型名'); if (c.needsKey && !c.key) throw new Error('请填写 API Key');
      $('llmNote').textContent = '测试中…';
      const t = cv(420, 110), x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 420, 110); x.fillStyle = '#111'; x.font = 'bold 24px sans-serif'; x.fillText('1', 20, 40); x.font = '28px sans-serif'; x.fillText('Hello 2026', 90, 42); x.fillText('1', 20, 90); x.fillText('Test', 90, 92);
      const rows = parseRows(await askModel(c, t));
      $('llmNote').textContent = `连接成功。模型返回 ${rows.length} 行：${rows.map(r => r.text).join(' | ').slice(0, 80)}`;
    } catch (e) { $('llmNote').textContent = '测试失败：' + e.message; }
  };
  $('frmLLM').onsubmit = e => {
    e.preventDefault(); const c = read();
    try { checkEndpoint(c.base); if (!c.model) throw new Error('请填写模型名'); if (c.needsKey && !c.key) throw new Error('请填写 API Key'); } catch (er) { $('llmNote').textContent = er.message; return; }
    A.llm = c; try { localStorage.setItem(LS, JSON.stringify({ ...c, key: c.remember ? c.key : '' })); } catch { /* 隐私模式 */ }
    $('engLLM').checked = true; $('dlgLLM').close(); setStatus('视觉大模型已启用；下次识别会自动校对。' + (c.remember ? '' : ' Key 仅保存在本页内存，刷新后需重填。'));
  };
}

/* ───────── 事件绑定 ───────── */
function bindUI() {
  $('btnOpen').onclick = $('btnStart').onclick = $('mOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = () => { const fs = [...$('fileInput').files]; $('fileInput').value = ''; openFiles(fs); };
  $('btnDemo').onclick = async () => { const d = addDoc(demoCanvas(), '示例.png'); runOCR(d); };
  $('mNew').onclick = () => { $('dlgNew').showModal(); $('newName').focus(); }; $('newCancel').onclick = () => $('dlgNew').close();
  $('frmNew').onsubmit = e => { e.preventDefault(); const w = Number($('newW').value), h = Number($('newH').value); if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || w * h > MAX_PIXELS) { setStatus('新建尺寸须为整数，至少 3 × 3 且不超过 1600 万像素', true); return; } const c = cv(w, h); if (!$('newTransparent').checked) { const x = c.getContext('2d'); x.fillStyle = $('newBg').value; x.fillRect(0, 0, w, h); } try { addDoc(c, $('newName').value.trim() || '未命名'); $('dlgNew').close(); setStatus('新建画布已就绪：双击画布添加文字。'); } catch (er) { setStatus(er.message, true); } };
  $('mPng').onclick = $('btnExport').onclick = () => exportAs('image/png'); $('mJpg').onclick = () => exportAs('image/jpeg'); $('mWebp').onclick = () => exportAs('image/webp'); $('mCopy').onclick = copyImage;
  $('mFlatten').onclick = flatten; $('mClose').onclick = () => { if (A.doc) closeDoc(A.doc); };
  $('filemenu').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') $('filemenu').open = false; });
  $('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
  $('btnOCR').onclick = () => { if (A.doc) { A.doc.lines = []; renderLists(); updateBoxes(); runOCR(A.doc); } };
  $('modeClick').onclick = () => setMode('click'); $('modeBox').onclick = () => setMode('box'); $('btnAddText').onclick = () => addText();
  $('btnBatch').onclick = () => { updateBatchPreview(); $('dlgBatch').showModal(); $('bFind').focus(); }; $('bCancel').onclick = () => $('dlgBatch').close();
  for (const id of ['bFind', 'bCase', 'bRegex']) $(id).addEventListener('input', updateBatchPreview);
  $('frmBatch').onsubmit = e => { e.preventDefault(); $('dlgBatch').close(); batchReplace(); };
  $('chkBoxes').onchange = () => { A.showBoxes = $('chkBoxes').checked; updateBoxes(); };
  $('zoom').onchange = () => { layoutSizes(); updateBoxes(); };
  window.addEventListener('resize', debounce(() => { if (A.doc && $('zoom').value === 'fit') layoutSizes(); }, 80));
  for (const b of $('layoutSeg').querySelectorAll('button')) b.onclick = () => { A.layout = b.dataset.layout; for (const x of $('layoutSeg').querySelectorAll('button')) x.classList.toggle('on', x === b); if (A.doc) { paintCanvases(); updateBoxes(); } };
  // 滑动对比手柄
  $('swipeHandle').addEventListener('pointerdown', e => { e.preventDefault(); const h = $('swipeHandle'); h.setPointerCapture(e.pointerId); const cmp = $('compare'), mv = ev => { const b = $('panePrev').getBoundingClientRect(); cmp.style.setProperty('--cut', clamp((ev.clientX - b.left) / b.width * 100, 0, 100) + '%'); }; const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); }; h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); });
  bindSvg($('svgOrig')); bindSvg($('svgPrev'));
  // 表单
  for (const id of ['newText']) $(id).addEventListener('input', () => { const l = A.doc?.sel; if (!l || A.fitting) return; l.text = $('newText').value; markTouched(l); commitSoon(); requestRender(); });
  $('srcText').addEventListener('change', async () => { const l = A.doc?.sel; if (!l || !l.src || A.fitting) return; await useSourceText(l, $('srcText').value); });
  for (const id of [...Object.keys(NUM), ...TXT, ...CHK]) $(id).addEventListener('input', () => onField(id));
  $('btnFit').onclick = async () => { const l = A.doc?.sel; if (l?.src && !A.fitting) await fitAndShow(l, A.doc); };
  $('btnResetPos').onclick = () => { const l = A.doc?.sel; if (!l) return; l.offset = { x: 0, y: 0 }; commit('位置归零'); showOffset(); requestRender(); };
  $('btnRevert').onclick = revertLayer; $('btnDelete').onclick = () => { const l = A.doc?.sel; if (l) deleteLayer(l); };
  // 拖放 / 粘贴
  const vp = $('viewport'); vp.addEventListener('dragover', e => e.preventDefault()); vp.addEventListener('drop', e => { e.preventDefault(); openFiles([...e.dataTransfer.files]); });
  window.addEventListener('paste', e => { if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile(); if (f) { e.preventDefault(); openFiles([f]); } });
  // 键盘
  window.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing) { const l = A.doc?.sel; if (!l || A.fitting) return; e.preventDefault(); l.offset = { x: l.offset.x + arrow[0], y: l.offset.y + arrow[1] }; markTouched(l); showOffset(); commitSoon(); requestRender(); setStatus(`文字位置：X ${l.offset.x} px，Y ${l.offset.y} px`); return; }
    if ((e.ctrlKey || e.metaKey) && !editing) { const k = e.key.toLowerCase(); if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if (k === 'y') { e.preventDefault(); redo(); } }
    if (e.key === 'Escape' && !editing && A.doc?.sel) { A.doc.sel = null; refreshSide(); updateBoxes(); }
  });
  window.addEventListener('beforeunload', e => { if (A.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  // Photopea
  const pp = initPhotopea({ doc: () => A.doc, composite, signature: () => A.doc.history.key(), replaceBase: (c, l) => replaceBase(c, l), selectedFont: () => fonts.get(A.doc?.sel?.style.font) });
  $('mPhotopea').onclick = pp.open;
}

function init() {
  const n = fonts.detectSystem();
  bindFonts(); bindLLM(); bindUI(); renderTabs(); switchDoc(null);
  setStatus(`就绪 · 检测到 ${n} 个系统字体（可再读取本机全部字体或导入）。打开图片开始。`);
}
init();
window.__app = { A, whenIdle, openFile, selectLine, requestRender, undo, redo, exportAs, composite, addText, runOCR, fonts, batchReplace, setMode, commit };
