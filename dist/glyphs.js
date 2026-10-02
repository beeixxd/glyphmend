'use strict';
// Source glyph atlas is built once per selected line, never from the replacement font.
function buildGlyphAtlas(){
 const source=S.source;if(source.glyphAtlas)return source.glyphAtlas;
 const mask=S.a.mask,ctx=mask.getContext('2d'),pixels=ctx.getImageData(0,0,mask.width,mask.height).data;
 let symbols=(source.symbols||[]).filter(s=>s.b&&s.text&&[s.b.x,s.b.y,s.b.w,s.b.h].every(Number.isFinite)&&s.b.w>0&&s.b.h>0);
 if(!symbols.length){
  // Conservative projection fallback: use only unambiguous one-run-per-character lines.
  const rows=source.lines?.length?source.lines:[source],found=[];
  for(const row of rows){
   const chars=Array.from(row.text||'').filter(ch=>! /\s/.test(ch));if(!chars.length)continue;
   const box=row.r||S.r,x0=Math.max(0,Math.floor(box.x-S.r.x)),x1=Math.min(mask.width,Math.ceil(box.x+box.w-S.r.x));
   const y0=Math.max(0,Math.floor(box.y-S.r.y)),y1=Math.min(mask.height,Math.ceil(box.y+box.h-S.r.y));
   const runs=[];let start=-1;
   for(let x=x0;x<=x1;x++){let ink=false;if(x<x1)for(let y=y0;y<y1;y++)if(pixels[(y*mask.width+x)*4+3]>48){ink=true;break;}
    if(ink&&start<0)start=x;if(!ink&&start>=0){runs.push({x:start,w:x-start});start=-1;}}
   if(runs.length!==chars.length)throw Error('此行缺少单字符坐标，且字形粘连或分裂，无法可靠复用。请用本地 OCR 框选单行重新识别，或切换字体重绘。');
   runs.forEach((r,i)=>found.push({text:chars[i],b:{x:S.r.x+r.x,y:S.r.y+y0,w:r.w,h:y1-y0}}));
  }
  symbols=found;
 }
 const entries=new Map();let top=Infinity,bottom=0;
 for(const s of symbols){
  if(Array.from(s.text).length!==1||/\s/.test(s.text))continue;
  const x0=Math.max(0,Math.floor(s.b.x-S.r.x)),y0=Math.max(0,Math.floor(s.b.y-S.r.y));
  const x1=Math.min(mask.width,Math.ceil(s.b.x+s.b.w-S.r.x)),y1=Math.min(mask.height,Math.ceil(s.b.y+s.b.h-S.r.y));
  let left=x1,right=-1,t=y1,b=-1;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(pixels[(y*mask.width+x)*4+3]>16){left=Math.min(left,x);right=Math.max(right,x);t=Math.min(t,y);b=Math.max(b,y);}
  if(right<left||b<t)continue;
  const canvas=cv(right-left+1,b-t+1);canvas.getContext('2d').drawImage(mask,left,t,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
  if(!entries.has(s.text))entries.set(s.text,{canvas,width:canvas.width,height:canvas.height,top:t});top=Math.min(top,t);bottom=Math.max(bottom,b+1);
 }
 if(!entries.size)throw Error('没有可用原字形。请先识别包含文字的区域；添加文字不能复用不存在的源字形。');
 const referenceSize=Number(S.match?.size)||Number(source.rawHeight)||bottom-top;
 source.glyphAtlas={entries,top,bottom,referenceSize};return source.glyphAtlas;
}
function glyphTextLayout(p,x,y,pad){
 const atlas=buildGlyphAtlas(),scale=p.size/atlas.referenceSize;
 for(const ch of Array.from(p.text))if(!/\s/.test(ch)&&!atlas.entries.has(ch))throw Error(`原图选中区域没有「${ch}」字形，无法凭空生成。请切换字体重绘，或重新框选包含该字符的原图区域。`);
 const widths=[...atlas.entries.values()].map(g=>g.width),space=(widths.reduce((a,b)=>a+b,0)/widths.length)*.45*scale;
 const ascent=(atlas.bottom-atlas.top)*scale,descent=0;
 const result=TextLayout.layout(p.text,{...p,ascent,descent},ch=>/\s/.test(ch)?space:atlas.entries.get(ch).width*scale,Math.max(1,base.width-x-pad*2));
 return {...result,ascent,descent,pad,x,y,atlas,scale};
}
function drawSourceGlyph(ctx,l,p,ch,x,lineTop){
 if(/\s/.test(ch))return;const g=l.atlas.entries.get(ch),c=cv(g.width,g.height),gc=c.getContext('2d');
 gc.drawImage(g.canvas,0,0);gc.globalCompositeOperation='source-in';gc.fillStyle=p.color;gc.fillRect(0,0,c.width,c.height);
 const dw=g.width*l.scale,dh=g.height*l.scale,top=lineTop+(g.top-l.atlas.top)*l.scale;
 // Stroke the original alpha silhouette rather than a substituted font outline.
 if(p.stroke>0){const stroke=cv(c.width,c.height),sc=stroke.getContext('2d');sc.drawImage(g.canvas,0,0);sc.globalCompositeOperation='source-in';sc.fillStyle=p.color;sc.fillRect(0,0,c.width,c.height);for(let i=0;i<16;i++){const a=i*Math.PI/8;ctx.drawImage(stroke,x+Math.cos(a)*p.stroke,top+Math.sin(a)*p.stroke,dw,dh);}}
 ctx.drawImage(c,x,top,dw,dh);
}
