import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Film, KeyRound, Play, Square, Wand2, ImagePlus, CreditCard, Scissors, Music } from 'lucide-react';
import './style.css';

declare global { interface Window { flowAPI: any } }

const styles = ['CINEMATIC','ANIME','PAINTING','RENDER_3D','COMIC_BOOK','PIXEL_ART','WATERCOLOR','CYBERPUNK','STEAMPUNK','NONE'];
const models = ['default','veo3_lite','veo3_fast','veo3_quality','omni_flash','nano_banana_pro','nano_banana2','imagen4'];
const ratios = ['16:9','9:16','square','landscape_4_3','portrait_3_4'];

const api = () => window.flowAPI || {
  openFile: async()=>[], status: async()=>({ok:true,running:false}), licenseCached: async()=>({ok:true}), machineId: async()=>({machineId:''}),
  ensureCdp: async()=>({ok:false,error:'flowAPI_not_ready'}), openProfileLogin: async()=>({ok:false,error:'flowAPI_not_ready'}), start: async()=>({ok:false,error:'flowAPI_not_ready'}), pause: async()=>({ok:false,error:'flowAPI_not_ready'}), resume: async()=>({ok:false,error:'flowAPI_not_ready'}), stop: async()=>({ok:false,error:'flowAPI_not_ready'}),
  licenseCheck: async()=>({ok:false,error:'flowAPI_not_ready'}), activateLicense: async()=>({ok:false,error:'flowAPI_not_ready'}), generatePrompt: async()=>({ok:false,error:'flowAPI_not_ready'}), generateScript: async()=>({ok:false,error:'flowAPI_not_ready'}), generateCharacters: async()=>({ok:false,error:'flowAPI_not_ready'}),
  videoList: async()=>({ok:true,files:[]}), videoMerge: async()=>({ok:false,error:'flowAPI_not_ready'}), videoExtractAudio: async()=>({ok:false,error:'flowAPI_not_ready'}), videoAnalyzeSample: async()=>({ok:false,error:'flowAPI_not_ready'}), videoPostPlan: async()=>({ok:false,error:'flowAPI_not_ready'}), videoPostExport: async()=>({ok:false,error:'flowAPI_not_ready'})
};

function Card({title, icon, children}:{title:string; icon?:React.ReactNode; children:React.ReactNode}){return <div className="card"><div className="card-title">{icon}{title}</div>{children}</div>}
function Button({children,onClick,variant='soft'}:{children:React.ReactNode;onClick?:()=>void;variant?:'primary'|'soft'|'danger'}){return <button onClick={onClick} className={`btn ${variant}`}>{children}</button>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}

