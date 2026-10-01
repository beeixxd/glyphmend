'use strict';
// v5.1: editing bounds are independent of the OCR/background-repair rectangle.
function textLayout(p){
 const ctx=cv(1,1).getContext('2d');ctx.font=`${p.weight} ${p.size}px "${p.font}"`;
 const m=ctx.measureText(p.text||'Mg'),pad=Math.ceil(Math.max(0,p.stroke)+Math.max(0,p.blur)*3+2);
 const ascent=Math.max(p.size*.8,m.actualBoundingBoxAscent||0),descent=Math.max(p.size*.25,m.actualBoundingBoxDescent||0);
 const n=S.nudge||{x:0,y:0},x=S.r.x+n.x+S.a.ink.x,y=S.r.y+n.y+S.a.ink.y;
 const layout=TextLayout.layout(p.text,{...p,ascent,descent},ch=>ctx.measureText(ch).width,Math.max(1,base.width-x-pad*2));
 return {...layout,ascent,descent,pad,x,y};
}
const originalInlineUpdate=updateInlineEditor;
updateInlineEditor=function(){originalInlineUpdate();if(!S.source)return;try{const l=textLayout(params()),z=currentZoom();inlineEditor.style.width=(l.width+l.pad*2)*z+'px';inlineEditor.style.height=(l.height+l.pad*2)*z+'px';inlineEditor.style.lineHeight=l.lineHeight*z+'px';inlineEditor.style.overflow='visible';}catch{}};
generate=async function(){
 if(!S.source)throw Error('请先选择或添加文字');
 const source=S.source,doc=WORK.active,p=params(),r={...S.r};
 await document.fonts.load(`${p.weight} ${p.size}px "${p.font}"`,p.text);
 if(source!==S.source||doc!==WORK.active)throw Error('编辑对象已切换，请重试');
 const l=textLayout(p),ink=cv(Math.ceil(l.width+l.pad*2),Math.ceil(l.height+l.pad*2)),ix=ink.getContext('2d');
 if(ink.width*ink.height>16000000)throw Error('文字区域超过安全内存上限，请降低字号或分层编辑');
 ix.font=`${p.weight} ${p.size}px "${p.font}"`;ix.fillStyle=ix.strokeStyle=p.color;ix.lineWidth=Math.max(0,p.stroke)*2;
 ix.globalAlpha=Math.max(0,Math.min(1,p.opacity));if(p.blur>0)ix.filter=`blur(${p.blur}px)`;
 for(const [i,line] of l.lines.entries())for(const c of line.chars){
  const x=l.pad+c.x,y=l.pad+l.ascent+i*l.lineHeight;
  if($('render').value==='glyph'){
   const s=(source.symbols||[]).find(s=>s.text===c.ch);if(c.ch===' ')continue;
   if(!s)throw Error(`图片这一行没有「${c.ch}」字形，请切换字体重绘`);
   const b=s.b,g=cv(Math.ceil(b.w+2),Math.ceil(b.h+2)),gc=g.getContext('2d');gc.drawImage(S.a.mask,b.x-r.x-1,b.y-r.y-1,b.w+2,b.h+2,0,0,g.width,g.height);gc.globalCompositeOperation='source-in';gc.fillStyle=p.color;gc.fillRect(0,0,g.width,g.height);ix.drawImage(g,x,y-b.h);
  }else{if(p.stroke>0)ix.strokeText(c.ch,x,y);ix.fillText(c.ch,x,y);}
 }
 const angle=p.angle*Math.PI/180,co=Math.abs(Math.cos(angle)),si=Math.abs(Math.sin(angle));
 const w=Math.ceil(ink.width*co+ink.height*si),h=Math.ceil(ink.width*si+ink.height*co);
 const tx=Math.floor(l.x-l.pad+(ink.width-w)/2),ty=Math.floor(l.y-l.pad+(ink.height-h)/2);
 const area={x:Math.min(0,r.x,tx),y:Math.min(0,r.y,ty)};
 area.w=Math.max(base.width,r.x+r.w,tx+w)-area.x;area.h=Math.max(base.height,r.y+r.h,ty+h)-area.y;
 if(area.w*area.h>32000000)throw Error('扩展画布超过 3200 万像素安全上限');
 const c=cv(area.w,area.h),ctx=c.getContext('2d');ctx.drawImage(base,-area.x,-area.y);
 if(!(p.text===source.text&&$('render').value==='auto'&&automaticStyle(p)&&!(S.nudge?.x||S.nudge?.y))){
  const clean=await cleanBackground(p);if(source!==S.source||doc!==WORK.active)throw Error('编辑对象已切换');
  ctx.clearRect(r.x-area.x,r.y-area.y,r.w,r.h);ctx.drawImage(clean,r.x-area.x,r.y-area.y);
  ctx.save();ctx.translate(tx-area.x+w/2,ty-area.y+h/2);ctx.rotate(angle);ctx.drawImage(ink,-ink.width/2,-ink.height/2);ctx.restore();
 }
 return {patch:c,r:area,layout:l};
};
const oldCompare=updateCompare;
updateCompare=function(compare=false){oldCompare(compare);originalCanvas.width=base.width;originalCanvas.height=base.height;originalCanvas.getContext('2d').drawImage(original,0,0);if(!compare&&S.preview){screen.width=S.preview.patch.width;screen.height=S.preview.patch.height;screen.getContext('2d').drawImage(S.preview.patch,0,0);const z=currentZoom();$('previewPane').style.width=screen.width*z+'px';$('previewPane').style.height=screen.height*z+'px';$('previewMeta').textContent=`实时预览 ${screen.width} × ${screen.height} · 超出高度自动扩展画布`;}};
snapshot=function(){if(!S.loaded)return;S.history.push({whole:true,data:base.getContext('2d').getImageData(0,0,base.width,base.height)});S.redo=[];while(S.history.length>10)S.history.shift();};
apply=async function(){const v=await generate();snapshot();base.width=v.patch.width;base.height=v.patch.height;base.getContext('2d').drawImage(v.patch,0,0);S.preview=null;clearSelection();markChanged();refreshWorkspace();msg('已应用；长文本自动换行，超出高度已扩展画布。');};
// Generate even while the preview button holds the action lock; never commit stale async results.
let previewSerial=0;
livePreview=async function(){if(!S.source)return;const serial=++previewSerial,source=S.source,doc=WORK.active;try{const v=await generate();if(serial!==previewSerial||source!==S.source||doc!==WORK.active)return;S.preview=v;paint();}catch(e){if(serial===previewSerial){S.preview=null;paint();msg(e.message,true);}}};
for(const id of ['repair','render'])$(id).addEventListener('input',()=>{clearTimeout(window.__pv);window.__pv=setTimeout(livePreview,180);});
$('export').onclick=async()=>{try{const v=S.source?await generate():null;const c=v?v.patch:base;c.toBlob(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='text-studio-result.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},'image/png');}catch(e){msg(e.message,true);}};
// OCR auto mode is one reusable bilingual model, not nine serial downloads.
pickLanguage=async function(){const selected=$('language').value;const lang=selected==='auto'?'eng+chi_sim':selected;S.detectedLang=lang;$('langhint').textContent=selected==='auto'?'快速默认：简体中文 / 英语；其他语言请手动选择（不是语种检测结果）。':`识别语言：${$('language').selectedOptions[0].textContent}`;return lang;};
let ocrQueue=Promise.resolve();
function queueOCR(doc){
 const source=cv(doc.base.width,doc.base.height);source.getContext('2d').drawImage(doc.base,0,0);
 const lang=$('language').value==='auto'?'eng+chi_sim':$('language').value,endpoint=$('ocrendpoint').value.trim(),online=$('ocrprovider').value==='online',version=doc.version;
 ocrQueue=ocrQueue.catch(()=>{}).then(async()=>{
  try{
   let lines;
   if(online){
    if(!endpoint)throw Error('请填写已授权的 OCR 接口地址');
    const url=new URL(endpoint,location.href);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('联网 OCR 须使用 HTTPS 或本机服务');
    const blob=await new Promise(ok=>source.toBlob(ok,'image/png')),body=new FormData();body.append('image',blob,'image.png');body.append('language',lang);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);let result;
    try{const response=await fetch(url,{method:'POST',body,credentials:'omit',signal:controller.signal});if(!response.ok)throw Error('OCR HTTP '+response.status);result=await response.json();}finally{clearTimeout(timer);}
    if(!Array.isArray(result.lines))throw Error('OCR 响应须包含 lines 数组');
    lines=result.lines.map(line=>{const r=line.r;if(!r||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<3||r.h<3||r.x+r.w>source.width||r.y+r.h>source.height)throw Error('OCR 坐标无效');return {text:String(line.text||''),r:{...r},symbols:[],confidence:Number(line.confidence)||0,leading:r.h*1.2};});
   }else{
    const w=await worker(lang);await w.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});const {data}=await w.recognize(source,{}, {blocks:true});
    // parse depends on active base bounds; postpone applying if the user changed tabs.
    if(WORK.active!==doc.id){if(WORK.documents.includes(doc)&&doc.version===version)doc.pendingOCR={data,version};return;}lines=parse(data);
   }
   if(!WORK.documents.includes(doc)||doc.version!==version)return;
   doc.state.lines=lines;if(WORK.active===doc.id){S.lines=lines;list();boxes();msg(`后台 OCR 完成：${lines.length} 行，图片编辑未被锁定。`);}
  }catch(e){if(WORK.active===doc.id)msg('图片可继续编辑；OCR 未完成：'+e.message,true);}
 });return ocrQueue;
}
load=async function(file){if(!file)return;if(file.size>25*1024*1024)throw Error('图片上限 25 MB');const url=URL.createObjectURL(file);try{const im=await decodeImage(url);if(im.width*im.height>16000000)throw Error('图片上限 1600 万像素');const image=cv(im.width,im.height);image.getContext('2d').drawImage(im,0,0);const doc=attachDocument(image,file.name);msg('图片已打开，可立即编辑；OCR 在后台执行。');queueOCR(doc);}finally{URL.revokeObjectURL(url);}};
$('detect').onclick=()=>{if(S.loaded)queueOCR(currentDocument());};
const originalSwitch=switchDocument;
switchDocument=function(id,internal=false){originalSwitch(id,internal);const doc=currentDocument();if(doc?.pendingOCR){if(doc.pendingOCR.version===doc.version)S.lines=parse(doc.pendingOCR.data);delete doc.pendingOCR;list();boxes();}};
// Correct per-document undo/redo stacks and dimension changes.
const undoButton=$('undo');undoButton.onclick=()=>{if(S.busy)return;const h=S.history.pop();if(!h)return;S.redo??=[];S.redo.push({whole:true,data:base.getContext('2d').getImageData(0,0,base.width,base.height)});if(h.whole){base.width=h.data.width;base.height=h.data.height;base.getContext('2d').putImageData(h.data,0,0);}else restoreSnapshot(h);clearSelection();refreshWorkspace();markChanged();};
function redoImage(){const h=S.redo?.pop();if(!h||S.busy)return;S.history.push({whole:true,data:base.getContext('2d').getImageData(0,0,base.width,base.height)});base.width=h.data.width;base.height=h.data.height;base.getContext('2d').putImageData(h.data,0,0);clearSelection();refreshWorkspace();markChanged();}
$('redo').onclick=redoImage;
window.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z'||/INPUT|TEXTAREA/.test(document.activeElement.tagName))return;e.preventDefault();if(e.shiftKey)redoImage();else undoButton.click();});
$('originalPane').addEventListener('dblclick',e=>{if(S.busy||!S.loaded||e.target===inlineEditor)return;const b=$('originalPane').getBoundingClientRect();S.r={x:Math.max(0,Math.min(base.width-3,(e.clientX-b.left)/b.width*base.width)),y:Math.max(0,Math.min(base.height-3,(e.clientY-b.top)/b.height*base.height)),w:3,h:3};manualText();});
const regionRecognize=recognize;
recognize=async function(r){await ocrQueue;return regionRecognize(r);};

