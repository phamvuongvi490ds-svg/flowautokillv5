const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const isDev = !app.isPackaged;
// Share runtime/license with stable standalone app so existing activated keys are visible.
const BASE_DIR = path.join(os.homedir(), '.flow-auto-standalone');
const FLOW_DIR = path.join(BASE_DIR, 'flow-auto');
const JOB_DIR = path.join(FLOW_DIR, 'job-state');
const REFS_DIR = path.join(FLOW_DIR, 'refs');

function makeCharacterRefsDir(images, runId) {
    const dir = path.join(REFS_DIR, runId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    images.forEach((img, i) => {
        const ext = path.extname(img);
        const dest = path.join(dir, `REF_${String(i + 1).padStart(2, '0')}${ext}`);
        if (fs.existsSync(img)) fs.copyFileSync(img, dest);
    });
    return dir;
}
const DEBUG_DIR = path.join(FLOW_DIR, 'debug');
const SCRIPTS_DIR = path.join(BASE_DIR, 'scripts');
const PYENV_DIR = path.join(BASE_DIR, 'electron-python');
const RUNTIME_CACHE_DIR = path.join(BASE_DIR, 'runtime-cache');
const RUNTIME_MARKER = path.join(RUNTIME_CACHE_DIR, '.ready');
const REQ_FILE = path.join(BASE_DIR, 'electron-requirements.txt');
const PID_RUN = path.join(JOB_DIR, 'electron-runner.pid');
const PAUSE_FILE = path.join(JOB_DIR, 'pause.flag');
const RUN_STATE = path.join(JOB_DIR, 'electron-runner-state.json');
const CDP_PORT = 18800;
function _s(parts){ return Buffer.from(parts.join(''), 'base64').toString('utf8'); }
const DEFAULT_API_BASE = _s(['aHR0cHM6Ly9zZXJ2ZXIt','YXV0by10b29sLnZlcmNl','bC5hcHAvYXBpL2xpY2Vuc2U=']);
try{ app.commandLine.appendSwitch('disable-dev-shm-usage'); }catch{}
const CDP_PROFILE = path.join(BASE_DIR, 'chrome-cdp-profile');
const LICENSE_CONFIG = path.join(BASE_DIR, 'keys', 'license-online.json');
let stopInProgress = false;

function ensureDirs(){ [BASE_DIR,FLOW_DIR,JOB_DIR,DEBUG_DIR,SCRIPTS_DIR,RUNTIME_CACHE_DIR].forEach(p=>fs.mkdirSync(p,{recursive:true})); }
function forceChromeLanguagePrefs(){
  try{
    fs.mkdirSync(path.join(CDP_PROFILE,'Default'),{recursive:true});
    const pref=path.join(CDP_PROFILE,'Default','Preferences');
    let obj={}; try{ obj=JSON.parse(fs.readFileSync(pref,'utf8')); }catch{}
    obj.intl={...(obj.intl||{}), accept_languages:'vi-VN,vi,en-US,en'};
    obj.translate={...(obj.translate||{}), enabled:false};
    obj.browser={...(obj.browser||{}), enable_spellchecking:false};
    fs.writeFileSync(pref,JSON.stringify(obj,null,2));
  }catch{}
}
function resourcePath(rel){ return app.isPackaged ? path.join(process.resourcesPath, rel) : path.join(__dirname, '..', rel); }
function appPath(rel){ return app.isPackaged ? path.join(process.resourcesPath, 'app.asar', rel) : path.join(__dirname, '..', rel); }
function bootstrap(){
  ensureDirs();
  const protectedBin=resourcePath('payload/bin');
  const src=resourcePath('payload/scripts');
  if(fs.existsSync(protectedBin)){
    const dstBin=path.join(SCRIPTS_DIR,'bin');
    fs.rmSync(dstBin,{recursive:true,force:true});
    copyDirSync(protectedBin,dstBin);
  }
  if(fs.existsSync(src)){
    for(const f of fs.readdirSync(src)){
      const sp=path.join(src,f); const dp=path.join(SCRIPTS_DIR,f);
      if(fs.statSync(sp).isFile()) fs.copyFileSync(sp,dp);
    }
  }
  const req=resourcePath('payload/requirements.txt'); if(fs.existsSync(req)) fs.copyFileSync(req, REQ_FILE);
}
function sha256File(file){
  const h=crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function integrityPublicKey(){
  const chunks=['-----BEGIN PUBLIC KEY-----','MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAr7WPVAXLM49mc4szbi23','JjoF3SL3dzcMmEy4LIfZcbYLM/fisVGjATggzcMeOBJv4p3Jg817i52/LVK5TAqF','CxVD4uFezSBnB4k6ew9a3/HBFRDE9py/w1IQqAGj6JFhfXvUusZKAl5tw7b+iasg','7RYV565xVhysWUQm3iNCQidbSnyFXqC671Uq9I5CdNMEBXKmd1FKHud9zXDaM9Q1','yq6i6UaKuixKYMM/tSHKLU0pCkdSNCvXh52CeZfiWNHKRDKh4dumDIHXrYLIwp9f','c6I59rLztWQe61ByFgMA1bYBo/VfsP5XCfdBrkAxDFDhdwhn0mwjFduHwzIxbn3C','zZOmRmvgjBqdCeGTT3Cs3OOBAcseE8UiVgjCkx54nIfqbr/4O+JKUqfKnwV5AhUf','rxxURiy4ZiahUHHG68RRdNamcPtGsrS+OYQUm1o20DjEm8zGqMWJiZSj3RhF3lSg','+hT+Qec+lOuqblN/wT1m8TdnxpqoSGnJfF9LXAcOVielAgMBAAE=','-----END PUBLIC KEY-----'];
  return chunks.join('\n');
}
function verifyProtectedIntegrity(){
  if(!app.isPackaged) return {ok:true, skipped:true};
  const manifestPath=resourcePath('integrity-manifest.json');
  if(!fs.existsSync(manifestPath)) return {ok:false,error:'integrity_manifest_missing'};
  let manifest={};
  try{ manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')); }catch(e){ return {ok:false,error:'integrity_manifest_invalid'}; }
  const files=Array.isArray(manifest.files)?manifest.files:[];
  if(manifest.version!==2 || !files.length || !manifest.signature) return {ok:false,error:'integrity_manifest_unsigned_or_bad_version'};
  const body={version:manifest.version,generatedAt:manifest.generatedAt,files};
  let signatureOk=false;
  try{ signatureOk=crypto.verify('sha256',Buffer.from(JSON.stringify(body)),integrityPublicKey(),Buffer.from(String(manifest.signature),'base64')); }catch{}
  if(!signatureOk) return {ok:false,error:'integrity_signature_invalid'};
  for(const item of files){
    const rel=String(item.path||'').replace(/^[\\/]+/,'');
    const expected=String(item.sha256||'').toLowerCase();
    if(!rel || !expected || !Number(item.size)) return {ok:false,error:'integrity_manifest_bad_entry'};
    const target=resourcePath(rel);
    if(!fs.existsSync(target)) return {ok:false,error:`integrity_missing:${rel}`};
    if(fs.statSync(target).size!==Number(item.size)) return {ok:false,error:`integrity_size_mismatch:${rel}`};
    const actual=sha256File(target).toLowerCase();
    if(actual!==expected) return {ok:false,error:`integrity_mismatch:${rel}`};
  }
  return {ok:true, signed:true, checked:files.length};
}
function enforceProtectedIntegrity(){
  const r=verifyProtectedIntegrity();
  if(r.ok) return r;
  try{ dialog.showErrorBox('FLOW AUTO VEO 3', 'Ứng dụng đã bị thay đổi hoặc thiếu file bảo vệ. Vui lòng cài lại bản chính thức.\n\n' + r.error); }catch{}
  setTimeout(()=>app.quit(), 50);
  return r;
}

function suspiciousRuntimeSignals(){
  const bad=[];
  const argv=process.argv.join(' ').toLowerCase();
  const execArgv=(process.execArgv||[]).join(' ').toLowerCase();
  const env=process.env||{};
  if(/--inspect|--inspect-brk|--remote-debugging-port|--js-flags|--enable-logging|--trace-/.test(argv+' '+execArgv)) bad.push('debug_flags');
  if(env.NODE_OPTIONS && /--inspect|--require|--loader|--experimental/.test(String(env.NODE_OPTIONS))) bad.push('node_options');
  if(app.isPackaged){
    try{ if(!String(process.resourcesPath||'').toLowerCase().includes('resources')) bad.push('bad_resources_path'); }catch{}
    try{ if(!fs.existsSync(path.join(process.resourcesPath,'app.asar'))) bad.push('asar_missing'); }catch{}
  }
  return bad;
}
function installRuntimeGuards(){
  try{
    app.on('web-contents-created', (_event, contents)=>{
      contents.on('will-navigate', (e,url)=>{ if(!String(url||'').startsWith('file://')) e.preventDefault(); });
      contents.setWindowOpenHandler(()=>({action:'deny'}));
      contents.on('before-input-event', (event,input)=>{
        const k=String(input.key||'').toLowerCase();
        const dev=(input.control||input.meta)&&input.shift&&['i','j','c'].includes(k);
        if(app.isPackaged && (dev || k==='f12')) event.preventDefault();
      });
      if(app.isPackaged){
        try{ contents.on('devtools-opened',()=>{ try{ contents.closeDevTools(); }catch{} }); }catch{}
      }
    });
  }catch{}
}
function enforceRuntimeGuards(){
  if(!app.isPackaged) return {ok:true, skipped:true};
  const bad=suspiciousRuntimeSignals();
  if(!bad.length) return {ok:true};
  try{ dialog.showErrorBox('FLOW AUTO VEO 3', 'Môi trường chạy không hợp lệ hoặc có dấu hiệu debug: '+bad.join(',')); }catch{}
  setTimeout(()=>app.quit(), 50);
  return {ok:false,error:bad.join(',')};
}

function systemPython(){ return process.platform==='win32' ? 'python' : 'python3'; }
function cachedRuntimePython(){ const exe=process.platform==='win32'?path.join(RUNTIME_CACHE_DIR,'python.exe'):path.join(RUNTIME_CACHE_DIR,'bin','python3'); if(fs.existsSync(exe)) return exe; const exe2=process.platform==='win32'?path.join(RUNTIME_CACHE_DIR,'python.exe'):path.join(RUNTIME_CACHE_DIR,'bin','python'); return fs.existsSync(exe2)?exe2:''; }
function bundledPython(){ const base=resourcePath('payload/python/runtime'); const exe=process.platform==='win32'?path.join(base,'python.exe'):path.join(base,'bin','python3'); if(fs.existsSync(exe)) return exe; const exe2=process.platform==='win32'?path.join(base,'python.exe'):path.join(base,'bin','python'); return fs.existsSync(exe2)?exe2:''; }
function copyDirSync(src,dst){ fs.mkdirSync(dst,{recursive:true}); for(const ent of fs.readdirSync(src,{withFileTypes:true})){ const sp=path.join(src,ent.name), dp=path.join(dst,ent.name); if(ent.isDirectory()) copyDirSync(sp,dp); else if(ent.isSymbolicLink()){ try{ const real=fs.realpathSync(sp); if(fs.statSync(real).isDirectory()) copyDirSync(real,dp); else fs.copyFileSync(real,dp); }catch{} } else if(ent.isFile()) fs.copyFileSync(sp,dp); } }
function prepareRuntimeCache(){ ensureDirs(); const cached=cachedRuntimePython(); if(fs.existsSync(RUNTIME_MARKER) && cached && pyReady(cached)) return cached; const bundled=bundledPython(); if(!bundled || !pyReady(bundled)) return ''; const src=path.dirname(process.platform==='win32'?bundled:path.dirname(bundled)); fs.rmSync(RUNTIME_CACHE_DIR,{recursive:true,force:true}); copyDirSync(src,RUNTIME_CACHE_DIR); const c=cachedRuntimePython(); if(pyReady(c)){ fs.writeFileSync(RUNTIME_MARKER,new Date().toISOString()); return c; } return bundled; }
function pyReady(py){ return py && fs.existsSync(py) && spawnSync(py,['-c','import playwright, certifi'],{encoding:'utf8',windowsHide:true}).status===0; }
function venvPython(){ return process.platform==='win32' ? path.join(PYENV_DIR,'Scripts','python.exe') : path.join(PYENV_DIR,'bin','python'); }
function ensurePythonEnv(){
  bootstrap();
  const cached=cachedRuntimePython();
  if(pyReady(cached)) return cached;
  const prepared=prepareRuntimeCache();
  if(pyReady(prepared)) return prepared;
  const bundled=bundledPython();
  if(pyReady(bundled)) return bundled;
  const py=venvPython();
  const check=()=>pyReady(py);
  if(check()) return py;
  fs.mkdirSync(PYENV_DIR,{recursive:true});
  let r=spawnSync(systemPython(), ['-m','venv',PYENV_DIR], {encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||'python venv failed');
  r=spawnSync(py, ['-m','pip','install','-U','pip'], {encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||'pip upgrade failed');
  const req=fs.existsSync(REQ_FILE)?REQ_FILE:resourcePath('payload/requirements.txt');
  r=spawnSync(py, ['-m','pip','install','-r',req], {encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||'pip install requirements failed');
  return py;
}
function spawnOpts(extra={}){ return {cwd:BASE_DIR, env:{...process.env,FLOW_WORKSPACE:BASE_DIR,FLOW_PAUSE_FILE:PAUSE_FILE}, windowsHide:true, ...extra}; }
function runScript(script,args=[]){ return new Promise((resolve)=>{ bootstrap(); let p, py; try{ py=ensurePythonEnv(); p=spawn(py, [path.join(SCRIPTS_DIR,script), ...args], spawnOpts()); }catch(e){ resolve({ok:false,error:String(e)}); return; } let out='',err=''; p.stdout.on('data',d=>out+=d); p.stderr.on('data',d=>err+=d); p.on('error',e=>resolve({ok:false,error:String(e)})); p.on('close',code=>resolve({ok:code===0, code, stdout:out.trim(), stderr:err.trim()})); }); }

function machineId(){
  try{
    if(process.platform==='win32'){
      const out=require('child_process').execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-Command',"$x=''; try{$x=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid}catch{}; if([string]::IsNullOrWhiteSpace($x)){try{$x=(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID}catch{}}; if([string]::IsNullOrWhiteSpace($x)){$x=$env:COMPUTERNAME}; $x.ToString().Trim().ToLower()"],{encoding:'utf8'}).trim();
      if(out) return out.toLowerCase();
    }
  }catch{}
  if(process.platform==='darwin'){
    try{ const out=require('child_process').execFileSync('ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8'}); const m=out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); if(m) return m[1].toLowerCase(); }catch{}
  }
  if(process.platform==='linux'){
    try{ const v=fs.readFileSync('/etc/machine-id','utf8').trim(); if(v) return v.toLowerCase(); }catch{}
  }
  return os.hostname().toLowerCase();
}
function licenseApiBase(){ try{ const cfg=JSON.parse(fs.readFileSync(LICENSE_CONFIG,'utf8')); return cfg.api_base||DEFAULT_API_BASE; }catch{return DEFAULT_API_BASE;} }


function protectLocalSecret(value){
  const v=String(value||''); if(!v)return '';
  try{ if(process.platform==='win32' && safeStorage.isEncryptionAvailable()) return 'dpapi:'+safeStorage.encryptString(v).toString('base64'); }catch{}
  return 'machine:'+crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(machineId()).digest(),Buffer.alloc(12)).update(v,'utf8','base64');
}
function unprotectLocalSecret(value){
  const v=String(value||''); if(!v)return '';
  try{ if(v.startsWith('dpapi:') && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(v.slice(6),'base64')); }catch{}
  return v.startsWith('machine:')?'':v;
}
function loadLicenseCfg(){
  try{
    const cfg=JSON.parse(fs.readFileSync(LICENSE_CONFIG,'utf8'));
    if(cfg.license_key_encrypted) cfg.license_key=unprotectLocalSecret(cfg.license_key_encrypted);
    if(cfg.signed_token_encrypted) cfg.signed_token=unprotectLocalSecret(cfg.signed_token_encrypted);
    return cfg;
  }catch{return {}}
}
function saveLicenseCfg(input){
  const cfg={...input};
  if(cfg.license_key){ cfg.license_key_encrypted=protectLocalSecret(cfg.license_key); delete cfg.license_key; }
  if(cfg.signed_token){ cfg.signed_token_encrypted=protectLocalSecret(cfg.signed_token); delete cfg.signed_token; }
  fs.mkdirSync(path.dirname(LICENSE_CONFIG),{recursive:true}); fs.writeFileSync(LICENSE_CONFIG,JSON.stringify(cfg,null,2),'utf8');
}
function normalizeBase(b){ b=String(b||'').trim().replace(/\/+$/,''); if(b.endsWith('/activate')||b.endsWith('/verify')) b=b.replace(/\/[^\/]+$/,''); return b; }
async function postJson(url,payload){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); let data={}; try{data=await r.json()}catch{} return {status:r.status,data}; }
async function verifyLicenseJs(){ const cfg=loadLicenseCfg(); const base=normalizeBase(cfg.api_base||''); if(!base) return {ok:false,reason:'missing_api_base'}; if(!cfg.license_key) return {ok:false,reason:'missing_license_key'}; cfg.machine_id=cfg.machine_id||machineId(); const payload={license_key:cfg.license_key,machine_id:cfg.machine_id,app_version:'V2.0',nonce:Date.now().toString(36),timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}; if(cfg.signed_token) payload.signed_token=cfg.signed_token; try{ const {status,data}=await postJson(`${base}/verify`,payload); if(status===200 && data.valid){ ['signed_token','expires_at','grace_until','next_check_at'].forEach(k=>{if(data[k])cfg[k]=data[k]}); cfg.last_verified_at=payload.timestamp; saveLicenseCfg(cfg); return {ok:true,expires_at:data.expires_at||cfg.expires_at,data}; } return {ok:false,reason:data.reason||`http_${status}`,data}; }catch(e){ return {ok:false,reason:`network_error:${e.message||e}`}; }}

const STYLE_SUFFIX={CINEMATIC:'LIVE ACTION real human person, photorealistic live-action film, natural human skin texture, real face, realistic body, realistic clothing, cinematic lighting, 8k, shot on 35mm lens, shallow depth of field, not anime, not cartoon, not 3D render, not illustration',ANIME:'anime style, studio ghibli, makoto shinkai style, vibrant colors, detailed background, high quality 2d animation',PAINTING:'digital painting, oil painting texture, artistic style, concept art, artstation, masterpiece, intricate details',RENDER_3D:'3d render, unreal engine 5, octane render, global illumination, highly detailed, 8k resolution, ray tracing',COMIC_BOOK:'comic book style, graphic novel, bold outlines, halftone patterns, high contrast, dynamic lighting, marvel comics style',PIXEL_ART:'pixel art, 16-bit, retro gaming style, highly detailed pixel art, isometric perspective, vibrant colors',WATERCOLOR:'watercolor painting, soft edges, color bleeding, traditional art, ethereal, dreamy, delicate brushstrokes',CYBERPUNK:'cyberpunk style, neon lights, futuristic city, high tech, sci-fi, dark atmosphere, holographic elements',STEAMPUNK:'steampunk style, brass gears, steam powered, victorian era, intricate machinery, sepia tones, retro-futuristic',NONE:''};

async function geminiTextFast(apiKey,parts,system,jsonMode=false,timeoutMs=60000,preferredModel=''){
  const keys=String(apiKey||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  if(!keys.length) throw new Error('missing_api_key');
  let lastErr='';
  for(const key of keys){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const body={contents:[{role:'user',parts}],systemInstruction:{parts:[{text:system}]},generationConfig:{temperature:.55}};
      if(jsonMode) body.generationConfig.responseMimeType='application/json';
      const modelName=String(preferredModel||'gemini-2.0-flash-lite').trim()||'gemini-2.0-flash-lite';
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){ lastErr=data.error?.message||`http_${r.status}`; continue; }
      const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('\n').trim();
      if(text) return text;
      lastErr='empty_response';
    }catch(e){ lastErr=e.name==='AbortError'?'timeout_60s':String(e.message||e); }
    finally{ clearTimeout(timer); }
  }
  throw new Error(lastErr||'gemini_fast_failed');
}

async function geminiText(apiKey,parts,system,jsonMode=false,preferredModel=''){
  const keys=String(apiKey||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  if(!keys.length) throw new Error('missing_api_key');

  let lastErr='';
  for(const key of keys){
    let models=[];
    try{
      const listR=await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const listData=await listR.json().catch(()=>({}));
      if(!listR.ok){ lastErr=listData.error?.message||`list_models_http_${listR.status}`; }
      models=(listData.models||[])
        .filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
        .map(m=>String(m.name||'').replace(/^models\//,''))
        .filter(Boolean)
        .sort((a,b)=>{
          const score=x=> (x.includes('flash')?100:0) + (x.includes('lite')?35:0) + (x.includes('3.1')?60:0) + (x.includes('3.0')?50:0) + (x.includes('2.5')?40:0) + (x.includes('2.0')?30:0) + (x.includes('1.5')?10:0) - (x.includes('vision')?50:0) - (x==='gemini-2.0-flash-lite'?1000:0) - (x==='gemini-2.0-flash'?200:0);
          return score(b)-score(a);
        });
    }catch(e){ lastErr=`list_models_failed:${e.message||e}`; }

    // Fallback only if ListModels is unavailable; unavailable models are skipped silently.
    if(!models.length) models=['gemini-2.0-flash-lite','gemini-1.5-flash'];

    if(preferredModel){ models=[preferredModel, ...models.filter(x=>x!==preferredModel)]; }
    for(const m of models){
      try{
        console.log(`[gemini] Trying supported model ${m}`);
        const body={contents:[{role:'user',parts}],systemInstruction:{parts:[{text:system}]},generationConfig:{temperature:.7}};
        if(jsonMode) body.generationConfig.responseMimeType='application/json';
        const controller=new AbortController();
        const timeoutId=setTimeout(()=>controller.abort(),60000);
        const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal
        });
        clearTimeout(timeoutId);
        const obj=await r.json().catch(()=>({}));
        if(!r.ok){
          lastErr=obj.error?.message||`http_${r.status}`;
          console.error(`[gemini] ${m} failed: ${lastErr}`);
          continue;
        }
        const resTxt=(obj.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('\n').trim();
        if(resTxt) return resTxt;
        lastErr='empty_response';
      }catch(e){
        lastErr=String(e.message||e);
        console.error(`[gemini] ${m} exception: ${lastErr}`);
        continue;
      }
    }
  }
  throw new Error(lastErr||'gemini_failed');
}

function mimeFromFile(f){ const e=String(f||'').toLowerCase().split('.').pop(); if(e==='png')return 'image/png'; if(e==='webp')return 'image/webp'; return 'image/jpeg'; }

function imageFilesFromDir(dir) {
  if (!dir) return [];
  try {
    const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    return fs.readdirSync(dir)
      .map(f => path.join(dir, f))
      .filter(f => fs.existsSync(f) && fs.statSync(f).isFile() && exts.has(path.extname(f).toLowerCase()))
      .sort()
      .slice(0, 30);
  } catch { return []; }
}
function imageParts(files){ const out=[]; for(const f of (files||[]).slice(0,30)){ try{ out.push({inlineData:{mimeType:mimeFromFile(f),data:fs.readFileSync(f).toString('base64')}}); }catch{} } return out; }
function characterSystem(style,media,outLang='English'){
  const label = style;
  const suffix = STYLE_SUFFIX[style] || '';
  return ` Bạn là một chuyên gia kỹ sư prompt (Prompt Engineer) hàng đầu thế giới cho các mô hình AI tạo sinh như Gemini Image (Banana Pro) và Veo (Video).
    Nhiệm vụ của bạn là nhận ý tưởng thô từ người dùng và viết lại thành một prompt cực kỳ chi tiết bằng đúng ngôn ngữ được yêu cầu, chất lượng cao để tạo ra kết quả tốt nhất.

    YÊU CẦU QUAN TRỌNG NHẤT:
    1. TUYỆT ĐỐI KHÔNG THAY ĐỔI ĐỐI TƯỢNG CHÍNH: Nếu kịch bản là về "chú chó" (dog), "con mèo" (cat), hay "vật thể" (object), TUYỆT ĐỐI KHÔNG ĐƯỢC biến nó thành con người (human). Phải giữ đúng loài vật/đối tượng mà người dùng đã nhập.
    2. BÁM SÁT NỘI DUNG GỐC: Không được thay đổi cốt truyện, chủ thể, bối cảnh, cảm xúc hoặc hành động chính của người dùng. Nếu cần tránh lỗi chính sách, chỉ đổi từ ngữ/mức độ mô tả, không đổi ý cảnh. Chỉ được phép thêm các từ miêu tả chi tiết (adjectives) và các tham số kỹ thuật (technical parameters).
    3. NGÔN NGỮ ĐẦU RA BẮT BUỘC: Toàn bộ prompt, description, lời thoại và đặc biệt dòng Prompt cuối cùng phải viết bằng ${outLang}. Nếu ${outLang} là Vietnamese, không được viết prompt cuối bằng tiếng Anh, kể cả khi prompt video thường dùng tiếng Anh hoặc ví dụ nguồn có tiếng Anh; phải dịch/viết lại toàn bộ sang tiếng Việt tự nhiên.
    4. KHÔNG TỰ Ý TÓM TẮT: Nếu người dùng nhập một đoạn dài, hãy dịch và chi tiết hóa toàn bộ đoạn đó, không được tóm tắt thành một câu ngắn.
    5. Chỉ trả về nội dung prompt đã tối ưu bằng ${outLang}. Không giải thích, không thêm râu ria.
    6. Tích hợp phong cách: ${label}. (${suffix})
    7. Loại media mục tiêu: ${media === 'VIDEO' ? 'Video (Veo 3.1) - Cần mô tả chuyển động, góc máy, nhịp độ' : 'Hình ảnh (Gemini Pro Image) - Cần mô tả bố cục, ánh sáng, chi tiết tĩnh'}.
    8. Nếu reference character images được cung cấp, hãy phân tích kỹ loài vật/nhân vật, kiểu dáng, trang phục để giữ sự đồng nhất 100%.`;
}
function splitIdeas(t){return String(t||'').split(/\n+/).map(x=>x.trim()).filter(Boolean)}

async function buildCharacterLock(apiKey, characterImages) {
  const imgs = imageParts(characterImages);
  if (!imgs.length) return '';
  const structure = `# CHARACTER DNA & CHARACTER LOCK

Perform a high-fidelity fusion analysis of the reference image.
Create a "DNA profile" that captures both the stable visual markers and the immutable constraints of the subject.
Do not summarize. Use maximum precision. Objective only.

--------------------------------------------------

# 1. CHARACTER DNA (VISUAL MARKERS)
[...các mục 1-21 giữ nguyên như trước...]

--------------------------------------------------

# 2. CHARACTER LOCK (IMMUTABLE IDENTITY)
Generate a final immutable identity paragraph that MUST preserve exact face geometry, estimated age, body proportions, hairstyle, and the exact outfit currently visible in the reference image. Clothing must include garment type, silhouette, length, neckline/collar, sleeve style, fabric texture, material, color, pattern, fit, wrinkles, accessories, shoes if visible, and layering. If the subject wears a dress, explicitly say dress and never convert it into a shirt/top/skirt unless that is visually true.

--------------------------------------------------

# 3. NEGATIVE CONSTRAINTS (NEVER CHANGE)
Never change face shape, facial proportions, estimated age, gender, hairstyle, skin tone, body type, or visible outfit. Never replace a dress with a shirt, blouse, jacket, pants, school uniform, or any other garment. Never invent clothing not visible in the reference image. Never simplify clothing details.`;

  return await geminiText(apiKey, [...imgs, { text: `Analyze the reference image and output the combined CHARACTER DNA & CHARACTER LOCK using this structure:\n\n${structure}\n\nStrictly follow the structure. Output in English only. Maximum precision.` }], "You are a professional visual identity and DNA analyst. Follow the structure strictly.", false, arguments[2] || '');
}

async function buildCharacterRoster(apiKey, characterImages, scriptText=''){
  const files=(characterImages||[]).slice(0,30);
  const imgs=imageParts(files);
  if(!imgs.length) return '';
  const sys='You are a character reference mapping director. Analyze every uploaded reference image as a separate character unless clearly the same person/subject. Match each reference to possible names/roles in the script. Return concise JSON only.';
  const text=`SCRIPT TO MATCH CHARACTERS:
${scriptText||'(no script)'}

REFERENCE FILES IN ORDER:
${files.map((f,i)=>`REF_${String(i+1).padStart(2,'0')}: ${path.basename(f)}`).join('\n')}

Return JSON: {"characters":[{"id":"REF_01","likelyName":"name or role from script if identifiable","visualLock":"precise face/hair/body/clothing identity traits","usageRule":"when this character appears in scene prompts, include this REF id and visual lock"}]}. Include every uploaded reference. Do not merge different characters.`;
  try{ const out=await geminiText(apiKey,[...imgs,{text}],sys,true); return String(out||'').replace(/^```json\s*|```$/g,'').trim(); }
  catch(e){ return JSON.stringify({characters:files.map((f,i)=>({id:`REF_${String(i+1).padStart(2,'0')}`,likelyName:path.basename(f).replace(/\.[^.]+$/,''),visualLock:`Reference image ${i+1}: ${path.basename(f)}`,usageRule:'Use this exact reference ID when this character appears.'}))}); }
}


async function fetchUrlReadable(url){
  const u=String(url||'').trim();
  if(!/^https?:\/\//i.test(u)) throw new Error('invalid_url');
  const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),25000);
  try{
    const r=await fetch(u,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 FlowAutoPro AI Script Analyzer','Accept':'text/html,text/plain,application/json,video/*,*/*'},signal:controller.signal});
    const ct=String(r.headers.get('content-type')||'').toLowerCase();
    const finalUrl=r.url||u;
    if(ct.startsWith('video/')||/\.(mp4|mov|webm|mkv|m4v)(\?|$)/i.test(finalUrl)){
      return {url:finalUrl,contentType:ct,isDirectVideo:true,title:path.basename(finalUrl.split('?')[0]),text:`Direct video URL: ${finalUrl}. This URL points to a downloadable video file.`};
    }
    let txt=await r.text();
    if(ct.includes('html')||/<html[\s>]/i.test(txt)){
      const title=(txt.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
      txt=txt.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ')
        .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
      return {url:finalUrl,contentType:ct,title:title.replace(/\s+/g,' ').trim(),text:txt.slice(0,25000)};
    }
    return {url:finalUrl,contentType:ct,title:'',text:String(txt||'').replace(/\s+/g,' ').trim().slice(0,25000)};
  }finally{clearTimeout(t);}
}


async function downloadVideoForAnalysis(url){
  const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 FlowAutoPro Video Analyzer','Accept':'video/*,*/*'},signal:controller.signal});
    if(!r.ok) throw new Error('http_'+r.status);
    const len=Number(r.headers.get('content-length')||0);
    if(len && len>90*1024*1024) throw new Error('video_too_large_max_90mb');
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length>90*1024*1024) throw new Error('video_too_large_max_90mb');
    const ext=(String(new URL(r.url||url).pathname).match(/\.(mp4|mov|webm|mkv|m4v)$/i)||[])[0]||'.mp4';
    const dir=path.join(JOB_DIR,'url-video-analysis-'+Date.now()); fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'source'+ext); fs.writeFileSync(file,buf);
    return {file,dir,bytes:buf.length};
  }finally{clearTimeout(t);}
}
function extractAnalysisFrames(file,dir,maxFrames=16){
  const pattern=path.join(dir,'url_frame_%02d.jpg');
  const r=ffmpegRun(['-y','-i',file,'-vf','fps=1/2,scale=640:-1','-frames:v',String(maxFrames),pattern]);
  if(r.status!==0) throw new Error('url_video_frame_extract_failed:'+ffErr(r));
  return fs.readdirSync(dir).filter(x=>/^url_frame_\d+\.jpe?g$/i.test(x)).map(x=>path.join(dir,x)).slice(0,maxFrames);
}





function subtitlePromptRule(payload,outLang='English',voiceLang=''){
  const isVietnamese=outLang==='Vietnamese' && String(voiceLang||'').toLowerCase().includes('vietnamese');
  const enabled=String(payload?.promptSubtitles||'off')==='on';
  if(enabled && isVietnamese) return 'PHỤ ĐỀ: Có hiển thị phụ đề tiếng Việt đồng bộ chính xác với lời dẫn/lời thoại. Dùng font Unicode tiếng Việt chuẩn như Be Vietnam Pro hoặc Noto Sans Vietnamese, đầy đủ dấu, không lỗi font, không ký tự ô vuông, không sai dấu; chữ rõ, dễ đọc, căn giữa phía dưới, không che chủ thể.';
  if(enabled) return `SUBTITLES: Display subtitles synchronized with speech, using a fully compatible Unicode font for ${outLang}, clear and readable at the bottom without covering the subject.`;
  return outLang==='Vietnamese' ? 'PHỤ ĐỀ: Không hiển thị phụ đề, không chèn chữ, caption, văn bản hoặc ký tự lên video.' : 'SUBTITLES: Do not display subtitles, captions, text, letters, or on-screen typography.';
}
function enforceSubtitleInPrompt(prompt,payload,outLang='English',voiceLang=''){
  const p=String(prompt||'').replace(/\s+$/,'');
  const rule=subtitlePromptRule(payload,outLang,voiceLang);
  if(p.includes(rule)) return p;
  return `${p}\n${rule}`;
}

function extractVoiceFromScene(text){
  const raw=String(text||'').trim();
  const m=raw.match(/(?:Voiceover|Lời dẫn\/Voiceover|Lời thoại\/Voice|Lời thoại|Voice)\s*:\s*([\s\S]*?)(?:\n\s*(?:Scene\s*\d+|Hình ảnh|Hành động|Cảm xúc|Camera|Ánh sáng|Prompt)\s*:|$)/i);
  if(m) return String(m[1]||'').trim().replace(/^"|"$/g,'');
  // When caller passes only the voice text (no label), still preserve it.
  if(raw && !/\n/.test(raw) && raw.length>8) return raw.replace(/^"|"$/g,'');
  return '';
}
function enforceVoiceInPrompt(prompt, source, outLang='Vietnamese', voiceLang=''){
  const voice=extractVoiceFromScene(source);
  if(!voice) return prompt;
  let p=String(prompt||'').trim();
  const hasVoiceLabel=/(Voiceover|Lời dẫn|Lời thoại|Voice)\s*:/i.test(p);
  const accent=voiceLang||'tiếng Việt tự nhiên';
  if(outLang==='Vietnamese'){
    const block=`\nLời dẫn/Voiceover: "${voice}"\nLời thoại nhân vật: Không có, chỉ dùng lời dẫn voiceover nếu cảnh không có nhân vật nói trực tiếp.\nGiọng đọc/Voice: ${accent}.`;
    if(p.includes(voice) && hasVoiceLabel) return p;
    if(p.includes(voice) && !hasVoiceLabel) p=p.replace(voice, `Lời dẫn/Voiceover: "${voice}"`);
    return `${p}${block}`;
  }
  const block=`\nVoiceover: "${voice}"\nCharacter dialogue: None unless the scene explicitly has a speaking character.\nVoice: ${accent}.`;
  if(p.includes(voice) && hasVoiceLabel) return p;
  return `${p}${block}`;
}

function looksEnglishHeavy(text){
  const t=String(text||'').toLowerCase();
  const hits=(t.match(/\b(the|and|with|in|on|a|an|of|to|for|from|cinematic|lighting|camera|shot|close|wide|medium|ultra|detailed|realistic|high-tech|glowing|background|character|voice|speaks|scene|prompt)\b/g)||[]).length;
  const vi=(t.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g)||[]).length;
  return hits>=5 && vi<8;
}
async function ensureOutputLanguageText(apiKey,text,outLang='English',apiModel){
  let t=String(text||'').trim();
  if(outLang!=='Vietnamese' || !looksEnglishHeavy(t)) return t;
  try{
    const sys='Bạn là bộ chuyển ngữ prompt. Chỉ trả về prompt đã viết lại bằng tiếng Việt tự nhiên, không giải thích.';
    const req=`Viết lại toàn bộ nội dung sau sang tiếng Việt tự nhiên. Giữ nguyên ý, chủ thể, hành động, bối cảnh, cảm xúc, camera, ánh sáng. Không thêm nhân vật nếu không có. Không bỏ chi tiết. Không dùng tiếng Anh trừ tên riêng bất khả kháng.\n\nNỘI DUNG:\n${t}`;
    const out=await geminiText(apiKey,[{text:req}],sys,false,apiModel);
    if(out && !looksEnglishHeavy(out)) t=out;
  }catch{}
  return policySafePostProcess(t,outLang);
}

