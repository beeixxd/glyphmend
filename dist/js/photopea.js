// Photopea 往返：把当前合成图发到官方免费在线编辑器，修改后以 PNG 带回（成为新的底图），或导出 PNG / PSD。
// 只接受 www.photopea.com 且来自对应 iframe 的消息；返回文件校验 PNG 签名、体积、像素。
import { $, cv, canvasToBlob } from './util.js';

class Bridge {
  constructor(frame) { this.frame = frame; this.origin = 'https://www.photopea.com'; this.ready = false; this.boot = null; this.pending = null; this.queue = Promise.resolve(); this.handle = e => this.receive(e); window.addEventListener('message', this.handle); }
  waitReady() {
    if (this.ready) return Promise.resolve();
    if (this.boot) return this.boot.promise;
    let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
    const timer = setTimeout(() => { this.boot = null; reject(new Error('Photopea 加载超时，请检查网络后重试')); }, 90000);
    this.boot = { promise, resolve, reject, timer }; return promise;
  }
  receive(e) {
    if (e.origin !== this.origin || e.source !== this.frame.contentWindow) return;
    if (e.data === 'done' && !this.ready) { this.ready = true; if (this.boot) { clearTimeout(this.boot.timer); this.boot.resolve(); this.boot = null; } return; }
    const p = this.pending; if (!p) return;
    if (typeof e.data === 'string' && e.data.startsWith('GS_ERROR:')) p.error = e.data.slice(9);
    else if (typeof e.data === 'string' && e.data.startsWith('GS_SOURCE:')) p.source = e.data.slice(10);
    else if (e.data instanceof ArrayBuffer) p.buffer = e.data;
    else if (e.data === 'done') {
      clearTimeout(p.timer); this.pending = null;
      if (p.error) p.reject(new Error(p.error));
      else if (p.binary && !p.buffer) p.reject(new Error('在线编辑器没有返回文件，请重试'));
      else if (p.expected && p.source !== p.expected) p.reject(new Error('返回图片的标识不匹配，已阻止覆盖'));
      else p.resolve({ buffer: p.buffer });
    }
  }
  call(packet, { binary = false, expected = null } = {}) {
    const task = this.queue.then(async () => {
      await this.waitReady();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending = null; reject(new Error('Photopea 操作超时，原图保持不变，可重试')); }, 90000);
        this.pending = { resolve, reject, timer, binary, expected };
        try { this.frame.contentWindow.postMessage(packet, this.origin); } catch (e) { clearTimeout(timer); this.pending = null; reject(e); }
      });
    });
    this.queue = task.catch(() => {}); return task;
  }
  script(code, o) { return this.call('try{' + code + '}catch(e){app.echoToOE("GS_ERROR:"+e.message);}', o); }
  dispose() { window.removeEventListener('message', this.handle); if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('在线编辑器已关闭')); this.pending = null; } if (this.boot) { clearTimeout(this.boot.timer); this.boot.reject(new Error('在线编辑器已关闭')); this.boot = null; } }
}

export function pngSignature(bytes) { const b = new Uint8Array(bytes); return b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v); }

