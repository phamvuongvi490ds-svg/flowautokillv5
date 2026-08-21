const fs = require('fs');
const path = require('path');
const root = process.cwd();
const banned = [];
function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const name of fs.readdirSync(dir)){
    const p=path.join(dir,name);
    const st=fs.statSync(p);
    if(st.isDirectory()) walk(p);
    else if(/\.py$/i.test(name)) banned.push(p);
  }
}
walk(path.join(root,'payload_protected'));
if(banned.length){
  console.error('Protected payload contains Python source files:');
  console.error(banned.join('\n'));
  process.exit(1);
}
const manifest=path.join(root,'integrity-manifest.json');
if(!fs.existsSync(manifest)) throw new Error('integrity-manifest.json missing');
const txt=fs.readFileSync(manifest,'utf8');
const obj=JSON.parse(txt);
if(!Array.isArray(obj.files)||!obj.files.length) throw new Error('integrity manifest has no files');
console.log('Protected artifact audit OK');
