const fs=require('fs');const path=require('path');const root=path.join(process.cwd(),'dist');
const bad=[];function walk(d){if(!fs.existsSync(d))return;for(const n of fs.readdirSync(d)){const p=path.join(d,n);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\.(map|tsx?|jsx|py|log|pdb)$/i.test(n))bad.push(p);}}
walk(root);if(bad.length)throw new Error('Renderer contains source/debug artifacts:\n'+bad.join('\n'));
const js=[];function scan(d){if(!fs.existsSync(d))return;for(const n of fs.readdirSync(d)){const p=path.join(d,n);const st=fs.statSync(p);if(st.isDirectory())scan(p);else if(/\.js$/i.test(n))js.push(p);}}scan(root);
if(!js.length)throw new Error('Renderer JS missing');
for(const f of js){const t=fs.readFileSync(f,'utf8');if(/sourceMappingURL/i.test(t))throw new Error('Source map reference remains: '+f);if(t.length<5000)throw new Error('Renderer bundle unexpectedly small: '+f);}
console.log('Renderer artifact audit OK');