export function initPhotopea(api) {
  const PP = { bridge: null, source: null, docId: null, sessions: new Map(), busy: false, serial: 0 };
  const ids = ['ppReturn', 'ppPng', 'ppPsd', 'ppSend', 'ppFonts'];
  const status = (s, err = false) => { $('ppStatus').textContent = s; $('ppStatus').classList.toggle('error', err); };
  const findScript = src => `var f=null;for(var i=0;i<app.documents.length;i++){if(app.documents[i].source===${JSON.stringify(src)}){f=app.documents[i];break;}}if(!f)throw new Error('未找到对应图片，请重新发送当前标签页');app.activeDocument=f;`;
  async function action(fn) {
    if (PP.busy) return; PP.busy = true; ids.forEach(i => $(i).disabled = true);
    try { await fn(); } catch (e) { status(e.message, true); } finally { PP.busy = false; ids.forEach(i => $(i).disabled = false); }
  }
  async function ensure() {
    if (PP.bridge) return;
    const frame = $('ppFrame'); PP.bridge = new Bridge(frame);
    frame.src = 'https://www.photopea.com/#' + encodeURIComponent(JSON.stringify({ environment: { lang: 'zh', theme: 2, intro: false } }));
    status('正在加载免费 Photopea，首次加载需要联网…'); await PP.bridge.waitReady();
  }
  async function sendFont() {
    const e = api.selectedFont(); if (!e || (!e.bytes && !e.getBytes)) return false;
    await PP.bridge.call((e.bytes || await e.getBytes()).slice(0)); return true;
  }
  async function send(force = false) {
    const doc = api.doc(); if (!doc) throw new Error('请先打开或新建图片');
    PP.docId = doc.id; await ensure();
    const sig = api.signature(), old = PP.sessions.get(doc.id);
    if (old && old.sig === sig && !force) { PP.source = old.source; await PP.bridge.script(findScript(old.source)); status('已恢复该标签页在 Photopea 中的编辑状态'); return; }
    status('正在发送当前合成图与所选字体…');
    const canvas = await api.composite();
    try { await sendFont(); } catch { /* 字体传送失败不影响图片 */ }
    await PP.bridge.call(await (await canvasToBlob(canvas)).arrayBuffer());
    PP.source = doc.id + ':' + (++PP.serial);
    await PP.bridge.script(`app.activeDocument.source=${JSON.stringify(PP.source)};app.activeDocument.name=${JSON.stringify(doc.name)};`);
    PP.sessions.set(doc.id, { source: PP.source, sig });
    status('已发送。可使用 Photopea 的图层、修复和文字工具；完成后点“返回本站”。');
  }
  async function exportBytes(format) {
    if (!PP.source) throw new Error('请先发送当前图片');
    return (await PP.bridge.script(findScript(PP.source) + `app.echoToOE('GS_SOURCE:'+app.activeDocument.source);app.activeDocument.saveToOE(${JSON.stringify(format)});`, { binary: true, expected: PP.source })).buffer;
  }
  function download(bytes, name, type) { const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  async function back() {
    const doc = api.doc(); if (!doc || doc.id !== PP.docId) throw new Error('当前标签页已变化，请先切回在线编辑的标签页');
    const bytes = await exportBytes('png');
    if (!pngSignature(bytes) || bytes.byteLength > 80 * 1024 * 1024) throw new Error('返回文件格式或大小不符合 PNG 要求');
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    if (bmp.width * bmp.height > 16_000_000) throw new Error('返回图片超过 1600 万像素，请在 Photopea 中缩小图片');
    const c = cv(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
    api.replaceBase(c, 'Photopea 修改');
    PP.sessions.delete(doc.id);
    $('dlgPP').close();
  }
  function open() {
    const doc = api.doc(); if (!doc) return;
    $('dlgPP').showModal(); $('ppLabel').textContent = doc.name;
    action(() => send());
  }
  $('ppReturn').onclick = () => action(back);
  $('ppLeave').onclick = () => { if (PP.busy) return status('正在传送图片，请等本次操作完成后切回'); $('dlgPP').close(); };
  $('ppSend').onclick = () => action(() => send(true));
  $('ppFonts').onclick = () => action(async () => { if (!PP.bridge) throw new Error('在线编辑器尚未就绪'); status(await sendFont() ? '已把所选字体送入 Photopea 字体库' : '该字体没有可传送的文件（系统字体请在 Photopea 字体菜单中选择，或先导入字体文件）'); });
  for (const [id, format, ext, type] of [['ppPng', 'png', 'png', 'image/png'], ['ppPsd', 'psd:true', 'psd', 'image/vnd.adobe.photoshop']])
    $(id).onclick = () => action(async () => { const bytes = await exportBytes(format), doc = api.doc(); download(bytes, (doc?.name || 'Photopea').replace(/\.[^.]+$/, '') + '.' + ext, type); status('已导出 ' + ext.toUpperCase()); });
  $('dlgPP').addEventListener('cancel', e => { if (PP.busy) e.preventDefault(); });
  return { open };
}
