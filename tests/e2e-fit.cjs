// 真实 Chromium 中验证：字体 / 字号 / 字重拟合与渲染一致性
const { launch, startServer } = require('./lib.cjs');
const assert = require('node:assert/strict');
(async () => {
  const srv = startServer(8792), b = await launch(), p = await b.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  await p.goto('http://127.0.0.1:8792/_test/fit.html');
  await p.waitForFunction('window.T && window.T.ready');
  const sys = await p.evaluate(() => T.fonts.list.map(f => f.id));
  console.log('沙箱可用字体：', sys.join(', '));

  // 在页面里：合成“原图”→ 区域分析 → 拟合 → 用同一渲染路径重绘 → 度量
  const run = (spec) => p.evaluate(async (spec) => {
    const { cv, extractMask, strokeWidth, fitStyle, DEFAULT_STYLE, renderInk } = T;
    const W = 900, H = 160, img = cv(W, H), x = img.getContext('2d');
    x.fillStyle = spec.bg || '#f4efe4'; x.fillRect(0, 0, W, H);
    x.fillStyle = spec.fg || '#222a35';
    x.font = spec.css; x.textBaseline = 'alphabetic';
    if (spec.shear) x.setTransform(1, 0, -spec.shear, 1, spec.shear * 100, 0);
    if (spec.extraStroke) { x.strokeStyle = x.fillStyle; x.lineWidth = spec.extraStroke; x.lineJoin = 'round'; x.strokeText(spec.text, 40, 100); }
    if (spec.letterSpacing) x.letterSpacing = spec.letterSpacing;
    x.fillText(spec.text, 40, 100);
    let src = img;
    if (spec.degrade) { // 缩小再放大 + 轻微模糊，模拟真实截图质量损失
      const s = cv(W * 0.7, H * 0.7); s.getContext('2d').drawImage(img, 0, 0, s.width, s.height);
      const t = cv(W, H); const tx = t.getContext('2d'); tx.filter = 'blur(0.6px)'; tx.drawImage(s, 0, 0, W, H); src = t;
    }
    const m0 = src.getContext('2d').getImageData(0, 0, W, H);
    // 手工给出“OCR 框”：文字周围留白
    const probe = cv(1, 1).getContext('2d'); probe.font = spec.css; probe.letterSpacing = spec.letterSpacing || '0px';
    const mt = probe.measureText(spec.text);
    const r = { x: Math.max(0, Math.floor(40 - mt.actualBoundingBoxLeft - 6)), y: Math.max(0, Math.floor(100 - mt.actualBoundingBoxAscent - 6)), w: Math.ceil(mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight + 12), h: Math.ceil(mt.actualBoundingBoxAscent + mt.actualBoundingBoxDescent + 12) };
    r.w = Math.min(r.w, W - r.x); r.h = Math.min(r.h, H - r.y);
    const reg = src.getContext('2d').getImageData(r.x, r.y, r.w, r.h);
    const mask = extractMask(reg.data, r.w, r.h);
    const s = { id: 's', text: spec.text, r, alpha: mask.alpha, ink: mask.ink, fgHex: '#' + mask.fg.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''), symbols: [] };
    const t0 = performance.now();
    const res = await fitStyle(s, {});
    const ms = performance.now() - t0, best = res[0];
    // 用最终渲染路径绘制，并测量笔画粗细差异
    const layer = { text: spec.text, offset: { x: 0, y: 0 }, touched: true, style: { ...DEFAULT_STYLE, font: best.font, weight: best.weight, size: best.size, spacing: best.spacing, embolden: best.embolden, skew: best.skew, blur: 0, color: '#000000', wrap: false }, pos: { x: r.x + mask.inkF.x, y: r.y + mask.inkF.y }, src: { text: spec.text, ink: mask.inkF } };
    const ink = renderInk(layer, { W: 2000, H: 2000 });
    const c = cv(r.w, r.h), cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(ink.canvas, ink.x - r.x, ink.y - r.y);
    const d = cx.getImageData(0, 0, r.w, r.h).data, a = new Float32Array(r.w * r.h); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    const wOf = f => { const fam = ['sans-serif', 'serif', 'monospace'].includes(f) ? f : `"${f}"`; const q = cv(1, 1).getContext('2d'); q.font = `64px ${fam}, monospace`; const a = q.measureText('Quality Studio 2026 mmmm 文字').width; q.font = `700 64px ${fam}, monospace`; return a + '|' + q.measureText('Quality Studio 2026 mmmm 文字').width; };
    const expectW = wOf(spec.expect);
    return { aliasHit: res.slice(0, 3).some(q => wOf(q.font) === expectW), top: res.slice(0, 3).map(q => ({ font: q.font, w: q.weight, size: +q.size.toFixed(1), emb: q.embolden, blur: q.blur, err: +q.error.toFixed(3) })), stemTarget: strokeWidth(mask.alpha, r.w, r.h), stemRender: strokeWidth(a, r.w, r.h), stemNoEmb: best.stemFit, skew: best.skew, ms: Math.round(ms), nCand: res.length };
  }, spec);

  const cases = [
    { name: 'DejaVu Sans 常规 40px', css: '400 40px "DejaVu Sans"', text: 'Quality Studio 2026', expect: 'DejaVu Sans' },
    { name: 'DejaVu Sans 粗体 40px', css: '700 40px "DejaVu Sans"', text: 'Quality Studio 2026', expect: 'DejaVu Sans' },
    { name: 'Liberation Serif 常规 44px', css: '400 44px "Liberation Serif"', text: 'Create something new', expect: 'Liberation Serif' },
    { name: 'DejaVu Sans Mono 36px', css: '400 36px "DejaVu Sans Mono"', text: 'order_id = 20260918', expect: 'DejaVu Sans Mono' },
    { name: '【字重缺失】Liberation Sans 常规 + 额外描边 1.6px（模拟 500/600 字重）', css: '400 42px "Liberation Sans"', text: 'Medium Weight Text', expect: 'Liberation Sans', extraStroke: 1.6, mustEmbolden: true },
    { name: '【降质】DejaVu Sans 粗体，缩小 0.7× + 模糊', css: '700 44px "DejaVu Sans"', text: 'Degraded Screenshot', expect: 'DejaVu Sans', degrade: true },
    { name: '浅色字深色底', css: '700 40px "Liberation Sans"', text: 'Light On Dark', expect: 'Liberation Sans', bg: '#1d2430', fg: '#f2f0ea' },
    { name: '斜体（剪切 0.22，约 12.4°）', css: '400 42px "DejaVu Sans"', text: 'Slanted Italic Text', expect: 'DejaVu Sans', shear: 0.22, wantSkew: true },
    { name: '中日文（IPAGothic）', css: '400 40px "IPAGothic"', text: '文字編集', expect: 'IPAGothic' }
  ];
  let fail = 0;
  for (const c of cases) {
    try {
      const r = await run(c);
      const ratio = r.stemRender / r.stemTarget, ok1 = r.aliasHit;
      const ok2 = Math.abs(ratio - 1) < 0.18;
      const ok3 = (!c.mustEmbolden || r.top[0].emb > 0.3) && (!c.wantSkew || Math.abs(r.skew - 12.4) < 3) && (c.wantSkew || Math.abs(r.skew) < 0.01);
      console.log(`${ok1 && ok2 && ok3 ? '✓' : '✗'} ${c.name}\n    前三候选: ${r.top.map(t => `${t.font}/${t.w}/${t.size}px/emb ${t.emb}/blur ${t.blur}/err ${t.err}`).join(' | ')}\n    笔画粗细 原图 ${r.stemTarget.toFixed(2)} → 重绘 ${r.stemRender.toFixed(2)}（比值 ${ratio.toFixed(3)}），候选数 ${r.nCand}，耗时 ${r.ms} ms，倾斜 ${r.skew.toFixed(1)}°`);
      if (!(ok1 && ok2 && ok3)) fail++;
    } catch (e) { console.log('✗', c.name, e.message); fail++; }
  }
  await b.close(); srv.close();
  if (fail) { console.log(`\n${fail} 项未通过`); process.exit(1); }
  console.log('\ne2e-fit: 全部通过');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