function App(){
  const [page,setPage]=useState('flow');
  const [apiKeys,setApiKeys]=useState(localStorage.getItem('gemini_api_keys')||'');
  const [style,setStyle]=useState('CINEMATIC');
  const [mediaType,setMediaType]=useState('VIDEO');
  const [ideas,setIdeas]=useState('');
  const [characterIdeas,setCharacterIdeas]=useState('');
  const [topic,setTopic]=useState('');
  const oldDuration=(localStorage.getItem('ai_duration')||'60 seconds');
  const [durationValue,setDurationValue]=useState(localStorage.getItem('ai_duration_value')||((oldDuration.match(/\d+/)||['60'])[0]));
  const [durationUnit,setDurationUnit]=useState<'seconds'|'minutes'>((localStorage.getItem('ai_duration_unit') as any)||(oldDuration.toLowerCase().includes('minute')||oldDuration.toLowerCase().includes('phút')?'minutes':'seconds'));
  const [promptLang,setPromptLang]=useState(localStorage.getItem('ai_prompt_lang')||'en');
  const [voiceLang,setVoiceLang]=useState(localStorage.getItem('ai_voice_lang')||'vi');
  const [mode,setMode]=useState('createvideo');
  const [subMode,setSubMode]=useState('frames');
  const [model,setModel]=useState('default');
  const [ratio,setRatio]=useState('16:9');
  const [count,setCount]=useState('1');
  const [omniDuration,setOmniDuration]=useState('8s');
  const [spacing, setSpacing] = useState('10');
  const [runMode,setRunMode]=useState('single');
  const [autoDownload,setAutoDownload]=useState((localStorage.getItem('flow_auto_download')||'true')==='true');
  const [flowThreads,setFlowThreads]=useState('1');
  const [profiles,setProfiles]=useState<any[]>([{name:'Profile 1',script:'',promptFile:'',refsDir:''},{name:'Profile 2',script:'',promptFile:'',refsDir:''}]);
  const [characterImages,setCharacterImages]=useState<string[]>([]);
  const [promptFile,setPromptFile]=useState('');
  const [refsDir,setRefsDir]=useState('');
  const [downloadDir,setDownloadDir]=useState(localStorage.getItem('flow_download_dir')||'');
  const [generatedFile,setGeneratedFile]=useState('');
  const [activity,setActivity]=useState('Sẵn sàng.');
  const [licenseText,setLicenseText]=useState('Đang kiểm tra license...');
  const [machineId,setMachineId]=useState('Đang lấy Machine ID...');
  const [licenseKey,setLicenseKey]=useState('');
  const [bootLoading,setBootLoading]=useState(true);
  const [bootPct,setBootPct]=useState(0);
  const [lang,setLang]=useState(localStorage.getItem('flow_lang')||'VI');
  const [langNotice,setLangNotice]=useState(false);
  const [videoFolder,setVideoFolder]=useState('');
  const [videoFiles,setVideoFiles]=useState<string[]>([]);
  const [audioFile,setAudioFile]=useState('');
  const [postMode,setPostMode]=useState<'ai'|'manual'>('ai');
  const [postScript,setPostScript]=useState('');
  const [sampleVideo,setSampleVideo]=useState('');
  const [timeline,setTimeline]=useState<any[]>([]);
  const [subLang,setSubLang]=useState('vi');
  const [manualCuts,setManualCuts]=useState('');
  const [manualSubs,setManualSubs]=useState('');
  const [manualClips,setManualClips]=useState<any[]>([]);
  const [subRows,setSubRows]=useState<any[]>([{start:'0',end:'3',text:''}]);
  const [musicFile,setMusicFile]=useState('');
  function timeoutPromise<T>(p:Promise<T>, ms:number, label:string):Promise<T>{ return Promise.race([p, new Promise<T>((_,rej)=>setTimeout(()=>rej(new Error(label)),ms))]); }
  const firstKey=()=>apiKeys.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)[0]||'';
  const friendly=(x:any)=>{
    if(typeof x==='string') return x;
    if(!x) return 'Không có phản hồi';
    if(x.ok===false){ const e=x.error||x.stderr||x.reason||''; if(String(e).includes('process_not_running')) return 'ℹ️ Tiến trình chưa chạy hoặc đã dừng.'; if(String(e).includes('revoked')||String(e).includes('expired')||String(e).includes('license_invalid')) return '❌ License đã hết hạn hoặc đã bị thu hồi. Các tính năng đã bị khóa.'; return `❌ ${e || 'Không kiểm tra được license. Vui lòng kiểm tra cấu hình hoặc kích hoạt lại.'}`; }
    if(x.base!==undefined && x.running!==undefined) {
      if(x.running) return `✅ Tiến trình đang chạy${x.progress?.total?' • prompt '+Math.min(x.progress.current,x.progress.total)+'/'+x.progress.total:''}.`;
      if(x.progress?.done) return `⏹ Tiến trình đã dừng • đã xong ${x.progress.done}/${x.progress.total||'?'} prompt.`;
      return 'ℹ️ Tiến trình chưa chạy.';
    }
    if(x.paused===true) return '⏸ Đã tạm dừng. App sẽ dừng trước prompt kế tiếp.';
    if(x.paused===false && x.ok===true) return '▶ Đã tiếp tục chạy.';
    if(x.running===false) return '⏹ Đã dừng tiến trình.';
    if(x.launched||x.already) return '🌐 Chrome Flow/CDP đã sẵn sàng.';
    if(x.pid) return `✅ Đã bắt đầu chạy. PID: ${x.pid}`;
    if(x.generated?.count!==undefined) return `✅ Đã tạo ${x.generated.count} prompt.`;
    if(x.expires_at) return `✅ License hiện tại hết hạn: ${x.expires_at}${x.warning?' • đang dùng dữ liệu local':''}`;
    if(x.stdout){
      try{
        const obj=JSON.parse(x.stdout);
        if(obj.ok===false) return `❌ License không hợp lệ${obj.reason?' • '+obj.reason:''}`;
        if(obj.ok===true) return `✅ License hợp lệ${obj.expires_at?' • hết hạn: '+obj.expires_at:''}`;
      }catch{}
      return '✅ Thao tác hoàn tất.';
    }
    if(x.ok===true) return '✅ Thành công';
    return 'ℹ️ Đã cập nhật trạng thái.';
  };
  const append=(x:any)=>setActivity(`${new Date().toLocaleTimeString()}  ${friendly(x)}`);
  const T=(vi:string,en:string)=>lang==='EN'?en:vi;
  const nav=[['flow',T('Vận hành Flow','Flow Operation'),Film],['ai','AI Prompt Studio',Wand2],['chars','Prompt nhân vật',ImagePlus],['multi',T('Đa luồng','Multi-profile'),Film],['post',T('Hậu kì video','Video Post-production'),Scissors],['payment',T('Thanh toán','Payment'),CreditCard],['license','License',KeyRound]];
  function switchLang(next:string){localStorage.setItem('flow_lang',next); setLang(next); setLangNotice(true); setActivity(next==='EN'?'Language changed. Please restart app to fully apply.':'Đã đổi ngôn ngữ. Vui lòng khởi động lại app để áp dụng đầy đủ.')}
  function saveApiConfig(){localStorage.setItem('gemini_api_keys',apiKeys); localStorage.setItem('ai_style',style); localStorage.setItem('ai_media_type',mediaType); localStorage.setItem('ai_duration_value',durationValue); localStorage.setItem('ai_duration_unit',durationUnit); localStorage.setItem('ai_prompt_lang',promptLang); localStorage.setItem('ai_voice_lang',voiceLang); append(lang==='EN'?'✅ API configuration saved.':'✅ Đã lưu cấu hình API.')}
  async function pickImages(){const r=await api().openFile({properties:['openFile','multiSelections'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}]}); if(r?.length){setCharacterImages(r); append(`Đã chọn ${r.length} ảnh nhân vật`)}}
  async function pickPrompt(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Text',extensions:['txt','json']},{name:'All',extensions:['*']}]}); if(r?.[0]){setPromptFile(r[0]); append(`Prompt file: ${r[0]}`)}}
  async function pickRefs(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setRefsDir(r[0]); append(`Đường dẫn thư mục ảnh: ${r[0]}`)}}
  async function pickDownloadDir(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setDownloadDir(r[0]); localStorage.setItem('flow_download_dir',r[0]); append(`Thư mục lưu tải về: ${r[0]}`)}}
  async function downloadGeneratedPrompt(){ if(!generatedFile){ append('Chưa có file prompt đã tạo.'); return; } append(await api().saveGeneratedPrompt(generatedFile)); }
  async function pickProfilePrompt(i:number){const r=await api().openFile({properties:['openFile'],filters:[{name:'Text',extensions:['txt','json']},{name:'All',extensions:['*']}]}); if(r?.[0]){setProfiles(p=>p.map((x,k)=>k===i?{...x,promptFile:r[0]}:x)); append(`Profile ${i+1} file prompt: ${r[0]}`)}}
  async function pickProfileRefs(i:number){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setProfiles(p=>p.map((x,k)=>k===i?{...x,refsDir:r[0]}:x)); append(`Profile ${i+1} thư mục ảnh: ${r[0]}`)}}
  async function pickVideoFolder(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setVideoFolder(r[0]); const x=await api().videoList(r[0]); setVideoFiles(x?.files||[]); append(`Đã chọn thư mục video: ${r[0]}`)}}
  async function pickMusic(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Audio',extensions:['mp3','wav','m4a','aac']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setMusicFile(r[0]); append(`Nhạc nền: ${r[0]}`)}}
  async function pickAudio(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Audio',extensions:['mp3','wav','m4a','aac']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setAudioFile(r[0]); append(`Audio: ${r[0]}`)}}
  async function pickSampleVideo(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','mkv','webm','avi','m4v']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setSampleVideo(r[0]); append(`Video mẫu: ${r[0]}`)}}
  async function analyzeSampleVideo(){append('AI đang phân tích video mẫu và tạo kịch bản tương tự...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().videoAnalyzeSample({file:sampleVideo,apiKey:firstKey(),duration}); if(r?.script)setPostScript(r.script); append(r)}
  async function analyzeSampleVideoForAi(){append('AI Prompt Studio đang phân tích video mẫu...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().videoAnalyzeSample({file:sampleVideo,apiKey:firstKey(),duration}); if(r?.script){setTopic(r.script); setIdeas(r.script);} append(r)}
  async function mergeVideos(){append('Đang ghép video...'); append(await api().videoMerge({folder:videoFolder,files:videoFiles}))}
  async function extractAudio(){append('Đang tách âm thanh...'); append(await api().videoExtractAudio({file:videoFiles[0]}))}
  async function analyzeVideos(){append(postMode==='ai'?'AI đang phân tích video theo kịch bản...':'Đang tạo timeline thủ công...'); const r=await api().videoAnalyze({folder:videoFolder,files:videoFiles,script:postScript,useAi:postMode==='ai',apiKey:firstKey()}); if(r?.scenes)setTimeline(r.scenes); append(r)}
  async function exportTimeline(){append('Đang xuất video theo timeline...'); append(await api().videoExportTimeline({folder:videoFolder,scenes:timeline.length?timeline:videoFiles.map((f,i)=>({file:f,keep:true,order:i+1}))}))}
  async function aiPostPlan(){append('AI đang tạo timeline + subtitle...'); const r=await api().videoPostPlan({folder:videoFolder,files:videoFiles,script:postScript,subLang,apiKey:firstKey()}); if(r?.scenes)setTimeline(r.scenes); if(r?.subtitles)setManualSubs(r.subtitles.map((x:any)=>`${x.start}, ${x.end}, ${x.text}`).join('\n')); append(r)}
  async function exportPost(){append('Đang xuất hậu kì video...'); append(await api().videoPostExport({folder:videoFolder,files:videoFiles,scenes:timeline.length?timeline:videoFiles.map((f,i)=>({file:f,keep:true,order:i+1})),manualCuts,manualSubs,musicFile,subLang}))}
  const baseTimeline=()=>timeline.length?timeline:videoFiles.map((f,i)=>({id:`manual_${i+1}`,file:f,name:f.split(/[\\/]/).pop(),keep:true,order:i+1,reason:'Thủ công'}));

  function initManualClips(){ const rows=videoFiles.map((f,i)=>({id:`clip_${Date.now()}_${i}`,file:f,start:'0',end:'',name:f.split(/[\\/]/).pop()})); setManualClips(rows); setManualCuts(rows.map(x=>`${x.file}, ${x.start||0}, ${x.end||''}`).join('\n')); }
  function syncManualCuts(rows:any[]){ setManualClips(rows); setManualCuts(rows.filter(x=>x.file).map(x=>`${x.file}, ${x.start||0}, ${x.end||''}`).join('\n')); }
  function updateClip(i:number,patch:any){ const rows=[...manualClips]; rows[i]={...rows[i],...patch}; syncManualCuts(rows); }
  function addClip(){ const f=videoFiles[0]||''; syncManualCuts([...manualClips,{id:`clip_${Date.now()}`,file:f,start:'0',end:'',name:f.split(/[\\/]/).pop()||'clip'}]); }
  function removeClip(i:number){ syncManualCuts(manualClips.filter((_,idx)=>idx!==i)); }
  function moveClip(i:number,d:number){ const rows=[...manualClips]; const j=i+d; if(j<0||j>=rows.length)return; [rows[i],rows[j]]=[rows[j],rows[i]]; syncManualCuts(rows); }
  function syncSubRows(rows:any[]){ setSubRows(rows); setManualSubs(rows.filter(x=>String(x.text||'').trim()).map(x=>`${x.start||0}, ${x.end||''}, ${x.text||''}`).join('\n')); }
  function updateSub(i:number,patch:any){ const rows=[...subRows]; rows[i]={...rows[i],...patch}; syncSubRows(rows); }
  function addSub(){ syncSubRows([...subRows,{start:'0',end:'3',text:''}]); }
  function removeSub(i:number){ syncSubRows(subRows.filter((_,idx)=>idx!==i)); }

  function moveScene(i:number,dir:number){setTimeline(()=>{const a=[...baseTimeline()]; const j=i+dir; if(j<0||j>=a.length)return a; [a[i],a[j]]=[a[j],a[i]]; return a.map((x,k)=>({...x,order:k+1}));})}
  function toggleScene(i:number){setTimeline(()=>baseTimeline().map((x,k)=>k===i?{...x,keep:!x.keep}:x))}

  async function generateCharacterPrompts(){
    const text=(characterIdeas||'').trim();
    if(!text){ append('❌ Vui lòng nhập danh sách nhân vật, mỗi dòng một nhân vật.'); return; }
    append('🧑🎨 Đang tạo prompt ảnh nhân vật...');
    let r:any;
    try{ r=await timeoutPromise(api().generateCharacters({apiKey:apiKeys,style,ideas:text,promptLang}), 310000, 'character_prompt_timeout_310s'); }
    catch(e:any){ r={ok:false,error:e?.message||String(e)}; }
    if(r?.generated?.file) setGeneratedFile(r.generated.file);
    append(r);

  }

  async function generatePrompt(){ await generateScript(); }
  async function generateScript(){
    const scriptTopic=(topic || ideas || '').trim();
    if(!scriptTopic){ append('❌ Vui lòng nhập Ý tưởng / chủ đề kịch bản trước.'); return; }
    append('🎬 Đang tạo kịch bản video...');
    const duration=`${durationValue} ${durationUnit}`;
    try {
      const r=await api().generateScript({apiKey:apiKeys,style,topic:scriptTopic,duration,characterImages,promptLang,voiceLang});
      if(r?.ok) {
        if(r.generated?.file) setGeneratedFile(r.generated.file);
        append(`✅ Đã tạo kịch bản thành công: ${r.generated?.count || 0} cảnh.`);
      } else {
        append(`❌ Lỗi: ${r?.error || 'Không rõ nguyên nhân'}`);
      }
    } catch (e) {
      append(`❌ Lỗi kết nối: ${String(e)}`);
    }
  }
  async function pause(){append('⏸ Đang tạm dừng tiến trình...'); const r=await api().pause(); append(r); setTimeout(()=>api().status().then(append).catch(()=>{}),500)}
  async function resume(){append('▶ Đang tiếp tục tiến trình...'); const r=await api().resume(); append(r); setTimeout(()=>api().status().then(append).catch(()=>{}),500)}
  async function stop(){append(await api().stop())}
  async function checkLicense(){ const r=await api().licenseCheck(); const msg=friendly(r); setLicenseText(msg); append(msg); return r }
  async function activateLicense(){ append('🚀 Đang gửi yêu cầu kích hoạt...'); const r=await api().activateLicense({licenseKey}); const msg=friendly(r); setLicenseText(msg); append(msg); return r }
  useEffect(()=>{ try{ const saved=JSON.parse(localStorage.getItem('flowProfilesConfig')||'[]'); if(Array.isArray(saved)&&saved.length) setProfiles(saved); }catch{} },[]);
  useEffect(()=>{ try{ localStorage.setItem('flowProfilesConfig', JSON.stringify(profiles)); }catch{} },[profiles]);
  useEffect(()=>{ let p=0; const it=setInterval(()=>{p=Math.min(98,p+7); setBootPct(p)},90); const t=setTimeout(()=>{setBootPct(100); setTimeout(()=>setBootLoading(false),180)},1400); api().licenseCached().then((r:any)=>{ const msg=friendly(r); setLicenseText(msg); }).catch(()=>{}); api().machineId().then((r:any)=>{ if(r?.machineId)setMachineId(r.machineId) }).catch(()=>{}); api().status().then(append).catch(()=>{}); return ()=>{clearTimeout(t); clearInterval(it)}; },[])
  async function ensureCdp(){append('Đang mở/kiểm tra Chrome CDP...'); append(await api().ensureCdp())}
  async function openProfileLogin(i:number){ const pr=profiles[i]||{}; append(`🌐 Mở Chrome profile ${i+1} để đăng nhập: ${pr.accountEmail||pr.name||''}`); append(await api().openProfileLogin(pr,i)); }
  function domValue(id:string, fallback:string){
    const el=document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return el?.value || fallback;
  }
  function runPayload(file?:string, overrides:any={}){
    const liveMode=overrides.mode ?? mode;
    const liveSubMode=overrides.subMode ?? subMode;
    const liveModel=overrides.model ?? model;
    const liveRatio=overrides.ratio ?? ratio;
    const liveCount=overrides.count ?? count;
    const liveOmniDuration=overrides.omniDuration ?? omniDuration;
    const liveSpacing=overrides.spacing ?? spacing;
    const liveRunMode=overrides.runMode ?? runMode;
    const liveThreads=overrides.flowThreads ?? flowThreads;
    const payload={
      promptFile:file||promptFile||generatedFile,
      mode:liveMode, taskMode:liveMode,
      model:liveModel, flowModel:liveModel,
      ratio:liveRatio, aspectRatio:liveRatio, flowAspectRatio:liveRatio,
      count:liveCount, flowCount:liveCount,
      omniDuration: liveModel==='omni_flash' ? liveOmniDuration : '',
      spacing:liveSpacing,
      refsDir:overrides.refsDir ?? refsDir,
      downloadDir:overrides.downloadDir ?? downloadDir,
      runMode:liveRunMode,
      flowThreads:liveThreads,
      autoDownload: overrides.autoDownload ?? autoDownload,
      pairedMode:true,
      subMode:liveSubMode, videoSubMode:liveSubMode,
      referenceMode:'ingredients'
    };
    append(`⚙️ Setting gửi vào worker: mode=${payload.mode}, model=${payload.model}, ratio=${payload.ratio}, count=${payload.count}${payload.omniDuration?', duration='+payload.omniDuration:''}, sub=${payload.subMode}`);
    return payload;
  }
  async function start(file?:string, overrides:any={}){ const p=runPayload(file,overrides); append(`🚀 Start (ID: ${Date.now()}): mode=${p.mode}, model=${p.model}`); append(await api().start(p))}
  async function quick(){append('Đang quick start...'); append(await api().start({...runPayload(), startFrom:1}))}
  return <div className="app">{bootLoading&&<div className="boot-loading"><div className="loader-card"><div className="spinner"></div><b>{T('Đang tải ứng dụng...','Loading application...')} {bootPct}%</b><div className="boot-bar"><div style={{width:`${bootPct}%`}}></div></div><span>{T('FLOW AUTO VEO 3 đang khởi động, vui lòng chờ.','FLOW AUTO VEO 3 is starting, please wait.')}</span></div></div>}{langNotice&&<div className="modal-backdrop"><div className="small-modal"><b>{T('Đã đổi ngôn ngữ','Language changed')}</b><p>{T('Vui lòng khởi động lại app để áp dụng đầy đủ cài đặt ngôn ngữ.','Please restart the app to fully apply the language setting.')}</p><Button variant="primary" onClick={()=>setLangNotice(false)}>OK</Button></div></div>}
    <aside className="side"><div className="brand"><Bot/><div><b>FLOW AUTO VEO 3</b><span>Modern UI</span></div></div><div className="lang-switch"><button type="button" className={lang==='VI'?'active':''} onClick={(e)=>{e.preventDefault();e.stopPropagation();switchLang('VI')}}>VI</button><button type="button" className={lang==='EN'?'active':''} onClick={(e)=>{e.preventDefault();e.stopPropagation();switchLang('EN')}}>EN</button></div>{nav.map(([id,label,Icon]:any)=><button key={id} onClick={()=>setPage(id)} className={page===id?'active':''}><Icon size={18}/>{label}</button>)}<div className="price">{T('1200K / vĩnh viễn','1200K / lifetime')}</div></aside>
    <main>
      <header><div><h1>{page==='ai'?'AI Prompt Studio':page==='flow'?T('Vận hành Flow','Flow Operation'):page==='license'?T('License & Đăng ký','License & Activation'):page==='payment'?T('Thanh toán','Payment'):page==='chars'?'Prompt nhân vật':page==='multi'?T('Đa luồng Flow','Multi-profile Flow'):page==='post'?T('Hậu kì video','Video Post-production'):'FLOW AUTO VEO 3'}</h1><p>FLOW AUTO VEO 3 Modern UI</p></div><div className="header-actions"><div className="status">{activity}</div><div className="lang-switch header-lang"><button type="button" className={lang==='VI'?'active':''} onClick={(e)=>{e.preventDefault();switchLang('VI')}}>VI</button><button type="button" className={lang==='EN'?'active':''} onClick={(e)=>{e.preventDefault();switchLang('EN')}}>EN</button></div></div></header>
      {page==='flow'&&<div className="grid"><Card title={T("Thiết lập chạy","Running setup")} icon={<Film/>}><div className="actions"><Button onClick={pickPrompt}>📄 {T("Chọn file prompt","Pick prompt file")}</Button><Button onClick={pickRefs}>🖼 {T("Chọn đường dẫn thư mục ảnh","Pick reference directory")}</Button><Button onClick={pickDownloadDir}>💾 {T("Chọn thư mục lưu tải về","Pick download directory")}</Button><Button onClick={ensureCdp}>🌐 {T("Mở Chrome Flow","Open Chrome Flow")}</Button></div><p className="hint">{T("Prompt:","Prompt:")} {promptFile || generatedFile || T('chưa chọn','not selected')}<br/>{T("Đường dẫn thư mục ảnh:","Reference path:")} {refsDir || T('chưa chọn','not selected')}<br/>{T("Thư mục lưu tải về:","Download path:")} {downloadDir || T('Downloads mặc định','Default Downloads')}</p><div className="form4"><Field label="Mode"><select id="flow-mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="createvideo">createvideo</option><option value="createimage">createimage</option></select></Field><Field label={T("Chế độ video","Video sub-mode")}><select id="flow-sub-mode" value={subMode} onChange={e=>setSubMode(e.target.value)} disabled={mode==='createimage'}><option value="ingredients">{T("Video thành phần","Ingredients")}</option><option value="frames">{T("Khung hình","Frames")}</option></select></Field><Field label="Model"><select id="flow-model" value={model} onChange={e=>setModel(e.target.value)}>{models.map(x=><option key={x} value={x}>{x}</option>)}</select></Field>{model==='omni_flash'&&<Field label={T("Thời lượng Omni Flash","Omni Flash Duration")}><select id="flow-omni-duration" value={omniDuration} onChange={e=>setOmniDuration(e.target.value)}>{['4s','6s','8s','10s'].map(x=><option key={x} value={x}>{x}</option>)}</select></Field>}<Field label={T("Tỉ lệ","Ratio")}><select id="flow-ratio" value={ratio} onChange={e=>setRatio(e.target.value)}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label={T("Số output","Output count")}><select id="flow-count" value={count} onChange={e=>setCount(e.target.value)}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label={T("Giãn cách prompt","Spacing")}><input id="flow-spacing" value={spacing} onChange={e=>setSpacing(e.target.value)}/></Field><Field label={T("Chế độ chạy","Run mode")}><select id="flow-run-mode" value={runMode} onChange={e=>setRunMode(e.target.value)}><option value="single">{T("Chạy từng prompt một","Single prompt")}</option><option value="continuous_submit_only">{T("Chạy liên tục","Continuous")}</option><option value="continuous_download_delay_3">{T("Chạy liên tục - tải trễ sau 3 prompt","Continuous delay 3")}</option></select></Field><Field label={T("Auto tải xuống","Auto download")}><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>setAutoDownload(e.target.checked)}/><span>{autoDownload?T('Bật','On'):T('Tắt','Off')}</span></label><small className="field-note">{T("Bật là luôn tự tải, dù chạy từng prompt hay chạy liên tục.","Always auto-download.")}</small></Field><Field label={T("Số tab Flow","Flow tabs")}><select id="flow-threads" value={flowThreads} onChange={e=>setFlowThreads(e.target.value)}>{Array.from({length:100},(_,i)=>String(i+1)).map(x=><option key={x} value={x}>{x} {T('tab','tabs')}</option>)}</select></Field></div></Card><Card title={T("Điều khiển","Control")} icon={<Play/>}><div className="actions"><Button variant="primary" onClick={()=>start()}><Play size={16}/> {T('Bắt đầu','Start')}</Button><Button variant="danger" onClick={stop}><Square size={16}/> Stop</Button></div></Card></div>}
      {page==='multi'&&<div className="multi-page">
        <Card title={T("Đa luồng profile Flow", "Multi-profile Flow Operation")} icon={<Film/>}>
          <p className="hint">{T("Mỗi profile mở Chrome riêng và giữ session đăng nhập riêng.", "Each profile opens its own Chrome instance.")}</p>
          <div className="form4">
            <Field label={T("Số profile", "Number of profiles")}>
              <select value={String(profiles.length)} onChange={e=>{const n=Number(e.target.value); setProfiles(p=>Array.from({length:n},(_,i)=>p[i]||{name:`Profile ${i+1}`,accountEmail:'',script:'',promptFile:'',refsDir:''}))}}>
                {Array.from({length:100},(_,i)=>String(i+1)).map(x=><option key={x} value={x}>{x} profile</option>)}
              </select>
            </Field>
            <Field label="Model">
              <select id="flow-model-multi" value={model} onChange={e=>setModel(e.target.value)}>{models.map(x=><option key={x} value={x}>{x}</option>)}</select>
            </Field>
            {model==='omni_flash'&&<Field label={T("Thời lượng Omni Flash", "Omni Flash Duration")}>
              <select id="flow-omni-duration" value={omniDuration} onChange={e=>setOmniDuration(e.target.value)}>{['4s','6s','8s','10s'].map(x=><option key={x} value={x}>{x}</option>)}</select>
            </Field>}
            <Field label={T("Tỉ lệ", "Aspect Ratio")}>
              <select id="flow-ratio-multi" value={ratio} onChange={e=>setRatio(e.target.value)}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select>
            </Field>
            <Field label={T("Giãn cách prompt", "Spacing between prompts")}>
              <input id="flow-spacing" value={spacing} onChange={e=>setSpacing(e.target.value)}/>
            </Field>
            <Field label={T("Chế độ video", "Video Sub-mode")}>
              <select id="flow-sub-mode-multi" value={subMode} onChange={e=>setSubMode(e.target.value)}>
                <option value="ingredients">{T("Video thành phần", "Ingredients")}</option>
                <option value="frames">{T("Khung hình", "Frames")}</option>
              </select>
            </Field>
          </div>
          <div className="profile-grid">{profiles.map((pr:any,i:number)=><div className="profile-card" key={i}><Field label={`Tên profile ${i+1}`}><input value={pr.name} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,name:e.target.value}:x))}/></Field><Field label={T("Email / nhãn tài khoản Veo 3", "Veo 3 account label")}>
            <input value={pr.accountEmail||''} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,accountEmail:e.target.value}:x))} placeholder={T("email Google hoặc tên tài khoản","Google email or account label")}/>
            </Field><div className="actions mini-actions"><Button onClick={()=>openProfileLogin(i)}>🌐 {T("Mở profile đăng nhập", "Open profile login")}</Button><Button onClick={()=>pickProfilePrompt(i)}>📄 {T("Chọn file text prompt", "Pick text prompt file")}</Button><Button onClick={()=>pickProfileRefs(i)}>🖼 {T("Chọn thư mục ảnh", "Pick images folder")}</Button></div>
            <p className="hint">{T("File prompt:","Prompt file:")} {pr.promptFile||T('chưa chọn','not selected')}<br/>{T("Thư mục ảnh:","Images folder:")} {pr.refsDir||T('chưa chọn','not selected')}</p>
            <Field label={T("Kịch bản / prompt cho profile này", "Script/prompt for this profile")}>
              <textarea value={pr.script} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,script:e.target.value}:x))} placeholder={T("Có thể nhập trực tiếp, hoặc chọn file text prompt ở trên", "Direct input or file prompt")}/>
            </Field>
            </div>)}</div>
          <div className="form4"><Field label={T("Auto tải xuống", "Auto download")}><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>setAutoDownload(e.target.checked)}/><span>{autoDownload?T('Bật','On'):T('Tắt','Off')}</span></label></Field></div><div className="actions"><Button variant="primary" onClick={async()=>{append(T('Đang chạy đa luồng profile...','Running multi-profile...')); append(await api().start({...runPayload(undefined,{autoDownload}),flowThreads:String(profiles.length),profiles}))}}>🚀 {T('Chạy đa luồng profile', 'Run multi-profile')}</Button><Button variant="danger" onClick={stop}>⏹ {T('Stop tất cả', 'Stop all')}</Button></div>
        </Card>
      </div>}
      {page==='ai'&&<div className="grid"><Card title="AI Prompt Studio" icon={<Wand2/>}><div className="form4"><Field label={T("Style","Phong cách")}><select value={style} onChange={e=>setStyle(e.target.value)}>{styles.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label={T("Loại phương tiện","Media Type")}><select value={mediaType} onChange={e=>setMediaType(e.target.value)}><option value="VIDEO">VIDEO</option><option value="IMAGE">IMAGE</option></select></Field><Field label={T("Thời lượng","Duration")}><div className="flex"><input value={durationValue} onChange={e=>setDurationValue(e.target.value)}/><select value={durationUnit} onChange={e=>setDurationUnit(e.target.value as any)}><option value="seconds">{T('giây','seconds')}</option><option value="minutes">{T('phút','minutes')}</option></select></div></Field></div><Field label={T("Ý tưởng / chủ đề kịch bản","Idea / Script topic")}><textarea value={ideas} onChange={e=>setIdeas(e.target.value)} placeholder={T("Nhập ý tưởng...","Enter ideas...")}/></Field><div className="actions"><Button variant="primary" onClick={generateScript}>🎬 {T('Tạo kịch bản', 'Generate script')}</Button><Button onClick={pickSampleVideo}>{T('Video mẫu','Sample video')}</Button><Button onClick={analyzeSampleVideoForAi}>{T('Phân tích video mẫu','Analyze sample video')}</Button></div><p className="hint">{T("Kịch bản tạo ra sẽ lưu ở file:", "Generated script file:")} {generatedFile || T('chưa tạo','none')}</p></Card><Card title={T("Prompt nhân vật","Character Prompt")} icon={<ImagePlus/>}><Button onClick={pickImages}>{T('Chọn ảnh nhân vật','Pick char images')}</Button><p className="hint">{T("Ảnh đã chọn:","Selected images:")} {characterImages.length}</p><Field label={T("Danh sách nhân vật / ý tưởng","Character list / ideas")}><textarea value={characterIdeas} onChange={e=>setCharacterIdeas(e.target.value)} placeholder={T("Mỗi nhân vật một dòng...","One character per line...")}/></Field><div className="actions"><Button variant="primary" onClick={generateCharacterPrompts}>{T('Tạo prompt nhân vật','Generate char prompts')}</Button><Button onClick={downloadGeneratedPrompt}>💾 {T('Tải file prompt','Download prompt file')}</Button></div></Card></div>}
      {page==='chars'&&<div className="grid"><Card title={T("Prompt nhân vật","Character Prompt")} icon={<ImagePlus/>}><Button onClick={pickImages}>{T('Chọn ảnh nhân vật','Pick char images')}</Button><p className="hint">{T("Ảnh đã chọn:","Selected images:")} {characterImages.length}</p><Field label={T("Danh sách nhân vật / ý tưởng","Character list / ideas")}><textarea value={characterIdeas} onChange={e=>setCharacterIdeas(e.target.value)} placeholder={T("Mỗi nhân vật một dòng...","One character per line...")}/></Field><div className="actions"><Button variant="primary" onClick={generateCharacterPrompts}>{T('Tạo prompt nhân vật','Generate char prompts')}</Button></div></Card></div>}
      {page==='post'&&<div className="post-page">
        <div className="grid">
          <Card title={T("Nguồn video & chế độ hậu kì", "Video source & post-processing")} icon={<Film/>}>
            <div className="actions"><Button onClick={pickVideoFolder}>{T('📁 Chọn thư mục chứa video','Pick video folder')}</Button><Button onClick={async()=>{if(videoFolder){const x=await api().videoList(videoFolder); setVideoFiles(x?.files||[]); append(T('Đã làm mới danh sách video','List refreshed'))}}}>🔄 {T('Làm mới','Refresh')}</Button></div>
            <p className="hint">{T("Thư mục:","Folder:")} {videoFolder||T('chưa chọn','not selected')}<br/>{T("Số video:","Count:")} {videoFiles.length}</p>
            <div className="form4"><Field label={T("Chế độ","Mode")}><select value={postMode} onChange={e=>setPostMode(e.target.value as any)}><option value="ai">{T('AI tự phân tích & ghép theo kịch bản','AI analyze & merge by script')}</option><option value="manual">{T('Ghép thủ công','Manual merge')}</option></select></Field><Field label={T("Audio chèn","Audio insertion")}><input readOnly value={audioFile||T('chưa chọn','not selected')}/></Field></div>
            <Field label={T("Kịch bản / mô tả thứ tự cảnh","Script / scene order description")}><textarea value={postScript} onChange={e=>setPostScript(e.target.value)} placeholder={T("Dán kịch bản video để AI phân tích video và sắp xếp đúng cảnh","Paste script to AI analyze & sort scenes")}/></Field>
            <div className="form4"><Field label={T("Ngôn ngữ sub","Sub language")}><select value={subLang} onChange={e=>setSubLang(e.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="zh">中文</option><option value="ko">한국어</option><option value="ja">日本語</option></select></Field><Field label={T("Nhạc nền","Background music")}><input readOnly value={musicFile||T('chưa chọn','not selected')}/></Field></div><div className="actions"><Button variant="primary" onClick={aiPostPlan}>🤖 {T('AI cắt ghép + tạo sub','AI Cut + Sub')}</Button><Button onClick={analyzeVideos}>{T('🧠 Tạo timeline cũ','Gen old timeline')}</Button><Button onClick={pickMusic}><Music size={16}/> {T('Chọn nhạc nền','Pick Music')}</Button><Button onClick={pickAudio}><Music size={16}/> {T('Chọn âm thanh chèn','Pick Audio')}</Button><Button onClick={extractAudio}>{T('🎧 Tách âm video đầu tiên','Extract audio')}</Button></div>
          </Card>
          <Card title={T("Danh sách video","Video list")} icon={<Scissors/>}><div className="video-list">{videoFiles.map((f,i)=><div key={f} className="video-item video-preview-row"><video src={`file://${f}`} muted controls preload="metadata"/><div><b>{String(i+1).padStart(2,'0')}</b><span>{f.split(/[\\/]/).pop()}</span></div></div>)}</div></Card>
        </div>
        <Card title={T("Preview timeline / kéo thả sắp xếp cảnh", "Timeline Preview / Rearrange scenes")} icon={<Scissors/>}>
          <div className="timeline-editor">{baseTimeline().map((sc:any,i:number)=><div key={sc.id||sc.file||i} className={sc.keep===false?'scene-card muted':'scene-card'}><div className="scene-thumb"><video src={`file://${sc.file}`} muted controls preload="metadata"/></div><div className="scene-info"><b>Scene {i+1} • {sc.name||String(sc.file||'').split(/[\\/]/).pop()}</b><span>{sc.reason||sc.note||T('Sẵn sàng ghép','Ready')}</span></div><div className="scene-actions"><button onClick={()=>moveScene(i,-1)}>↑</button><button onClick={()=>moveScene(i,1)}>↓</button><button onClick={()=>toggleScene(i)}>{sc.keep===false?T('Khôi phục','Restore'):T('Xóa cảnh','Delete')}</button></div></div>)}</div>
          <div className="capcut-panel"><div className="capcut-head"><b>✂️ {T('Cut / ghép thủ công','Manual Cut')}</b><div><Button onClick={initManualClips}>{T('Tạo timeline từ video','Gen timeline from videos')}</Button><Button onClick={addClip}>+ {T('Thêm clip','Add clip')}</Button></div></div><div className="clip-timeline">{manualClips.map((c:any,i:number)=><div className="clip-block" key={c.id||i}><div className="clip-index">{String(i+1).padStart(2,'0')}</div><select value={c.file} onChange={e=>updateClip(i,{file:e.target.value,name:e.target.value.split(/[\\/]/).pop()})}>{videoFiles.map(f=><option key={f} value={f}>{f.split(/[\\/]/).pop()}</option>)}</select><input value={c.start} onChange={e=>updateClip(i,{start:e.target.value})} placeholder={T("Start giây","Start sec")}/><input value={c.end} onChange={e=>updateClip(i,{end:e.target.value})} placeholder={T("End giây","End sec")}/><button onClick={()=>moveClip(i,-1)}>↑</button><button onClick={()=>moveClip(i,1)}>↓</button><button onClick={()=>removeClip(i)}>X</button></div>)}</div></div><div className="capcut-panel"><div className="capcut-head"><b>💬 {T('Subtitle thủ công','Manual Subtitle')}</b><Button onClick={addSub}>+ {T('Thêm sub','Add sub')}</Button></div><div className="sub-editor">{subRows.map((r:any,i:number)=><div className="sub-row" key={i}><input value={r.start} onChange={e=>updateSub(i,{start:r.start,end:r.end,text:r.text,start:e.target.value})} placeholder="Start"/><input value={r.end} onChange={e=>updateSub(i,{start:r.start,end:r.end,text:r.text,end:e.target.value})} placeholder="End"/><input value={r.text} onChange={e=>updateSub(i,{start:r.start,end:r.end,text:r.text,text:e.target.value})} placeholder={T("Nội dung subtitle","Subtitle text")}/><button onClick={()=>removeSub(i)}>Xóa</button></div>)}</div></div><div className="actions"><Button variant="primary" onClick={exportPost}>📤 {T('Xuất hậu kì video','Export post-production')}</Button><Button onClick={exportTimeline}>📤 {T('Xuất timeline cũ','Export old timeline')}</Button><Button onClick={mergeVideos}>🎞 {T('Ghép toàn bộ video gốc','Merge original videos')}</Button></div>
          <p className="hint">{T("AI có thể đánh dấu cảnh không phù hợp để bỏ qua. Chế độ thủ công cho phép sắp xếp bằng nút ↑ ↓ và xóa/khôi phục cảnh trước khi xuất.","AI auto-marks unsuitable scenes. Manual mode allows sorting via ↑ ↓ and removing/restoring scenes before export.")}</p>
        </Card>
      </div>}
            {page==='payment'&&<div className="payment-page payment-single"><Card title={T('Thanh toán','Payment')} icon={<CreditCard/>}><div className="pay-info single"><div className="pay-block"><h3>USDT ETH</h3><p><b>{T('Người nhận','Receiver')}:</b> PHAM VAN VUONG</p><p><b>1.200.000 VNĐ / Vĩnh Viễn</b></p><p><b>{T('Ví USDT mạng ETH','USDT wallet on ETH network')}:</b><br/><code>0xcbcf357d5d2f5165c544d0ba1d520dbaaaef11c7</code></p><p>{T('Nội dung chuyển khoản','Transfer note')}: <b>FLOWAUTO + SĐT</b></p></div><div className="pay-contact"><b>{T('Hỗ trợ cấp key','Key/support contact')}</b><br/>Zalo: 0989139295<br/>Telegram: https://t.me/flowautotool<br/><span>{T('Sau khi thanh toán, gửi Machine ID cho admin để nhận key.','After payment, send Machine ID to admin to receive your key.')}</span></div></div></Card><Card title="QR USDT ETH - PHAM VAN VUONG" icon={<CreditCard/>}><img className="qr qr-huge" src="assets/subscription_qr.png"/></Card></div>}
            {page==='license'&&<div className="grid"><Card title={T("License hiện tại","Current License")} icon={<KeyRound/>}><div className="license-box">{licenseText}</div><Field label={T("Machine ID - gửi mã này cho admin để lấy key kích hoạt","Machine ID - send to admin for activation key")}><div className="machine-row"><input readOnly value={machineId}/><Button onClick={()=>{navigator.clipboard?.writeText(machineId); append(T('Đã copy Machine ID','Machine ID copied'))}}>Copy</Button></div></Field><div className="actions"><Button variant="primary" onClick={checkLicense}>🔄 {T('Cập nhật trạng thái license','Update license status')}</Button></div></Card><Card title={T("Kích hoạt online","Online Activation")} icon={<KeyRound/>}><p>{T('Nhập key admin gửi để kích hoạt.','Enter the activation key.')}</p><Field label={T("License key admin gửi","Activation key")}><input value={licenseKey} onChange={e=>setLicenseKey(e.target.value)} placeholder={T("Nhập key kích hoạt","Enter key")}/></Field><div className="actions"><Button variant="primary" onClick={activateLicense}>🔐 {T('Kích hoạt online','Activate online')}</Button></div><div className="pricing"><div><b>1.200.000 VNĐ</b><span>/ vĩnh viễn</span></div></div><p>Zalo: 0989139295<br/>Telegram: https://t.me/flowautotool</p></Card></div>}

    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>);