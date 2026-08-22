const fs=require('fs');
const path=require('path');
const JavaScriptObfuscator=require('javascript-obfuscator');
const root=path.join(process.cwd(),'dist');
const targets=[];
function walk(dir){ if(!fs.existsSync(dir))return; for(const n of fs.readdirSync(dir)){const p=path.join(dir,n);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\.js$/i.test(n))targets.push(p);} }
walk(root);
if(!targets.length)throw new Error('No renderer JS found to obfuscate');
for(const file of targets){
  const source=fs.readFileSync(file,'utf8').replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm,'');
  const out=JavaScriptObfuscator.obfuscate(source,{
    compact:true,
    controlFlowFlattening:true,
    controlFlowFlatteningThreshold:0.22,
    deadCodeInjection:true,
    deadCodeInjectionThreshold:0.08,
    identifierNamesGenerator:'hexadecimal',
    renameGlobals:false,
    renameProperties:false,
    selfDefending:true,
    simplify:true,
    splitStrings:true,
    splitStringsChunkLength:8,
    stringArray:true,
    stringArrayCallsTransform:true,
    stringArrayCallsTransformThreshold:0.75,
    stringArrayEncoding:['base64'],
    stringArrayIndexShift:true,
    stringArrayRotate:true,
    stringArrayShuffle:true,
    stringArrayThreshold:0.9,
    unicodeEscapeSequence:false,
    transformObjectKeys:true,
  }).getObfuscatedCode();
  fs.writeFileSync(file,out,'utf8');
}
for(const f of fs.readdirSync(root,{recursive:true}).filter(x=>/\.map$/i.test(x))){try{fs.rmSync(path.join(root,f),{force:true})}catch{}}
console.log(`Obfuscated ${targets.length} renderer bundle(s)`);