function finalPromptLanguageRule(outLang='English'){
  if(outLang==='Vietnamese') return 'BẮT BUỘC: trường prompt / dòng Prompt cuối cùng phải là tiếng Việt 100%. Không viết prompt cuối bằng tiếng Anh. Dịch các cụm như cinematic lighting, close-up, wide shot, ultra-detailed, 8k resolution sang tiếng Việt tự nhiên. Chỉ giữ tên riêng bất khả kháng.';
  return `The final prompt field must be written in ${outLang}.`;
}

function policySafeInstruction(outLang='English'){
  if(outLang==='Vietnamese') return `YÊU CẦU AN TOÀN NỘI DUNG CHO GOOGLE/FLOW: Giữ nguyên cốt truyện, nhân vật, bối cảnh, cảm xúc và hành động chính của kịch bản. Chỉ thay đổi CÁCH DIỄN ĐẠT các chi tiết có rủi ro chính sách thành phiên bản điện ảnh an toàn, không làm lệch ý hoặc đổi nội dung chính. Không dùng hoặc mô tả trực diện các nội dung dễ bị chặn: khỏa thân, gợi dục, tình dục, trẻ em trong tình huống nhạy cảm, máu me, thương tích nặng, giết chóc, vũ khí thật, tự hại, ma túy, thù ghét, phân biệt chủng tộc, người nổi tiếng/người thật có danh tính, thương hiệu/logo/bản quyền, lừa đảo, hướng dẫn nguy hiểm hoặc hoạt động phạm pháp. Nếu ý tưởng gốc có yếu tố nhạy cảm, hãy giữ cùng vai trò trong cảnh nhưng chuyển thành phiên bản an toàn: hồi hộp nhưng không bạo lực, xung đột không máu me, trang phục kín đáo, nhân vật hư cấu trưởng thành, không logo/không thương hiệu, không nêu tên người nổi tiếng. Ưu tiên mô tả cảnh quay, ánh sáng, cảm xúc, chuyển động máy quay, môi trường, màu sắc, hành động đời thường an toàn. Không viết các từ khóa nhạy cảm nếu có thể thay bằng mô tả trung tính.`;
  return `GOOGLE/FLOW CONTENT-SAFE REQUIREMENT: Preserve the original script's plot, characters, setting, emotion, and main action. Only rewrite policy-risk wording into safe cinematic phrasing without changing the core meaning. Do not use or directly describe commonly blocked content: nudity, sexual content, minors in sensitive contexts, gore, severe injury, killing, real weapons, self-harm, drugs, hate, racism, identifiable real people/celebrities, brands/logos/copyrighted IP, scams, dangerous instructions, or illegal activity. If the source idea contains sensitive elements, preserve the same story function but rewrite it into a safe version: suspenseful but non-graphic, conflict without gore, modest clothing, fictional adult characters, no logos/brands, no celebrity names. Prioritize camera movement, lighting, emotion, environment, colors, and safe everyday actions. Avoid sensitive keywords when a neutral description works.`;
}
function policySafePostProcess(text,outLang='English'){
  let t=String(text||'').trim();
  const reps=[
    [/\b(blood|bloody|gore|gory|kill|killing|murder|murdered|corpse|dead body)\b/gi,'dramatic non-graphic tension'],
    [/\b(gun|rifle|pistol|knife|bomb|explosive)\b/gi,'non-dangerous prop'],
    [/\b(nude|naked|sexy|sexual|erotic|porn|lingerie)\b/gi,'modest cinematic outfit'],
    [/\b(drug|cocaine|heroin|meth)\b/gi,'safe fictional object'],
    [/\b(celebrity|famous actor|real person)\b/gi,'fictional character'],
    [/(logo|brand|trademark)/gi,'generic unbranded detail'],
    [/(máu me|đẫm máu|giết|giết chóc|xác chết|thi thể|súng|dao|bom|khỏa thân|khiêu dâm|gợi dục|ma túy|người nổi tiếng|logo|thương hiệu)/gi,'chi tiết điện ảnh an toàn, không trực diện']
  ];
  for(const [a,b] of reps) t=t.replace(a,b);
  if(outLang==='Vietnamese'){
    t=t.replace(/CHARACTER_REFERENCE\s*\/\s*FACE_IDENTITY_LOCK/gi,'KHÓA NHẬN DẠNG NHÂN VẬT')
      .replace(/NO REFERENCE IMAGE MODE/gi,'CHẾ ĐỘ KHÔNG CÓ ẢNH THAM CHIẾU')
      .replace(/UNIQUE SCENE/gi,'CẢNH RIÊNG BIỆT')
      .replace(/Use the uploaded reference image as the exact identity source/gi,'Dùng ảnh tham chiếu đã upload làm nguồn nhận dạng chính xác')
      .replace(/Same character throughout/gi,'Giữ cùng một nhân vật xuyên suốt')
      .replace(/Keep face, hair, age, body type, and main outfit consistent/gi,'Giữ khuôn mặt, tóc, độ tuổi, vóc dáng và trang phục chính đồng nhất');
  }
  return t;
}

