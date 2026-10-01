const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
for(const file of ['dist/layout.js','dist/engine-v51.js','dist/studio.js','dist/workspace.js','dist/fonts.js','dist/photopea.js','dist/repair.js','server.cjs'])new vm.Script(fs.readFileSync(path.join(__dirname,file),'utf8'),{filename:file});
const html=fs.readFileSync(path.join(__dirname,'dist/index.html'),'utf8'),ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('Duplicate DOM id');for(const file of ['engine-v51','studio','workspace','fonts','photopea']){const code=fs.readFileSync(path.join(__dirname,'dist/'+file+'.js'),'utf8');for(const match of code.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(match[1]))throw Error('Missing DOM id: '+match[1]);}console.log('PASS syntax and DOM reference integrity');
require('./test-repair.cjs');require('./test-workspace.cjs');

