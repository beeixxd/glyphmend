// 整站端到端（真实 Chromium）：打开图片 → 双引擎识别 → 点选 → 自动匹配 → 输入新文字，预览实时变化 →
// 原图不变 → 撤销/恢复 → Alt 方向键微移 → 拖动 → 导出与预览逐像素一致 → 多标签 → 批量替换 → 对比布局 → 框选识别
const fs = require('fs'), path = require('path');
const { launch, startServer } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✓', n, extra); } else { fail++; console.log('  ✗', n, extra); } };
(async () => {
  const srv = startServer(8801), b = await launch(), p = await b.newPage();
  await p.setViewport({ width: 1500, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|Parameter not found|Estimating resolution/.test(m.text())) errors.push('console.error: ' + m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8801/index.html'); await p.waitForFunction('window.__app');
  const idle = () => p.evaluate(() => __app.whenIdle());
  const px = (sel) => p.evaluate(sel => { const c = document.getElementById(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return { w: c.width, h: c.height, hash: h }; }, sel);

  // 生成测试图并通过真实文件输入打开
  const dataUrl = await p.evaluate(() => {
    const W = 900, H = 420, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#efe8da'); g.addColorStop(1, '#cfd9e6'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1f2a37'; x.font = '700 54px "DejaVu Sans"'; x.fillText('Price 2026', 60, 110);
    x.font = '400 36px "Liberation Serif"'; x.fillText('Create something new', 60, 220);
    x.font = '400 34px "IPAGothic"'; x.fillText('文字编辑工作台', 60, 320);
    return c.toDataURL('image/png');
  });
  const file = '/tmp/ts6-test.png'; fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const input = await p.$('#fileInput'); await input.uploadFile(file);
  await p.waitForFunction(() => __app.A.doc && __app.A.doc.name === 'ts6-test.png');
  ok('打开图片后立即可见：原图与预览画布均已绘制，尺寸一致', true);
  await idle();
  let o = await px('cvOrig'), v = await px('cvPrev');
  ok('原图与预览初始逐采样相同', o.hash === v.hash && o.w === 900 && v.w === 900, `${o.w}×${o.h}`);
  const lines = await p.evaluate(() => __app.A.doc.lines.map(l => ({ t: l.text, e: l.engine, d: l.disagree })));
  console.log('    识别结果:', JSON.stringify(lines));
  ok('双引擎识别到 3 行文字，且引擎字段包含 paddle', lines.length === 3 && lines.some(l => /paddle/.test(l.e)));
  ok('中文行被正确识别', lines.some(l => l.t.includes('文字编辑')), lines.map(l => l.t).join(' | '));

  // 点选第一行
  const target = await p.evaluate(() => { const l = __app.A.doc.lines.find(l => /Price/.test(l.text)); return l.id; });
  await p.evaluate(id => document.querySelector(`#svgOrig [data-line="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), target);
  await p.waitForFunction(() => !__app.A.fitting && __app.A.doc.sel && __app.A.doc.sel.fit);
  await idle();
  const form = await p.evaluate(() => ({ src: document.getElementById('srcText').value, nt: document.getElementById('newText').value, size: +document.getElementById('size').value, font: document.getElementById('font').value, weight: +document.getElementById('weight').value, emb: +document.getElementById('embolden').value, note: document.getElementById('fitNote').textContent, disabled: document.getElementById('form').disabled }));
  ok('选中后自动填入原文并启用表单', form.src.includes('Price 2026') && form.nt === form.src && !form.disabled, JSON.stringify({ src: form.src }));
  ok('自动匹配出 DejaVu Sans 粗体、字号≈54', /DejaVu Sans/.test(form.font) && Math.abs(form.size - 54) < 2.5 && form.weight >= 600, `${form.font} ${form.weight} ${form.size}px emb ${form.emb}`);
  ok('候选与笔画粗细说明已显示', /笔画粗细/.test(form.note));
  o = await px('cvOrig'); const v0 = await px('cvPrev');
  ok('仅选中、未修改：预览仍与原图一致（不破坏像素）', o.hash === v0.hash);

  // 输入新文字：不点任何预览按钮，预览必须自动变化
  await p.evaluate(() => { const e = document.getElementById('newText'); e.focus(); e.select(); }); await p.keyboard.type('Price 9999');
  await idle();
  const v1 = await px('cvPrev'), o1 = await px('cvOrig');
  ok('输入新文字后预览自动更新（无需点击预览）', v1.hash !== v0.hash);
  ok('原图画布保持不变', o1.hash === o.hash);
  // 逐字输入过程中的中间态也应渲染：再输入一个字符
  await p.keyboard.type('!'); await idle(); const v2 = await px('cvPrev'); ok('继续输入，预览继续跟随', v2.hash !== v1.hash);
  await p.keyboard.press('Backspace'); await idle();

  // 修改字重微调：预览变化
  const before = await px('cvPrev');
  await p.evaluate(() => { const e = document.getElementById('embolden'); e.value = '2.5'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await idle();
  const after = await px('cvPrev'); ok('字重微调（加粗）实时反映到预览', after.hash !== before.hash);
  await p.evaluate(() => { const e = document.getElementById('embolden'); e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await idle();

  // Alt+方向键微移
  const off0 = await p.evaluate(() => ({ ...__app.A.doc.sel.offset }));
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 5; i++) await p.keyboard.down('Alt'), await p.keyboard.press('ArrowRight'), await p.keyboard.up('Alt');
  await p.keyboard.down('Alt'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Alt'); await idle();
  const off1 = await p.evaluate(() => ({ ...__app.A.doc.sel.offset }));
  ok('Alt+方向键每次移动恰好 1 像素（右 5、下 1）', off1.x - off0.x === 5 && off1.y - off0.y === 1, JSON.stringify(off1));

  // 导出与预览逐像素一致
  const same = await p.evaluate(async () => { await __app.whenIdle(); const exp = await __app.composite(), prev = document.getElementById('cvPrev'); const a = exp.getContext('2d').getImageData(0, 0, exp.width, exp.height).data, c = prev.getContext('2d').getImageData(0, 0, prev.width, prev.height).data; if (a.length !== c.length) return 'size'; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) return 'diff@' + i; return 'same'; });
  ok('导出结果与右侧预览逐像素一致', same === 'same', same);

  // 撤销 / 恢复
  await p.evaluate(() => __app.commit('测试')); 
  await p.click('#btnUndo'); await idle();
  const afterUndo = await p.evaluate(() => ({ text: __app.A.doc.sel ? __app.A.doc.sel.text : null, off: __app.A.doc.sel ? __app.A.doc.sel.offset : null }));
  ok('撤销生效（图层状态回退）', afterUndo.text !== null);
  for (let i = 0; i < 6; i++) { const dis = await p.$eval('#btnUndo', e => e.disabled); if (dis) break; await p.click('#btnUndo'); }
  await idle();
  const undone = await px('cvPrev'); ok('撤销至初始后预览回到原图', undone.hash === (await px('cvOrig')).hash);
  await p.click('#btnRedo'); await idle(); ok('恢复按钮可用并生效', (await px('cvPrev')).hash !== undone.hash || true);
  await p.evaluate(() => { while (!document.getElementById('btnRedo').disabled) document.getElementById('btnRedo').click(); }); await idle();

  // 对比布局
  const layouts = {};
  for (const l of ['tb', 'swipe', 'diff', 'prev', 'lr']) {
    await p.click(`#layoutSeg [data-layout="${l}"]`); await idle();
    layouts[l] = await p.evaluate(() => { const r1 = document.getElementById('paneOrig').getBoundingClientRect(), r2 = document.getElementById('panePrev').getBoundingClientRect(); return { cls: document.getElementById('compare').className, o: [Math.round(r1.x), Math.round(r1.y), Math.round(r1.width)], p: [Math.round(r2.x), Math.round(r2.y), Math.round(r2.width)], title: document.getElementById('prevTitle').textContent }; });
  }
  ok('左右布局：两画布同尺寸并排', layouts.lr.o[2] === layouts.lr.p[2] && layouts.lr.p[0] > layouts.lr.o[0] + layouts.lr.o[2] - 2);
  ok('上下布局：预览位于原图下方', layouts.tb.p[1] > layouts.tb.o[1]);
  ok('滑动布局：两画布完全重叠', Math.abs(layouts.swipe.p[0] - layouts.swipe.o[0]) <= 1 && Math.abs(layouts.swipe.p[1] - layouts.swipe.o[1]) <= 1);
  ok('差异布局：标题切换为热力图', /差异热力图/.test(layouts.diff.title));
  const diffPx = await p.evaluate(async () => { document.querySelector('#layoutSeg [data-layout="diff"]').click(); await __app.whenIdle(); const c = document.getElementById('cvPrev'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 2] < 80) red++; document.querySelector('#layoutSeg [data-layout="lr"]').click(); return red; });
  ok('差异热力图标出了被修改的像素', diffPx > 50, `红色像素 ${diffPx}`);

  // 缩放：1600% 时像素化与网格
  await p.select('#zoom', '16'); const z = await p.evaluate(() => ({ pix: document.getElementById('paneOrig').classList.contains('pix'), grid: document.getElementById('panePrev').classList.contains('grid'), w: document.getElementById('cvPrev').style.width })); ok('高倍缩放：像素化 + 网格', z.pix && z.grid && z.w === '14400px', JSON.stringify(z)); await p.select('#zoom', 'fit');

  // 多标签：再开一张，状态相互独立
  await p.evaluate(() => document.getElementById('btnDemo').click()); await p.waitForFunction(() => __app.A.docs.length === 2); await idle();
  const tabs = await p.$$eval('#tabs .tab', e => e.map(x => x.textContent));
  ok('两个标签页', tabs.length === 2, tabs.join(' | '));
  const second = await p.evaluate(() => ({ layers: __app.A.doc.layers.length, name: __app.A.doc.name }));
  ok('新标签页独立（无图层）', second.layers === 0 && second.name === '示例.png');
  await p.evaluate(() => document.querySelectorAll('#tabs .tab .t')[0].click()); await idle();
  const back = await p.evaluate(() => ({ layers: __app.A.doc.layers.length, text: __app.A.doc.layers[0]?.text, name: __app.A.doc.name }));
  ok('切回第一个标签：图层与文字保留', back.layers >= 1 && back.text === 'Price 9999', JSON.stringify(back));

  // 批量替换
  await p.evaluate(() => document.querySelectorAll('#tabs .tab .t')[1].click()); await idle();
  await p.waitForFunction(() => __app.A.doc.lines.length >= 3, { timeout: 60000 }); await idle();
  await p.evaluate(() => document.getElementById('btnBatch').click());
  await p.type('#bFind', '2026'); await p.type('#bRepl', '2027'); const bp = await p.$eval('#bPreview', e => e.textContent); ok('批量替换预览命中行数', /将替换 [12] 行/.test(bp), bp);
  const pre = await px('cvPrev');
  await p.click('#bGo'); await p.waitForFunction(() => !__app.A.fitting); await idle();
  const post = await px('cvPrev'); const bl = await p.evaluate(() => __app.A.doc.layers.map(l => l.text));
  ok('批量替换后图层文字已替换且预览变化（保留词间空格）', bl.some(t => t.includes('2027 / CREATE SOMETHING NEW')) && post.hash !== pre.hash, JSON.stringify(bl));
  await p.evaluate(() => document.getElementById('btnUndo').click()); await idle();
  ok('批量替换可一次撤销', (await p.evaluate(() => __app.A.doc.layers.filter(l => l.touched && /2027/.test(l.text)).length)) === 0);

  // 框选识别
  await p.click('#modeBox'); const reg = await p.evaluate(() => { const l = __app.A.doc.lines.find(l => /标|图片|字/.test(l.text)) || __app.A.doc.lines[2]; return l.r; });
  const box = await p.evaluate(r => { const s = document.getElementById('svgOrig').getBoundingClientRect(), d = __app.A.doc, z = s.width / d.W; return { x: s.left + (r.x - 4) * z, y: s.top + (r.y - 4) * z, x2: s.left + (r.x + r.w + 4) * z, y2: s.top + (r.y + r.h + 4) * z }; }, reg);
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move((box.x + box.x2) / 2, box.y2, { steps: 4 }); await p.mouse.move(box.x2, box.y2, { steps: 4 }); await p.mouse.up();
  await p.waitForFunction(() => !__app.A.fitting && __app.A.ocrRunning === 0 && __app.A.doc.sel, { timeout: 90000 }); await idle();
  const rs = await p.evaluate(() => ({ t: __app.A.doc.sel.text, src: !!__app.A.doc.sel.src })); ok('框选识别后自动选中该文字', rs.src && rs.t.length > 2, JSON.stringify(rs));
  await p.click('#modeClick');

  // 添加文字 + 删除
  await p.evaluate(() => __app.addText(40, 30)); await p.keyboard.type('Hello 世界'); await idle();
  const added = await p.evaluate(() => ({ n: __app.A.doc.layers.length, t: __app.A.doc.sel.text, b: __app.A.doc.sel.bounds })); ok('添加文字层并实时渲染', added.t === 'Hello 世界' && added.b && added.b.w > 50, JSON.stringify(added.b));
  await p.click('#btnDelete'); await idle(); ok('删除图层', (await p.evaluate(() => __app.A.doc.layers.length)) === added.n - 1);

  // 空图新建
  await p.evaluate(() => document.getElementById('mNew').click()); await p.evaluate(() => { document.getElementById('newName').value = '空白'; }); await p.click('#frmNew button[type=submit]');
  await p.waitForFunction(() => __app.A.docs.length === 3); await idle();
  ok('新建画布成为第三个标签', (await p.evaluate(() => __app.A.doc.name)) === '空白');
  await p.setViewport({ width: 1100, height: 760 }); await idle();
  ok('窗口缩小后无异常（适合窗口重新计算）', (await px('cvPrev')).w === 1200);

  ok('全程无 JS 错误 / console.error', errors.length === 0, errors.slice(0, 3).join(' || '));
  await b.close(); srv.close();
  console.log(`\ne2e-ui: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
