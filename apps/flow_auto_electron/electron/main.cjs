const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const isDev = !app.isPackaged;
// Share runtime/license with stable standalone app so existing activated keys are visible.
const BASE_DIR = path.join(os.homedir(), '.flow-auto-standalone');
const FLOW_DIR = path.join(BASE_DIR, 'flow-auto');
const JOB_DIR = path.join(FLOW_DIR, 'job-state');
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
const DEFAULT_API_BASE = 'https://server-auto-tool.vercel.app/api/license';
const CDP_PROFILE = path.join(BASE_DIR, 'chrome-cdp-profile');
const LICENSE_CONFIG = path.join(BASE_DIR, 'keys', 'license-online.json');

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
function bootstrap(){ ensureDirs(); const src=resourcePath('payload/scripts'); if(fs.existsSync(src)){ for(const f of fs.readdirSync(src)){ const sp=path.join(src,f); const dp=path.join(SCRIPTS_DIR,f); if(fs.statSync(sp).isFile()) fs.copyFileSync(sp,dp); } } const req=resourcePath('payload/requirements.txt'); if(fs.existsSync(req)) fs.copyFileSync(req, REQ_FILE); }
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


function loadLicenseCfg(){ try{return JSON.parse(fs.readFileSync(LICENSE_CONFIG,'utf8'))}catch{return {}} }
function saveLicenseCfg(cfg){ fs.mkdirSync(path.dirname(LICENSE_CONFIG),{recursive:true}); fs.writeFileSync(LICENSE_CONFIG,JSON.stringify(cfg,null,2),'utf8'); }
function normalizeBase(b){ b=String(b||'').trim().replace(/\/+$/,''); if(b.endsWith('/activate')||b.endsWith('/verify')) b=b.replace(/\/[^\/]+$/,''); return b; }
async function postJson(url,payload){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); let data={}; try{data=await r.json()}catch{} return {status:r.status,data}; }
async function verifyLicenseJs(){ const cfg=loadLicenseCfg(); const base=normalizeBase(cfg.api_base||''); if(!base) return {ok:false,reason:'missing_api_base'}; if(!cfg.license_key) return {ok:false,reason:'missing_license_key'}; cfg.machine_id=cfg.machine_id||machineId(); const payload={license_key:cfg.license_key,machine_id:cfg.machine_id,app_version:'V2.0',nonce:Date.now().toString(36),timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}; if(cfg.signed_token) payload.signed_token=cfg.signed_token; try{ const {status,data}=await postJson(`${base}/verify`,payload); if(status===200 && data.valid){ ['signed_token','expires_at','grace_until','next_check_at'].forEach(k=>{if(data[k])cfg[k]=data[k]}); cfg.last_verified_at=payload.timestamp; saveLicenseCfg(cfg); return {ok:true,expires_at:data.expires_at||cfg.expires_at,data}; } return {ok:false,reason:data.reason||`http_${status}`,data}; }catch(e){ return {ok:false,reason:`network_error:${e.message||e}`}; }}

const STYLE_SUFFIX={CINEMATIC:'LIVE ACTION real human person, photorealistic live-action film, natural human skin texture, real face, realistic body, realistic clothing, cinematic lighting, 8k, shot on 35mm lens, shallow depth of field, not anime, not cartoon, not 3D render, not illustration',ANIME:'anime style, studio ghibli, makoto shinkai style, vibrant colors, detailed background, high quality 2d animation',PAINTING:'digital painting, oil painting texture, artistic style, concept art, artstation, masterpiece, intricate details',RENDER_3D:'3d render, unreal engine 5, octane render, global illumination, highly detailed, 8k resolution, ray tracing',COMIC_BOOK:'comic book style, graphic novel, bold outlines, halftone patterns, high contrast, dynamic lighting, marvel comics style',PIXEL_ART:'pixel art, 16-bit, retro gaming style, highly detailed pixel art, isometric perspective, vibrant colors',WATERCOLOR:'watercolor painting, soft edges, color bleeding, traditional art, ethereal, dreamy, delicate brushstrokes',CYBERPUNK:'cyberpunk style, neon lights, futuristic city, high tech, sci-fi, dark atmosphere, holographic elements',STEAMPUNK:'steampunk style, brass gears, steam powered, victorian era, intricate machinery, sepia tones, retro-futuristic',NONE:''};

