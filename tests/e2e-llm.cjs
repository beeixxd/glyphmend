// 视觉大模型链路：浏览器 → 本机 mock（OpenAI 兼容 / Gemini 两种协议）。验证请求格式、拼接图内容、
// 返回解析、采纳/拒绝策略、错误提示、Key 不落盘策略。mock 不代表任何真实服务的行为。
const http = require('http'), fs = require('fs');
const { launch, startServer } = require('./lib.cjs');
let pass = 0, fail = 0; const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', n, e); };
(async () => {
  const seen = [];
  let reply = null, status = 200;
  const mock = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const j = JSON.parse(body); seen.push({ url: req.url, auth: req.headers.authorization, gkey: req.headers['x-goog-api-key'], body: j });
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      if (status !== 200) return res.end(JSON.stringify({ error: 'x' }));
      const text = typeof reply === 'function' ? reply(j) : reply;
      if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
      else res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    });
  }).listen(8899, '127.0.0.1');
  const srv = startServer(8802), b = await launch(), p = await b.newPage(); await p.setViewport({ width: 1500, height: 900 });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8802/index.html'); await p.waitForFunction('window.__app');
  const idle = () => p.evaluate(() => __app.whenIdle());

  // 配置对话框：OpenAI 兼容（Ollama 预设改指向 mock）
  await p.click('#btnLLMCfg'); await p.select('#llmPreset', 'ollama');
  await p.evaluate(() => { document.getElementById('llmBase').value = 'http://localhost:8899/v1'; document.getElementById('llmModel').value = 'mock-vl'; });
  reply = '```json\n{"rows":[{"i":1,"text":"Test","bold":true,"italic":false,"family":"sans"}]}\n```';
  await p.click('#llmTest'); await p.waitForFunction(() => /连接成功|测试失败/.test(document.getElementById('llmNote').textContent));
  const note = await p.$eval('#llmNote', e => e.textContent); ok('测试连接成功并解析带围栏的 JSON', /连接成功/.test(note), note);
  ok('请求命中 /v1/chat/completions，含 image_url(JPEG base64) 与 JSON 提示词', seen.length === 1 && seen[0].url === '/v1/chat/completions' && seen[0].body.messages[0].content.some(c => c.type === 'image_url' && /^data:image\/jpeg;base64,/.test(c.image_url.url)) && /只输出 JSON/.test(seen[0].body.messages[0].content[0].text), JSON.stringify(seen[0] && Object.keys(seen[0].body)));
  ok('本机服务无需 Key：未发送 Authorization', seen[0].auth === undefined);

  // 非 HTTPS 远程地址被拒绝
  await p.evaluate(() => { document.getElementById('llmBase').value = 'http://example.com/v1'; }); await p.click('#llmTest');
  await p.waitForFunction(() => /测试失败/.test(document.getElementById('llmNote').textContent)); ok('明文远程地址被拒绝', /HTTPS/.test(await p.$eval('#llmNote', e => e.textContent)));
  await p.evaluate(() => { document.getElementById('llmBase').value = 'http://localhost:8899/v1'; });
  await p.click('#frmLLM button[type=submit]'); await p.waitForFunction(() => !document.getElementById('dlgLLM').open);
  ok('保存后自动勾选“视觉大模型校对”', await p.$eval('#engLLM', e => e.checked));
  ok('未勾选“记住 Key”：localStorage 不含 Key', !(await p.evaluate(() => localStorage.getItem('textstudio6.llm') || '')).includes('"key":"s'));

  // 打开含三行文字的图片 → 识别 → 大模型校对。让 mock 修正第一行（相近）+ 胡编第二行（应被拒绝）
  const dataUrl = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#f2ede2'; x.fillRect(0, 0, 900, 300); x.fillStyle = '#222'; x.font = '700 52px "DejaVu Sans"'; x.fillText('Quality Studio', 50, 90); x.font = '400 40px "Liberation Serif"'; x.fillText('Order 20260918', 50, 180); x.font = 'italic 36px "DejaVu Serif"'; x.fillText('plain note here', 50, 255); return c.toDataURL(); });
  fs.writeFileSync('/tmp/ts6-llm.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  seen.length = 0;
  reply = j => JSON.stringify({ rows: [{ i: 1, text: 'Quality Studio', bold: true, italic: false, family: 'sans' }, { i: 2, text: 'Order 20260918', bold: false, family: 'serif' }, { i: 3, text: 'A completely invented sentence about nothing', italic: true }] });
  await (await p.$('#fileInput')).uploadFile('/tmp/ts6-llm.png'); await p.waitForFunction(() => __app.A.doc && __app.A.doc.name === 'ts6-llm.png'); await p.waitForFunction(() => __app.A.doc.ocr.status === 'done', { timeout: 120000 }); await idle();
  const res = await p.evaluate(() => __app.A.doc.lines.map(l => ({ t: l.text, e: l.engine, hints: l.hints || null, alts: (l.alts || []).map(a => a.engine + ':' + a.text + (a.rejected ? '(拒)' : '')) })));
  console.log('    ', JSON.stringify(res));
  ok('识别流程中自动调用了一次视觉模型（整图拼接，不是逐行多次）', seen.length === 1);
  const sheet = seen[0].body.messages[0].content.find(c => c.type === 'image_url').image_url.url; ok('拼接图为有效 JPEG 且体积合理', sheet.length > 2000 && sheet.length < 4_000_000, `${(sheet.length / 1024).toFixed(0)} KB`);
  ok('模型一致的行：写入粗体 / 字体族提示，文字不变', res[0].t === 'Quality Studio' && res[0].hints && res[0].hints.bold === true);
  ok('模型胡编的第三行被拒绝：保留本地识别文字，并把模型输出记为被拒候选', res[2].t === 'plain note here' && res[2].alts.some(a => a.includes('(拒)')), res[2].alts.join(' | '));
  const hintFit = await p.evaluate(async () => { const l = __app.A.doc.lines[0]; await __app.selectLine(l); await __app.whenIdle(); return { font: __app.A.doc.sel.style.font, w: __app.A.doc.sel.style.weight, hints: __app.A.doc.sel.src.hints }; });
  ok('提示（粗体）随原文进入字体匹配', hintFit.hints && hintFit.hints.bold === true && hintFit.w >= 600, JSON.stringify(hintFit));

  // 错误路径：429 / 401 / 乱码输出；识别仍完成（本地结果不受影响）
  for (const [st, rep, re] of [[429, '', /429.*限频/], [401, '', /401.*Key/]]) {
    status = st; seen.length = 0;
    await p.evaluate(() => document.getElementById('btnOCR').click()); await p.waitForFunction(() => __app.A.doc.ocr.status === 'running'); await p.waitForFunction(() => __app.A.doc.ocr.status === 'done', { timeout: 120000 }); await idle();
    const msg = await p.$eval('#status', e => e.textContent); const nLines = await p.evaluate(() => __app.A.doc.lines.length);
    ok(`HTTP ${st}：状态栏给出可读提示，本地识别结果保留(${nLines} 行)`, re.test(msg) && nLines === 3, msg.slice(0, 90));
  }
  status = 200; reply = '抱歉，我无法处理这张图片。';
  await p.evaluate(() => document.getElementById('btnOCR').click()); await p.waitForFunction(() => __app.A.doc.ocr.status === 'running'); await p.waitForFunction(() => __app.A.doc.ocr.status === 'done', { timeout: 120000 }); await idle();
  ok('模型返回非 JSON：提示“不是 JSON”，不影响本地结果', /不是 JSON/.test(await p.$eval('#status', e => e.textContent)) && (await p.evaluate(() => __app.A.doc.lines.length)) === 3);

  // Gemini 协议
  await p.click('#btnLLMCfg'); await p.select('#llmPreset', 'gemini');
  await p.evaluate(() => { document.getElementById('llmBase').value = 'http://localhost:8899/v1beta'; document.getElementById('llmKey').value = 'sk-test-123'; document.getElementById('llmRemember').checked = false; });
  reply = '{"rows":[{"i":1,"text":"Test"}]}'; seen.length = 0; await p.click('#llmTest'); await p.waitForFunction(() => /连接成功|测试失败/.test(document.getElementById('llmNote').textContent));
  const g = seen[0]; ok('Gemini：走 :generateContent，Key 放在请求头而非 URL', g && /:generateContent$/.test(g.url) && g.gkey === 'sk-test-123' && !g.url.includes('key='), g && g.url);
  ok('Gemini：inline_data(JPEG) + responseMimeType=application/json', g.body.contents[0].parts.some(x => x.inline_data && x.inline_data.mime_type === 'image/jpeg') && g.body.generationConfig.responseMimeType === 'application/json');
  await p.click('#frmLLM button[type=submit]'); await p.waitForFunction(() => !document.getElementById('dlgLLM').open);
  ok('未勾选记住：Key 不写入 localStorage', !(await p.evaluate(() => localStorage.getItem('textstudio6.llm'))).includes('sk-test-123'));
  await p.click('#btnLLMCfg'); await p.evaluate(() => { document.getElementById('llmRemember').checked = true; }); await p.click('#frmLLM button[type=submit]');
  ok('勾选记住：Key 才写入 localStorage', (await p.evaluate(() => localStorage.getItem('textstudio6.llm'))).includes('sk-test-123'));

  ok('无 JS 错误', errors.length === 0, errors.join('|'));
  await b.close(); srv.close(); mock.close();
  console.log(`\ne2e-llm: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
