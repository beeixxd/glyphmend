// 依次运行全部测试；任何一项失败即返回非 0。
const { spawnSync } = require('child_process'), path = require('path');
const steps = [
  ['语法检查', ['--check-all']],
  ['单元：图像分析', ['tests/unit-analyze.mjs']], ['单元：排版', ['tests/unit-layout.mjs']], ['单元：背景修复', ['tests/unit-repair.cjs']], ['单元：多引擎融合 / 视觉模型协议', ['tests/unit-fusion.mjs']],
  ['浏览器：字体/字重拟合', ['tests/e2e-fit.cjs']], ['浏览器：图层模型与渲染', ['tests/e2e-doc.cjs']],
  ['浏览器：整站交互', ['tests/e2e-ui.cjs']], ['浏览器：视觉模型链路(mock)', ['tests/e2e-llm.cjs']], ['浏览器：字形一致性', ['tests/e2e-glyph.cjs']]
];
let failed = 0; const t0 = Date.now();
for (const [name, args] of steps) {
  process.stdout.write(`\n━━ ${name}\n`);
  if (args[0] === '--check-all') {
    const fs = require('fs'); const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); } else if (/\.(js|mjs|cjs)$/.test(f)) files.push(p); } })(path.join(__dirname, '..', 'dist'));
    files.push(path.join(__dirname, '..', 'server.cjs'));
    let bad = 0; for (const f of files) { const r = spawnSync(process.execPath, f.endsWith('.js') || f.endsWith('.mjs') ? ['--input-type=module', '--check'] : ['--check', f], { input: f.endsWith('.js') || f.endsWith('.mjs') ? fs.readFileSync(f) : undefined, encoding: 'utf8' }); if (r.status !== 0) { bad++; console.log('  ✗', f, r.stderr.split('\n')[0]); } }
    // repair-worker.js 同时是 CJS 兼容脚本：单独 --check
    const rw = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', 'dist/js/repair-worker.js')], { encoding: 'utf8' }); if (rw.status !== 0) { bad++; console.log('  ✗ repair-worker.js'); }
    console.log(bad ? `  ${bad} 个文件语法错误` : `  ✓ ${files.length} 个脚本语法正确`); if (bad) failed++; continue;
  }
  const r = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0) { failed++; console.log(`  ✗ 未通过：${name}`); }
}
console.log(`\n${failed ? '✗ 有 ' + failed + ' 组测试未通过' : '✓ 全部测试通过'}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
process.exit(failed ? 1 : 0);
