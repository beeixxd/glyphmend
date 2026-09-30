// Deterministic classical interpolation. No model inference or network access.
function repairPatch(data,w,h){
  if(w<3||h<3||w*h>550000)throw new Error('Background repair requires 3px minimum and at most 550000 pixels');
  const source=new Uint8ClampedArray(data),out=new Uint8ClampedArray(source);
  let a=new Float32Array(w*h*3),b=new Float32Array(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
    const i=(y*w+x)*3+c;
    if(x===0||y===0||x===w-1||y===h-1)a[i]=source[(y*w+x)*4+c];
    else {const tx=x/(w-1),ty=y/(h-1);a[i]=((1-tx)*source[(y*w)*4+c]+tx*source[(y*w+w-1)*4+c]+(1-ty)*source[x*4+c]+ty*source[((h-1)*w+x)*4+c])/2;}
  }
  b.set(a);
  for(let step=0;step<100;step++){
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let c=0;c<3;c++){
      const i=(y*w+x)*3+c;b[i]=(a[i-3]+a[i+3]+a[i-w*3]+a[i+w*3])*.25;
    }
    const temp=a;a=b;b=temp;
  }
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let c=0;c<3;c++)out[(y*w+x)*4+c]=a[(y*w+x)*3+c];
  return out;
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)self.onmessage=e=>{try{const out=repairPatch(e.data.data,e.data.w,e.data.h);self.postMessage({data:out.buffer},[out.buffer]);}catch(error){self.postMessage({error:error.message});}};
if(typeof module!=='undefined')module.exports={repairPatch};
