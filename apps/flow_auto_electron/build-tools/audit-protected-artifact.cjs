const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=process.cwd();
const banned=[];
function walk(dir){ if(!fs.existsSync(dir))return; for(const name of fs.readdirSync(dir)){ const p=path.join(dir,name); const st=fs.statSync(p); if(st.isDirectory())walk(p); else if(/\.(py|pyc|pyo|map|log|pdb)$/i.test(name)||/__pycache__/i.test(p))banned.push(p); }}
walk(path.join(root,'payload_protected'));
if(banned.length) throw new Error('Protected payload contains source/debug artifacts:\n'+banned.join('\n'));
const manifestPath=path.join(root,'integrity-manifest.json');
if(!fs.existsSync(manifestPath))throw new Error('integrity-manifest.json missing');
const obj=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(obj.version!==2||!Array.isArray(obj.files)||!obj.files.length||!obj.signature)throw new Error('signed integrity manifest invalid');
const body={version:obj.version,generatedAt:obj.generatedAt,files:obj.files};
const pub=fs.readFileSync(path.join(root,'build-tools','integrity-public.pem'),'utf8');
if(!crypto.verify('sha256',Buffer.from(JSON.stringify(body)),pub,Buffer.from(obj.signature,'base64')))throw new Error('integrity manifest signature invalid');
for(const item of obj.files){
  const source=path.join(root,'payload_protected',String(item.path).replace(/^payload\//,''));
  if(!fs.existsSync(source))throw new Error('manifest file missing: '+item.path);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if(hash!==item.sha256)throw new Error('manifest hash mismatch: '+item.path);
  if(fs.statSync(source).size!==item.size)throw new Error('manifest size mismatch: '+item.path);
}
console.log('Protected artifact signed-manifest audit OK');