function lockPrompt(prompt, characterLock, outLang='English'){
  if(!characterLock) return prompt;
  const guard = outLang==='Vietnamese' ? `CHARACTER_REFERENCE / FACE_IDENTITY_LOCK: Dùng ảnh tham chiếu đã upload làm nguồn nhận dạng tuyệt đối. Giữ chính xác hình học khuôn mặt, mắt, mũi, môi, xương hàm, màu da, kiểu tóc, đường chân tóc, tỉ lệ khuôn mặt, trang phục, dáng người, thần thái và biểu cảm. Không thiết kế lại, không làm đẹp khác đi, không đổi phong cách, tuổi hoặc giới tính. Chỉ lấy nhân vật từ ảnh tham chiếu; tuyệt đối không lấy bối cảnh, môi trường, ánh sáng hoặc phòng nền của ảnh tham chiếu vào cảnh video mới. Giữ cùng một nhân vật xuyên suốt: ${characterLock}. Giữ nguyên khuôn mặt, tóc, độ tuổi, vóc dáng và trang phục đang mặc trong ảnh tham chiếu: đúng loại trang phục, màu, chất liệu, hoa văn, độ dài, cổ áo, tay áo, phụ kiện và giày nếu thấy. Nếu ảnh mặc váy thì mọi prompt phải ghi váy, không đổi thành áo/quần. ` : outLang==='Chinese' ? `始终保持同一个角色：${characterLock}。保持相同的脸、头发、年龄、体型和主要服装。 ` : outLang==='Korean' ? `전체 장면에서 동일한 캐릭터 유지: ${characterLock}. 얼굴, 머리, 나이, 체형, 주요 의상을 그대로 유지. ` : outLang==='Spanish' ? `Mantener el mismo personaje en todo momento: ${characterLock}. Conservar rostro, cabello, edad, tipo de cuerpo y atuendo principal. ` : `CHARACTER_REFERENCE / FACE_IDENTITY_LOCK: Use the uploaded reference image as the exact identity source. Preserve exact face geometry, eyes, nose, lips, jawline, skin tone, hairstyle, hairline, facial proportions, clothing, body posture and expression/aura. Do not redesign, beautify, stylize, age-change or gender-change. Use ONLY the character from the reference image; do NOT copy the reference image background/environment/lighting into the new video scene. Same character throughout: ${characterLock}. Keep face, hair, age, body type, and main outfit consistent. `;
  const p=String(prompt||'').trim();
  return p.includes('CHARACTER CONSISTENCY LOCK') ? p : guard + p;
}


function compactForCompare(text){
  return String(text||'').toLowerCase().replace(/character_reference[^.]+\./g,' ').replace(/face_identity_lock[^.]+\./g,' ').replace(/[^a-z0-9\u00c0-\u1ef9]+/gi,' ').replace(/\s+/g,' ').trim();
}
function similarityScore(a,b){
  const A=new Set(compactForCompare(a).split(' ').filter(x=>x.length>3));
  const B=new Set(compactForCompare(b).split(' ').filter(x=>x.length>3));
  if(!A.size||!B.size) return 0;
  let hit=0; for(const x of A) if(B.has(x)) hit++;
  return hit/Math.min(A.size,B.size);
}
function enforceUniqueScenePrompts(scenes,outLang='English'){
  const out=[];
  for(const sc of scenes){
    let prompt=String(sc.prompt||'').replace(/\s+/g,' ').trim();
    const desc=String(sc.description||'').replace(/\s+/g,' ').trim();
    const duplicate=out.some(prev=>similarityScore(prev.prompt,prompt)>0.82);
    if(duplicate){
      const tag=outLang==='Vietnamese'
        ? ` CẢNH RIÊNG BIỆT ${sc.sceneNumber}: bám đúng mô tả cảnh này, không lặp lại hành động/góc máy/bối cảnh của cảnh trước. Nội dung cảnh này: ${desc}.`
        : ` UNIQUE SCENE ${sc.sceneNumber}: follow this scene only, do not repeat previous scene action/camera/setting. This scene content: ${desc}.`;
      prompt=(prompt+' '+tag).trim();
    }
    out.push({...sc,prompt});
  }
  return out;
}


function formatSceneBlock(sc,outLang='Vietnamese'){
  const n=String(sc.sceneNumber||'').padStart(2,'0');
  const visual=sc.visual||sc.image||sc.hinhAnh||sc.description||'';
  const action=sc.action||sc.hanhDong||'';
  const emotion=sc.emotion||sc.camXuc||'';
  const camera=sc.cameraLighting||sc.camera||sc.gocMayAnhSang||'';
  const voice=sc.voice||sc.dialogue||sc.loiThoai||'';
  const prompt=sc.prompt||'';
  if(outLang==='Vietnamese'){
    return `Scene ${n}:\n- Thời lượng: ${sc.duration||'8 giây'}\n- Hình ảnh: ${visual}\n- Hành động: ${action}\n- Cảm xúc: ${emotion}\n- Góc máy & Ánh sáng: ${camera}\n- Lời thoại/Voice: ${voice}\n- Prompt: "${String(prompt).replace(/^"|"$/g,'')}"`;
  }
  return `Scene ${n}:\n- Duration: ${sc.duration||'8 seconds'}\n- Visual: ${visual}\n- Action: ${action}\n- Emotion: ${emotion}\n- Camera & Lighting: ${camera}\n- Dialogue/Voice: ${voice}\n- Prompt: "${String(prompt).replace(/^"|"$/g,'')}"`;
}

