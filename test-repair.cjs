const assert=require('node:assert/strict');
const {repairPatch}=require('./dist/repair.js');
const w=50,h=24,data=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data[i]=200;data[i+1]=210;data[i+2]=220;data[i+3]=173;if(x>10&&x<38&&y>7&&y<18){data[i]=20;data[i+1]=25;data[i+2]=30;}}
const result=repairPatch(data.buffer,w,h);
for(let i=0;i<result.length;i+=4){assert.equal(result[i],200);assert.equal(result[i+1],210);assert.equal(result[i+2],220);assert.equal(result[i+3],173);}
const gradient=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;gradient[i]=x*3;gradient[i+1]=y*4;gradient[i+2]=100;gradient[i+3]=255;}
const restored=repairPatch(gradient.buffer,w,h);let worst=0;for(let i=0;i<restored.length;i++)worst=Math.max(worst,Math.abs(restored[i]-gradient[i]));assert.ok(worst<=2,`gradient error ${worst}`);
assert.throws(()=>repairPatch(new ArrayBuffer(4),1,1));assert.throws(()=>repairPatch(new ArrayBuffer(4),1000,1000));
console.log('PASS solid background restoration, linear gradient continuity, alpha preservation, bounds');
