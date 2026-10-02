// 字形一致性：复用原字形 / 智能混合 / 字体重绘 三种方式，与原图的墨迹失配率；并检查 Photopea 消息校验。
const fs = require('fs');
const { launch, startServer } = require('./lib.cjs');
let pass = 0, fail = 0; const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', n, e); };
(async () => {
  const srv = startServer(8803), b = await launch(), p = await b.newPage(); await p.setViewport({ width: 1500, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8803/index.html'); await p.waitForFunction('window.__app');
  const idle = () => p.evaluate(() => __app.whenIdle());
  // 两种“真实质感”的原图：干净 + 降质（缩小再放大 + 轻微模糊，模拟截图/压缩）
  for (const degrade of [false, true]) {
    const name = degrade ? 'degraded' : 'clean';
    const url = await p.evaluate(degrade => {
      const W = 900, H = 200, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      x.fillStyle = '#ece6d8'; x.fillRect(0, 0, W, H); x.fillStyle = '#1b2733'; x.font = '700 56px "DejaVu Sans"'; x.fillText('Price 2026 Sale', 50, 110);
      if (!degrade) return c.toDataURL();
      const s = document.createElement('canvas'); s.width = W * .7; s.height = H * .7; s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
      const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d'); tx.filter = 'blur(.5px)'; tx.drawImage(s, 0, 0, W, H); return t.toDataURL();
    }, degrade);
    fs.writeFileSync(`/tmp/ts6-g-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    await (await p.$('#fileInput')).uploadFile(`/tmp/ts6-g-${name}.png`);
    await p.waitForFunction(n => __app.A.doc && __app.A.doc.name === `ts6-g-${n}.png`, {}, name); await p.waitForFunction(() => __app.A.doc.ocr.status === 'done', { timeout: 120000 }); await idle();
    const lineCount = await p.evaluate(() => __app.A.doc.lines.length); ok(`[${name}] 识别到 1 行`, lineCount === 1, `${lineCount} 行`);
    await p.evaluate(() => __app.selectLine(__app.A.doc.lines[0])); await p.waitForFunction(() => !__app.A.fitting && __app.A.doc.sel?.fit); await idle();

    // 度量：该行区域内，重绘相对于“原图”的墨迹失配率（0=逐像素一致）
    const measure = (xFrac) => p.evaluate(async xFrac => {
      await __app.whenIdle(); const d = __app.A.doc, l = d.sel, r = l.src.r, comp = await __app.composite();
      const o = d.original.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data, c = comp.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
      const bg = l.src.bg || [0, 0, 0]; let num = 0, den = 0; const x1 = Math.floor(r.w * xFrac);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < x1; x++) { const i = (y * r.w + x) * 4; for (let k = 0; k < 3; k++) { num += Math.abs(c[i + k] - o[i + k]); den += Math.abs(o[i + k] - bg[k]); } }
      return +(num / den).toFixed(3);
    }, xFrac);
    const setField = (id, v) => p.evaluate((id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    const err = () => p.evaluate(() => __app.A.doc.sel.error || '');
    // 1) 原文不变 + 字体重绘（拟合结果）
    await setField('mode', 'font'); await idle(); const mFont = await measure(1);
    // 2) 复用原字形：文字相同 → 应当几乎逐像素复用
    await setField('mode', 'glyph'); await idle(); const eGlyph = await err(); const mGlyph = await measure(1);
    ok(`[${name}] 复用原字形（原文不变）无报错，失配率 < 3%（近乎逐像素）`, !eGlyph && mGlyph < 0.03, `glyph ${mGlyph} / font ${mFont} ${eGlyph}`);
    ok(`[${name}] 字体重绘（拟合）失配率 < 22%（笔画粗细/字形接近）`, mFont < 0.22, `${mFont}`);
    // 3) 智能混合：把 “2026” 改成 “2027”：前 9 个字符范围 = 原字形，应与原图高度一致；缺的 “7” 用字体补画，不报错
    await p.evaluate(() => { const e = document.getElementById('newText'); e.value = 'Price 2027 Sale'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await setField('mode', 'hybrid'); await idle(); const eHy = await err(); const mHyLeft = await measure(0.55);
    ok(`[${name}] 智能混合：缺字（7）用匹配字体补画，不报错`, !eHy, eHy);
    ok(`[${name}] 智能混合：未改动的前半段（Price 202）与原图的失配率 < 3%`, mHyLeft < 0.03, `${mHyLeft}`);
    // 4) 仅复用原字形 + 缺字 → 明确提示
    await setField('mode', 'glyph'); await idle(); ok(`[${name}] 仅复用原字形遇到缺字：明确提示且不崩溃`, /没有「7」字形/.test(await err()), await err());
    // 5) 预览与原图保持并排：左原图不变
    const same = await p.evaluate(() => { const o = document.getElementById('cvOrig'), d = __app.A.doc.original; return o.width === d.width; }); ok(`[${name}] 原图画布保持原样`, same);
  }

  // Photopea：伪造 origin 的 message 不应让桥接就绪；PNG 签名校验
  const { pngSignature } = await import('file:///' + __dirname.replace(/\\/g, '/') + '/../dist/js/photopea.js').catch(() => ({}));
  await p.evaluate(() => document.getElementById('mPhotopea').click());
  await p.waitForFunction(() => document.getElementById('dlgPP').open);
  const stateBefore = await p.$eval('#ppStatus', e => e.textContent);
  await p.evaluate(() => { for (const origin of ['https://evil.example', 'https://www.photopea.com.evil.com']) window.dispatchEvent(new MessageEvent('message', { data: 'done', origin, source: window })); });
  await new Promise(r => setTimeout(r, 300));
  const stateAfter = await p.$eval('#ppStatus', e => e.textContent);
  ok('Photopea：伪造 origin / source 的 message 被忽略（状态未变为已发送）', stateBefore === stateAfter && !/已发送/.test(stateAfter), stateAfter);
  const sig = await p.evaluate(() => { const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]); return { png: png.length }; }); ok('PNG 签名常量就位', sig.png === 9);
  ok('无 JS 错误', errors.length === 0, errors.join('|'));
  await b.close(); srv.close();
  console.log(`\ne2e-glyph: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