function writeGenerated(name,prompts){ const file=path.join(JOB_DIR,name); fs.writeFileSync(file,prompts.map(x=>String(x).replace(/\s+/g,' ').trim()).filter(Boolean).join('\n\n')+'\n','utf8'); return {file,count:prompts.length,prompts}; }
function writeScriptText(obj){
  const file=path.join(JOB_DIR,'electron-ai-video-script.txt');
  const outLang=obj.outLang||'Vietnamese';
  const scenes=(obj.scenes||[]).sort((a,b)=>(a.sceneNumber||0)-(b.sceneNumber||0));
  const lines=[`TITLE: ${obj.title||''}`, obj.characterSheet?`CHARACTER SHEET:\n${obj.characterSheet}`:'', 'SCENES:', ...scenes.map(s=>formatSceneBlock(s,outLang))].filter(Boolean);
  fs.writeFileSync(file,lines.join('\n\n'),'utf8');
  return file;
}
function langName(code){ return ({vi:'Vietnamese',en:'English',zh:'Chinese',ko:'Korean',es:'Spanish'}[String(code||'en')]||'English'); }
function voiceLangName(code){ const v=String(code||'vi_south'); if(v==='en')return 'English'; if(v==='vi_north')return 'Vietnamese Northern accent (giọng Bắc)'; return 'Vietnamese Southern accent (giọng Nam)'; }
function hasReferenceImages(payload){
  const direct=Array.isArray(payload.characterImages)&&payload.characterImages.length>0;
  const dir=payload.refsDir ? imageFilesFromDir(payload.refsDir).length>0 : false;
  return !!(direct||dir);
}
async function generatePromptsJs(payload){
  const apiKey=payload.apiKey||''; const style=payload.style||'CINEMATIC'; const media=payload.mediaType||'IMAGE'; const outLang=langName(payload.promptLang); const voiceLang=voiceLangName(payload.voiceLang);
  const sys=characterSystem(style,media,outLang); const hasRefs=Array.isArray(payload.characterImages)&&payload.characterImages.length>0; const imgs=imageParts(payload.characterImages); const characterLock=hasRefs?await buildCharacterLock(apiKey,payload.characterImages):''; const characterRoster=hasRefs?await buildCharacterRoster(apiKey,payload.characterImages,payload.ideas||''):'';
  const results=[];
  for(const idea of splitIdeas(payload.ideas)){
    const refInstruction = hasRefs
      ? (outLang==='Vietnamese'
        ? `CHẾ ĐỘ CÓ ẢNH THAM CHIẾU: Dùng ảnh đã upload làm nguồn nhận dạng nhân vật. KHÓA NHÂN VẬT CẦN GIỮ CHÍNH XÁC:\n${characterLock}\n\nChỉ dùng nhân vật tham chiếu khi cảnh yêu cầu nhân vật đó. Giữ mặt, tóc, trang phục, vóc dáng và biểu cảm theo ảnh; bối cảnh/môi trường phải lấy từ mô tả cảnh, không lấy từ ảnh tham chiếu.`
        : `REFERENCE IMAGE MODE: Use uploaded images as the character identity source. CHARACTER LOCK TO KEEP EXACTLY:\n${characterLock}\n\nUse referenced characters only when the scene requires them. Keep face, hair, outfit, body type and expression from the image; generate the background/environment from the scene description, never from the reference image.`)
      : (outLang==='Vietnamese'
        ? `CHẾ ĐỘ KHÔNG CÓ ẢNH THAM CHIẾU: Không có ảnh nhân vật. Không tự tạo nhân vật chính cố định, không tạo Character Sheet, không thêm REF_ID, không khóa mặt, không thêm người nếu prompt không yêu cầu. Viết đúng chủ thể trong mô tả từng prompt. Nếu prompt là phong cảnh, sản phẩm, con vật, đồ vật, địa điểm hoặc ý tưởng trừu tượng thì giữ đúng chủ thể đó, không biến thành người.`
        : `NO REFERENCE IMAGE MODE: There are no uploaded character images. Do not invent a fixed main character, character sheet, REF_ID, face identity lock, or recurring identity unless the user's scene explicitly describes one. Write only what the scene/prompt describes. If the prompt is about landscape, product, animal, object, location, or abstract concept, keep that subject and do not add a human character.`);
    const prompt=await geminiText(apiKey,[...imgs,{text:`${refInstruction}\n\nNội dung cảnh/prompt cần tạo: ${idea}\nYÊU CẦU NGÔN NGỮ BẮT BUỘC: ${finalPromptLanguageRule(outLang)} Toàn bộ prompt cuối cùng phải viết bằng ${outLang}. Nếu ${outLang} là Vietnamese, mọi mô tả, quy tắc, cảnh quay, ánh sáng, camera, cảm xúc và lời thoại phải viết bằng tiếng Việt; không dùng tiếng Anh trừ tên riêng bất khả kháng. Bám đúng nội dung, chủ thể, hành động, bối cảnh và cảm xúc của prompt gốc. Không thêm nhân vật, đạo cụ, tuyến truyện hoặc danh tính mới nếu đầu vào không có. Nếu đầu vào có dòng Voiceover, Lời dẫn/Voiceover, Lời thoại/Voice hoặc Lời thoại, BẮT BUỘC prompt cuối phải có nhãn rõ ràng: Lời dẫn/Voiceover: "..."; Lời thoại nhân vật: ...; Giọng đọc/Voice: ${voiceLang}. Không được chỉ mô tả hình ảnh mà bỏ phần lời. Nếu cảnh có lời thoại, nhân vật nói bằng ${voiceLang} và giữ đồng nhất. Chỉ đổi cách diễn đạt nhạy cảm thành cách nói an toàn. ${policySafeInstruction(outLang)}`}],sys,false);
    const withVoice=enforceSubtitleInPrompt(enforceVoiceInPrompt(policySafePostProcess(lockPrompt(prompt,characterLock,outLang),outLang), idea, outLang, voiceLang),payload,outLang,voiceLang);
    results.push(await ensureOutputLanguageText(apiKey, withVoice, outLang, payload.apiModel));
  }
  return {ok:true,characterLock,characterRoster,generated:writeGenerated('electron-ai-generated-prompts.txt',results)};
}
function durationScenes(d){ const s=String(d||'60 seconds').toLowerCase(); let sec=0; let m=s.match(/(\d+)\s*(m|minute|phút)/); if(m)sec+=Number(m[1])*60; m=s.match(/(\d+)\s*(s|second|giây)/); if(m)sec+=Number(m[1]); if(!sec){m=s.match(/^(\d+)$/); if(m)sec=Number(m[1])*60;} return Math.max(1,Math.ceil((sec||60)/8)); }

function characterSuffixByLang(style, outLang){
  if(outLang==='Vietnamese'){
    if(style==='CINEMATIC') return 'phong cách LIVE ACTION người thật, ảnh chụp điện ảnh siêu thực, da người tự nhiên, khuôn mặt thật, cơ thể thật, quần áo thật, ánh sáng điện ảnh, không anime, không hoạt hình, không 3D, không tranh vẽ';
    const m={
      ANIME:'phong cách anime chất lượng cao', PAINTING:'phong cách tranh vẽ nghệ thuật', RENDER_3D:'phong cách render 3D chi tiết', COMIC_BOOK:'phong cách truyện tranh', PIXEL_ART:'phong cách pixel art', WATERCOLOR:'phong cách màu nước', CYBERPUNK:'phong cách cyberpunk tương lai', STEAMPUNK:'phong cách steampunk cổ điển', NONE:'phong cách hình ảnh tự nhiên'
    };
    return m[style]||'phong cách hình ảnh điện ảnh';
  }
  if(style==='CINEMATIC') return 'LIVE ACTION real human person, photorealistic portrait/full-body photography, natural human skin texture, real face, realistic clothing, realistic lighting, cinematic live-action camera, not anime, not cartoon, not 3D render, not illustration';
  return STYLE_SUFFIX[style]||'';
}
function singleCharacterPromptText(raw, fallback, idx, suffix, outLang='English'){
  let body=String(raw||'').replace(/^Prompt\s*\d+\s*:\s*/i,'').trim();
  body=body.split(/(?:\n|\s)(?:Prompt|Option|Alternative|Version|Biến thể|Phương án|Lựa chọn|Phiên bản)\s*0?2\s*[:.-]/i)[0].trim();
  body=body.replace(/```[a-z]*|```/gi,'').replace(/\s+/g,' ').trim();
  if(!body) body=String(fallback||'').trim();
  // Do not expose character names directly; force visual-description wording in final prompt.
  if(outLang==='Vietnamese'){
    body=body
      .replace(/\bSingle character only\b/gi,'chỉ một nhân vật')
      .replace(/\bsolo portrait\/full-body image\b/gi,'ảnh chân dung hoặc toàn thân một người')
      .replace(/\bno alternate prompts\b/gi,'không tạo biến thể prompt')
      .replace(/\bno second character\b/gi,'không có nhân vật thứ hai')
      .replace(/\bfull character design\b/gi,'thiết kế nhân vật đầy đủ')
      .replace(/\breal human\b/gi,'người thật')
      .replace(/\bphotorealistic\b/gi,'siêu thực như ảnh chụp')
      .replace(/\blive action\b/gi,'người thật đóng phim')
      .replace(/\bbackground\b/gi,'bối cảnh')
      .replace(/\boutfit\b/gi,'trang phục')
      .replace(/\bpose\b/gi,'tư thế')
      .replace(/\bexpression\b/gi,'biểu cảm')
      .replace(/\baccessories\b/gi,'phụ kiện');
    return `Prompt ${String(idx+1).padStart(2,'0')}: ${body}. Không ghi trực tiếp tên nhân vật; chỉ mô tả ngoại hình thật chính xác 100% gồm khuôn mặt, mắt, mũi, môi, xương hàm, kiểu tóc, màu tóc, vóc dáng, trang phục, chất liệu quần áo, màu sắc và phụ kiện. Chỉ tạo một nhân vật duy nhất trong ảnh, đúng một prompt cho nhân vật này, không tạo biến thể, không thêm nhân vật thứ hai, ảnh chân dung hoặc toàn thân một người, ${suffix}`;
  }
  return `Prompt ${String(idx+1).padStart(2,'0')}: ${body}. Do not write the character name directly; describe the visual identity with 100% accuracy, including face shape, eyes, nose, lips, jawline, hairstyle, hair color, body shape, outfit, clothing material, colors, and accessories. Single character only, exactly one image prompt for this character, no alternate prompts, no second character, solo portrait/full-body image, ${suffix}`;
}

