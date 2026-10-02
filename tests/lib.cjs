// 测试公共：启动静态服务 + 无头 Chromium（来自 @sparticuz/chromium npm 包，无需另外下载浏览器）
const path = require('path');
const { createRequire } = require('module');
const roots = [process.env.TS_ENV, path.resolve(__dirname, '..'), '/home/claude/work/env'].filter(Boolean);
function load(name) {
  for (const r of roots) { try { return createRequire(path.join(r, 'package.json'))(name); } catch { /* 下一个 */ } }
  throw new Error(`缺少测试依赖 ${name}：请先在项目目录执行 npm install`);
}
async function launch() {
  const chromium = load('@sparticuz/chromium'), puppeteer = load('puppeteer-core'), c = chromium.default || chromium;
  const exe = process.env.CHROME_PATH || await c.executablePath();
  return puppeteer.launch({ executablePath: exe, args: [...c.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 600000 });
}
function startServer(port) {
  process.env.PORT = String(port);
  delete require.cache[require.resolve('../server.cjs')];
  return require('../server.cjs');
}
module.exports = { launch, startServer };
