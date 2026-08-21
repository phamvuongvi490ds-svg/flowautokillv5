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
}));
if (!files.length) throw new Error('No protected runner files found for integrity manifest');
fs.writeFileSync(path.join(root, 'integrity-manifest.json'), JSON.stringify({version: 1, generatedAt: new Date().toISOString(), files}, null, 2));
console.log(`Wrote integrity-manifest.json with ${files.length} file(s)`);
