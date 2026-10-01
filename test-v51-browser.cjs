const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8787');
const result=await page.evaluate(async()=>{
 const results=[],assert=(v,t)=>{if(!v)throw Error(t);results.push(t)};
 attachDocument(cv(320,100),'test');manualText();$('text').value='1234567890 '.repeat(30);$('spacing').value=18;$('size').value=32;$('leading').value=40;const v=await generate();assert(v.patch.height>100,'long text expands canvas height');assert(v.layout.lines.flatMap(l=>l.chars).length===330,'all characters retained');assert(v.layout.lines.length>1,'wide spacing wraps');
 await livePreview();assert(screen.height===S.preview.patch.height,'preview uses full expanded raster');
 await apply();const height=base.height;assert(height>100&&S.history.length===1,'apply snapshot and dimensions');$('undo').click();assert(base.height===100,'undo restores canvas dimensions');$('redo').click();assert(base.height===height,'redo restores expanded image');
 manualText();$('text').value='2026';$('spacing').value=25;$('size').value=80;$('angle').value=45;assert((await generate()).patch.width>=base.width,'rotation does not clip raster');
 // Worker fixture is deliberately delayed: opening a file must return first.
 let release;window.Tesseract={createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{},recognize:()=>new Promise(ok=>release=()=>ok({data:{blocks:[]}}))})};S.worker=null;
 const file=await new Promise(ok=>cv(100,60).toBlob(b=>ok(new File([b],'fast.png'))));await load(file);assert(base.width===100,'image shown before OCR resolves');await new Promise(ok=>setTimeout(ok,50));assert(typeof release==='function','OCR running in background');manualText();assert(S.source.manual,'editing available while OCR running');release();await ocrQueue;
 return results;
});console.log(result);if(errors.length)throw Error(errors.join('\n'));await browser.close();})().catch(e=>{console.error(e);process.exit(1)});

