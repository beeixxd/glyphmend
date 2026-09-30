const fs=require('fs');
(async()=>{
 const tabs=await (await fetch('http://127.0.0.1:9223/json')).json();
 const socket=new WebSocket(tabs[0].webSocketDebuggerUrl);await new Promise(ok=>socket.onopen=ok);
 let id=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});}
 async function evaljs(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 await call('Page.enable');await call('Page.navigate',{url:'http://localhost:8787'});
 for(let n=0;n<30;n++){if(await evaljs("typeof S !== 'undefined'"))break;await new Promise(ok=>setTimeout(ok,100));}
 const results=await evaljs(`(async()=>{
 const out=[],assert=(v,s)=>{if(!v)throw Error(s);out.push(s)};
 assert($('old').readOnly,'original content is readonly');
 const c=cv(600,240),ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,600,240);ctx.fillStyle='#222222';ctx.font='40px Arial';ctx.fillText('HELLO',40,100);
 const fixture={text:'HELLO',bbox:{x0:40,y0:70,x1:175,y1:100},confidence:99,words:[{symbols:[...('HELLO')].map((text,i)=>({text,bbox:{x0:40+i*27,y0:70,x1:65+i*27,y1:100}}))}]};
 window.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{blocks:[{paragraphs:[{lines:[fixture]}]}]}}),terminate:async()=>{}})};
 await load(await new Promise(ok=>c.toBlob(b=>ok(new File([b],'fixture.png',{type:'image/png'})))));
 assert(S.lines.length===1,'OCR line parsed with boxes');
 await choose(S.lines[0]);assert($('old').value==='HELLO'&&$('text').value==='HELLO','click selection automatically fills original and replacement');
 const size=$('size').value,inkY=S.a.ink.y;assert(+size>0,'font size automatically matched');
 const before=base.getContext('2d').getImageData(S.r.x,S.r.y,S.r.w,S.r.h).data;
 const unchanged=(await generate()).patch.getContext('2d').getImageData(0,0,S.r.w,S.r.h).data;
 assert(before.every((v,i)=>v===unchanged[i]),'unchanged text preserves every original pixel');
 $('text').value='HI';$('repair').value='solid';const p=await generate();assert($('size').value===size,'replacement preserves matched size');assert(p.patch.width===S.r.w,'preview preserves selected dimensions');
 $('text').value='THIS IS A VERY LONG REPLACEMENT';let overflow=false;try{await generate()}catch(e){overflow=/超出选区/.test(e.message)}assert(overflow,'overflow blocked without auto shrinking');
 $('render').value='glyph';$('text').value='Z';let missing=false;try{await generate()}catch(e){missing=/没有/.test(e.message)}assert(missing,'missing source glyph rejected');
 $('render').value='auto';$('text').value='HI';await apply();assert(S.history.length===1&&S.source===null,'apply records undo and invalidates stale OCR');$('undo').click();assert(!S.history.length,'undo restores previous patch');
 await recognize({x:30,y:60,w:170,h:55});assert($('old').value==='HELLO','box selection automatically recognizes original');
 const m1=metrics($('font').value,S.source.text,+$('size').value,+$('weight').value);assert(m1.ascent>0,'canvas font metrics available');
 return out;
})()`);
 console.log(JSON.stringify(results,null,2));
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(require('path').join(__dirname,'browser-check.png'),Buffer.from(screenshot.data,'base64'));
 await call('Browser.close');socket.close();
})().catch(e=>{console.error(e);process.exit(1)});
