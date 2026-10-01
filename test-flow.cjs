const assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs');
class Element{constructor(){this.value='';this.options=[];this.children=[];this.classList={add(){},toggle(){}};this.style={};this.clientWidth=1000;this.clientHeight=600;this.listeners={};}add(o){this.options.push(o);if(!this.value)this.value=o.value;}addEventListener(t,f){this.listeners[t]=f;}removeEventListener(){}append(e){this.children.push(e);}replaceChildren(){this.children=[];}setAttribute(){}click(){this.onclick?.();}getContext(){return {drawImage(){},clearRect(){},fillRect(){},putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),measureText:text=>({width:text.length*12,actualBoundingBoxAscent:20,actualBoundingBoxDescent:5,actualBoundingBoxLeft:0}),fillText(){},strokeText(){},save(){},restore(){},translate(){},rotate(){}};}}
const els=new Map(),doc={getElementById:id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);},createElement:()=>new Element(),createElementNS:()=>new Element(),querySelectorAll:()=>[],body:new Element(),fonts:{check:()=>true,add(){}},head:new Element()};
const ctx=vm.createContext({document:doc,window:{addEventListener(){}},Option:class{constructor(text,value){this.textContent=text;this.value=value;}},FontFace:class{async load(){return this;}},requestAnimationFrame:f=>f(),setTimeout,clearTimeout,console,Uint8ClampedArray,fetch:async()=>({ok:false}),URL,Blob});
vm.runInContext(fs.readFileSync(__dirname+'/dist/studio.js','utf8'),ctx);
(async()=>{await vm.runInContext(`(async()=>{
 base.width=600;base.height=240;S.loaded=true;
 const data={blocks:[{paragraphs:[{lines:[{text:'HELLO',confidence:99,bbox:{x0:40,y0:70,x1:175,y1:100},words:[{symbols:[{text:'H',bbox:{x0:40,y0:70,x1:65,y1:100}}]}]}]}]}]};
 S.lines=parse(data);if(S.lines[0].r.x!==36||S.lines[0].text!=='HELLO')throw Error('OCR parsing');
 const scaled=parse(data,{x:10,y:20},2);if(scaled[0].symbols[0].b.x!==30)throw Error('scaled symbol positions');
 analyze=()=>({mask:cv(143,38),fg:'#222222',bg:'#ffffff',ink:{x:4,y:4,w:135,h:30}});
 await choose(S.lines[0]);if($('old').value!=='HELLO'||$('text').value!=='HELLO')throw Error('automatic original fill');
 const size=$('size').value;$('text').value='HI';$('repair').value='solid';$('render').value='auto';
 for(const [id,v] of Object.entries({stroke:0,blur:0,angle:0,opacity:1,dx:0,dy:0}))$(id).value=v;
 const result=await generate();if(result.patch.width!==143||$('size').value!==size)throw Error('size lock');
 $('text').value='A'.repeat(80);let overflow=false;try{await generate()}catch(e){overflow=e.message.includes('超出选区')}if(!overflow)throw Error('overflow guard');
 $('render').value='glyph';$('text').value='Z';let missing=false;try{await generate()}catch(e){missing=e.message.includes('没有')}if(!missing)throw Error('glyph guard');
 $('render').value='auto';$('text').value='HI';await apply();if(S.history.length!==1||S.source!==null||S.lines.length)throw Error('stale selection invalidation');
 $('undo').click();if(S.history.length)throw Error('undo');
 return true;
})()`,ctx);assert(true);console.log('PASS OCR JSON parsing, scaled glyph coordinates, automatic original fill, locked size, overflow guard, missing glyph guard, apply invalidation, undo (mock Canvas; not rendering/OCR accuracy)');})().catch(e=>{console.error(e);process.exitCode=1;});
