import assert from 'node:assert/strict';
import { fuse, similarity, levenshtein, applyLLMRows, enginePrior, cleanSpaces, looseKey } from '../dist/js/ocr/fusion.js';
import { parseRows, buildSheets, checkEndpoint, PRESETS } from '../dist/js/ocr/llm.js';
let pass = 0; const ok = (n, f) => { f(); pass++; console.log('  ✓', n); };
const L = (text, x, y, w, h, conf, extra = {}) => ({ text, r: { x, y, w, h }, confidence: conf, symbols: [], ...extra });

ok('编辑距离与相似度', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(similarity('LOCAL TEXT', 'local text'), 1);
  assert.ok(similarity('字境 图片', 'FE 图片') > 0.5 && similarity('abc', 'xyz') === 0);
});
ok('同一行被两个引擎识别：合并为一条，文本一致则无分歧', () => {
  const out = fuse([{ engine: 'paddle', lines: [L('LOCAL TEXT', 10, 10, 200, 30, 97)] }, { engine: 'tesseract', lines: [L('LOCAL TEXT', 12, 12, 196, 28, 95)] }]);
  assert.equal(out.length, 1); assert.equal(out[0].disagree, false); assert.equal(out[0].engine, 'paddle+tesseract'); assert.ok(out[0].confidence > 96);
});
ok('中文行：Paddle 与 Tesseract 冲突时采用 Paddle，Tesseract 作为候选保留', () => {
  const out = fuse([{ engine: 'tesseract', lines: [L('FE 图片文字 编辑', 10, 10, 260, 30, 86)] }, { engine: 'paddle', lines: [L('字境 图片文字 编辑', 8, 8, 270, 34, 98)] }]);
  assert.equal(out[0].text, '字境 图片文字 编辑'); assert.equal(out[0].disagree, true);
  assert.equal(out[0].alts[0].engine, 'tesseract');
});
ok('纯英文行：Tesseract 高置信时压过 Paddle 低置信', () => {
  const out = fuse([{ engine: 'paddle', lines: [L('Create sornething new', 10, 10, 300, 30, 62)] }, { engine: 'tesseract', lines: [L('Create something new', 10, 10, 300, 30, 94)] }]);
  assert.equal(out[0].text, 'Create something new');
});
ok('不同位置的行不会被误合并；按阅读顺序输出', () => {
  const out = fuse([{ engine: 'paddle', lines: [L('第二行', 10, 100, 80, 30, 99), L('第一行', 10, 10, 80, 30, 99)] }]);
  assert.deepEqual(out.map(l => l.text), ['第一行', '第二行']);
});
ok('只有一个引擎检出的行也保留；同一引擎的两行不互相合并', () => {
  const out = fuse([{ engine: 'paddle', lines: [L('A', 10, 10, 50, 20, 90), L('B', 12, 12, 48, 18, 90)] }, { engine: 'tesseract', lines: [L('C', 300, 300, 50, 20, 90)] }]);
  assert.equal(out.length, 3);
});
ok('逐字符坐标优先取非近似来源（Tesseract 精确框）', () => {
  const syms = [{ text: 'A', b: { x: 1, y: 1, w: 5, h: 5 } }];
  const out = fuse([{ engine: 'paddle', lines: [L('A', 0, 0, 20, 10, 90, { symbols: [{ text: 'A', b: { x: 0, y: 0, w: 9, h: 9 }, approx: true }] })] }, { engine: 'tesseract', lines: [L('A', 0, 0, 20, 10, 90, { symbols: syms })] }]);
  assert.equal(out[0].symbols[0].approx, undefined);
});
ok('大模型校对：相近文本被采纳；离谱文本被拒绝并保留为候选；提示信息写入 hints', () => {
  const lines = [L('Welcome tc the Studlo', 0, 0, 100, 20, 70, { engine: 'tesseract' }), L('2026', 0, 30, 50, 20, 90, { engine: 'paddle' }), L('Hello', 0, 60, 50, 20, 90, { engine: 'paddle' })];
  const r = applyLLMRows(lines, [{ i: 1, text: 'Welcome to the Studio', bold: true, family: 'sans' }, { i: 2, text: '2026', bold: false }, { i: 3, text: 'Completely unrelated hallucination sentence' }]);
  assert.equal(lines[0].text, 'Welcome to the Studio'); assert.equal(lines[0].alts[0].text, 'Welcome tc the Studlo'); assert.equal(lines[0].hints.bold, true);
  assert.equal(lines[1].llmAgrees, true); assert.equal(lines[2].text, 'Hello'); assert.equal(lines[2].alts[0].rejected, true);
  assert.deepEqual(r, { changed: 1, rejected: 1 });
});
ok('parseRows：容忍 Markdown 代码围栏、前后说明文字；非法输出给出明确错误', () => {
  assert.equal(parseRows('```json\n{"rows":[{"i":1,"text":"a"}]}\n```')[0].text, 'a');
  assert.equal(parseRows('好的，结果如下：{"rows":[{"i":"2","text":"b"}]} 完毕')[0].i, 2);
  assert.throws(() => parseRows('没有 JSON'), /不是 JSON/);
  assert.throws(() => parseRows('{"rows": 5}'), /rows/);
  assert.throws(() => parseRows('{bad json}'), /无法解析/);
});
ok('接口地址校验：HTTPS 与 localhost 允许，明文远程地址拒绝', () => {
  checkEndpoint('https://api.example.com/v1'); checkEndpoint('http://localhost:11434/v1'); checkEndpoint('http://127.0.0.1:1234/v1');
  assert.throws(() => checkEndpoint('http://example.com/v1'), /HTTPS/);
  assert.throws(() => checkEndpoint('not a url'), /无效/);
});
ok('预设服务商：本机类标注无需 Key，其余都有 base 与默认模型', () => {
  for (const p of PRESETS) { assert.ok(p.label && p.kind); if (p.id !== 'custom') assert.ok(p.base && p.model, p.id); }
  assert.equal(PRESETS.find(p => p.id === 'ollama').needsKey, false);
});
ok('空白归一：Paddle 丢英文词间空格时，采用 Tesseract 的空格写法且不算分歧', () => {
  const out = fuse([{ engine: 'paddle', lines: [L('2026/CREATESOMETHINGNEW', 10, 10, 400, 30, 99)] }, { engine: 'tesseract', lines: [L('2026 / CREATE SOMETHING NEW', 10, 10, 400, 30, 90)] }]);
  assert.equal(out[0].text, '2026 / CREATE SOMETHING NEW'); assert.equal(out[0].disagree, false);
});
ok('汉字之间的多余空格被清理；拉丁词与标点周围空格保留', () => {
  assert.equal(cleanSpaces('字 境 图 片'), '字境图片'); assert.equal(cleanSpaces('图片文字 · 实时对比'), '图片文字 · 实时对比'); assert.equal(cleanSpaces('字境 图片文字 编辑'), '字境 图片文字 编辑');
  assert.equal(cleanSpaces('Hello 世 界 world'), 'Hello 世界 world'); assert.equal(looseKey('A  b'), 'ab');
  const out = fuse([{ engine: 'tesseract', lines: [L('文 字 编 辑', 5, 5, 100, 30, 80)] }]); assert.equal(out[0].text, '文字编辑');
});
ok('大模型校对：仅空白差异视为一致（不制造“分歧”）', () => {
  const lines = [L('Hello World', 0, 0, 100, 20, 90, { engine: 'paddle' })];
  applyLLMRows(lines, [{ i: 1, text: 'HelloWorld' }]); assert.equal(lines[0].llmAgrees, true); assert.equal(lines[0].text, 'Hello World');
});
console.log(`\nunit-fusion: ${pass} passed`);