async function generateCharacterPromptsJs(payload){
  const apiKey=payload.apiKey||'';
  const style=payload.style||'CINEMATIC';
  const outLang=langName(payload.promptLang);
  const suffix=characterSuffixByLang(style,outLang);
  const lines=String(payload.ideas||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length) return {ok:false,error:'missing_character_ideas'};

  const sys=`You are a visual prompt creator. Output valid JSON only. Output language: ${outLang}. Visual style: ${style}. Every item must be one standalone single-subject image prompt. Apply content-safe wording for Google/Flow. NEVER include nudity, sexualized wording, gore, weapons, drugs, hate, real celebrities, brands/logos, copyrighted IP, or dangerous/illegal instructions. NEVER turn animals or creatures into humans. Keep the subject type EXACTLY as described (dog remains dog, cat remains cat). Never create group scenes. Never combine subjects. Never mention the subject name directly; infer and describe the subject visually with maximum accuracy. If output language is Vietnamese, every word in the prompt must be Vietnamese except unavoidable proper names.`;
  const prompt=`Create exactly ${lines.length} separate image prompts from the input list. If an input line is a known character/person name, do not output that name; infer the visual appearance and describe it precisely instead.

CRITICAL RULES:
- Return ONLY valid JSON: {"prompts":["Prompt 01: ...", "Prompt 02: ..."]}
- The JSON array length MUST be exactly ${lines.length}.
- Each input line becomes exactly ONE output prompt.
- Each output prompt must contain exactly ONE character only and exactly ONE prompt text only.
- Do NOT include other characters from the list inside a prompt.
- Do NOT create a group image.
- Do NOT merge multiple lines. Do NOT generate alternatives, versions, Prompt 02/03 inside one item, or multiple prompt variants for the same character.
- Each prompt must include: face shape, eyes, nose, lips, jawline, hairstyle, hair color, outfit, pose, expression, body type, accessories, background/environment.
- Do NOT mention or output the character name directly. Convert the name/input into a precise visual description only.
- Style suffix for every prompt: ${suffix}
- Write every prompt in ${outLang}. If ${outLang} is Vietnamese, do not use English style terms; translate all descriptions and constraints to Vietnamese.

INPUT CHARACTER LINES:
${lines.map((x,i)=>`${i+1}. ${x}`).join('\n')}`;

  let text='';
  try{
    text=await geminiTextFast(apiKey,[{text:prompt}],sys,true,60000,payload.apiModel);
  }catch(e){
    // Fallback to normal text mode if JSON mode is not supported/quota model behavior differs.
    text=await geminiTextFast(apiKey,[{text:prompt}],sys,false,60000,payload.apiModel);
  }

  let prompts=[];
  try{
    const clean=String(text||'').replace(/^```json\s*|^```\s*|```$/g,'').trim();
    const obj=JSON.parse(clean);
    prompts=Array.isArray(obj)?obj:(Array.isArray(obj.prompts)?obj.prompts:[]);
  }catch{}

  if(!prompts.length){
    prompts=String(text||'').split(/\n\s*(?=Prompt\s*\d+\s*:)/i).map(x=>x.trim()).filter(Boolean);
  }

  // Final guard: force one output item per input line even if Gemini under/over returns.
  prompts=prompts.slice(0,lines.length).map((x,i)=>singleCharacterPromptText(x, lines[i], i, suffix, outLang));
  while(prompts.length<lines.length){
    const i=prompts.length;
    prompts.push(singleCharacterPromptText('', outLang==='Vietnamese' ? `${lines[i]}. khuôn mặt chi tiết, kiểu tóc, trang phục, tư thế, biểu cảm, vóc dáng, phụ kiện, bối cảnh phù hợp` : `${lines[i]}. detailed face, hairstyle, outfit, pose, expression, body type, accessories, matching background`, i, suffix, outLang));
  }

  const generated=writeGenerated(`character_prompts_${Date.now()}.txt`, prompts);
  return {ok:true,generated:{file:generated.file,count:prompts.length,prompts}};
}

function referenceName(file){ return path.basename(String(file||''),path.extname(String(file||''))).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
function labeledImageParts(files){ const out=[]; for(const f of (files||[]).slice(0,30)){try{out.push({text:`REFERENCE FILE NAME / CHARACTER NAME HINT: ${referenceName(f)}`});out.push({inlineData:{mimeType:mimeFromFile(f),data:fs.readFileSync(f).toString('base64')}})}catch{}}return out;}
async function buildObservableCharacterMasters(apiKey,files,script,preferredModel=''){
  if(!files.length)return {masters:[],text:''};
  const sys=`Bạn là chuyên gia phân tích nhân vật từ ảnh tham chiếu. Chỉ mô tả đặc điểm quan sát được; không suy đoán danh tính, quốc tịch, nghề nghiệp hay dữ liệu cá nhân. Tên file là gợi ý tên nhân vật để nối với kịch bản, không phải bằng chứng về danh tính. Phân tích riêng từng ảnh/người, không trộn đặc điểm. Không dùng FACE_IDENTITY_LOCK, CHARACTER_IDENTITY_LOCK, BIOMETRIC LOCK, exact identity replication, clone face hoặc thuật ngữ sao chép sinh trắc học. Trả JSON {"masters":[{"name":"tên từ file","aliases":[],"subjectNumber":1,"role":"","genderPresentation":"","ageRange":"","appearance":"","face":"","hair":"","physique":"","wardrobe":"","expression":"","visibleOnlyNotes":""}]}. Wardrobe phải đúng loại đồ nhìn thấy; không bịa phần bị khuất.`;
  const parts=[...labeledImageParts(files),{text:`SCRIPT CHARACTER NAMES AND CONTEXT:\n${String(script||'').slice(0,30000)}\nMatch only explicit character names to reference file names.`}];
  const raw=await geminiText(apiKey,parts,sys,true,preferredModel); const obj=JSON.parse(String(raw).replace(/^```json\s*|```$/g,''));
  const masters=Array.isArray(obj.masters)?obj.masters:[];
  const text=masters.map((m,i)=>`SUBJECT ${m.subjectNumber||i+1} — ${m.name||m.role||'CHARACTER'}\nAppearance: ${m.appearance||''}\nFace: ${m.face||''}\nHair: ${m.hair||''}\nPhysique: ${m.physique||''}\nWardrobe: ${m.wardrobe||''}\nExpression / Presence: ${m.expression||''}`).join('\n\n');
  return {masters,text};
}
function observablePromptFormatInstruction(masterText,speakerGender,voiceLang,subtitleRule){
  const gender=speakerGender==='female'?'female':'male';
  return `MANDATORY FINAL PROMPT FORMAT, output only the complete prompt and no analysis commentary:\nCHARACTER VISUAL REFERENCE\nCHARACTER MASTER DESCRIPTION\n${masterText}\nCHARACTER CONTINUITY\nUse uploaded references as visual guidance for observable appearance, hairstyle, wardrobe, body proportions and presentation. Maintain strong visual continuity.\nREFERENCE IMAGE BOUNDARY\nUse references only for character appearance and wardrobe. Do not reproduce reference background, room, objects, lighting or camera composition unless the scene explicitly requests it.\nSCENE [NUMBER] — [SHORT TITLE]\nENVIRONMENT\nCHARACTER POSITION\nACTION\nCAMERA\nMOTION\nLIGHTING\nVISUAL STYLE\nVOICEOVER\nCHARACTER DIALOGUE\nON-SCREEN TEXT\nSCENE CONTINUITY\nDistinguish character description from scene/environment. Match character names in the script to reference filename names; never mix Subjects. Include only characters named or required in that scene. Preserve observable face structure/proportions, age range, skin tone, hair, physique, garment category/design/colors, accessories and visible footwear. Do not invent hidden details. Do not use FACE_IDENTITY_LOCK, CHARACTER_IDENTITY_LOCK, BIOMETRIC LOCK, absolute identity source, exact identity replication, 100% identical face, clone face, copy biometric identity, or replicate exact identity. The only direct speaking/lip-sync character gender is ${gender}. Other characters have no direct dialogue unless explicitly required. Voice/accent: ${voiceLang}. ${subtitleRule}`;
}
async function generateScriptJs(payload){
  const totalScenes=durationScenes(payload.duration);
  const refImages = (payload.refsDir ? imageFilesFromDir(payload.refsDir) : []).concat(payload.characterImages || []);
  const imgs=labeledImageParts(refImages);
  const hasRefs=hasReferenceImages(payload);
  const observed=hasRefs?await buildObservableCharacterMasters(payload.apiKey,refImages,payload.topic||'',payload.apiModel):{masters:[],text:''};
  let characterSheet=observed.text;
  const style=payload.style||'CINEMATIC';
  const outLang=langName(payload.promptLang);
  const voiceLang=voiceLangName(payload.voiceLang);
  const speakerGender=String(payload.speakerGender||'male');
  const structuredFormat=observablePromptFormatInstruction(characterSheet,speakerGender,voiceLang,subtitlePromptRule(payload,outLang,voiceLang));
  const batchSize=20;
  const batches=Math.ceil(totalScenes/batchSize);
  let title=''; const allScenes=[];
  for(let i=0;i<batches;i++){
    const startScene=i*batchSize+1;
    const endScene=Math.min((i+1)*batchSize,totalScenes);
    const sceneCount=endScene-startScene+1;
    const sys=` Bạn là một chuyên gia biên kịch và đạo diễn hình ảnh chuyên nghiệp.
      Nhiệm vụ của bạn là tạo ra một phần của kịch bản video chi tiết dựa trên chủ đề yêu cầu.
      
      YÊU CẦU BẮT BUỘC ĐỂ KHÔNG BỊ LỖI NỘI DUNG:
      1. TRUNG THÀNH VỚI CHỦ ĐỀ: Không được tự ý sáng tạo nội dung lệch khỏi yêu cầu của người dùng. Nếu người dùng nhập kịch bản sẵn, hãy phân bổ nó vào các cảnh thay vì viết mới.
      2. BÁM SÁT NỘI DUNG GỐC: Không được thay đổi cốt truyện, chủ thể, bối cảnh, cảm xúc hoặc hành động chính của người dùng. Nếu cần tránh lỗi chính sách, chỉ đổi từ ngữ/mức độ mô tả, không đổi ý cảnh.
      3. BẠN PHẢI TẠO CHÍNH XÁC ${sceneCount} CẢNH QUAY (từ cảnh ${startScene} đến cảnh ${endScene}). Không được thiếu, không được thừa.
      4. MỖI CẢNH QUAY PHẢI CÓ THỜI LƯỢNG CỐ ĐỊNH LÀ 8 GIÂY (8s).
      5. TỐI ƯU ĐỒNG NHẤT NHÂN VẬT: 
         ${characterSheet ? `- SỬ DỤNG BẢN MÔ TẢ NHÂN VẬT SAU ĐÂY CHO TẤT CẢ CÁC CẢNH CÓ NHÂN VẬT THAM CHIẾU: "${characterSheet}"` : `- KHÔNG CÓ ẢNH THAM CHIẾU: không tự tạo Character Sheet cố định, không tự thêm nhân vật chính, không tự thêm người nếu kịch bản không yêu cầu. Mỗi cảnh chỉ mô tả đúng chủ thể/nội dung có trong kịch bản.`}
         ${characterSheet ? '- Bắt buộc lặp lại TOÀN BỘ bản mô tả nhân vật này vào prompt của các cảnh cần nhân vật tham chiếu.' : '- Nếu cảnh là phong cảnh/đồ vật/sản phẩm/con vật/địa điểm/ý tưởng trừu tượng thì giữ nguyên chủ thể đó, không biến thành người.'}
         - Đảm bảo hành động và chủ thể không bị AI tự ý thêm hoặc đổi.
      6. CHỐNG TRÙNG LẶP CẢNH: Mỗi cảnh phải có nội dung riêng theo đúng tiến trình kịch bản. Không được lặp lại cùng hành động, cùng mô tả, cùng góc máy, cùng bối cảnh hoặc cùng prompt giữa các cảnh. Cảnh sau phải phát triển câu chuyện từ cảnh trước.
      7. Mỗi cảnh quay phải có:
         - sceneNumber: Số thứ tự cảnh (từ ${startScene} đến ${endScene}).
         - duration: Thời lượng cảnh đó (luôn là "8s").
         - visual: Mô tả phần Hình ảnh thật chi tiết bằng ${outLang}, đúng nội dung cảnh, nêu rõ chủ thể, bối cảnh, màu sắc, chi tiết thị giác.
         - action: Mô tả Hành động/chuyển động chính trong cảnh bằng ${outLang}.
         - emotion: Mô tả Cảm xúc/không khí của cảnh bằng ${outLang}.
         - cameraLighting: Mô tả Góc máy & Ánh sáng bằng ${outLang}, gồm loại góc máy, chuyển động camera, ánh sáng, màu chủ đạo.
         - voice: Lời thoại/Voice bằng ${outLang} nếu phù hợp; nếu không có thoại thì ghi "Không có".
         - description: Tóm tắt nội dung cảnh bằng ${outLang} bám sát nội dung gốc.
         - prompt: Prompt video cuối cùng cho Veo 3.1, tích hợp phong cách ${characterSuffixByLang(style,outLang)} (${style}). ${finalPromptLanguageRule(outLang)} Nếu có ảnh tham chiếu và cảnh cần nhân vật đó, prompt phải dùng bản mô tả nhân vật đồng nhất. Nếu không có ảnh tham chiếu, prompt chỉ được viết theo mô tả của cảnh, không tự thêm nhân vật/Character Sheet/REF_ID. Tuyệt đối không dùng bối cảnh/môi trường/ánh sáng/phòng nền của ảnh tham chiếu; bối cảnh phải theo kịch bản từng cảnh.
      8. NGÔN NGỮ GIỌNG NÓI NHÂN VẬT: Nếu cảnh có lời thoại/nhân vật nói, nhân vật bắt buộc nói bằng ${voiceLang}. Toàn bộ prompt trong cùng kịch bản phải đồng nhất đúng lựa chọn này, không được lúc giọng Nam lúc giọng Bắc hoặc đổi sang ngôn ngữ khác. Trong prompt video phải ghi rõ: character speaks ${voiceLang}.
      9. QUY TẮC PHỤ ĐỀ BẮT BUỘC CHO MỌI PROMPT: ${subtitlePromptRule(payload,outLang,voiceLang)}
      10. CẤU TRÚC PROMPT VIDEO BẮT BUỘC: ${structuredFormat}
      10. AN TOÀN CHÍNH SÁCH GOOGLE/FLOW: ${policySafeInstruction(outLang)}
      11. Trả về kết quả dưới dạng JSON: {"title":"...","characterSheet":"...","scenes":[{"sceneNumber":...,"duration":"8 giây","visual":"...","action":"...","emotion":"...","cameraLighting":"...","voice":"...","description":"...","prompt":"..."}]}.`;

    const characterInstruction=characterSheet
      ? `REFERENCE IMAGE MODE: Use this exact character sheet only for scenes that require the referenced character: "${characterSheet}". Repeat this compact identity in those scene prompts. Do not change face, hair, age, body type, or the exact visible outfit from the reference image.`
      : `NO REFERENCE IMAGE MODE: Do not create a fixed character sheet. Do not invent a main character, extra people, REF_ID, face identity lock, or recurring identity unless the user's script explicitly asks for one. For each scene, write only the subject described by that scene. Landscape remains landscape, product remains product, animal remains animal, object remains object, abstract scene remains abstract.`;
    const parts=[...(i===0?imgs:[]),{text:`Topic/content: ${payload.topic}. Total video scenes: ${totalScenes}. Generate scenes ${startScene}-${endScene}. ${characterInstruction} Prompts and descriptions must be in ${outLang}. ${finalPromptLanguageRule(outLang)} If ${outLang} is Vietnamese, every sentence in description and prompt must be Vietnamese; do not output English style phrases, English camera instructions, or English safety rules except unavoidable proper names. If any dialogue/speech exists, character voice language must be ${voiceLang} and must stay identical in every generated prompt. Do not mix accents/languages. Keep prompts short but preserve character consistency. Each scene must be unique, must follow the exact script progression, and must not repeat the same action, camera, setting, or wording from another scene. Each scene must be detailed enough to render and must contain these fields: visual, action, emotion, cameraLighting, voice, prompt. Apply this exact structured format to every scene prompt: ${structuredFormat} Apply this subtitle rule to every scene: ${subtitlePromptRule(payload,outLang,voiceLang)} Apply this safety rule to every scene: ${policySafeInstruction(outLang)}`}];
    const txt=await geminiText(payload.apiKey,parts,sys,true);
    let obj;
    try {
      obj=JSON.parse(txt.replace(/^```json\s*|```$/g,''));
    } catch (e) {
      console.error("JSON parse failed, attempt fuzzy match:", e);
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) obj = JSON.parse(m[0]); else throw e;
    }
    if(i===0){ title=obj.title||payload.topic||''; if(hasRefs && obj.characterSheet) characterSheet=String(obj.characterSheet).replace(/\s+/g,' ').trim(); }
    const scenes=[];
    for(const sc of (obj.scenes||[])){
      scenes.push({
        ...sc,
        duration: sc.duration||'8 giây',
        visual: sc.visual||sc.image||sc.hinhAnh||sc.description||'',
        action: sc.action||sc.hanhDong||'',
        emotion: sc.emotion||sc.camXuc||'',
        cameraLighting: sc.cameraLighting||sc.camera||sc.gocMayAnhSang||'',
        voice: sc.voice||sc.dialogue||sc.loiThoai||'',
        prompt: await ensureOutputLanguageText(payload.apiKey, enforceSubtitleInPrompt(enforceVoiceInPrompt(policySafePostProcess(sc.prompt,outLang), `${sc.voice||sc.dialogue||sc.loiThoai||''}`, outLang, voiceLang),payload,outLang,voiceLang), outLang, payload.apiModel)
      });
    }
    allScenes.push(...scenes);
  }
  const finalObj={title:title||payload.topic||'', characterSheet, outLang, totalDuration:payload.duration, scenes:enforceUniqueScenePrompts(allScenes.slice(0,totalScenes).sort((a,b)=>(a.sceneNumber||0)-(b.sceneNumber||0)),outLang)};
  const prompts=finalObj.scenes.map(s=>s.prompt).filter(Boolean);
  const generated=writeGenerated('electron-ai-script-prompts.txt',prompts);
  const scriptFile=writeScriptText(finalObj);
  return {ok:true,characterLock:characterSheet,generated,scriptFile};
}

async function activateLicenseJs(key,api){ const cfg=loadLicenseCfg(); cfg.api_base=normalizeBase(DEFAULT_API_BASE); cfg.license_key=String(key||'').trim(); cfg.machine_id=machineId(); if(!cfg.api_base) return {ok:false,error:'missing_api_base'}; if(!cfg.license_key) return {ok:false,error:'missing_license_key'}; const payload={license_key:cfg.license_key,machine_id:cfg.machine_id,app_version:'V2.0',nonce:Date.now().toString(36),timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}; try{ const {status,data}=await postJson(`${cfg.api_base}/activate`,payload); if(status===200 && data.valid!==false){ ['signed_token','expires_at','grace_until','next_check_at'].forEach(k=>{if(data[k])cfg[k]=data[k]}); cfg.last_verified_at=payload.timestamp; saveLicenseCfg(cfg); return {ok:true,expires_at:data.expires_at||cfg.expires_at,data}; } return {ok:false,error:data.reason||`http_${status}`,data}; }catch(e){ return {ok:false,error:`network_error:${e.message||e}`}; }}

function cachedLicense(){ try{ const cfg=loadLicenseCfg(); if(cfg.expires_at) return {ok:true, cached:true, expires_at:cfg.expires_at}; if(cfg.license_key) return {ok:true, cached:true, reason:'Đã có key local nhưng chưa có thời hạn'}; }catch{} return null; }
function readPid(){ try{return Number(fs.readFileSync(PID_RUN,'utf8').trim())}catch{return 0} }
function isRunningPid(pid){ if(!pid) return false; try{ process.kill(pid,0); return true; }catch{return false;} }

function anyRunnerRunning(){
  const pids=[]; const p=readPid(); if(p)pids.push(p);
  try{ for(const f of fs.readdirSync(JOB_DIR).filter(x=>/^electron-runner-\d+(?:-[a-f0-9-]+)?\.pid$/.test(x))){ const v=Number(fs.readFileSync(path.join(JOB_DIR,f),'utf8').trim()); if(v)pids.push(v); } }catch{}
  return [...new Set(pids)].some(isRunningPid);
}

function runState(){ let progress=null; try{ const st=JSON.parse(fs.readFileSync(RUN_STATE,'utf8')); progress={done:st.done||0,total:st.total||0,current:Math.min((st.done||0)+1, st.total||0)}; }catch{} const pid=readPid(); const running=isRunningPid(pid); if(pid && !running){ try{fs.rmSync(PID_RUN,{force:true})}catch{} } return {pid: running?pid:0, running, paused:fs.existsSync(PAUSE_FILE), progress}; }
function parseJsonMaybe(txt){ try{return JSON.parse(txt||'{}')}catch{return null} }
function withTimeout(promise, ms, label='timeout'){ return Promise.race([promise, new Promise((_,rej)=>setTimeout(()=>rej(new Error(label)), ms))]); }
async function onlineLicenseGuard(){ const r=await verifyLicenseJs(); if(r.ok) return {ok:true,license:r}; return {ok:false,error:r.reason||r.error||'license_invalid_or_revoked'}; }
function killPidAsync(pid){
  if(!pid)return;
  try{
    if(process.platform==='win32') spawn('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).unref();
    else { try{ process.kill(-pid,'SIGTERM'); }catch{} try{ process.kill(pid,'SIGTERM'); }catch{} }
  }catch{}
}
function sleepSync(ms){ const start=Date.now(); while(Date.now()-start<ms){} }
function killPid(pid){
  if(!pid)return;
  try{
    if(process.platform==='win32') {
      spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{encoding:'utf8',windowsHide:true});
    } else {
      try{ process.kill(-pid,'SIGTERM'); }catch{}
      try{ process.kill(pid,'SIGTERM'); }catch{}
    }
  }catch{}
}

