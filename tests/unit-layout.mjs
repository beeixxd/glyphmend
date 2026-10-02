import assert from 'node:assert/strict';
import { wrapText } from '../dist/js/layout.js';
let pass = 0; const ok = (n, f) => { f(); pass++; console.log('  ✓', n); };
const m = s => Array.from(s).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 20 : 10), 0);
ok('不需要换行时原样返回；显式换行保留', () => {
  assert.deepEqual(wrapText('hello', m, 200), ['hello']);
  assert.deepEqual(wrapText('a\n\nb', m, 200), ['a', '', 'b']);
});
ok('西文按词换行，不在单词中间断开', () => {
  const lines = wrapText('hello world foo', m, 100);
  assert.deepEqual(lines, ['hello', 'world foo']);
});
ok('中文逐字换行，每行不超宽', () => {
  const lines = wrapText('一二三四五六七八九十', m, 60);
  assert.deepEqual(lines, ['一二三', '四五六', '七八九', '十']);
  for (const l of lines) assert.ok(m(l) <= 60);
});
ok('超宽单词被强制拆开且不丢字符', () => {
  const lines = wrapText('abcdefghijklmnop', m, 50);
  assert.equal(lines.join(''), 'abcdefghijklmnop');
  for (const l of lines) assert.ok(m(l) <= 50);
});
ok('避头标点：句号不会出现在行首', () => {
  const lines = wrapText('一二三。四五六。', m, 60);
  for (const l of lines) assert.ok(!/^[。，、]/.test(l), JSON.stringify(lines));
  assert.equal(lines.join(''), '一二三。四五六。');
});
ok('4 万字长文本换行不丢字且耗时合理', () => {
  const src = '中a'.repeat(20000), t = performance.now();
  const lines = wrapText(src, m, 400);
  assert.equal(lines.join(''), src);
  assert.ok(performance.now() - t < 3000, '耗时 ' + (performance.now() - t));
});
ok('宽度<=0 视为不换行；emoji 代理对不被拆坏', () => {
  assert.deepEqual(wrapText('abc def', m, 0), ['abc def']);
  const lines = wrapText('😀😀😀😀😀😀', () => 0, 0); assert.equal(lines[0], '😀😀😀😀😀😀');
  const l2 = wrapText('😀😀😀😀😀😀', s => Array.from(s).length * 10, 30); assert.equal(l2.join(''), '😀😀😀😀😀😀');
});
console.log(`\nunit-layout: ${pass} passed`);
