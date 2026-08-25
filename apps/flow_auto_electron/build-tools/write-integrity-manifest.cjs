const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.cwd();
const candidates = [
  'payload_protected/bin/flow_batch_runner.dist/flow_batch_runner.exe',
  'payload_protected/bin/flow_batch_runner.dist/flow_batch_runner',
  'payload_protected/bin/flow_batch_runner-x64.dist/flow_batch_runner',
  'payload_protected/bin/flow_batch_runner-arm64.dist/flow_batch_runner',
].filter(p => fs.existsSync(path.join(root, p)));
const files = candidates.map(p => ({
  path: p.replace(/^payload_protected\//, 'payload/').replaceAll('\\', '/'),
  sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex'),
  size: fs.statSync(path.join(root,p)).size,
})).sort((a,b)=>a.path.localeCompare(b.path));
if (!files.length) throw new Error('No protected runner files found for integrity manifest');
const body={version:2,generatedAt:new Date().toISOString(),files};
const privateKey=String(process.env.INTEGRITY_PRIVATE_KEY_PEM||'').replace(/\\n/g,'\n').trim();
if(!privateKey) throw new Error('INTEGRITY_PRIVATE_KEY_PEM is required for protected build');
const canonical=JSON.stringify(body);
const signature=crypto.sign('sha256',Buffer.from(canonical),privateKey).toString('base64');
fs.writeFileSync(path.join(root,'integrity-manifest.json'),JSON.stringify({...body,algorithm:'RSA-SHA256',signature},null,2));
console.log(`Wrote signed integrity-manifest.json with ${files.length} file(s)`);
