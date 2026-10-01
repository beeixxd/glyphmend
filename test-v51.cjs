const assert=require('node:assert/strict');const {layout}=require('./dist/layout.js');
const p={spacing:20,leading:10,ascent:20,descent:5};
const a=layout('1234567890',p,()=>12,80);assert.equal(a.lines.length,4);assert.equal(a.lines.flatMap(x=>x.chars).map(x=>x.ch).join(''),'1234567890');assert(a.width<=80);assert.equal(a.height,100);
assert.equal(layout('A\n\nB',p,()=>12,100).lines.length,3);
assert.equal(layout('😀中',p,()=>20,100).lines[0].chars.length,2);
assert.equal(layout('A'.repeat(3000),p,()=>12,200).lines.flatMap(x=>x.chars).length,3000);
assert.equal(layout('A',p,()=>120,80).width,120);
console.log('PASS v5.1 wrapping, wide spacing, 3000 characters, explicit blank lines, Unicode and oversized glyph');
