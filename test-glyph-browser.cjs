const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8787');const result=await page.evaluate(async()=>{
 const out=[],assert=(v,t)=>{if(!v)throw Error(t);out.push(t)};
 const image=cv(300,120);image.getContext('2d').fillStyle='white';image.getContext('2d').fillRect(0,0,300,120);attachDocument(image,'glyph-fixture');manualText();
 const mask=cv(180,70),ctx=mask.getContext('2d');ctx.fillStyle='black';ctx.font='50px monospace';
 const symbols=[];Array.from('2026').forEach((text,i)=>{ctx.fillText(text,i*40+4,55);symbols.push({text,b:{x:20+i*40,y:20,w:38,h:70}})});
 S.r={x:20,y:20,w:180,h:70};S.source={text:'2026',r:S.r,symbols};S.a={mask,fg:'#222222',bg:'#ffffff',ink:{x:4,y:17,w:150,h:40}};S.match={size:50};S.cleanCache=null;
 $('render').value='glyph';$('text').value='620202';$('size').value=50;$('spacing').value=10;$('leading').value=65;$('repair').value='keep';$('color').value='#222222';$('angle').value=0;$('stroke').value=0;$('blur').value=0;$('opacity').value=1;
 const atlas=buildGlyphAtlas();assert(atlas.entries.size===3,'extracts available digits including repeated 2');
 const first=textLayout(params());$('font').value='serif';const other=textLayout(params());assert(first.width===other.width,'layout independent of replacement font');
 $('size').value=100;const large=textLayout(params());assert(large.scale===2&&large.lines[0].chars[0].ch==='6','size scales original glyph atlas');
 const actual=cv(150,150),a=actual.getContext('2d');drawSourceGlyph(a,large,params(),'6',10,10);const pixels=a.getImageData(0,0,150,150).data;assert(pixels.some((v,i)=>i%4===3&&v>0),'real canvas source glyph renders visible pixels');
 let width=0,height=0,x0=150,y0=150;for(let y=0;y<150;y++)for(let x=0;x<150;x++)if(pixels[(y*150+x)*4+3]>32){x0=Math.min(x0,x);y0=Math.min(y0,y);width=Math.max(width,x);height=Math.max(height,y);}const g=atlas.entries.get('6');assert(width-x0+1>=g.width*2-2&&height-y0+1>=g.height*2-2,'rendered pixel bounds scale correctly');
 $('text').value='6202'.repeat(100);$('spacing').value=24;const v=await generate();assert(v.layout.lines.flatMap(l=>l.chars).length===400&&v.patch.height>base.height,'long reused glyphs wrap without dropping digits');
 await livePreview();assert(screen.height===S.preview.patch.height,'reused glyph preview uses generated raster');await apply();const h=base.height;$('undo').click();assert(base.height===120,'glyph apply undo restores image');$('redo').click();assert(base.height===h,'glyph redo restores expanded image');
 // Exercise missing-symbol fallback on the same real alpha mask.
 manualText();S.r={x:20,y:20,w:180,h:70};S.source={text:'2026',r:S.r,symbols:[]};S.a={mask,fg:'#222222',bg:'#ffffff',ink:{x:4,y:17,w:150,h:40}};S.match={size:50};$('text').value='6202';$('render').value='glyph';$('size').value=50;const fallback=buildGlyphAtlas();assert(fallback.entries.size===3,'projection fallback recovers digits when OCR omits character boxes');
 $('text').value='8';let missing=false;try{await generate()}catch(e){missing=e.message.includes('没有「8」')}assert(missing,'unavailable source character gives explicit error');
 S.source={text:'2026',r:S.r,symbols:[]};const ambiguous=cv(180,70);ambiguous.getContext('2d').fillRect(0,0,180,70);S.a.mask=ambiguous;let rejected=false;try{buildGlyphAtlas()}catch(e){rejected=e.message.includes('无法可靠复用')}assert(rejected,'ambiguous segmentation rejected instead of wrong glyph mapping');
 // Validate online coordinate passthrough without calling an external service.
 const nativeFetch=window.fetch;window.fetch=async()=>({ok:true,json:async()=>({lines:[{text:'2026',r:{x:20,y:20,w:180,h:70},symbols}]})});
 $('ocrprovider').value='online';$('ocrendpoint').value='http://127.0.0.1:9999/ocr';await queueOCR(currentDocument());window.fetch=nativeFetch;
 assert(S.lines[0].symbols.length===4,'online OCR preserves provided character coordinates');
 return out;
});console.log(result);if(errors.length)throw Error(errors.join('\n'));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