async function geminiTextFast(apiKey,parts,system,jsonMode=false,timeoutMs=60000){
  const keys=String(apiKey||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  if(!keys.length) throw new Error('missing_api_key');
  let lastErr='';
  for(const key of keys){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const body={contents:[{role:'user',parts}],systemInstruction:{parts:[{text:system}]},generationConfig:{temperature:.55}};
      if(jsonMode) body.generationConfig.responseMimeType='application/json';
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
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

async function geminiText(apiKey,parts,system,jsonMode=false){
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
          const score=x=> (x.includes('flash')?100:0) + (x.includes('2.0')?20:0) + (x.includes('1.5')?10:0) - (x.includes('vision')?50:0);
          return score(b)-score(a);
        });
    }catch(e){ lastErr=`list_models_failed:${e.message||e}`; }

    // Fallback only if ListModels is unavailable; unavailable models are skipped silently.
    if(!models.length) models=['gemini-2.0-flash','gemini-1.5-flash'];

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
function imageParts(files){ const out=[]; for(const f of (files||[]).slice(0,8)){ try{ out.push({inlineData:{mimeType:mimeFromFile(f),data:fs.readFileSync(f).toString('base64')}}); }catch{} } return out; }
function characterSystem(style,media,outLang='English'){
  const label = style;
  const suffix = STYLE_SUFFIX[style] || '';
  return ` Bạn là một chuyên gia kỹ sư prompt (Prompt Engineer) hàng đầu thế giới cho các mô hình AI tạo sinh như Gemini Image (Banana Pro) và Veo (Video).
    Nhiệm vụ của bạn là nhận ý tưởng thô từ người dùng và viết lại thành một prompt cực kỳ chi tiết bằng đúng ngôn ngữ được yêu cầu, chất lượng cao để tạo ra kết quả tốt nhất.

    YÊU CẦU QUAN TRỌNG NHẤT:
    1. TUYỆT ĐỐI KHÔNG THAY ĐỔI ĐỐI TƯỢNG CHÍNH: Nếu kịch bản là về "chú chó" (dog), "con mèo" (cat), hay "vật thể" (object), TUYỆT ĐỐI KHÔNG ĐƯỢC biến nó thành con người (human). Phải giữ đúng loài vật/đối tượng mà người dùng đã nhập.
    2. BÁM SÁT NỘI DUNG GỐC: Không được thay đổi cốt truyện, chủ thể hoặc hành động chính của người dùng. Chỉ được phép thêm các từ miêu tả chi tiết (adjectives) và các tham số kỹ thuật (technical parameters).
    3. NGÔN NGỮ ĐẦU RA BẮT BUỘC: Toàn bộ prompt, description và lời thoại phải viết bằng ${outLang}. Không được tự đổi sang tiếng Anh nếu ${outLang} không phải English.
    4. KHÔNG TỰ Ý TÓM TẮT: Nếu người dùng nhập một đoạn dài, hãy dịch và chi tiết hóa toàn bộ đoạn đó, không được tóm tắt thành một câu ngắn.
    5. Chỉ trả về nội dung prompt đã tối ưu bằng ${outLang}. Không giải thích, không thêm râu ria.
    6. Tích hợp phong cách: ${label}. (${suffix})
    7. Loại media mục tiêu: ${media === 'VIDEO' ? 'Video (Veo 3.1) - Cần mô tả chuyển động, góc máy, nhịp độ' : 'Hình ảnh (Gemini Pro Image) - Cần mô tả bố cục, ánh sáng, chi tiết tĩnh'}.
    8. Nếu reference character images được cung cấp, hãy phân tích kỹ loài vật/nhân vật, kiểu dáng, trang phục để giữ sự đồng nhất 100%.`;
}
function splitIdeas(t){return String(t||'').split(/\n+/).map(x=>x.trim()).filter(Boolean)}

async function buildCharacterLock(apiKey, characterImages){
  const imgs=imageParts(characterImages);
  if(!imgs.length) return '';
  const sys='You are a strict subject consistency analyst. Analyze the reference images and create a SUBJECT LOCK in English. Identify the species/subject first (e.g., Golden Retriever dog, robotic arm, young woman). Include only the most important stable identity traits: species, color, breed/type, facial features, body markings, and clothing/accessories. Keep it compact, maximum 45 words. Do not invent unseen traits.';
  return await geminiText(apiKey,[...imgs,{text:'Create a compact reusable SUBJECT LOCK, maximum 45 words, for AI video prompts. Identify if it is an animal or human and describe it accurately to keep it identical across scenes.'}],sys,false);
}
function lockPrompt(prompt, characterLock, outLang='English'){
  if(!characterLock) return prompt;
  const guard = outLang==='Vietnamese' ? `Giữ cùng một nhân vật xuyên suốt: ${characterLock}. Giữ nguyên khuôn mặt, tóc, độ tuổi, vóc dáng và trang phục chính. ` : outLang==='Chinese' ? `始终保持同一个角色：${characterLock}。保持相同的脸、头发、年龄、体型和主要服装。 ` : outLang==='Korean' ? `전체 장면에서 동일한 캐릭터 유지: ${characterLock}. 얼굴, 머리, 나이, 체형, 주요 의상을 그대로 유지. ` : outLang==='Spanish' ? `Mantener el mismo personaje en todo momento: ${characterLock}. Conservar rostro, cabello, edad, tipo de cuerpo y atuendo principal. ` : `Same character throughout: ${characterLock}. Keep face, hair, age, body type, and main outfit consistent. `;
  const p=String(prompt||'').trim();
  return p.includes('CHARACTER CONSISTENCY LOCK') ? p : guard + p;
}

function writeGenerated(name,prompts){ const file=path.join(JOB_DIR,name); fs.writeFileSync(file,prompts.map(x=>String(x).replace(/\s+/g,' ').trim()).filter(Boolean).join('\n\n')+'\n','utf8'); return {file,count:prompts.length,prompts}; }
function writeScriptText(obj){ const file=path.join(JOB_DIR,'electron-ai-video-script.txt'); const scenes=(obj.scenes||[]).sort((a,b)=>(a.sceneNumber||0)-(b.sceneNumber||0)); const lines=[`TITLE: ${obj.title||''}`, obj.characterSheet?`CHARACTER SHEET:
${obj.characterSheet}`:'', 'SCENES:', ...scenes.map(s=>`Scene ${s.sceneNumber||''} (${s.duration||''})\nDescription: ${s.description||''}\nPrompt: ${s.prompt||''}`)].filter(Boolean); fs.writeFileSync(file,lines.join('\n\n'),'utf8'); return file; }
function langName(code){ return ({vi:'Vietnamese',en:'English',zh:'Chinese',ko:'Korean',es:'Spanish'}[String(code||'en')]||'English'); }
function voiceLangName(code){ return String(code||'vi')==='en'?'English':'Vietnamese'; }
async function generatePromptsJs(payload){
  const apiKey=payload.apiKey||''; const style=payload.style||'CINEMATIC'; const media=payload.mediaType||'IMAGE'; const outLang=langName(payload.promptLang); const voiceLang=voiceLangName(payload.voiceLang);
  const sys=characterSystem(style,media,outLang); const imgs=imageParts(payload.characterImages); const characterLock=await buildCharacterLock(apiKey,payload.characterImages);
  const results=[];
  for(const idea of splitIdeas(payload.ideas)){
    const prompt=await geminiText(apiKey,[...imgs,{text:`CHARACTER LOCK TO KEEP EXACTLY:\n${characterLock||'(no reference character)'}\n\nScene/content to generate prompt for: ${idea}\nRequirement: write the prompt in ${outLang} only. If the scene contains speech/dialogue, the character must speak ${voiceLang} with a natural ${voiceLang} voice/accent; include this instruction explicitly in the video prompt. Follow the content exactly. If a character lock exists, include the compact identity description, but keep the full prompt concise and under 90 words if possible.`}],sys,false);
    results.push(lockPrompt(prompt,characterLock,outLang));
  }
  return {ok:true,characterLock,generated:writeGenerated('electron-ai-generated-prompts.txt',results)};
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

  const sys=`You are a professional image prompt designer. Output valid JSON only. Output language: ${outLang}. Visual style: ${style}. Every item must be one standalone single-character image prompt. Never create group scenes. Never combine characters. Never mention the character name directly; infer and describe the character visually with maximum accuracy. If output language is Vietnamese, every word in the prompt must be Vietnamese except unavoidable proper names.`;
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
    text=await geminiTextFast(apiKey,[{text:prompt}],sys,true,60000);
  }catch(e){
    // Fallback to normal text mode if JSON mode is not supported/quota model behavior differs.
    text=await geminiTextFast(apiKey,[{text:prompt}],sys,false,60000);
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

async function generateScriptJs(payload){
  const totalScenes=durationScenes(payload.duration);
  const imgs=imageParts(payload.characterImages);
  let characterSheet=await buildCharacterLock(payload.apiKey,payload.characterImages);
  const style=payload.style||'CINEMATIC';
  const outLang=langName(payload.promptLang);
  const voiceLang=voiceLangName(payload.voiceLang);
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
      2. BÁM SÁT NỘI DUNG GỐC: Không được thay đổi cốt truyện, chủ thể hoặc hành động chính của người dùng.
      3. BẠN PHẢI TẠO CHÍNH XÁC ${sceneCount} CẢNH QUAY (từ cảnh ${startScene} đến cảnh ${endScene}). Không được thiếu, không được thừa.
      4. MỖI CẢNH QUAY PHẢI CÓ THỜI LƯỢNG CỐ ĐỊNH LÀ 8 GIÂY (8s).
      5. TỐI ƯU ĐỒNG NHẤT NHÂN VẬT: 
         ${characterSheet ? `- SỬ DỤNG BẢN MÔ TẢ NHÂN VẬT SAU ĐÂY CHO TẤT CẢ CÁC CẢNH: "${characterSheet}"` : `- Bước 1: Xác định một "bản mô tả nhân vật" (Character Sheet) cực kỳ chi tiết bao gồm: Giới tính, độ tuổi, sắc tộc, kiểu tóc, màu mắt, đặc điểm khuôn mặt, trang phục, phụ kiện.`}
         - Bắt buộc lặp lại TOÀN BỘ bản mô tả nhân vật này vào phần đầu của MỖI prompt trong từng cảnh quay.
         - Đảm bảo hành động không làm thay đổi các đặc điểm này.
      6. Mỗi cảnh quay phải có:
         - sceneNumber: Số thứ tự cảnh (từ ${startScene} đến ${endScene}).
         - duration: Thời lượng cảnh đó (luôn là "8s").
         - description: Mô tả nội dung cảnh bằng ${outLang} bám sát nội dung gốc.
         - prompt: Prompt chi tiết bằng ${outLang} cho Veo 3.1, tích hợp phong cách ${STYLE_SUFFIX[style]} (${style}). Prompt PHẢI bắt đầu bằng bản mô tả nhân vật đồng nhất đã xác định.
      7. NGÔN NGỮ GIỌNG NÓI NHÂN VẬT: Nếu cảnh có lời thoại/nhân vật nói, nhân vật bắt buộc nói bằng ${voiceLang}, giọng tự nhiên theo ${voiceLang}. Trong prompt video phải ghi rõ: character speaks ${voiceLang}.
      8. Trả về kết quả dưới dạng JSON: {"title":"...","characterSheet":"...","scenes":[{"sceneNumber":...,"duration":"8s","description":"...","prompt":"..."}]}.`;

    const characterInstruction=characterSheet
      ? `USE THIS EXACT CHARACTER SHEET FOR ALL SCENES: "${characterSheet}". Repeat this compact identity inside every prompt, translated/written in ${outLang}. Do not change face, hair, age, body type, or main outfit.`
      : `If reference images are included, first create a compact Character Sheet under 45 words from the images in ${outLang}, then repeat it inside every scene prompt.`;
    const parts=[...(i===0?imgs:[]),{text:`Topic/content: ${payload.topic}. Total video scenes: ${totalScenes}. Generate scenes ${startScene}-${endScene}. ${characterInstruction} Prompts and descriptions must be in ${outLang}. If any dialogue/speech exists, character voice language must be ${voiceLang}. Keep prompts short but preserve character consistency.`}];
    const txt=await geminiText(payload.apiKey,parts,sys,true);
    let obj;
    try {
      obj=JSON.parse(txt.replace(/^```json\s*|```$/g,''));
    } catch (e) {
      console.error("JSON parse failed, attempt fuzzy match:", e);
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) obj = JSON.parse(m[0]); else throw e;
    }
    if(i===0){ title=obj.title||payload.topic||''; if(obj.characterSheet) characterSheet=String(obj.characterSheet).replace(/\s+/g,' ').trim(); }
    const scenes=(obj.scenes||[]).map(sc=>({
      ...sc,
      duration: sc.duration||'8s',
      prompt: lockPrompt(sc.prompt,characterSheet,outLang)
    }));
    allScenes.push(...scenes);
  }
  const finalObj={title:title||payload.topic||'', characterSheet, totalDuration:payload.duration, scenes:allScenes.slice(0,totalScenes)};
  const prompts=finalObj.scenes.sort((a,b)=>(a.sceneNumber||0)-(b.sceneNumber||0)).map(s=>s.prompt).filter(Boolean);
  const generated=writeGenerated('electron-ai-script-prompts.txt',prompts);
  const scriptFile=writeScriptText(finalObj);
  return {ok:true,characterLock:characterSheet,generated,scriptFile};
}

async function activateLicenseJs(key,api){ const cfg=loadLicenseCfg(); cfg.api_base=normalizeBase(DEFAULT_API_BASE); cfg.license_key=String(key||'').trim(); cfg.machine_id=machineId(); if(!cfg.api_base) return {ok:false,error:'missing_api_base'}; if(!cfg.license_key) return {ok:false,error:'missing_license_key'}; const payload={license_key:cfg.license_key,machine_id:cfg.machine_id,app_version:'V2.0',nonce:Date.now().toString(36),timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}; try{ const {status,data}=await postJson(`${cfg.api_base}/activate`,payload); if(status===200 && data.valid!==false){ ['signed_token','expires_at','grace_until','next_check_at'].forEach(k=>{if(data[k])cfg[k]=data[k]}); cfg.last_verified_at=payload.timestamp; saveLicenseCfg(cfg); return {ok:true,expires_at:data.expires_at||cfg.expires_at,data}; } return {ok:false,error:data.reason||`http_${status}`,data}; }catch(e){ return {ok:false,error:`network_error:${e.message||e}`}; }}

function cachedLicense(){ try{ const cfg=JSON.parse(fs.readFileSync(LICENSE_CONFIG,'utf8')); if(cfg.expires_at) return {ok:true, cached:true, expires_at:cfg.expires_at}; if(cfg.license_key) return {ok:true, cached:true, reason:'Đã có key local nhưng chưa có thời hạn'}; }catch{} return null; }
function readPid(){ try{return Number(fs.readFileSync(PID_RUN,'utf8').trim())}catch{return 0} }
function isRunningPid(pid){ if(!pid) return false; try{ process.kill(pid,0); return true; }catch{return false;} }

function anyRunnerRunning(){
  const pids=[]; const p=readPid(); if(p)pids.push(p);
  try{ for(const f of fs.readdirSync(JOB_DIR).filter(x=>/^electron-runner-\d+\.pid$/.test(x))){ const v=Number(fs.readFileSync(path.join(JOB_DIR,f),'utf8').trim()); if(v)pids.push(v); } }catch{}
  return [...new Set(pids)].some(isRunningPid);
}

function runState(){ let progress=null; try{ const st=JSON.parse(fs.readFileSync(RUN_STATE,'utf8')); progress={done:st.done||0,total:st.total||0,current:Math.min((st.done||0)+1, st.total||0)}; }catch{} const pid=readPid(); const running=isRunningPid(pid); if(pid && !running){ try{fs.rmSync(PID_RUN,{force:true})}catch{} } return {pid: running?pid:0, running, paused:fs.existsSync(PAUSE_FILE), progress}; }
function parseJsonMaybe(txt){ try{return JSON.parse(txt||'{}')}catch{return null} }
function withTimeout(promise, ms, label='timeout'){ return Promise.race([promise, new Promise((_,rej)=>setTimeout(()=>rej(new Error(label)), ms))]); }
async function onlineLicenseGuard(){ const r=await verifyLicenseJs(); if(r.ok) return {ok:true,license:r}; return {ok:false,error:r.reason||r.error||'license_invalid_or_revoked'}; }
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
function resetRunnerWorkers(){
  ensureDirs();
  const killed=[];
  const files=[];
  try{ files.push(...fs.readdirSync(JOB_DIR).filter(x=>/^electron-runner(?:-state)?(?:-\d+)?\.(?:pid|json)$/.test(x)).map(x=>path.join(JOB_DIR,x))); }catch{}
  try{ files.push(PID_RUN, RUN_STATE, PAUSE_FILE); }catch{}
  const unique=[...new Set(files)];
  for(const f of unique){
    if(/\.pid$/.test(f)){
      try{ const pid=Number(fs.readFileSync(f,'utf8').trim()); if(pid){ killPid(pid); killed.push(pid); } }catch{}
    }
  }
  // Give taskkill/SIGTERM a short moment so the new worker cannot race old settings.
  const started=Date.now(); while(Date.now()-started<800){}
  for(const f of unique){ try{ fs.rmSync(f,{force:true}); }catch{} }
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
  // Always prefer the bundled Python script so new fixes/settings are used immediately.
  // Older packaged exe runners can keep stale automation logic between releases.
  const script=path.join(SCRIPTS_DIR,'flow_batch_runner.py');
  if(fs.existsSync(script)){
    const py=ensurePythonEnv();
    return {cmd:py, prefix:[script], compiled:false};
  }
  const exeName=process.platform==='win32'?'flow_batch_runner.exe':'flow_batch_runner';
  const candidates=[
    resourcePath(path.join('payload','bin','flow_batch_runner.dist',exeName)),
    resourcePath(path.join('payload','bin',exeName)),
    path.join(BASE_DIR,'bin','flow_batch_runner.dist',exeName),
    path.join(BASE_DIR,'bin',exeName),
  ];
  const exe=candidates.find(x=>fs.existsSync(x));
  if(exe) return {cmd:exe, prefix:[], compiled:true};
  const py=ensurePythonEnv();
  return {cmd:py, prefix:[script], compiled:false};
}

function startRunner(payload){
  ensureDirs(); try{fs.rmSync(PAUSE_FILE,{force:true})}catch{}
  const profiles=Array.isArray(payload.profiles)?payload.profiles.filter(x=>x&&(x.promptFile||String(x.script||x.prompts||'').trim())).slice(0,100):[];
  const promptFile=payload.promptFile || writePromptFile('electron-manual-prompts.txt', payload.prompts||'');
  const flowThreads=Math.max(1,Math.min(100,Number(payload.flowThreads||1)||1));
  let threadFiles=[]; let threadRefs=[];
  if(profiles.length){
    threadFiles=profiles.map((pr,i)=> pr.promptFile || writeThreadPromptFile(`profile-${i+1}.txt`,i,String(pr.script||pr.prompts||'').split(/\n\s*\n/g).map(x=>x.trim()).filter(Boolean)));
    threadRefs=profiles.map(pr=>pr.refsDir||'');
  }else{
    const blocks=readPromptBlocks(promptFile);
    threadFiles=flowThreads>1 && blocks.length>1 ? splitRoundRobin(blocks, flowThreads).map((part,i)=>writeThreadPromptFile(promptFile,i,part)) : [promptFile];
    threadRefs=threadFiles.map(()=>payload.refsDir||'');
  }
  const runner=runnerCommand(); const pids=[]; const runId=String(Date.now());
  threadFiles.forEach((pf,idx)=>{
    const logFile=path.join(DEBUG_DIR,`electron-runner-${idx+1}.log`); const out=fs.openSync(logFile,'a');
    const stateFile=idx===0?RUN_STATE:path.join(JOB_DIR,`electron-runner-state-${idx+1}.json`);
    try { if(fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch(e) {}
    const args=['--run-id',runId,'--prompts',pf,'--state',stateFile,'--fresh-run','--start-from',String(payload.startFrom||1),'--cdp',`http://127.0.0.1:${CDP_PORT+idx}`,'--task-mode',payload.mode||payload.taskMode||'createvideo','--video-sub-mode',payload.subMode||payload.videoSubMode||'frames','--reference-mode',payload.referenceMode||'ingredients','--flow-model',payload.model||payload.flowModel||'default','--flow-aspect-ratio',payload.ratio||payload.aspectRatio||payload.flowAspectRatio||'16:9','--flow-count',String(payload.count||payload.flowCount||1),'--omni-duration',String(payload.omniDuration||''),'--download-resolution','720','--between-prompts-sec',String(payload.spacing||10)];
    args.push(payload.pairedMode===false?'--no-paired-mode':'--paired-mode'); if(payload.autoDownload!==false) args.push('--auto-download'); if(payload.runMode==='continuous_submit_only') args.push('--submit-only'); if(payload.runMode==='continuous_download_delay_3') args.push('--download-delay-prompts','3'); const refDir=threadRefs[idx]||payload.refsDir; if(refDir) args.push('--refs-dir',refDir);
    const p=spawn(runner.cmd, [...runner.prefix, ...args], spawnOpts({detached:true, stdio:['ignore',out,out]})); p.unref(); pids.push(p.pid); fs.writeFileSync(path.join(JOB_DIR,`electron-runner-${idx+1}.pid`),String(p.pid));
  });
  fs.writeFileSync(PID_RUN,String(pids[0]||'')); return {ok:true,pid:pids[0],pids,threads:threadFiles.length,promptFile,runner:runner.compiled?'nuitka-runner-hidden-multitab':'python-stable-hidden-multitab'};
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

app.whenReady().then(()=>{ ensureDirs(); const splash=createSplash(); const win=createWindow(); setTimeout(()=>{ try{ bootstrap(); }catch{} }, 300); win.once('ready-to-show',()=>{ setTimeout(()=>{ splash.webContents.executeJavaScript('window.finish&&window.finish()').catch(()=>{}); setTimeout(()=>{ if(!splash.isDestroyed()) splash.close(); win.show(); },120); },250); }); });
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
ipcMain.handle('flow:start', async(_e,payload)=>{ const lic=await onlineLicenseGuard(); if(!lic.ok) return lic; const reset=resetRunnerWorkers(); const n=Math.max(1,Math.min(100,Array.isArray((payload||{}).profiles)&&payload.profiles.length?payload.profiles.length:Number((payload||{}).flowThreads||1)||1)); let c=await ensureCdpThreads(n,(payload||{}).profiles||[]); if(!c.ok) return c; const r=startRunner(payload||{}); return {...r, reset}; });
ipcMain.handle('flow:pause', async()=>{ if(!anyRunnerRunning()) return {ok:false,error:'process_not_running'}; ensureDirs(); fs.writeFileSync(PAUSE_FILE,String(Date.now())); return {ok:true, paused:true}; });
ipcMain.handle('flow:resume', async()=>{ if(!anyRunnerRunning() && !fs.existsSync(PAUSE_FILE)) return {ok:false,error:'process_not_running'}; try{fs.rmSync(PAUSE_FILE,{force:true})}catch{} return {ok:true, paused:false}; });
ipcMain.handle('flow:stop', async()=>{ const reset=resetRunnerWorkers(); return {ok:true, running:false, reset}; });
ipcMain.handle('license:machineId', async()=>({ok:true,machineId:machineId()}));
ipcMain.handle('license:cached', async()=>cachedLicense() || {ok:false, reason:'missing_local_license'});
ipcMain.handle('license:activate', async(_e,payload)=>activateLicenseJs(payload?.licenseKey, DEFAULT_API_BASE));
ipcMain.handle('license:check', async()=>{ const r=await verifyLicenseJs(); if(r.ok) return r; const cached=cachedLicense(); if(cached) return {...cached, warning:r.reason||r.error||'online_check_failed'}; return r; });
ipcMain.handle('prompt:generate', async(_e,payload)=>{ const lic=await onlineLicenseGuard(); if(!lic.ok) return lic; return generatePromptsJs(payload||{}); });
ipcMain.handle('prompt:characters', async(_e,payload)=>{ try{ const lic=await withTimeout(onlineLicenseGuard(),15000,'license_check_timeout'); if(!lic.ok) return lic; return await withTimeout(generateCharacterPromptsJs(payload||{}),75000,'character_prompt_timeout_75s'); }catch(e){ return {ok:false,error:String(e.message||e)}; } });

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


ipcMain.handle('video:analyzeSample', async(_e,payload={})=>{
  const lic=await onlineLicenseGuard(); if(!lic.ok) return lic;
  const file=payload.file||''; const apiKey=payload.apiKey||''; if(!file)return {ok:false,error:'missing_video'}; if(!apiKey)return {ok:false,error:'missing_api_key'};
  const outDir=path.join(path.dirname(file),'flow_auto_post','sample_frames_'+Date.now()); fs.mkdirSync(outDir,{recursive:true});
  const pattern=path.join(outDir,'frame_%02d.jpg');
  const r=ffmpegRun(['-y','-i',file,'-vf','fps=1/3,scale=512:-1','-frames:v','8',pattern]);
  if(r.status!==0) return {ok:false,error:'sample_frame_extract_failed: '+ffErr(r)};
  const frames=fs.readdirSync(outDir).filter(x=>/\.jpe?g$/i.test(x)).map(x=>path.join(outDir,x)).slice(0,8);
  if(!frames.length) return {ok:false,error:'no_frames_extracted'};
  const parts=imageParts(frames);
  const sys='Bạn là biên kịch video và chuyên gia phân tích nội dung. Hãy phân tích video mẫu qua các frame, nhận diện nhân vật, bối cảnh, hành động, nhịp câu chuyện, phong cách hình ảnh. Sau đó tạo một kịch bản mới có nội dung/tinh thần tương tự nhưng thay đổi đủ chi tiết để khác bản gốc: đổi bối cảnh phụ, hành động phụ, đạo cụ, nhịp chuyển cảnh, góc máy hoặc câu chuyện nhỏ. Không sao chép nguyên văn. Trả về tiếng Việt, có tiêu đề, tóm tắt, danh sách cảnh, và prompt tiếng Anh cho từng cảnh.';
  const prompt=`Video mẫu: ${path.basename(file)}\nYêu cầu: phân tích nội dung video mẫu và tạo kịch bản mới tương tự nhưng đã biến đổi để khác nội dung gốc. Thời lượng mong muốn: ${payload.duration||'60 seconds'}.`;
  const text=await geminiText(apiKey,[...parts,{text:prompt}],sys,false);
  const scriptFile=path.join(outDir,'ai-remix-script.txt'); fs.writeFileSync(scriptFile,text,'utf8');
  return {ok:true,script:text,scriptFile,frames};
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
