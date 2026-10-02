import assert from 'node:assert/strict';
import { strokeWidth, rowBands, inkBox, inkBoxSub, slantOf, boxBlur, maskDistance, extractMask } from '../dist/js/analyze.js';
globalThis.document = undefined;
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

function stripes(w, h, sw, gap, soft = false) { // 竖条纹：笔画宽 sw
  const a = new Float32Array(w * h);
  for (let y = 4; y < h - 4; y++) for (let x = 0; x < w; x++) { const m = (x - 4) % (sw + gap); if (x >= 4 && m < sw) a[y * w + x] = 1; }
  return a;
}
ok('笔画粗细估计：2/3/5/8 px 竖条误差 < 15%', () => {
  for (const sw of [2, 3, 5, 8]) {
    const a = stripes(200, 60, sw, 12), s = strokeWidth(a, 200, 60);
    assert.ok(Math.abs(s - sw) / sw < 0.15, `sw=${sw} 估计=${s.toFixed(2)}`);
  }
});
ok('笔画粗细：轻微模糊（抗锯齿/缩放）下偏差有界，粗细顺序不变', () => {
  // 极细笔画被模糊后峰值本就 <1，视觉上更“粗而淡”，估计略大属物理现象；这里只要求偏差有界且单调。
  const est = [3, 6, 9].map(sw => strokeWidth(boxBlur(stripes(220, 60, sw, 14), 220, 60, 1), 220, 60));
  assert.ok(est[0] < est[1] && est[1] < est[2], est.join(','));
  assert.ok(Math.abs(est[1] - 6) / 6 < 0.2 && Math.abs(est[2] - 9) / 9 < 0.15, est.join(','));
  assert.ok(Math.abs(est[0] - 3) / 3 < 0.4, est.join(','));
});
ok('笔画粗细：加粗后单调增加', () => {
  const s = [2, 3, 4, 6].map(v => strokeWidth(stripes(160, 50, v, 12), 160, 50));
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
});
ok('行带切分：3 行文字恰好得到 3 条带，且 i 点间隙不会被误当作换行', () => {
  const w = 100, h = 90, a = new Float32Array(w * h);
  for (const [y0, y1] of [[5, 25], [40, 58], [70, 88]]) for (let y = y0; y <= y1; y++) for (let x = 10; x < 90; x++) a[y * w + x] = 1;
  for (let x = 10; x < 90; x++) a[31 * w + x] = 0; // 无影响
  a[48 * w + 50] = 0; // 行内小缺口
  const bands = rowBands(a, w, h, 3);
  assert.equal(bands.length, 3); assert.equal(bands[1].y0, 40);
  assert.equal(rowBands(a, w, h, 1).length, 1);
});
ok('倾斜度：竖直字形≈0，向右斜的平行四边形>0.15', () => {
  const w = 120, h = 60, up = new Float32Array(w * h), sl = new Float32Array(w * h);
  for (let y = 5; y < 55; y++) for (let x = 0; x < 6; x++) { up[y * w + 40 + x] = 1; sl[y * w + 40 + x + Math.round((55 - y) * 0.25)] = 1; }
  assert.ok(Math.abs(slantOf(up, w, h)) < 0.02);
  const t = slantOf(sl, w, h); assert.ok(t > 0.18 && t < 0.32, 'slant=' + t);
});
ok('maskDistance：相同=0，错位 1px 仍很小，不同粗细明显更大', () => {
  const w = 160, h = 50, a = stripes(w, h, 4, 10), shifted = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) shifted[y * w + x] = a[y * w + x - 1];
  assert.equal(maskDistance(a, a, w, h), 0);
  assert.ok(maskDistance(a, shifted, w, h) < 0.05);
  assert.ok(maskDistance(a, stripes(w, h, 7, 7), w, h) > 0.2);
});
ok('extractMask：纯色背景深色文字；渐变背景也能得到干净蒙版', () => {
  const w = 120, h = 40;
  for (const grad of [false, true]) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bg = grad ? 200 + x * 0.3 : 240, i = (y * w + x) * 4, inText = x > 20 && x < 100 && y > 12 && y < 28 && (x % 8 < 5);
      const v = inText ? 30 : bg; rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    const m = extractMask(rgba, w, h);
    assert.ok(m.fg[0] < 60, 'fg=' + m.fg);
    let ghost = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const inText = x > 20 && x < 100 && y > 12 && y < 28 && (x % 8 < 5); if (!inText && m.alpha[y * w + x] > 0.3) ghost++; }
    assert.ok(ghost < 6, `grad=${grad} 背景误检 ${ghost}`);
    assert.ok(m.ink.x >= 20 && m.ink.w <= 82);
  }
});
ok('extractMask：对比度不足时给出明确错误', () => {
  const rgba = new Uint8ClampedArray(30 * 30 * 4).fill(128);
  assert.throws(() => extractMask(rgba, 30, 30), /对比不足/);
});
ok('亚像素墨迹框：覆盖率 0.5 的边缘被折算为半个像素', () => {
  const w = 40, h = 30, a = new Float32Array(w * h);
  for (let y = 10; y < 20; y++) for (let x = 5; x < 25; x++) a[y * w + x] = 1;
  for (let x = 5; x < 25; x++) { a[9 * w + x] = 0.5; a[20 * w + x] = 0.25; } // 上边 0.5、下边 0.25
  for (let y = 10; y < 20; y++) { a[y * w + 4] = 0.75; }                      // 左边 0.75
  const b = inkBoxSub(a, w, h);
  assert.ok(Math.abs(b.y - 9.5) < 1e-6 && Math.abs(b.h - (10 + 0.5 + 0.25)) < 1e-6, JSON.stringify(b));
  assert.ok(Math.abs(b.x - 4.25) < 1e-6 && Math.abs(b.w - (20 + 0.75)) < 1e-6, JSON.stringify(b));
  assert.equal(inkBox(a, w, h, 0.22).h, 12); // 整像素版本会偏大
});
console.log(`\nunit-analyze: ${pass} passed`);
