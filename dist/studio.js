'use strict';
const $=id=>document.getElementById(id),cv=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
let base=cv(1,1),original=cv(1,1);const screen=$('image'),svg=$('boxes'),originalCanvas=$('originalView'),inlineEditor=$('inlineEditor');
const S={loaded:false,busy:false,lines:[],r:null,source:null,a:null,match:null,preview:null,history:[],mode:'click',worker:null,lang:null,serial:0,detectedLang:null};
const LANG_LABELS={auto:'自动识别语种','eng+chi_sim':'简体中文 + 英文','eng+chi_tra':'繁体中文 + 英文','eng':'英文 / 数字','eng+jpn':'日文 + 英文','eng+kor':'韩文 + 英文','eng+spa':'西班牙语 + 英文','eng+por':'葡萄牙语 + 英文','eng+fra':'法语 + 英文','eng+deu':'德语 + 英文','eng+ita':'意大利语 + 英文','eng+vie':'越南语 + 英文','eng+rus':'俄语 + 英文','eng+tha':'泰语 + 英文'};
const AUTO_LANGS=['eng+chi_sim','eng+chi_tra','eng+jpn','eng+kor','eng','eng+spa','eng+por','eng+rus','eng+tha'];
function langLabel(code){return LANG_LABELS[code]||code;}
function addFont(value,name=value){if(![...$('font').options].some(o=>o.value===value))$('font').add(new Option(name,value));}
['Microsoft YaHei','Microsoft JhengHei','SimSun','SimHei','DengXian','KaiTi','FangSong','Arial','Arial Black','Verdana','Tahoma','Helvetica','Times New Roman','Georgia','Courier New','Trebuchet MS','sans-serif','serif','monospace'].forEach(f=>addFont(f));
function msg(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function lock(v){S.busy=v;document.querySelectorAll('button').forEach(b=>b.disabled=v);$('controls').disabled=v||!S.source;for(const id of ['detect','select','export','original','clickmode'])$(id).disabled=v||!S.loaded;$('undo').disabled=v||!S.history.length;}
async function run(fn){if(S.busy)return;lock(true);try{await fn();}catch(e){msg(e.message,true);}finally{lock(false);}}
function currentZoom(){if(!S.loaded)return 1;const v=$('viewport');const gap=24;return $('zoom').value==='fit'?Math.max(.02,Math.min(Math.max(220,(v.clientWidth-90-gap)/2)/base.width,Math.max(220,v.clientHeight-90)/base.height,1)):Number($('zoom').value);} 
function updateCompare(compare=false){
 if(!S.loaded)return;
 originalCanvas.width=original.width;originalCanvas.height=original.height;
 screen.width=base.width;screen.height=base.height;
 const octx=originalCanvas.getContext('2d');
 octx.clearRect(0,0,originalCanvas.width,originalCanvas.height);
 octx.drawImage(original,0,0);
 const pctx=screen.getContext('2d');
 pctx.clearRect(0,0,screen.width,screen.height);
 pctx.drawImage(compare?original:base,0,0);
 if(S.preview&&!compare)pctx.drawImage(S.preview.patch,S.preview.r.x,S.preview.r.y);
 $('originalMeta').textContent=`${original.width} × ${original.height}`;
 $('previewMeta').textContent=S.preview?'实时预览已更新':`${base.width} × ${base.height}`;
}
function updateInlineEditor(){
 if(!S.loaded||!S.source||!S.r){inlineEditor.hidden=true;return;}
 const z=currentZoom(),n=S.nudge||{x:0,y:0},x=(S.r.x+n.x)*z,y=(S.r.y+n.y)*z,w=Math.max(24,S.r.w*z),h=Math.max(24,S.r.h*z);
 inlineEditor.hidden=false;
 inlineEditor.style.left=x+'px';inlineEditor.style.top=y+'px';inlineEditor.style.width=w+'px';inlineEditor.style.height=h+'px';
 inlineEditor.style.fontFamily=`${$('font').value||'sans-serif'}`;
 inlineEditor.style.fontSize=(Math.max(10,(Number($('size').value)||16)*z))+'px';
 inlineEditor.style.fontWeight=$('weight').value||'400';
 inlineEditor.style.lineHeight=Math.max(1,((Number($('leading').value)||20)/(Number($('size').value)||16))).toFixed(2);
 inlineEditor.style.letterSpacing=((Number($('spacing').value)||0)*z)+'px';
 inlineEditor.style.color=$('color').value||'#f3f1ff';
 inlineEditor.value=$('text').value;
 }
function paint(compare=false){if(!S.loaded)return;updateCompare(compare);boxes();updateInlineEditor();}
function resize(){if(!S.loaded)return;const z=currentZoom();for(const id of ['originalPane','previewPane']){const el=$(id);if(el){el.style.width=base.width*z+'px';el.style.height=base.height*z+'px';}}$('compareStage').style.minWidth=(base.width*z*2+24)+'px';updateInlineEditor();}
function rect(r){const a={x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),w:Math.round(r.w),h:Math.round(r.h)};a.w=Math.min(a.w,base.width-a.x);a.h=Math.min(a.h,base.height-a.y);if(!Object.values(a).every(Number.isFinite)||a.w<3||a.h<3)throw Error('请选择至少 3 × 3 像素的区域');return a;}
function boxes(){svg.replaceChildren();function box(r,cls,fn){const p=document.createElementNS(svg.namespaceURI,'rect');for(const [k,v] of Object.entries({x:r.x,y:r.y,width:r.w,height:r.h}))p.setAttribute(k,v);p.classList.add(cls);if(fn)p.onpointerdown=fn;svg.append(p);}S.lines.forEach(line=>box(line.r,'text-box',e=>{if(S.mode==='click'&&!S.busy){e.stopPropagation();run(()=>choose(line));}}));if(S.r){const n=S.nudge||{x:0,y:0},r={...S.r,x:S.r.x+n.x,y:S.r.y+n.y};box(r,'selection');if(S.source&&S.mode==='click')box(r,'move-hit',beginTextDrag);}}
function list(){const root=$('blocks');root.replaceChildren();S.lines.forEach(line=>{const b=document.createElement('button');b.className='block';b.textContent=line.text;const s=document.createElement('small');s.textContent=`OCR ${Math.round(line.confidence||0)} / 100 · 点击编辑`;b.append(s);b.onclick=()=>run(()=>choose(line));root.append(b);});if(!S.lines.length)root.textContent='识别后可直接点击文字行；也可框选一行自动识别。';}
async function load(file){
 if(!file)return;if(file.size>25*1024*1024)throw Error('图片上限 25 MB');
 const url=URL.createObjectURL(file);try{const im=await decodeImage(url);if(im.width*im.height>16000000)throw Error('图片上限 1600 万像素');
 const image=cv(im.width,im.height);image.getContext('2d').drawImage(im,0,0);attachDocument(image,file.name||'未命名图片');
 $('langhint').textContent='默认会智能识别语种；识别不准时可手动切换后重新识别。';try{await detect();}catch(e){msg('图片已打开。'+e.message+'；可使用添加文字或在线 Photopea。',true);}
 }finally{URL.revokeObjectURL(url);}
}
function script(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>{s.remove();no(Error('OCR 引擎下载失败，请联网重试或运行install-assets.ps1'));};document.head.append(s);});}
function downsampleCanvas(source,maxEdge=1280){const scale=Math.min(1,maxEdge/Math.max(source.width,source.height));if(scale===1)return source;const c=cv(Math.max(1,Math.round(source.width*scale)),Math.max(1,Math.round(source.height*scale)));c.getContext('2d').drawImage(source,0,0,c.width,c.height);return c;}
async function worker(langOverride){const lang=langOverride||S.detectedLang||($('language').value==='auto'?'eng':$('language').value);if(S.worker&&S.lang===lang)return S.worker;if(S.worker){await S.worker.terminate();S.worker=null;}if(!window.Tesseract){try{await script('vendor/tesseract.min.js');}catch{await script('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js');}}let local=false;try{const r=await fetch('vendor/ready.json');local=r.ok&&(await r.json()).ready===true;}catch{}const options={logger:m=>msg(`本地 OCR · ${m.status} ${Math.round((m.progress||0)*100)}%`)};if(local)Object.assign(options,{workerPath:'vendor/worker.min.js',corePath:'vendor/core',langPath:'vendor/lang'});try{S.worker=await Tesseract.createWorker(lang,1,options);S.lang=lang;return S.worker;}catch(e){throw Error('OCR 初始化失败，需要首次下载免费引擎与模型。'+e.message);}}
async function pickLanguage(sourceCanvas){const selected=$('language').value;if(selected!=='auto'){S.detectedLang=selected;$('langhint').textContent=`当前语言：${langLabel(selected)}。如识别不准，可切换后重新识别。`;return selected;}const sample=downsampleCanvas(sourceCanvas,960);let best={lang:'eng',score:-1};msg('正在智能识别语种…');for(const lang of AUTO_LANGS){const w=await worker(lang);await w.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});const {data}=await w.recognize(sample,{}, {blocks:true});const text=(data.text||'').trim();const useful=text.replace(/\s/g,'').length;const nonLatin=(text.match(/[^\u0000-\u00ff]/g)||[]).length;const confidence=Number(data.confidence)||0;const score=useful*2+nonLatin*1.4+confidence/8;if(score>best.score)best={lang,score};}S.detectedLang=best.lang;$('langhint').textContent=`已智能识别：${langLabel(best.lang)}。如不准确，可手动切换语言后重新识别。`;msg(`已智能识别语种：${langLabel(best.lang)}。如不准确，可手动切换语言后重新识别。`);return best.lang;}
function parse(data,offset={x:0,y:0},scale=1){
 const lines=[];let group=0;
 for(const block of data.blocks||[])for(const para of block.paragraphs||[]){const members=[];
 for(const line of para.lines||[]){const text=(line.text||'').trim();if(!text)continue;const b=line.bbox,r=rect({x:offset.x+b.x0/scale-4,y:offset.y+b.y0/scale-4,w:(b.x1-b.x0)/scale+8,h:(b.y1-b.y0)/scale+8});
 const symbols=(line.words||[]).flatMap(w=>w.symbols||[]).map(s=>({text:s.text,b:{x:offset.x+s.bbox.x0/scale,y:offset.y+s.bbox.y0/scale,w:(s.bbox.x1-s.bbox.x0)/scale,h:(s.bbox.y1-s.bbox.y0)/scale}}));
 const item={text,r,confidence:line.confidence,symbols,group,rawHeight:(b.y1-b.y0)/scale,rawY:offset.y+b.y0/scale};members.push(item);lines.push(item);}
 const gaps=members.slice(1).map((line,i)=>line.rawY-members[i].rawY).filter(v=>v>0);const leading=gaps.length?median(gaps):0;for(const line of members)line.leading=leading||Math.max(12,line.rawHeight*1.35);group++;
 }return lines;
}
async function detect(){const lang=await pickLanguage(base);const w=await worker(lang);await w.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});const {data}=await w.recognize(base,{}, {blocks:true});S.lines=parse(data);list();paint();msg(S.lines.length?`识别到 ${S.lines.length} 行，当前语种：${langLabel(lang)}。点击文字或框选即可修改。`:'未识别到文字，请框选一行重试，或切换识别语言。',!S.lines.length);}
async function recognize(r){
 Object.assign(S,{r,source:null,a:null,match:null,preview:null});$('old').value=$('text').value='';paint();
 const scale=Math.min(3,Math.max(1,80/r.h)),c=cv(Math.round(r.w*scale),Math.round(r.h*scale));c.getContext('2d').drawImage(base,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
 const lang=await pickLanguage(c);const w=await worker(lang);await w.setParameters({tessedit_pageseg_mode:$('ocrmode').value,preserve_interword_spaces:'1'});const {data}=await w.recognize(c,{}, {blocks:true});const lines=parse(data,r,scale);
 if(!lines.length)throw Error('未识别到文字。可重新框选，或点添加文字 / 在线 Photopea 修改。');
 if(lines.length===1){lines[0].r=r;await choose(lines[0]);}else{const gaps=lines.slice(1).map((l,i)=>l.rawY-lines[i].rawY).filter(n=>n>0);await choose({text:lines.map(l=>l.text).join('\n'),r,confidence:lines.reduce((n,l)=>n+l.confidence,0)/lines.length,symbols:lines.flatMap(l=>l.symbols),lines,leading:gaps.length?median(gaps):lines[0].leading,rawHeight:median(lines.map(l=>l.rawHeight))});}
}
async function choose(line){S.r={...line.r};S.source=line;S.nudge={x:0,y:0};S.cleanCache=null;showNudge();S.preview=null;S.match=null;$('old').value=$('text').value=line.text;for(const k of ['x','y','w','h'])$(k).value=S.r[k];$('leading').value=(line.leading||Math.max(12,line.r.h*1.2)).toFixed(2);$('angle').value=0;$('stroke').value=0;$('blur').value=0;$('opacity').value=1;try{S.a=analyze(S.r);}catch(e){S.source=null;throw Error(e.message+'；可使用添加文字或在线 Photopea。');}$('color').value=S.a.fg;$('bgcolor').value=S.a.bg;await match();paint();syncInlineEditorFromForm();msg(`原文已自动填入：${line.text}。只需输入替换内容。`);}
function point(e){const b=svg.getBoundingClientRect();return {x:(e.clientX-b.left)/b.width*base.width,y:(e.clientY-b.top)/b.height*base.height};}
svg.onpointerdown=e=>{if(!S.loaded||S.busy||S.mode!=='box')return;e.preventDefault();svg.setPointerCapture(e.pointerId);const a=point(e);Object.assign(S,{source:null,match:null,preview:null});const move=e=>{const b=point(e);S.r={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};boxes();};const clean=()=>{svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',end);svg.removeEventListener('pointercancel',cancel);};const end=()=>{clean();try{const r=rect(S.r);run(()=>recognize(r));}catch(e){S.r=null;paint();msg(e.message,true);}};const cancel=()=>{clean();S.r=null;paint();};svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',cancel);};
function mode(m){S.mode=m;document.body.classList.toggle('manual',m==='box');$('select').classList.toggle('primary',m==='box');$('clickmode').classList.toggle('primary',m==='click');msg(m==='box'?'拖动框选一行，松开后自动识别原文。':'点击图片上的文字框，自动带入原文与样式。');}
function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;}
function hex(a){return '#'+a.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');}
function analyze(r){if(r.w*r.h>1500000)throw Error('请缩小到一行文字再匹配');const im=base.getContext('2d').getImageData(r.x,r.y,r.w,r.h),edge=[[],[],[]];for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)if(x<2||y<2||x>=r.w-2||y>=r.h-2){const i=(y*r.w+x)*4;for(let c=0;c<3;c++)edge[c].push(im.data[i+c]);}const bg=edge.map(median),strong=[[],[],[]];let max=0;for(let i=0;i<im.data.length;i+=4)max=Math.max(max,Math.hypot(...bg.map((v,c)=>im.data[i+c]-v)));for(let i=0;i<im.data.length;i+=4)if(Math.hypot(...bg.map((v,c)=>im.data[i+c]-v))>max*.72)for(let c=0;c<3;c++)strong[c].push(im.data[i+c]);if(max<20||!strong[0].length)throw Error('文字与背景对比不足，无法可靠匹配');const fg=strong.map(median),d=fg.map((v,c)=>v-bg[c]),den=d.reduce((n,v)=>n+v*v,0),mask=cv(r.w,r.h),ctx=mask.getContext('2d'),out=ctx.createImageData(r.w,r.h);let x0=r.w,y0=r.h,x1=0,y1=0;for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const i=(y*r.w+x)*4,a=Math.max(0,Math.min(1,d.reduce((n,v,c)=>n+(im.data[i+c]-bg[c])*v,0)/den));out.data[i+3]=a*255;if(a>.22){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}ctx.putImageData(out,0,0);if(x1<=x0||y1<=y0)throw Error('未检测到可匹配字形');return {mask,fg:hex(fg),bg:hex(bg),ink:{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}};}
function metrics(font,text,size,weight){const ctx=cv(1,1).getContext('2d');ctx.font=`${weight} ${size}px "${font}"`;const lines=text.split('\n'),m=ctx.measureText(lines[0]||'M');return {width:Math.max(0,...lines.map(l=>Array.from(l).reduce((n,ch)=>n+ctx.measureText(ch).width,0))),ascent:m.actualBoundingBoxAscent??size*.8,descent:m.actualBoundingBoxDescent??size*.2,left:m.actualBoundingBoxLeft||0};}
function raster(p,text=p.text,color=p.color){const c=cv(S.r.w,S.r.h),ctx=c.getContext('2d'),m=metrics(p.font,S.source.text,p.size,p.weight);ctx.font=`${p.weight} ${p.size}px "${p.font}"`;ctx.fillStyle=ctx.strokeStyle=color;ctx.lineWidth=p.stroke*2||0;const leading=p.leading||+$('leading').value||p.size*1.2;for(const [i,line] of text.split('\n').entries()){let x=S.a.ink.x+m.left;for(const ch of line){const y=S.a.ink.y+m.ascent+i*leading;if(p.stroke)ctx.strokeText(ch,x,y);ctx.fillText(ch,x,y);x+=ctx.measureText(ch).width+p.spacing;}}return c;}
async function match(){if(!S.source)throw Error('请先点击文字或框选识别');const a=S.a,text=S.source.text,first=text.split('\n')[0],target=cv(180,60),tc=target.getContext('2d');tc.drawImage(a.mask,0,0,180,60);const pixels=tc.getImageData(0,0,180,60).data,results=[];let count=0;for(const o of $('font').options){if(!await available(o.value))continue;for(const weight of candidateWeights(o.value)){const m=metrics(o.value,first,100,weight),size=(S.source.lines?S.source.rawHeight:a.ink.h)/(m.ascent+m.descent)*100,mm=metrics(o.value,first,size,weight),spacing=Array.from(first).length>1?((S.source.lines?S.source.lines[0].r.w-8:a.ink.w)-mm.width)/(Array.from(first).length-1):0;if(spacing< -size*.18||spacing>size*.5)continue;const p={font:o.value,name:o.textContent,size,weight,spacing,leading:+$('leading').value,color:'#000000',stroke:0};tc.clearRect(0,0,180,60);tc.drawImage(raster(p,text),0,0,180,60);const q=tc.getImageData(0,0,180,60).data;let sum=0,union=0;for(let i=3;i<q.length;i+=4){sum+=Math.abs(pixels[i]-q[i]);union+=Math.max(pixels[i],q[i]);}p.error=sum/Math.max(1,union);results.push(p);}if(++count%10===0){msg(`比较字体 ${count}/${$('font').options.length}…`);await new Promise(requestAnimationFrame);}}results.sort((x,y)=>x.error-y.error);S.candidates=results.slice(0,5);if(!results.length)throw Error('没有可用字体，请读取本机字体或导入原字体');setMatch(results[0]);const root=$('candidates');root.replaceChildren();for(const c of results.slice(0,5)){const b=document.createElement('button');b.type='button';b.textContent=`${c.name} · ${c.weight} · 差异 ${Math.round(c.error*100)}%`;b.onclick=()=>setMatch(c);root.append(b);}}
function setMatch(p){S.match=p;S.preview=null;if(![...$('weight').options].some(o=>Number(o.value)===p.weight))$('weight').add(new Option('字重 '+p.weight,p.weight));$('font').value=p.font;$('size').value=p.size.toFixed(2);$('weight').value=p.weight;$('spacing').value=p.spacing.toFixed(2);$('matchnote').textContent=`形状差异 ${Math.round(p.error*100)}%（越低越接近，不是字体识别置信度）。字号已锁定，替换时不会自动缩小。`;comparison();paint();}
function comparison(){if(!S.a||!S.match)return;const c=$('comparison'),ctx=c.getContext('2d');c.width=S.r.w;c.height=S.r.h;ctx.drawImage(S.a.mask,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle='#58dce4';ctx.fillRect(0,0,c.width,c.height);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.6;ctx.drawImage(raster(params(),S.source.text,'#ff77b9'),0,0);ctx.globalAlpha=1;}
function params(){const p={text:$('text').value,font:$('font').value,color:$('color').value,bg:$('bgcolor').value,repair:$('repair').value};for(const k of ['size','weight','spacing','leading','stroke','blur','angle','opacity','dx','dy']){p[k]=Number($(k).value);if(!Number.isFinite(p[k]))throw Error('参数必须为数字');}if(p.leading<1||p.leading>2000)throw Error('行距须在 1–2000 原图像素范围内');if(p.size<=0||p.size>1000)throw Error('请先匹配字体，字号需大于 0 且不超过 1000');if(p.text.length>2000||/\r/.test(p.text))throw Error('最多 2000 字，请使用换行符分行');return p;}
function glyphLayout(text,spacing,size){if(text.includes('\n'))throw Error('多行修改请使用字体重绘；原字形复用当前只支持单行');if(!S.source.symbols.length)throw Error('OCR 未提供原字符边界，请使用字体重绘');let x=S.a.ink.x;const items=[];for(const ch of text){if(ch===' '){x+=size*.3;continue;}const s=S.source.symbols.find(s=>s.text===ch);if(!s)throw Error(`图片这一行没有「${ch}」字形，请切换字体重绘并核对效果`);const b=s.b,sx=Math.max(0,Math.floor(b.x-S.r.x-1)),sy=Math.max(0,Math.floor(b.y-S.r.y-1)),w=Math.min(S.r.w-sx,Math.ceil(b.w+2)),h=Math.min(S.r.h-sy,Math.ceil(b.h+2));items.push({sx,sy,w,h,x});x+=w-2+spacing;}if(x>S.r.w)throw Error('原字形排列超出选区，请扩大选区或缩短内容');return items;}
async function cleanBackground(p){
 const key=JSON.stringify([p.repair,p.bg,p.dx,p.dy]);
 if(S.cleanCache?.source===S.source&&S.cleanCache.key===key)return S.cleanCache.canvas;
 const r=S.r,c=cv(r.w,r.h),ctx=c.getContext('2d');ctx.drawImage(base,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
 if(p.repair==='solid'){ctx.clearRect(0,0,r.w,r.h);ctx.fillStyle=p.bg;ctx.fillRect(0,0,r.w,r.h);}
 else if(p.repair==='diffuse')ctx.putImageData(await repairAsync(ctx.getImageData(0,0,r.w,r.h)),0,0);
 else if(p.repair==='clone'){const x=r.x+p.dx,y=r.y+p.dy;if(x<0||y<0||x+r.w>base.width||y+r.h>base.height)throw Error('复制来源超出图像');ctx.clearRect(0,0,r.w,r.h);ctx.drawImage(base,x,y,r.w,r.h,0,0,r.w,r.h);}
 S.cleanCache={source:S.source,key,canvas:c};return c;
}
async function generate(){
 if(!S.source)throw Error('请先自动识别原文');
 const p=params();if(document.fonts.load)await document.fonts.load(`${p.weight} ${p.size}px "${p.font}"`,p.text.replace(/\n/g,' '));const r=S.r,n=S.nudge||{x:0,y:0};
 if(r.x+n.x<0||r.y+n.y<0||r.x+n.x+r.w>base.width||r.y+n.y+r.h>base.height)throw Error('文字移动到图片边界，已停止本次移动');
 const x=Math.min(r.x,r.x+n.x),y=Math.min(r.y,r.y+n.y),area={x,y,w:r.w+Math.abs(n.x),h:r.h+Math.abs(n.y)},c=cv(area.w,area.h),ctx=c.getContext('2d');
 ctx.drawImage(base,area.x,area.y,area.w,area.h,0,0,area.w,area.h);
 if(p.text===S.source.text&&$('render').value==='auto'&&!n.x&&!n.y&&automaticStyle(p))return {patch:c,r:area};
 const use=$('render').value==='glyph',items=use?glyphLayout(p.text,p.spacing,p.size):null;
 if(!use){const m=metrics(p.font,p.text,p.size,p.weight),width=Math.max(...p.text.split('\n').map(l=>metrics(p.font,l,p.size,p.weight).width+Math.max(0,Array.from(l).length-1)*p.spacing));if(width+S.a.ink.x>r.w)throw Error('替换内容超出选区。为保持字号，系统不会自动缩小；请扩大选区或缩短内容。');}
 const last=p.text.split('\n').at(-1)||'M',lastMetrics=metrics(p.font,last,p.size,p.weight),sourceMetrics=metrics(p.font,S.source.text,p.size,p.weight);if(S.a.ink.y+sourceMetrics.ascent+(p.text.split('\n').length-1)*p.leading+lastMetrics.descent>r.h)throw Error('文字高度超出选区，请扩大选区或调整行距');const clean=await cleanBackground(p);ctx.clearRect(r.x-area.x,r.y-area.y,r.w,r.h);ctx.drawImage(clean,r.x-area.x,r.y-area.y);
 const ink=cv(r.w,r.h),ix=ink.getContext('2d');
 if(use){for(const b of items){const g=cv(b.w,b.h),gc=g.getContext('2d');gc.drawImage(S.a.mask,b.sx,b.sy,b.w,b.h,0,0,b.w,b.h);gc.globalCompositeOperation='source-in';gc.fillStyle=S.a.fg;gc.fillRect(0,0,b.w,b.h);ix.drawImage(g,b.x,b.sy);}}
 else{ix.save();ix.globalAlpha=Math.max(0,Math.min(1,p.opacity));if(p.blur)ix.filter=`blur(${Math.max(0,p.blur)}px)`;ix.translate(r.w/2,r.h/2);ix.rotate(p.angle*Math.PI/180);ix.drawImage(raster(p),-r.w/2,-r.h/2);ix.restore();}
 ctx.drawImage(ink,r.x+n.x-area.x,r.y+n.y-area.y);return {patch:c,r:area};
}
async function apply(){const v=await generate();S.history.push({r:{...v.r},data:base.getContext('2d').getImageData(v.r.x,v.r.y,v.r.w,v.r.h)});while(S.history.length>10||S.history.length>1&&S.history.reduce((n,h)=>n+h.data.data.byteLength,0)>64000000)S.history.shift();const ctx=base.getContext('2d');ctx.clearRect(v.r.x,v.r.y,v.r.w,v.r.h);ctx.drawImage(v.patch,v.r.x,v.r.y);markChanged();clearSelection();msg('已应用。继续修改请重新识别，或框选下一行。');}
function clearSelection(){Object.assign(S,{lines:[],source:null,r:null,a:null,match:null,preview:null});inlineEditor.hidden=true;list();paint();}
$('upload').onclick=$('start').onclick=()=>$('file').click();$('file').onchange=()=>{const f=$('file').files[0];$('file').value='';run(()=>load(f));};$('detect').onclick=()=>run(detect);$('select').onclick=()=>mode('box');$('clickmode').onclick=()=>mode('click');$('estimate').onclick=()=>run(match);async function livePreview(){if(!S.source||S.busy)return;try{S.preview=await generate();paint();$('previewMeta').textContent='实时预览已更新';}catch(e){S.preview=null;paint();$('previewMeta').textContent='预览失败';msg(e.message,true);}}
$('preview').onclick=()=>run(async()=>{await livePreview();msg('实时预览已生成，修改参数会自动同步。');});
$('language').addEventListener('change',()=>{S.detectedLang=$('language').value==='auto'?null:$('language').value;$('langhint').textContent=$('language').value==='auto'?'默认会智能识别语种；识别不准时可手动切换后重新识别。':`当前语言：${langLabel($('language').value)}。切换后请重新识别图片或选区。`;});

function syncInlineEditorFromForm(){if(document.activeElement!==inlineEditor)inlineEditor.value=$('text').value;updateInlineEditor();}
inlineEditor.addEventListener('input',()=>{if($('text').value!==inlineEditor.value){$('text').value=inlineEditor.value;$('text').dispatchEvent(new Event('input',{bubbles:true}));}});
inlineEditor.addEventListener('focus',()=>{inlineEditor.select?.();});

['text','font','size','weight','spacing','leading','stroke','blur','angle','opacity','color','bgcolor','dx','dy'].forEach(id=>{
 const el=$(id); if(el) el.addEventListener('input',()=>{syncInlineEditorFromForm();clearTimeout(window.__pv);window.__pv=setTimeout(livePreview,180);});
});$('form').onsubmit=e=>{e.preventDefault();run(apply);};
$('undo').onclick=()=>{const h=S.history.pop();if(!h)return;base.getContext('2d').putImageData(h.data,h.r.x,h.r.y);clearSelection();lock(false);msg('已撤销，请重新识别或框选。');};$('export').onclick=()=>{if(S.preview)return msg('请先应用预览再导出',true);base.toBlob(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='text-studio-result.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},'image/png');};
$('zoom').onchange=resize;$('fit').onclick=()=>{$('zoom').value='fit';resize();};window.addEventListener('resize',resize);$('original').onpointerdown=e=>{e.preventDefault();$('original').setPointerCapture(e.pointerId);paint(true);};for(const t of ['pointerup','pointercancel','lostpointercapture'])$('original').addEventListener(t,()=>paint());
$('localfonts').onclick=()=>run(async()=>{if(!window.queryLocalFonts)throw Error('读取本机字体需要桌面 Chrome/Edge 与 localhost/HTTPS，也可批量导入字体。');const data=await window.queryLocalFonts();let n=0;for(const f of data){const id='Local'+(++S.serial),face=new FontFace(id,`local("${f.postscriptName.replace(/["\\]/g,'')}")`);try{await face.load();document.fonts.add(face);addFont(id,f.fullName);n++;}catch{}}msg(`已加载 ${n} 个本机字体，点击重新匹配比较。`);});
$('addfont').onclick=()=>$('fontfile').click();$('fontfile').onchange=()=>{const files=[...$('fontfile').files];$('fontfile').value='';run(async()=>{for(const f of files){if(f.size>50*1024*1024)throw Error('单个字体上限 50 MB');const id='Import'+(++S.serial),face=new FontFace(id,await f.arrayBuffer());await face.load();document.fonts.add(face);addFont(id,f.name);}msg(`已导入 ${files.length} 个字体，点击重新匹配。`);});};
$('onlinefonts').onclick=()=>run(async()=>{let ok=0;for(const [id,path] of [['Noto Sans SC','notosanssc/NotoSansSC'],['Noto Serif SC','notoserifsc/NotoSerifSC']]){try{const face=new FontFace(id,`url("https://raw.githubusercontent.com/google/fonts/main/ofl/${path}%5Bwght%5D.ttf")`,{weight:'100 900'});await face.load();document.fonts.add(face);addFont(id);ok++;}catch{}}if(!ok)throw Error('免费字体下载失败，请读取本机字体或批量导入');msg(`已加载 ${ok} 个免费中文字体系列，点击重新匹配。`);});
for(const id of ['text','font','size','weight','spacing','leading','color','stroke','blur','angle','opacity','repair','bgcolor','dx','dy','render'])$(id).addEventListener('input',()=>{S.preview=null;paint();try{comparison();}catch{}});
$('recognizebox').onclick=()=>run(()=>recognize(rect(Object.fromEntries(['x','y','w','h'].map(k=>[k,+$(k).value])))));
function beginViewportPan(e){if(!S.loaded||e.button!==0)return;const target=e.target;const interactive=target.closest?.('button,input,select,textarea,label,summary,details');const isSvgTarget=target instanceof SVGElement;const blocked=target.classList?.contains('text-box')||target.classList?.contains('move-hit')||target.classList?.contains('selection');if(interactive||blocked||(S.mode==='box'&&isSvgTarget))return;const view=$('viewport'),startX=e.clientX,startY=e.clientY,ox=view.scrollLeft,oy=view.scrollTop;view.classList.add('dragging');const move=ev=>{view.scrollLeft=ox-(ev.clientX-startX);view.scrollTop=oy-(ev.clientY-startY);};const end=()=>{view.classList.remove('dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);}
$('viewport').addEventListener('pointerdown',beginViewportPan,{passive:true});
$('viewport').addEventListener('dragover',e=>e.preventDefault());$('viewport').addEventListener('drop',e=>{e.preventDefault();run(()=>load(e.dataTransfer.files[0]));});window.addEventListener('paste',e=>{if($('psdialog').open||$('newdialog').open)return;if(/INPUT|TEXTAREA/.test(document.activeElement.tagName))return;const f=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(f){e.preventDefault();run(()=>load(f));}});
$('demo').onclick=()=>{const c=cv(1000,600),x=c.getContext('2d');x.fillStyle='#f3f0e9';x.fillRect(0,0,1000,600);x.fillStyle='#263b36';x.font='48px Arial';x.fillText('LOCAL TEXT STUDIO',100,220);x.font='30px Arial';x.fillText('2026 / CREATE SOMETHING NEW',100,310);c.toBlob(b=>run(()=>load(new File([b],'demo.png',{type:'image/png'}))));};
window.addEventListener('pagehide',()=>{if(S.worker)S.worker.terminate();});$('langhint').textContent='默认会智能识别语种；识别不准时可手动切换后重新识别。';lock(false);

const availability=new Map();
async function available(font){if(typeof FontResources!=='undefined'&&FontResources.has(font)){await document.fonts.load('24px "'+font+'"',(S.source?.text||'Aa').replace(/\n/g,' '));return true;}if(/^(Local|Import)/.test(font)||['sans-serif','serif','monospace'].includes(font)||document.fonts.check('16px "'+font+'"')&&font.startsWith('Noto'))return true;if(availability.has(font))return availability.get(font);let ok=false;try{await new FontFace('Check'+(++S.serial),'local("'+font.replace(/["\\]/g,'')+'")').load();ok=true;}catch{}availability.set(font,ok);return ok;}
function repairAsync(image){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(['const repairPatch='+repairPatch.toString()+';onmessage=e=>{try{const out=repairPatch(e.data.data,e.data.w,e.data.h);postMessage({data:out.buffer},[out.buffer]);}catch(e){postMessage({error:e.message})}}'],{type:'application/javascript'}));const worker=new Worker(url),timer=setTimeout(()=>{clean();reject(Error('背景修复超时，请缩小选区或选择纯色修复'));},30000);function clean(){clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);}worker.onerror=()=>{clean();reject(Error('背景修复失败，请改用纯色修复'));};worker.onmessage=e=>{clean();if(e.data.error)reject(Error(e.data.error));else resolve(new ImageData(new Uint8ClampedArray(e.data.data),image.width,image.height));};worker.postMessage({data:image.data.buffer,w:image.width,h:image.height},[image.data.buffer]);});}

function showNudge(){const n=S.nudge||{x:0,y:0};$('offsetx').value=n.x;$('offsety').value=n.y;}
async function moveText(dx,dy,reset=false){
 const previous=S.nudge||{x:0,y:0},preview=S.preview;
 S.nudge=reset?{x:0,y:0}:{x:previous.x+dx,y:previous.y+dy};
 try{S.preview=await generate();showNudge();paint();msg('文字位置：X '+S.nudge.x+' px，Y '+S.nudge.y+' px · 预览待应用');}
 catch(e){S.nudge=previous;S.preview=preview;showNudge();paint();throw e;}
}
function onNudgeKey(e){if($('psdialog').open||$('newdialog').open)return;
 const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
 if(!delta||!e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||!S.source)return;
 e.preventDefault();if(S.busy&&!Move.rendering)return;return scheduleNudge(...delta);
}
window.addEventListener('keydown',onNudgeKey);
$('resetoffset').onclick=()=>run(()=>moveText(0,0,true));

function automaticStyle(p){const m=S.match;if(!m)return false;return p.font===m.font&&Math.abs(p.size-m.size)<.02&&p.weight===m.weight&&Math.abs(p.spacing-m.spacing)<.02&&Math.abs(p.leading-(m.leading||p.leading))<.02&&p.color===S.a.fg&&!p.stroke&&!p.blur&&!p.angle&&p.opacity===1;}