function collectAutomationChromePids(){
  const pids=[];
  try{
    if(process.platform==='win32'){
      const ps=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'chrome|msedge') -and (($_.CommandLine -match '--remote-debugging-port=93') -or ($_.CommandLine -match 'chrome-cdp-profile') -or ($_.CommandLine -match 'chrome-flow-accounts')) } | Select-Object -ExpandProperty ProcessId`],{encoding:'utf8',windowsHide:true,timeout:7000});
      String(ps.stdout||'').split(/\s+/).forEach(x=>{ const pid=Number(x); if(pid&&pid!==process.pid)pids.push(pid); });
    }else{
      const r=spawnSync('pgrep',['-f','--remote-debugging-port=93|chrome-cdp-profile|chrome-flow-accounts'],{encoding:'utf8',timeout:4000});
      String(r.stdout||'').split(/\s+/).forEach(x=>{ const pid=Number(x); if(pid&&pid!==process.pid)pids.push(pid); });
    }
  }catch{}
  return [...new Set(pids)].filter(Boolean);
}
function killAutomationChrome(){
  const killed=[];
  for(let round=0; round<3; round++){
    const pids=collectAutomationChromePids();
    if(!pids.length) break;
    for(const pid of pids){ killPid(pid); killed.push(pid); }
    const start=Date.now(); while(Date.now()-start<700){}
  }
  return {killed:[...new Set(killed)],remaining:collectAutomationChromePids().filter(isRunningPid)};
}
function collectRunnerPids(){
  const pids=[];
  try{ const p=readPid(); if(p)pids.push(p); }catch{}
  try{ for(const f of fs.readdirSync(JOB_DIR).filter(x=>/^electron-runner-\d+(?:-[a-f0-9-]+)?\.pid$/.test(x))){ const v=Number(fs.readFileSync(path.join(JOB_DIR,f),'utf8').trim()); if(v)pids.push(v); } }catch{}
  try{
    if(process.platform==='win32'){
      const ps=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'flow_batch_runner(\\.py|\\.exe)' -or $_.CommandLine -match 'electron-runner' } | Select-Object -ExpandProperty ProcessId`],{encoding:'utf8',windowsHide:true,timeout:6000});
      String(ps.stdout||'').split(/\s+/).forEach(x=>{ const pid=Number(x); if(pid&&pid!==process.pid)pids.push(pid); });
    }else{
      const r=spawnSync('pgrep',['-f','flow_batch_runner.py|flow_batch_runner.exe|electron-runner'],{encoding:'utf8',timeout:3000});
      String(r.stdout||'').split(/\s+/).forEach(x=>{ const pid=Number(x); if(pid&&pid!==process.pid)pids.push(pid); });
    }
  }catch{}
  return [...new Set(pids)].filter(Boolean);
}
async function resetRunnerWorkersAsync({killChrome=false}={}){
  ensureDirs();
  if(stopInProgress) return {ok:true, already:true};
  stopInProgress = true;
  const killed=[];
  const files=[];
  try{ files.push(...fs.readdirSync(JOB_DIR).filter(x=>/^electron-runner(?:-state)?(?:-\d+)?(?:-[a-z0-9-]+)?\.(?:pid|json)$/.test(x)).map(x=>path.join(JOB_DIR,x))); }catch{}
  try{ files.push(PID_RUN, RUN_STATE, PAUSE_FILE); }catch{}
  try{
    for(let round=0; round<4; round++){
      const pids=collectRunnerPids();
      if(!pids.length) break;
      for(const pid of pids){ killPidAsync(pid); killed.push(pid); }
      await wait(450);
    }
    let chrome={killed:[],remaining:[]};
    if(killChrome) chrome=killAutomationChrome();
    for(const f of [...new Set(files)]){ try{ fs.rmSync(f,{force:true}); }catch{} }
    try{ fs.rmSync(PAUSE_FILE,{force:true}); }catch{}
    const remaining=collectRunnerPids().filter(isRunningPid);
    return {ok:remaining.length===0 && (!killChrome || chrome.remaining.length===0),killed:[...new Set(killed)],remaining,chrome};
  } finally {
    stopInProgress = false;
  }
}
function resetRunnerWorkers(){
  // Compatibility wrapper for app quit; bounded blocking, not used by Stop button.
  const killed=[];
  try{ collectRunnerPids().forEach(pid=>{ killPid(pid); killed.push(pid); }); }catch{}
  try{ fs.rmSync(PAUSE_FILE,{force:true}); }catch{}
  return {ok:true,killed:[...new Set(killed)]};
}

function safeProfileSlug(name, idx=0){
  const raw=String(name||`profile-${idx+1}`).trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
  return raw || `profile-${idx+1}`;
}
function flowProfileDir(profile, idx=0){
  const label=profile?.accountEmail || profile?.name || `profile-${idx+1}`;
  return path.join(BASE_DIR,'chrome-flow-accounts',`${String(idx+1).padStart(2,'0')}-${safeProfileSlug(label,idx)}`);
}

