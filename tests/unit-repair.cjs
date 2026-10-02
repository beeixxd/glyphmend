const assert = require('node:assert/strict');
const { inpaint, dilate } = require('../dist/js/repair-worker.js');
let pass = 0; const ok = (n, f) => { f(); pass++; console.log('  ✓', n); };
function img(w, h, fn) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; }
ok('纯色背景：被文字污染的像素完全恢复', () => {
  const w = 80, h = 30, clean = img(w, h, () => [230, 220, 210]), dirty = Uint8ClampedArray.from(clean), unk = new Uint8Array(w * h);
  for (let y = 10; y < 20; y++) for (let x = 20; x < 60; x++) { dirty[(y * w + x) * 4] = 10; unk[y * w + x] = 1; }
  const { out } = inpaint(dirty, w, h, unk, 200);
  for (let i = 0; i < w * h * 4; i++) assert.ok(Math.abs(out[i] - clean[i]) <= 1, 'idx ' + i);
});
ok('线性渐变背景：修补后与理想渐变误差 ≤ 2', () => {
  const w = 120, h = 40, f = (x, y) => [100 + x, 150 + y * 2, 200 - x * 0.5], clean = img(w, h, f), dirty = Uint8ClampedArray.from(clean), unk = new Uint8Array(w * h);
  for (let y = 12; y < 28; y++) for (let x = 25; x < 95; x++) { dirty[(y * w + x) * 4 + 1] = 0; unk[y * w + x] = 1; }
  const { out } = inpaint(dirty, w, h, unk, 400);
  let max = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(out[(y * w + x) * 4 + c] - clean[(y * w + x) * 4 + c]));
  assert.ok(max <= 2, 'max=' + max);
});
ok('只改未知像素：纹理（棋盘格）背景在文字之外 100% 保持', () => {
  const w = 60, h = 30, tex = img(w, h, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [200, 200, 200])), unk = new Uint8Array(w * h);
  for (let y = 10; y < 20; y++) for (let x = 20; x < 40; x++) unk[y * w + x] = 1;
  const { out } = inpaint(tex, w, h, unk, 100);
  for (let i = 0; i < w * h; i++) if (!unk[i]) for (let c = 0; c < 3; c++) assert.equal(out[i * 4 + c], tex[i * 4 + c]);
});
ok('全部未知时给出明确错误；无未知像素时原样返回', () => {
  const w = 10, h = 10, d = img(w, h, () => [1, 2, 3]);
  assert.throws(() => inpaint(d, w, h, new Uint8Array(w * h).fill(1), 10), /没有可参考/);
  assert.deepEqual(Array.from(inpaint(d, w, h, new Uint8Array(w * h), 10).out), Array.from(d));
});
ok('大区域性能：800×200 区域一半未知，< 3 秒', () => {
  const w = 800, h = 200, d = img(w, h, (x, y) => [x / 4, y, 128]), unk = new Uint8Array(w * h);
  for (let y = 50; y < 150; y++) for (let x = 40; x < 760; x++) unk[y * w + x] = 1;
  const t = Date.now(); inpaint(d, w, h, unk, 200); assert.ok(Date.now() - t < 3000, '耗时 ' + (Date.now() - t));
});
ok('dilate 半径正确', () => {
  const w = 21, h = 21, m = new Uint8Array(w * h); m[10 * w + 10] = 1;
  const o = dilate(m, w, h, 3); let c = 0; for (const v of o) c += v; assert.equal(c, 49);
});
console.log(`\nunit-repair: ${pass} passed`);
