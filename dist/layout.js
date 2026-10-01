'use strict';
// Pure shared layout: preview, export and the inline editor use the same result.
(function(root){
 function layout(text,p,measure,maxWidth){
  const lines=[];let chars=[],width=0;
  const flush=()=>{lines.push({chars,width});chars=[];width=0;};
  for(const ch of Array.from(text.replace(/\r\n?/g,'\n'))){
   if(ch==='\n'){flush();continue;}
   const advance=measure(ch),next=chars.length?Math.max(width,width+p.spacing+advance):advance;
   if(chars.length&&next>maxWidth)flush();
   const x=chars.length?width+p.spacing:0;chars.push({ch,x});width=Math.max(width,x+advance);
  }
  flush();const lineHeight=Math.max(p.leading,p.ascent+p.descent);
  return {lines,width:Math.max(1,...lines.map(l=>l.width)),height:Math.max(1,(lines.length-1)*lineHeight+p.ascent+p.descent),lineHeight};
 }
 root.TextLayout={layout};if(typeof module!=='undefined')module.exports=root.TextLayout;
})(typeof window==='undefined'?globalThis:window);
