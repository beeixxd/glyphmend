// 真实 Chromium：图层模型 / 非破坏式渲染 / 撤销历史 / 三种绘制方式 / 背景修复
const { launch, startServer } = require('./lib.cjs');
const assert = require('node:assert/strict');
(async () => {
  const srv = startServer(8794), b = await launch(), p = await b.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  await p.goto('http://127.0.0.1:8794/_test/doc.html'); await p.waitForFunction('window.T && window.T.ready');
  let pass = 0; const ok = (n, c, extra = '') => { if (!c) { console.log('  ✗', n, extra); process.exitCode = 1; } else { pass++; console.log('  ✓', n, extra); } };

  const R = await p.evaluate(async () => {
    const { cv, Doc, makeEditLayer, makeAddLayer, fitLayer, renderDoc } = T, out = {};
    // 渐变背景 + 两行文字（一行用于改字，一行作为“不应被改动”的对照）
    const W = 800, H = 260, img = cv(W, H), x = img.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#e9e3d6'); g.addColorStop(1, '#cfd8e3'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1f2a37'; x.font = '700 44px "DejaVu Sans"'; x.fillText('Price 2026', 50, 90);
    x.font = '400 30px "Liberation Serif"'; x.fillText('Untouched second line', 50, 190);
    const doc = new Doc(img, 'test.png');
    const meas = (font, t) => { const q = cv(1, 1).getContext('2d'); q.font = font; const m = q.measureText(t); return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent }; };
    const m1 = meas('700 44px "DejaVu Sans"', 'Price 2026');
    const line = { id: 'L1', text: 'Price 2026', r: { x: 50 - m1.l, y: 90 - m1.a, w: m1.l + m1.r, h: m1.a + m1.d }, symbols: [] };
    const baseData = x.getImageData(0, 0, W, H).data;
    const layer = makeEditLayer(doc, line); doc.layers.push(layer); doc.sel = layer;
    // 1) 未触碰：合成结果必须与原图逐像素一致
    let res = await renderDoc(doc); let c1 = res.canvas.getContext('2d').getImageData(0, 0, W, H).data, diff0 = 0;
    for (let i = 0; i < c1.length; i++) if (c1[i] !== baseData[i]) diff0++;
    out.untouchedDiff = diff0;
    // 2) 自动拟合
    const cands = await fitLayer(layer); out.fit = { font: cands[0].font, w: cands[0].weight, size: +cands[0].size.toFixed(1), emb: cands[0].embolden, err: +cands[0].error.toFixed(3) };
    // 3) 触碰但文字不变：与原图应非常接近
    layer.touched = true; res = await renderDoc(doc);
    const cmpRegion = (a, b, r) => { let s = 0, n = 0; for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) { const i = (yy * W + xx) * 4; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; } return s / n; };
    const c2 = res.canvas.getContext('2d').getImageData(0, 0, W, H).data; out.sameTextMAE = +cmpRegion(c2, baseData, layer.src.r).toFixed(2);
    // 墨迹能量失配率：Σ|重绘−原图| / Σ|原图−无字背景|（越小越像；0=逐像素一致）
    const saveText = layer.text; layer.text = ''; const blank = (await renderDoc(doc)).canvas.getContext('2d').getImageData(0, 0, W, H).data; layer.text = saveText;
    let num = 0, den = 0; const rg = layer.src.r;
    for (let yy = rg.y; yy < rg.y + rg.h; yy++) for (let xx = rg.x; xx < rg.x + rg.w; xx++) { const i = (yy * W + xx) * 4; for (let k = 0; k < 3; k++) { num += Math.abs(c2[i + k] - baseData[i + k]); den += Math.abs(baseData[i + k] - blank[i + k]); } }
    out.mismatch = +(num / den).toFixed(3);
    // 4) 改文字：区域外像素保持不变；区域内旧字被清除（渐变背景连续）
    layer.text = 'Price 2027'; res = await renderDoc(doc);
    const c3 = res.canvas.getContext('2d').getImageData(0, 0, W, H).data; let outside = 0;
    const rr = layer.src.r; const p = layer.bounds;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const inR = xx >= Math.min(rr.x, p.x) - 1 && xx < Math.max(rr.x + rr.w, p.x + p.w) + 1 && yy >= Math.min(rr.y, p.y) - 1 && yy < Math.max(rr.y + rr.h, p.y + p.h) + 1; if (inR) continue; const i = (yy * W + xx) * 4; if (c3[i] !== baseData[i] || c3[i + 1] !== baseData[i + 1] || c3[i + 2] !== baseData[i + 2]) outside++; }
    out.outsideChanged = outside; out.bounds = layer.bounds;
    // 5) 删除文字（空串）：区域应只剩平滑渐变（无旧字残影）
    layer.text = ''; res = await renderDoc(doc); const c4 = res.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    let dark = 0; for (let yy = rr.y; yy < rr.y + rr.h; yy++) for (let xx = rr.x; xx < rr.x + rr.w; xx++) if (c4[(yy * W + xx) * 4] < 150) dark++; out.darkAfterDelete = dark;
    // 6) 三种绘制方式：glyph 缺字报错；hybrid 缺字补画
    layer.text = 'Price 2026'; layer.style = { ...layer.style, mode: 'glyph' };
    layer.src.symbols = []; // 无 OCR 单字符坐标 → 走投影切分（"Price 2026" 含空格，字符与连通段应一致）
    layer.text = 'Price 262'; res = await renderDoc(doc); out.glyphErr = layer.error;
    layer.text = 'Price 2027'; res = await renderDoc(doc); out.glyphMissingErr = layer.error;
    layer.style = { ...layer.style, mode: 'hybrid' }; res = await renderDoc(doc); out.hybridErr = layer.error; out.hybridBounds = layer.bounds;
    // 7) 历史：撤销到触碰前
    layer.style = { ...layer.style, mode: 'font' }; layer.text = 'Price 2027';
    doc.history.commit('改字'); layer.text = 'Price 2028'; doc.history.commit('再改');
    doc.history.undo(); out.undoText = doc.layers[0].text; doc.history.undo(); out.undo2 = doc.layers.length ? doc.layers[0].text : null; doc.history.redo(); out.redoText = doc.layers[0].text;
    // 8) 添加文字图层
    const add = makeAddLayer(doc, 300, 200); add.text = 'Added 文字'; add.style = { ...add.style, size: 40 }; doc.layers.push(add);
    res = await renderDoc(doc); out.addBounds = add.bounds; out.addErr = add.error;
    // 9) 阴影/描边/旋转/不透明度 组合不报错且范围合理
    add.style = { ...add.style, stroke: 2, strokeColor: '#ffffff', shadowOn: true, angle: 8, opacity: 0.8, blur: 0.5 }; res = await renderDoc(doc); out.comboErr = add.error; out.comboBounds = add.bounds;
    // 10) 长文本换行：超出图像右边缘时自动换行，不抛错
    add.text = 'This is a very long sentence that must wrap onto multiple lines when it reaches the right edge of the picture'; add.style = { ...add.style, angle: 0, stroke: 0, shadowOn: false, size: 34 }; res = await renderDoc(doc); out.wrapErr = add.error; out.wrapH = add.bounds.h; out.wrapRight = add.bounds.x + add.bounds.w;
    return out;
  });
  console.log(JSON.stringify(R));
  ok('未触碰图层：合成结果与原图逐像素一致', R.untouchedDiff === 0, `差异字节 ${R.untouchedDiff}`);
  ok('自动拟合选中 DejaVu Sans 粗体且字号≈44', /DejaVu Sans|sans-serif/.test(R.fit.font) && Math.abs(R.fit.size - 44) < 1.5 && R.fit.w >= 600, JSON.stringify(R.fit));
  ok('触碰但文字不变：重绘与原图的墨迹能量失配率 < 10%', R.mismatch < 0.10, `失配率=${R.mismatch}，区域 MAE=${R.sameTextMAE}`);
  ok('改字后：补丁范围之外的像素 100% 不变', R.outsideChanged === 0, `越界改动 ${R.outsideChanged}`);
  ok('删除文字（空串）后区域内无旧字残影', R.darkAfterDelete === 0, `残留深色像素 ${R.darkAfterDelete}`);
  ok('glyph 模式：缺字时给出明确提示', /没有「7」字形|没有「2」字形|无法可靠切分/.test(R.glyphMissingErr || R.glyphErr || ''), `${R.glyphErr} / ${R.glyphMissingErr}`);
  ok('hybrid 模式：缺字时用匹配字体补画，不报错', !R.hybridErr && R.hybridBounds && R.hybridBounds.w > 100, `${R.hybridErr || ''}`);
  ok('撤销/恢复按提交点还原图层文字', R.undoText === 'Price 2027' && R.redoText === 'Price 2027', `undo=${R.undoText} undo2=${R.undo2} redo=${R.redoText}`);
  ok('添加文字图层可渲染', !R.addErr && R.addBounds.w > 80);
  ok('描边+阴影+旋转+透明度+柔化 组合可渲染', !R.comboErr && R.comboBounds.h > R.addBounds.h * 0.9, JSON.stringify(R.comboBounds));
  ok('长文本到达图片右边缘时自动换行，且不越界', !R.wrapErr && R.wrapH > 60 && R.wrapRight <= 800 + 2, `h=${R.wrapH} right=${R.wrapRight}`);
  await b.close(); srv.close();
  console.log(`\ne2e-doc: ${pass} 项通过${process.exitCode ? '，有失败项' : ''}`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