function chromeCandidates(){
  if(process.platform==='win32') return [
    path.join(process.env['PROGRAMFILES']||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA']||'', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES']||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')];
  if(process.platform==='darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return ['/usr/bin/google-chrome','/usr/bin/chromium-browser','/usr/bin/chromium','/snap/bin/chromium','/usr/bin/microsoft-edge'];
}
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function ensureCdpOn(port=CDP_PORT, profile=CDP_PROFILE){
  try{ const r=await fetch(`http://127.0.0.1:${port}/json/version`); if(r.ok) return {ok:true, already:true, port}; }catch{}
  fs.mkdirSync(profile,{recursive:true});
  forceChromeLanguagePrefs();
  const exe=chromeCandidates().find(x=>x && fs.existsSync(x));
  if(!exe) return {ok:false,error:'chrome_not_found'};
  const args=[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--lang=vi-VN','--accept-lang=vi-VN,vi,en-US,en','--disable-features=Translate','--no-first-run','--no-default-browser-check','https://labs.google/fx/vi/tools/flow'];
  const p=spawn(exe,args,{detached:true,stdio:'ignore',windowsHide:true}); p.unref();
  for(let i=0;i<40;i++){ try{ const r=await fetch(`http://127.0.0.1:${port}/json/version`); if(r.ok) return {ok:true, launched:true, port}; }catch{} await wait(500); }
  return {ok:false,error:'cdp_not_ready',port};
}
async function ensureCdp(){ return ensureCdpOn(CDP_PORT, CDP_PROFILE); }
async function ensureCdpThreads(n, profiles=[]){ const out=[]; for(let i=0;i<n;i++){ const port=CDP_PORT+i; const profile=profiles&&profiles[i]?flowProfileDir(profiles[i],i):(i===0?CDP_PROFILE:path.join(BASE_DIR,`chrome-cdp-profile-${i+1}`)); const r=await ensureCdpOn(port,profile); out.push({...r,profileDir:profile,accountEmail:profiles?.[i]?.accountEmail||''}); if(!r.ok) return {ok:false,error:r.error,port}; } return {ok:true,threads:n,cdp:out}; }
function writePromptFile(name, text){ ensureDirs(); const file=path.join(JOB_DIR,name); const blocks=(text||'').split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean); fs.writeFileSync(file, blocks.join('\n\n')+'\n','utf8'); return file; }
function saveGeneratedPrompts(jsonPath, fallbackText, outName){
  let prompts=[]; try{ const obj=JSON.parse(fs.readFileSync(jsonPath,'utf8')); if(obj.results) prompts=obj.results.filter(r=>r.ok&&r.prompt).map(r=>String(r.prompt).replace(/\s+/g,' ').trim()); if(obj.script?.scenes) prompts=obj.script.scenes.sort((a,b)=>(a.sceneNumber||0)-(b.sceneNumber||0)).map(s=>String(s.prompt||'').replace(/\s+/g,' ').trim()).filter(Boolean); }catch{}
  if(!prompts.length && fallbackText) prompts=(fallbackText||'').split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  const out=path.join(JOB_DIR,outName); fs.writeFileSync(out,prompts.join('\n\n')+'\n','utf8'); return {file:out,count:prompts.length,prompts};
}

function readPromptBlocks(file){ try{return fs.readFileSync(file,'utf8').split(/\n\s*\n/g).map(x=>x.trim()).filter(Boolean);}catch{return []} }
function writeThreadPromptFile(baseFile, idx, prompts){ const f=path.join(JOB_DIR,`thread-${idx+1}-${path.basename(baseFile||'prompts.txt')}`); fs.writeFileSync(f,prompts.join('\n\n')+'\n','utf8'); return f; }
function splitRoundRobin(items,n){ const out=Array.from({length:n},()=>[]); items.forEach((x,i)=>out[i%n].push(x)); return out.filter(x=>x.length); }

function runnerCommand(){
  const exeName=process.platform==='win32'?'flow_batch_runner.exe':'flow_batch_runner';
  const macArchDir=process.platform==='darwin' ? (process.arch==='arm64'?'flow_batch_runner-arm64.dist':'flow_batch_runner-x64.dist') : 'flow_batch_runner.dist';
  const exeCandidates=[
    resourcePath(path.join('payload','bin',macArchDir,exeName)),
    resourcePath(path.join('payload','bin','flow_batch_runner.dist',exeName)),
    resourcePath(path.join('payload','bin',exeName)),
    path.join(BASE_DIR,'bin',macArchDir,exeName),
    path.join(BASE_DIR,'bin','flow_batch_runner.dist',exeName),
    path.join(BASE_DIR,'bin',exeName),
  ];
  const exe=exeCandidates.find(x=>fs.existsSync(x));
  // Protected packaged builds ship only the compiled runner. Use it there.
  if(app.isPackaged && exe) return {cmd:exe, prefix:[], compiled:true, path:exe};

  // Dev/unprotected builds can use the Python script for fastest fixes.
  const script=path.join(SCRIPTS_DIR,'flow_batch_runner.py');
  if(fs.existsSync(script)){
    const py=ensurePythonEnv();
    return {cmd:py, prefix:[script], compiled:false, path:script};
  }
  if(exe) return {cmd:exe, prefix:[], compiled:true, path:exe};
  throw new Error(`runner_not_found: checked ${[script,...exeCandidates].join(' | ')}`);
}

function startRunner(payload){
  const integrity=enforceProtectedIntegrity(); if(!integrity.ok) return integrity;
  if(app.isPackaged && suspiciousRuntimeSignals().length) return {ok:false,error:'runtime_security_check_failed'};
  ensureDirs(); try{fs.rmSync(PAUSE_FILE,{force:true})}catch{}
  const profiles=Array.isArray(payload.profiles)?payload.profiles.filter(x=>x&&(x.promptFile||String(x.script||x.prompts||'').trim())).slice(0,100):[];
  const characterImages=payload.characterImages||[];
  const promptFile=payload.promptFile || writePromptFile('electron-manual-prompts.txt', payload.prompts||'');
  const flowThreads=Math.max(1,Math.min(100,Number(payload.flowThreads||1)||1));
  const workerId=crypto.randomUUID(); const runId=`${Date.now()}-${workerId}`;
  const characterRefsDir = characterImages.length ? makeCharacterRefsDir(characterImages, runId) : '';
  if(characterRefsDir && !payload.refsDir) payload.refsDir = characterRefsDir;
  let threadFiles=[]; let threadRefs=[];
  if(profiles.length){
    threadFiles=profiles.map((pr,i)=> pr.promptFile || writeThreadPromptFile(`profile-${i+1}.txt`,i,String(pr.script||pr.prompts||'').split(/\n\s*\n/g).map(x=>x.trim()).filter(Boolean)));
    threadRefs=profiles.map(pr=>pr.refsDir||characterRefsDir||'');
  }else{
    const blocks=readPromptBlocks(promptFile);
    threadFiles=flowThreads>1 && blocks.length>1 ? splitRoundRobin(blocks, flowThreads).map((part,i)=>writeThreadPromptFile(promptFile,i,part)) : [promptFile];
    threadRefs=threadFiles.map(()=>payload.refsDir||'');
  }
  const runner=runnerCommand(); const pids=[];
  threadFiles.forEach((pf,idx)=>{
    const logFile=path.join(DEBUG_DIR,`electron-runner-${idx+1}-${workerId}.log`); const out=fs.openSync(logFile,'a');
    const stateFile=path.join(JOB_DIR,`electron-runner-state-${idx+1}-${workerId}.json`);
    try { if(fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch(e) {}
    const args=['--run-id',runId,'--prompts',pf,'--state',stateFile,'--fresh-run','--start-from',String(payload.startFrom||1),'--cdp',`http://127.0.0.1:${CDP_PORT+idx}`,'--task-mode',payload.mode||payload.taskMode||'createvideo','--video-sub-mode',payload.subMode||payload.videoSubMode||'frames','--flow-model',payload.model||payload.flowModel||'default','--flow-aspect-ratio',payload.ratio||payload.aspectRatio||payload.flowAspectRatio||'16:9','--flow-count',String(payload.count||payload.flowCount||1),'--omni-duration',String(payload.omniDuration||''),'--download-resolution','720','--character-images', characterImages.join(','), '--between-prompts-sec', String(payload.spacing||10)];
    args.push(payload.pairedMode===false?'--no-paired-mode':'--paired-mode'); const wantAutoDownload = payload.autoDownload !== false; if(wantAutoDownload) args.push('--auto-download'); if(wantAutoDownload && payload.runMode==='continuous_submit_only') args.push('--download-delay-prompts','3'); if(!wantAutoDownload && payload.runMode==='continuous_submit_only') args.push('--submit-only'); const refDir=threadRefs[idx]||payload.refsDir; if(refDir) args.push('--refs-dir',refDir); if(payload.downloadDir) args.push('--output-dir',payload.downloadDir); try{ fs.appendFileSync(logFile, `[runner] path=${runner.path||runner.cmd} compiled=${!!runner.compiled}\n[runner] thread=${idx+1} mode=${payload.mode||payload.taskMode} model=${payload.model||payload.flowModel} ratio=${payload.ratio||payload.aspectRatio||payload.flowAspectRatio} count=${payload.count||payload.flowCount} autoDownload=${wantAutoDownload} runMode=${payload.runMode||''}\n`); }catch{}
    const licenseCfg=loadLicenseCfg(); const runnerBinding=crypto.createHash('sha256').update(`${process.pid}|${runId}|${machineId()}|flow-runner`).digest('hex'); const runnerEnv={...process.env,FLOW_PARENT_PID:String(process.pid),FLOW_RUNNER_BINDING:runnerBinding,FLOW_WORKSPACE:BASE_DIR,FLOW_PAUSE_FILE:PAUSE_FILE,FLOW_LICENSE_KEY_RUNTIME:String(licenseCfg.license_key||''),FLOW_LICENSE_API_BASE_RUNTIME:String(licenseCfg.api_base||DEFAULT_API_BASE),FLOW_LICENSE_SIGNED_TOKEN_RUNTIME:String(licenseCfg.signed_token||'')};
    const p=spawn(runner.cmd, [...runner.prefix, ...args], spawnOpts({detached:true, stdio:['ignore',out,out], env:runnerEnv})); p.unref(); pids.push(p.pid); fs.writeFileSync(path.join(JOB_DIR,`electron-runner-${idx+1}-${workerId}.pid`),String(p.pid));
  });
  fs.writeFileSync(PID_RUN,String(pids[0]||'')); return {ok:true,workerId,pid:pids[0],pids,threads:threadFiles.length,promptFile,runner:runner.compiled?'nuitka-runner-hidden-multitab':'python-stable-hidden-multitab'};
}

function createSplash(){
  const splash = new BrowserWindow({ width: 390, height: 190, frame:false, resizable:false, alwaysOnTop:true, center:true, backgroundColor:'#07111f', show:false, webPreferences:{contextIsolation:true,nodeIntegration:false} });
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:linear-gradient(135deg,#07111f,#102542);font-family:Segoe UI,Arial,sans-serif;color:#eef6ff;display:flex;align-items:center;justify-content:center;height:100vh}.box{width:320px;text-align:center}.title{font-weight:800;font-size:18px;margin-bottom:8px}.sub{font-size:13px;color:#9fb2d0;margin-bottom:18px}.bar{height:12px;background:rgba(148,163,184,.22);border-radius:999px;overflow:hidden}.fill{height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#22c55e);border-radius:999px;transition:width .18s}.pct{font-size:13px;margin-top:10px;color:#cce7ff}</style></head><body><div class="box"><div class="title">FLOW AUTO VEO 3</div><div class="sub">Đang tải ứng dụng...</div><div class="bar"><div id="fill" class="fill"></div></div><div id="pct" class="pct">0%</div></div><script>let p=0;const f=document.getElementById('fill'),t=document.getElementById('pct');const id=setInterval(()=>{p=Math.min(98,p+Math.ceil(Math.random()*6));f.style.width=p+'%';t.textContent=p+'%';if(p>=98)clearInterval(id)},120);window.finish=()=>{p=100;f.style.width='100%';t.textContent='100%'}</script></body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  splash.once('ready-to-show',()=>splash.show());
  return splash;
}
function createWindow(){
  const win = new BrowserWindow({ width: 1280, height: 820, minWidth: 1100, minHeight: 720, backgroundColor:'#07111f', title:'FLOW AUTO VEO 3 Modern', show:false, webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false }});
  if(isDev) win.loadURL('http://127.0.0.1:5173'); else win.loadFile(path.join(__dirname,'..','dist','index.html'));
  return win;
}

installRuntimeGuards();
app.whenReady().then(()=>{ ensureDirs(); enforceRuntimeGuards(); enforceProtectedIntegrity(); const splash=createSplash(); const win=createWindow(); setTimeout(()=>{ try{ bootstrap(); }catch{} }, 300); win.once('ready-to-show',()=>{ setTimeout(()=>{ splash.webContents.executeJavaScript('window.finish&&window.finish()').catch(()=>{}); setTimeout(()=>{ if(!splash.isDestroyed()) splash.close(); win.show(); },120); },250); }); });
app.on('window-all-closed',()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('before-quit', () => { resetRunnerWorkers(); });
app.on('activate',()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });

ipcMain.handle('dialog:openFile', async (_e, opts={})=>{ const r=await dialog.showOpenDialog({properties:opts.properties||['openFile'], filters:opts.filters||[]}); return r.canceled?[]:r.filePaths; });
ipcMain.handle('shell:openPath', (_e,p)=>shell.openPath(p));
ipcMain.handle('flow:status', async()=>runState());
ipcMain.handle('flow:ensureCdp', async()=>ensureCdp());
ipcMain.handle('flow:openProfileLogin', async(_e,profile,idx=0)=>{ const port=CDP_PORT+Number(idx||0); const dir=flowProfileDir(profile||{},Number(idx||0)); return ensureCdpOn(port,dir); });
ipcMain.handle('prompt:saveGenerated', async(_e,file)=>{
  try{
    if(!file || !fs.existsSync(file)) return {ok:false,error:'generated_prompt_not_found'};
    const r=await dialog.showSaveDialog({title:'Tải prompt đã tạo', defaultPath:path.basename(file), filters:[{name:'Text',extensions:['txt']},{name:'All',extensions:['*']}]});
    if(r.canceled || !r.filePath) return {ok:false,canceled:true};
    fs.copyFileSync(file,r.filePath);
    return {ok:true,file:r.filePath};
  }catch(e){ return {ok:false,error:String(e&&e.message||e)}; }
});
ipcMain.handle('flow:start', async(_e,payload)=>{ try{ const lic=await onlineLicenseGuard(); if(!lic.ok) return lic; const reset=await resetRunnerWorkersAsync({killChrome:false}); const n=Math.max(1,Math.min(100,Array.isArray((payload||{}).profiles)&&payload.profiles.length?payload.profiles.length:Number((payload||{}).flowThreads||1)||1)); const c=await ensureCdpThreads(n,(payload||{}).profiles||[]); if(!c.ok) return c; const r=startRunner(payload||{}); return {...r, reset}; }catch(e){ try{console.error('[flow:start]',e)}catch{} return {ok:false,error:'start_failed:'+String(e&&e.message||e)}; } });
ipcMain.handle('flow:pause', async()=>{ if(!anyRunnerRunning()) return {ok:false,error:'process_not_running'}; ensureDirs(); fs.writeFileSync(PAUSE_FILE,String(Date.now())); return {ok:true, paused:true}; });
ipcMain.handle('flow:resume', async()=>{ if(!anyRunnerRunning() && !fs.existsSync(PAUSE_FILE)) return {ok:false,error:'process_not_running'}; try{fs.rmSync(PAUSE_FILE,{force:true})}catch{} return {ok:true, paused:false}; });
ipcMain.handle('flow:stop', async()=>{ resetRunnerWorkersAsync({killChrome:false}).catch(()=>{}); return {ok:true, running:false, stopping:true}; });
ipcMain.handle('license:machineId', async()=>({ok:true,machineId:machineId()}));
ipcMain.handle('license:cached', async()=>cachedLicense() || {ok:false, reason:'missing_local_license'});
ipcMain.handle('license:activate', async(_e,payload)=>activateLicenseJs(payload?.licenseKey, DEFAULT_API_BASE));
ipcMain.handle('license:check', async()=>{ const r=await verifyLicenseJs(); return r.ok ? {...r, strictOnline:true} : {...r, ok:false, strictOnline:true}; });
ipcMain.handle('prompt:generate', async(_e,payload)=>{ const lic=await onlineLicenseGuard(); if(!lic.ok) return lic; return generatePromptsJs(payload||{}); });
ipcMain.handle('prompt:characters', async(_e,payload)=>{ try{ const lic=await withTimeout(onlineLicenseGuard(),15000,'license_check_timeout'); if(!lic.ok) return lic; return await withTimeout(generateCharacterPromptsJs(payload||{}),300000,'character_prompt_timeout_300s'); }catch(e){ return {ok:false,error:String(e.message||e)}; } });

function videoFiles(dir){ const exts=new Set(['.mp4','.mov','.mkv','.webm','.avi','.m4v']); try{return fs.readdirSync(dir).filter(f=>exts.has(path.extname(f).toLowerCase())).sort().map(f=>path.join(dir,f));}catch{return []} }
function ffmpegBin(){
  if(process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exe=process.platform==='win32'?'ffmpeg.exe':'ffmpeg';
  const platform=process.platform==='win32'?'win32-x64':process.platform==='darwin'?'darwin-x64':'linux-x64';
  try{
    const ff=require('@ffmpeg-installer/ffmpeg');
    if(ff && ff.path){
      const p1=ff.path;
      const p2=String(p1).replace('app.asar','app.asar.unpacked');
      if(fs.existsSync(p2)) return p2;
      if(fs.existsSync(p1)) return p1;
    }
  }catch{}
  const res=process.resourcesPath||'';
  const candidates=[
    path.join(res,'app.asar.unpacked','node_modules','@ffmpeg-installer',platform,exe),
    path.join(res,'app.asar.unpacked','node_modules','@ffmpeg-installer','ffmpeg','node_modules','@ffmpeg-installer',platform,exe),
    path.join(__dirname,'..','node_modules','@ffmpeg-installer',platform,exe),
    resourcePath('ffmpeg/ffmpeg.exe'), resourcePath('ffmpeg/ffmpeg'),
    'ffmpeg'
  ];
  return candidates.find(x=>x && (x==='ffmpeg'||fs.existsSync(x))) || 'ffmpeg';
}
function ffmpegRun(args){ return spawnSync(ffmpegBin(),args,{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024}); }
function ffErr(r){ return String((r&&r.stderr)||'').split('\n').slice(-8).join('\n') || String((r&&r.stdout)||'').split('\n').slice(-8).join('\n') || 'ffmpeg_failed'; }
function concatPath(f){ return String(f).replace(/\\/g,'/').replace(/'/g,"'\\''"); }
ipcMain.handle('video:list', async(_e,folder)=>{ const lic=await onlineLicenseGuard(); if(!lic.ok) return lic; return {ok:true,files:videoFiles(folder||'')}; });
ipcMain.handle('video:merge', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const folder=payload.folder||''; const files=(payload.files&&payload.files.length?payload.files:videoFiles(folder)).filter(Boolean); if(!folder||!files.length)return {ok:false,error:'missing_videos'};
  const outDir=path.join(folder,'flow_auto_post'); fs.mkdirSync(outDir,{recursive:true}); const list=path.join(outDir,'concat-list.txt');
  fs.writeFileSync(list,files.map(f=>`file '${concatPath(f)}'`).join('\n'),'utf8');
  const out=path.join(outDir,`merged_${Date.now()}.mp4`);
  const test=ffmpegRun(['-version']); if(test.status!==0) return {ok:false,error:'ffmpeg_not_available: '+ffErr(test)};
  let r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',out]);
  if(r.status!==0){ r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',out]); }
  if(r.status!==0){ const log=path.join(outDir,'ffmpeg-merge-error.log'); fs.writeFileSync(log,ffErr(r)); return {ok:false,error:'ffmpeg_merge_failed: '+ffErr(r),log}; }
  return {ok:true,out};
});
ipcMain.handle('video:extractAudio', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const file=payload.file||''; if(!file)return {ok:false,error:'missing_video'}; const out=path.join(path.dirname(file),path.basename(file,path.extname(file))+'_audio.mp3');
  const r=spawnSync(ffmpegBin(),['-y','-i',file,'-vn','-acodec','libmp3lame',out],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)return {ok:false,error:r.stderr||r.stdout||'ffmpeg_extract_audio_failed'}; return {ok:true,out};
});


ipcMain.handle('video:analyze', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const folder=payload.folder||''; const files=(payload.files&&payload.files.length?payload.files:videoFiles(folder)).filter(Boolean); if(!files.length)return {ok:false,error:'missing_videos'};
  const script=String(payload.script||'').trim();
  const scenes=files.map((file,i)=>({id:`scene_${i+1}`,index:i+1,file,name:path.basename(file),keep:true,reason:'Chưa phân tích AI',note:'',order:i+1}));
  const apiKey=payload.apiKey||'';
  if(payload.useAi && apiKey){
    try{
      const sys='Bạn là trợ lý hậu kì video. Hãy phân tích danh sách video theo kịch bản, trả JSON {scenes:[{index,order,keep,reason,note}]} để sắp xếp đúng kịch bản và đánh dấu cảnh không phù hợp.';
      const text=`KỊCH BẢN:\n${script||'(không có kịch bản)'}\n\nVIDEO FILES:\n${files.map((f,i)=>`${i+1}. ${path.basename(f)}`).join('\n')}`;
      const out=await geminiText(apiKey,[{text}],sys,true); const obj=JSON.parse(out.replace(/^```json\s*|```$/g,''));
      for(const item of obj.scenes||[]){ const sc=scenes[(item.index||1)-1]; if(sc){ sc.order=Number(item.order||sc.order); sc.keep=item.keep!==false; sc.reason=item.reason||sc.reason; sc.note=item.note||''; }}
    }catch(e){ return {ok:true,warning:'ai_analyze_failed:'+String(e.message||e),scenes}; }
  }
  scenes.sort((a,b)=>a.order-b.order); return {ok:true,scenes};
});
ipcMain.handle('video:exportTimeline', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const folder=payload.folder||''; const scenes=(payload.scenes||[]).filter(s=>s.keep!==false&&s.file); if(!folder||!scenes.length)return {ok:false,error:'missing_timeline'};
  return ipcMain.emit? await (async()=>{
    const outDir=path.join(folder,'flow_auto_post'); fs.mkdirSync(outDir,{recursive:true}); const list=path.join(outDir,'timeline-list.txt');
    fs.writeFileSync(list,scenes.map(s=>`file '${concatPath(s.file)}'`).join('\n'),'utf8'); const out=path.join(outDir,`timeline_export_${Date.now()}.mp4`);
    let r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',out]);
    if(r.status!==0) r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',out]);
    if(r.status!==0){ const log=path.join(outDir,'ffmpeg-timeline-error.log'); fs.writeFileSync(log,ffErr(r)); return {ok:false,error:'ffmpeg_timeline_failed: '+ffErr(r),log}; }
    return {ok:true,out};
  })() : {ok:false,error:'internal_error'};
});



function assColor(hex){
  const h=String(hex||'#FFFFFF').replace('#','');
  if(h.length!==6) return '&H00FFFFFF';
  return `&H00${h.slice(4,6)}${h.slice(2,4)}${h.slice(0,2)}`;
}
function escapeAssText(t){ return String(t||'').replace(/[{}]/g,'').replace(/\n/g,'\\N'); }
function secToAss(sec){ const n=Math.max(0,Number(sec)||0); const h=Math.floor(n/3600); const m=Math.floor((n%3600)/60); const s=(n%60).toFixed(2).padStart(5,'0'); return `${h}:${String(m).padStart(2,'0')}:${s}`; }
function parseSimpleSrt(txt){
  const blocks=String(txt||'').replace(/\r/g,'').split(/\n\s*\n/); const out=[];
  for(const b of blocks){ const lines=b.split('\n').filter(Boolean); const timing=lines.find(x=>x.includes('-->')); if(!timing) continue; const m=timing.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/); if(!m) continue; const to=(a,b,c,d)=>Number(a)*3600+Number(b)*60+Number(c)+Number('0.'+String(d).padEnd(3,'0').slice(0,3)); const idx=lines.indexOf(timing); out.push({start:to(m[1],m[2],m[3],m[4]),end:to(m[5],m[6],m[7],m[8]),text:lines.slice(idx+1).join(' ')}); }
  return out;
}
function parseSimpleAss(txt){
  const out=[];
  for(const line of String(txt||'').replace(/\r/g,'').split('\n')){
    if(!/^Dialogue\s*:/i.test(line)) continue;
    const parts=line.replace(/^Dialogue\s*:\s*/i,'').split(',');
    if(parts.length<10) continue;
    const time=s=>{const m=String(s).trim().match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0};
    out.push({start:time(parts[1]),end:time(parts[2]),text:parts.slice(9).join(',').replace(/\{[^}]*\}/g,'').replace(/\\N/g,' ')});
  }
  return out;
}
function subtitlesFromScript(script, scenes){
  const texts=[];
  const re=/(?:Lời dẫn\/Voiceover|Voiceover|Lời thoại\/Voice|Lời thoại|Voice)\s*:\s*["“]?([^\n"”]+)/gi;
  let m; while((m=re.exec(String(script||'')))){const t=String(m[1]||'').trim();if(t&&!/^none\b/i.test(t))texts.push(t)}
  if(!texts.length)return [];
  const durations=(scenes||[]).map(sc=>Math.max(.5,Number(sc.end||0)-Number(sc.start||0)||8));
  let cursor=0; return texts.map((text,i)=>{const d=durations[i]||8;const row={start:cursor,end:cursor+d,text};cursor+=d;return row});
}
async function transcribeVideoAudioVerbatim(file,apiKey,preferredModel='',language='vi'){
  const dir=path.join(path.dirname(file),'flow_auto_post','transcribe_audio'); fs.mkdirSync(dir,{recursive:true});
  const audio=path.join(dir,`${path.basename(file,path.extname(file))}_${Date.now()}.mp3`);
  const ex=ffmpegRun(['-y','-i',file,'-vn','-ac','1','-ar','16000','-b:a','64k',audio]);
  if(ex.status!==0 || !fs.existsSync(audio)) throw new Error('audio_extract_failed:'+ffErr(ex));
  const data=fs.readFileSync(audio).toString('base64');
  const system=`Bạn là hệ thống speech-to-text chính xác. Chép NGUYÊN VĂN lời nói thật trong audio, ngôn ngữ ${language}. Không viết lại, không tóm tắt, không sửa văn phong, không thêm lời từ kịch bản, không đoán khi không nghe rõ. Bỏ nhạc nền và tiếng động. Nếu không có lời nói, trả segments rỗng. Trả JSON duy nhất {"segments":[{"start":0.0,"end":1.2,"text":"nguyên văn"}]}; timestamp tính bằng giây theo audio.`;
  const out=await geminiText(apiKey,[{inlineData:{mimeType:'audio/mpeg',data}},{text:'Transcribe this audio verbatim with accurate segment timestamps. Return no invented words.'}],system,true,preferredModel);
  const obj=JSON.parse(String(out||'').replace(/^```json\s*|```$/g,''));
  return validSubtitleRows(obj.segments||[]);
}
async function transcribeTimelineVerbatim(scenes,apiKey,preferredModel='',language='vi'){
  const all=[]; let offset=0;
  for(const sc of scenes){
    const clipStart=Number(sc.start)||0, clipEnd=Number(sc.end)||videoDurationSec(sc.file), dur=Math.max(.5,clipEnd-clipStart||8);
    const rows=await transcribeVideoAudioVerbatim(sc.file,apiKey,preferredModel,language);
    for(const r of rows){
      const start=Math.max(0,Number(r.start)||0), end=Math.min(dur,Number(r.end)||0);
      if(String(r.text||'').trim() && end>start) all.push({start:offset+start,end:offset+end,text:String(r.text).trim()});
    }
    offset+=dur;
  }
  return all;
}
function validSubtitleRows(rows){ return (Array.isArray(rows)?rows:[]).map(r=>({start:Number(r.start)||0,end:Number(r.end)||0,text:String(r.text||'').trim()})).filter(r=>r.text&&r.end>r.start); }
function writeAssSub(file, rows, opt={}){
  const font=String(opt.font||'Arial').trim()||'Arial'; const size=Number(opt.size||42); const color=assColor(opt.color||'#FFFFFF'); const outline=assColor(opt.outlineColor||'#000000');
  const head=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${size},${color},&H000000FF,${outline},&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,60,60,70,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev=(rows||[]).map(r=>`Dialogue: 0,${secToAss(r.start)},${secToAss(r.end)},Default,,0,0,0,,${escapeAssText(r.text)}`).join('\n');
  fs.writeFileSync(file,head+ev,'utf8'); return file;
}
function videoProbe(file){
  const r=ffmpegRun(['-hide_banner','-i',file]); const txt=String(r.stderr||r.stdout||'');
  const dim=txt.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/); const dur=txt.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  return {width:dim?Number(dim[1]):0,height:dim?Number(dim[2]):0,duration:dur?Number(dur[1])*3600+Number(dur[2])*60+Number(dur[3]):0};
}
function targetVideoFrame(files){
  const probes=(files||[]).map(videoProbe); const portrait=probes.filter(x=>x.height>x.width).length>probes.length/2;
  return {width:portrait?1080:1920,height:portrait?1920:1080,orientation:portrait?'portrait':'landscape',probes};
}
function safeTransitionName(v){ const allowed=new Set(['fade','fadeblack','fadewhite','smoothleft','smoothright','smoothup','smoothdown']); return allowed.has(String(v||'').toLowerCase())?String(v).toLowerCase():'fade'; }
function videoDurationSec(file){ const r=ffmpegRun(['-hide_banner','-i',file]); const txt=String(r.stderr||r.stdout||''); const m=txt.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/); return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0; }

ipcMain.handle('video:analyzeSample', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const file=payload.file||''; const apiKey=payload.apiKey||''; if(!file)return {ok:false,error:'missing_video'}; if(!apiKey)return {ok:false,error:'missing_api_key'};
  const targetScenes=durationScenes(payload.duration);
  const outDir=path.join(path.dirname(file),'flow_auto_post','sample_frames_'+Date.now()); fs.mkdirSync(outDir,{recursive:true});
  const pattern=path.join(outDir,'frame_%02d.jpg');
  const r=ffmpegRun(['-y','-i',file,'-vf','fps=1/3,scale=512:-1','-frames:v','8',pattern]);
  if(r.status!==0) return {ok:false,error:'sample_frame_extract_failed: '+ffErr(r)};
  const frames=fs.readdirSync(outDir).filter(x=>/\.jpe?g$/i.test(x)).map(x=>path.join(outDir,x)).slice(0,8);
  if(!frames.length) return {ok:false,error:'no_frames_extracted'};
  const parts=imageParts(frames);
  const sys='Bạn là biên kịch video và chuyên gia phân tích nội dung. Hãy phân tích video mẫu qua các frame, nhận diện nhân vật, bối cảnh, hành động, nhịp câu chuyện, phong cách hình ảnh. Sau đó tạo kịch bản video khớp nội dung video mẫu nhất có thể. BẮT BUỘC chia đúng số cảnh theo yêu cầu, mỗi cảnh 8 giây. Không thiếu, không thừa cảnh. Kịch bản phải liệt kê rõ Scene 01, Scene 02... đúng thứ tự. Trả về tiếng Việt, có tiêu đề, tóm tắt, danh sách cảnh, và prompt tiếng Anh cho từng cảnh.';
  const prompt=`Video mẫu: ${path.basename(file)}\nYêu cầu: phân tích nội dung video mẫu và tạo kịch bản mới tương tự nhưng đã biến đổi để khác nội dung gốc. Thời lượng mong muốn: ${payload.duration||'60 seconds'}.`;
  const text=await geminiText(apiKey,[...parts,{text:prompt}],sys,false);
  const scriptFile=path.join(outDir,'ai-remix-script.txt'); fs.writeFileSync(scriptFile,text,'utf8');
  return {ok:true,script:text,scriptFile,frames};
});
function sceneTransitionFilter(name,duration){
  const n=safeTransitionName(name), d=Math.min(.45,Math.max(.18,Number(duration||8)/6)), out=Math.max(0,Number(duration||8)-d);
  const color=n==='fadewhite'?'white':'black';
  if(n==='smoothleft') return `fade=t=in:st=0:d=${d}:alpha=0,fade=t=out:st=${out}:d=${d}:alpha=0`;
  if(n==='smoothright') return `fade=t=in:st=0:d=${d},fade=t=out:st=${out}:d=${d}`;
  if(n==='smoothup') return `fade=t=in:st=0:d=${d}:color=${color},fade=t=out:st=${out}:d=${d}:color=${color}`;
  if(n==='smoothdown') return `fade=t=in:st=0:d=${d},fade=t=out:st=${out}:d=${d}`;
  return `fade=t=in:st=0:d=${d}:color=${color},fade=t=out:st=${out}:d=${d}:color=${color}`;
}


ipcMain.handle('video:postPlan', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const folder=payload.folder||''; const files=(payload.files&&payload.files.length?payload.files:videoFiles(folder)).filter(Boolean); if(!folder||!files.length)return {ok:false,error:'missing_videos'};
  const apiKey=payload.apiKey||''; const script=String(payload.script||'').trim();
  const framePlan=targetVideoFrame(files); const scenes=files.map((file,i)=>{const probe=framePlan.probes[i];return {id:`scene_${i+1}`,index:i+1,file,name:path.basename(file),keep:true,order:i+1,start:0,end:probe.duration||videoDurationSec(file),width:probe.width,height:probe.height,targetWidth:framePlan.width,targetHeight:framePlan.height,orientation:framePlan.orientation,transition:payload.defaultTransition&&payload.defaultTransition!=='ai'?safeTransitionName(payload.defaultTransition):'fade',effect:'subtle_fade',reason:'AI auto hậu kì'}});
  let subtitles=[];
  if(payload.srtFile && fs.existsSync(payload.srtFile)){
    const raw=fs.readFileSync(payload.srtFile,'utf8');
    subtitles=path.extname(payload.srtFile).toLowerCase()==='.ass'?parseSimpleAss(raw):parseSimpleSrt(raw);
  }
  if(apiKey){
    try{
      const sys='Bạn là AI dựng hậu kì video. Phân tích tên file video và kịch bản, trả JSON {scenes:[{index,order,keep,reason,start,end,transition,effect}]}. transition chỉ chọn fade, fadeblack, fadewhite, smoothleft, smoothright, smoothup, smoothdown. Phân tích kích thước/tỷ lệ từng clip, tự bỏ đoạn thừa/lỗi giọng bằng start/end, sắp cảnh đúng diễn biến, chọn hiệu ứng chuyển cảnh nhẹ phù hợp từng cảnh; tránh hiệu ứng rối mắt. Không tạo subtitle từ kịch bản; subtitle sẽ được nhận dạng riêng từ audio thật.';
      const text=`KỊCH BẢN:
${script||'(không có)'}

FILES:
${files.map((f,i)=>`${i+1}. ${path.basename(f)} duration=${videoDurationSec(f)}s`).join('\n')}

AutoSub=${!!payload.autoSub} Language=${payload.subLang||'vi'}`;
      const out=await geminiText(apiKey,[{text}],sys,true); const obj=JSON.parse(out.replace(/^```json\s*|```$/g,''));
      for(const item of obj.scenes||[]){ const sc=scenes[(Number(item.index)||1)-1]; if(sc){ Object.assign(sc,{order:Number(item.order||sc.order),keep:item.keep!==false,reason:item.reason||sc.reason,start:Number(item.start||0),end:Number(item.end||sc.end||0),transition:payload.defaultTransition&&payload.defaultTransition!=='ai'?safeTransitionName(payload.defaultTransition):safeTransitionName(item.transition),effect:String(item.effect||'subtle_fade')}); }}
    }catch(e){ return {ok:true,warning:'ai_post_plan_failed:'+String(e.message||e),scenes,subtitles}; }
  }
  scenes.sort((a,b)=>a.order-b.order);
  if(payload.autoSub && !payload.srtFile){
    if(!apiKey) return {ok:false,error:'missing_api_key_for_audio_transcription'};
    try{ subtitles=await transcribeTimelineVerbatim(scenes,apiKey,payload.apiModel||'',payload.subLang||'vi'); }
    catch(e){ return {ok:false,error:'audio_transcription_failed:'+String(e.message||e),scenes}; }
    if(!subtitles.length) return {ok:false,error:'no_spoken_audio_detected',scenes};
  }
  return {ok:true,scenes,subtitles,framePlan,subtitleSource:payload.srtFile?'file':payload.autoSub?'audio_verbatim':'none'};
});

ipcMain.handle('video:postExport', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const folder=payload.folder||'';
  const scenes=(payload.scenes||[]).filter(s=>s.keep!==false&&s.file);
  if(!folder||!scenes.length)return {ok:false,error:'missing_ai_timeline'};
  const outDir=path.join(folder,'flow_auto_post'); fs.mkdirSync(outDir,{recursive:true});
  const list=path.join(outDir,'ai-post-list.txt'); const temp=[]; const framePlan=targetVideoFrame(scenes.map(s=>s.file));
  for(const [i,sc] of scenes.entries()){
    const out=path.join(outDir,`clip_${String(i+1).padStart(3,'0')}.mp4`);
    const args=['-y'];
    if(Number(sc.start)>0) args.push('-ss',String(sc.start));
    args.push('-i',sc.file);
    if(Number(sc.end)>Number(sc.start||0)) args.push('-t',String(Number(sc.end)-Number(sc.start||0)));
    const clipDur=Math.max(.5,(Number(sc.end)>Number(sc.start||0)?Number(sc.end)-Number(sc.start||0):videoProbe(sc.file).duration)||8); const chosenTransition=sc.transition&&sc.transition!=='ai'?safeTransitionName(sc.transition):(payload.defaultTransition&&payload.defaultTransition!=='ai'?safeTransitionName(payload.defaultTransition):'fade'); const transitionFx=sceneTransitionFilter(chosenTransition,clipDur); const vf=`scale=${framePlan.width}:${framePlan.height}:force_original_aspect_ratio=decrease,pad=${framePlan.width}:${framePlan.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,${transitionFx}`; args.push('-map','0:v:0?','-map','0:a:0?','-vf',vf,'-r','30','-pix_fmt','yuv420p','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-ar','48000','-ac','2','-b:a','192k',out);
    const r=ffmpegRun(args); if(r.status!==0)return {ok:false,error:'ffmpeg_trim_failed:'+ffErr(r)};
    temp.push(out);
  }
  fs.writeFileSync(list,temp.map(f=>`file '${concatPath(f)}'`).join('\n'),'utf8');
  let merged=path.join(outDir,`ai_post_${Date.now()}.mp4`);
  let r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',merged]);
  if(r.status!==0) r=ffmpegRun(['-y','-f','concat','-safe','0','-i',list,'-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',merged]);
  if(r.status!==0)return {ok:false,error:'ffmpeg_ai_merge_failed:'+ffErr(r)};
  let subs=validSubtitleRows(payload.subtitles||[]);
  if(!subs.length && payload.srtFile && fs.existsSync(payload.srtFile)){
    const raw=fs.readFileSync(payload.srtFile,'utf8');
    subs=validSubtitleRows(path.extname(payload.srtFile).toLowerCase()==='.ass'?parseSimpleAss(raw):parseSimpleSrt(raw));
  }
  if(payload.autoSub && !subs.length) return {ok:false,error:'subtitle_enabled_but_no_valid_rows'};
  if(subs.length){
    const ass=writeAssSub(path.join(outDir,'ai_subtitles.ass'),subs,payload.subStyle||{});
    const final=path.join(outDir,`ai_post_sub_${Date.now()}.mp4`);
    const assPath=ass.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
    const vf=`ass='${assPath}'`;
    const rr=ffmpegRun(['-y','-i',merged,'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','copy',final]);
    if(rr.status===0) merged=final; else return {ok:false,error:'ffmpeg_sub_burn_failed:'+ffErr(rr)};
  }
  return {ok:true,out:merged};
});


ipcMain.handle('prompt:analyzeUrl', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const apiKey=payload.apiKey||''; if(!apiKey) return {ok:false,error:'missing_api_key'};
  const deepRewrite=payload.deepRewrite===true;
  const outLang=langName(payload.promptLang); const duration=String(payload.duration||'60 seconds'); const targetScenes=durationScenes(duration);
  let page;
  try{ page=await fetchUrlReadable(payload.url); }catch(e){ return {ok:false,error:'fetch_url_failed:'+String(e.message||e)}; }
  let parts=[]; let videoNote='';
  if(page.isDirectVideo){
    try{
      const dl=await downloadVideoForAnalysis(page.url);
      const frames=extractAnalysisFrames(dl.file,dl.dir,Math.min(24,Math.max(8,targetScenes)));
      parts=imageParts(frames);
      videoNote=`Downloaded direct video for visual scene analysis. Extracted ${frames.length} frames from ${path.basename(dl.file)}.`;
    }catch(e){ videoNote=`Direct video visual analysis unavailable: ${String(e.message||e)}. Use URL metadata only and do not invent uncertain details.`; }
  }
  const sys=`Bạn là đạo diễn sáng tạo, biên kịch quảng cáo/video ngắn và chuyên gia phân tích nội dung. Ngôn ngữ đầu ra: ${outLang}. Nhiệm vụ: phân tích nguồn thật kỹ rồi viết lại thành kịch bản video chuyên nghiệp, cuốn hút hơn, nhưng vẫn bám sát nguồn. ${deepRewrite?'CHẾ ĐỘ VIẾT LẠI CHUYÊN SÂU TỪ BÀI BÁO: xác định luận điểm trung tâm, bối cảnh, nguyên nhân, diễn biến, tác động, các góc nhìn, dữ kiện then chốt và kết luận; tạo mở đầu có hook mạnh, mạch kể tăng tiến, chuyển cảnh logic và kết thúc gợi suy ngẫm. Chuyên sâu hơn nguồn về cách giải thích và cấu trúc nhưng tuyệt đối không bịa số liệu, trích dẫn, nhân vật hoặc sự kiện. Phân biệt rõ dữ kiện trong nguồn với nhận định/phân tích. Loại bỏ quảng cáo, nội dung lặp và chi tiết không liên quan.':'CHẾ ĐỘ PHÂN TÍCH TIÊU CHUẨN.'} Nếu nguồn là VIDEO và có frame ảnh, hãy phân tích từng cảnh: nhân vật/chủ thể, bối cảnh, hành động, nhịp dựng, cảm xúc, camera, ánh sáng, màu sắc, điểm nhấn thị giác. Nếu nguồn là BÀI BÁO/TRANG WEB, hãy bóc tách ý chính, sự kiện, nhân vật/chủ thể, bối cảnh, thông tin quan trọng rồi chuyển thành kịch bản video. BẮT BUỘC giữ đúng sự kiện/chủ thể/thứ tự ý cốt lõi, không bịa thông tin không có trong nguồn. BẮT BUỘC chia đúng ${targetScenes} cảnh, mỗi cảnh 8 giây, không thiếu không thừa. ${policySafeInstruction(outLang)} Trả JSON {"script":"...","sourceSummary":"...","sceneAnalysis":"..."}. Trường script phải có đúng ${targetScenes} cảnh. Mỗi cảnh chỉ dùng đúng cấu trúc sau, không thêm dòng Prompt, không thêm Description, không thêm Thời lượng:
Scene 01:
Hình ảnh: ...
Hành động: ...
Cảm xúc: ...
Camera: ...
Ánh sáng/Màu sắc: ...
Voiceover: ...`;
  const prompt=`URL: ${page.url}\nContent-Type: ${page.contentType}\nTitle: ${page.title||''}\nTarget duration: ${duration}\nRequired scenes: ${targetScenes} scenes, each scene 8 seconds.\nVideo analysis note: ${videoNote}\n\nSOURCE TEXT / METADATA:\n${page.text}\n\n${deepRewrite?'Hãy viết lại bài báo thành kịch bản video chuyên sâu, hấp dẫn và có chiều sâu phân tích; mở đầu bằng hook, phát triển theo bối cảnh–diễn biến–tác động–góc nhìn–kết luận, nhưng chỉ dùng dữ kiện kiểm chứng được trong nguồn.':'Hãy phân tích nguồn thật chi tiết rồi viết lại thành kịch bản chuyên nghiệp dùng trực tiếp trong AI Prompt Studio.'} Kịch bản cuối BẮT BUỘC đúng ${targetScenes} cảnh, mỗi cảnh 8 giây, đánh số Scene 01 đến Scene ${String(targetScenes).padStart(2,'0')}. Mỗi cảnh chỉ gồm đúng các dòng: Hình ảnh, Hành động, Cảm xúc, Camera, Ánh sáng/Màu sắc, Voiceover. Không thêm dòng Prompt, không thêm Description, không thêm Thời lượng.`;
  try{
    const out=await geminiText(apiKey,[...parts,{text:prompt}],sys,true,payload.apiModel);
    const obj=JSON.parse(String(out||'').replace(/^```json\s*|```$/g,''));
    return {ok:true,script:policySafePostProcess(obj.script||'',outLang),sourceSummary:obj.sourceSummary||'',sceneAnalysis:obj.sceneAnalysis||'',rewriteMode:deepRewrite?'deep_article':'standard',page};
  }catch(e){ return {ok:false,error:'ai_url_analyze_failed:'+String(e.message||e),page}; }
});

ipcMain.handle('prompt:script', async(_e,payload)=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  try {
    return await generateScriptJs(payload||{});
  } catch (err) {
    console.error("IPC generateScript error:", err);
    return { ok: false, error: String(err.message || err) };
  }
});
