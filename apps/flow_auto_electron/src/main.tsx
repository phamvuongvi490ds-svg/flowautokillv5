import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Film, KeyRound, Play, Square, Wand2, ImagePlus, CreditCard, Scissors, Music, Sun, Moon, Search } from 'lucide-react';
import './style.css';

declare global { interface Window { flowAPI: any } }

const styles = ['CINEMATIC','ANIME','PAINTING','RENDER_3D','COMIC_BOOK','PIXEL_ART','WATERCOLOR','CYBERPUNK','STEAMPUNK','NONE'];
const videoModels = ['default','veo3_lite_low_priority','veo3_lite','veo3_fast','veo3_quality','omni_flash'];
const imageModels = ['nano_banana_pro','nano_banana2','nano_banana2_lite','imagen4'];
const modelsForMode = (mode:string) => mode==='createimage' ? imageModels : videoModels;
const flowModelLabels:Record<string,string> = {
  default:'Veo 3.1 - Fast',
  veo3_lite_low_priority:'Veo 3.1 - Lite [Lower Priority]',
  veo3_lite:'Veo 3.1 - Lite',
  veo3_fast:'Veo 3.1 - Fast',
  veo3_quality:'Veo 3.1 - Quality',
  omni_flash:'Omni 1.1 Flash',
  nano_banana_pro:'Nano Banana Pro',
  nano_banana2:'Nano Banana 2',
  nano_banana2_lite:'Nano Banana 2 Lite',
  imagen4:'Imagen 4',
};
const flowModelLabel=(key:string)=>flowModelLabels[key]||key;
const ratios = ['16:9','9:16','square','landscape_4_3','portrait_3_4'];
const geminiApiModels = [
  {value:'gemini-3.7-flash', label:'Gemini Flash 3.7 API'},
  {value:'gemini-2.5-flash', label:'Gemini 2.5 Flash'},
  {value:'gemini-2.5-flash-lite', label:'Gemini 2.5 Flash Lite'},
  {value:'gemini-3-flash', label:'Gemini 3 Flash'},
  {value:'gemini-3.1-flash-lite', label:'Gemini 3.1 Flash Lite'},
  {value:'gemini-3.5-flash', label:'Gemini 3.5 Flash'}
];

const api = () => window.flowAPI || {
  openFile: async()=>[], status: async()=>({ok:true,running:false}), outputTimeline: async()=>({ok:true,items:[]}), quickMerge: async()=>({ok:false,error:'flowAPI_not_ready'}), licenseCached: async()=>({ok:true}), machineId: async()=>({machineId:''}),
  ensureCdp: async()=>({ok:false,error:'flowAPI_not_ready'}), debugStart: async()=>({ok:false,error:'flowAPI_not_ready'}), debugStop: async()=>({ok:false,error:'flowAPI_not_ready'}), debugExport: async()=>({ok:false,error:'flowAPI_not_ready'}), openProfileLogin: async()=>({ok:false,error:'flowAPI_not_ready'}), start: async()=>({ok:false,error:'flowAPI_not_ready'}), pause: async()=>({ok:false,error:'flowAPI_not_ready'}), resume: async()=>({ok:false,error:'flowAPI_not_ready'}), stop: async()=>({ok:false,error:'flowAPI_not_ready'}),
  licenseCheck: async()=>({ok:false,error:'flowAPI_not_ready'}), activateLicense: async()=>({ok:false,error:'flowAPI_not_ready'}), generatePrompt: async()=>({ok:false,error:'flowAPI_not_ready'}), generateScript: async()=>({ok:false,error:'flowAPI_not_ready'}), rewriteScriptDeep: async()=>({ok:false,error:'flowAPI_not_ready'}), generateCharacters: async()=>({ok:false,error:'flowAPI_not_ready'}), analyzeUrl: async()=>({ok:false,error:'flowAPI_not_ready'}),
  videoList: async()=>({ok:true,files:[]}), videoMerge: async()=>({ok:false,error:'flowAPI_not_ready'}), videoExtractAudio: async()=>({ok:false,error:'flowAPI_not_ready'}), videoAnalyzeSample: async()=>({ok:false,error:'flowAPI_not_ready'}), videoPostPlan: async()=>({ok:false,error:'flowAPI_not_ready'}), videoPostExport: async()=>({ok:false,error:'flowAPI_not_ready'}), danceGenerate: async()=>({ok:false,error:'flowAPI_not_ready'}), danceExtractAudio: async()=>({ok:false,error:'flowAPI_not_ready'}), seoAnalyze: async()=>({ok:false,error:'flowAPI_not_ready'})
};

function Card({title, icon, children}:{title:string; icon?:React.ReactNode; children:React.ReactNode}){return <div className="card"><div className="card-title">{icon}{title}</div>{children}</div>}
function Button({children,onClick,variant='soft'}:{children:React.ReactNode;onClick?:()=>void;variant?:'primary'|'soft'|'danger'}){return <button onClick={onClick} className={`btn ${variant}`}>{children}</button>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}

function App(){
  const [page,setPage]=useState('flow');
  const [apiKeys,setApiKeys]=useState(localStorage.getItem('gemini_api_keys')||'');
  const [geminiApiModel,setGeminiApiModel]=useState(localStorage.getItem('gemini_api_model')||'gemini-2.5-flash-lite');
  const [style,setStyle]=useState('CINEMATIC');
  const [mediaType,setMediaType]=useState('VIDEO');
  const [ideas,setIdeas]=useState('');
  const [characterIdeas,setCharacterIdeas]=useState('');
  const [topic,setTopic]=useState('');
  const oldDuration=(localStorage.getItem('ai_duration')||'60 seconds');
  const [durationValue,setDurationValue]=useState(localStorage.getItem('ai_duration_value')||((oldDuration.match(/\d+/)||['60'])[0]));
  const [durationUnit,setDurationUnit]=useState<'seconds'|'minutes'>((localStorage.getItem('ai_duration_unit') as any)||(oldDuration.toLowerCase().includes('minute')||oldDuration.toLowerCase().includes('phút')?'minutes':'seconds'));
  const [promptLang,setPromptLang]=useState(localStorage.getItem('ai_prompt_lang')||'en');
  const [voiceLang,setVoiceLang]=useState(localStorage.getItem('ai_voice_lang')||'vi_south');
  const [speakerGender,setSpeakerGender]=useState(localStorage.getItem('ai_speaker_gender')||'male');
  const [speechMode,setSpeechMode]=useState(localStorage.getItem('ai_speech_mode')||'fixed');
  const [promptSubtitles,setPromptSubtitles]=useState(localStorage.getItem('ai_prompt_subtitles')||'off');
  const [promptSafetyMode,setPromptSafetyMode]=useState(localStorage.getItem('ai_prompt_safety_mode')||'standard');
  const [refMode,setRefMode]=useState(localStorage.getItem("flow_ref_mode")||"paired"); const [mode,setMode]=useState(localStorage.getItem('flow_mode')||'createvideo');
  const [subMode,setSubMode]=useState('frames');
  const [model,setModel]=useState(localStorage.getItem('flow_model')||'default');
  const [ratio,setRatio]=useState(localStorage.getItem('flow_ratio')||'16:9');
  const [count,setCount]=useState(localStorage.getItem('flow_count')||'1');
  const [omniDuration,setOmniDuration]=useState('8s');
  const [spacing, setSpacing] = useState(localStorage.getItem('flow_spacing')||'10');
  const [runMode,setRunMode]=useState((localStorage.getItem('flow_run_mode')==='continuous_download_delay_3'?'continuous_submit_only':localStorage.getItem('flow_run_mode'))||'single');
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
  const [licenseLocked,setLicenseLocked]=useState(true);
  const [licenseReady,setLicenseReady]=useState(false);
  const [runWatch,setRunWatch]=useState(false);
  const [outputTimeline,setOutputTimeline]=useState<any>({items:[],dir:'',running:false,progress:null});
  const [statusProfiles,setStatusProfiles]=useState<any[]>(()=>{try{return JSON.parse(localStorage.getItem('status_profiles')||'[]')}catch{return []}});
  const [quickTransition,setQuickTransition]=useState(localStorage.getItem('status_quick_transition')||'fade');
  const [quickAutoSub,setQuickAutoSub]=useState((localStorage.getItem('status_quick_auto_sub')||'false')==='true');
  const [quickSubLang,setQuickSubLang]=useState(localStorage.getItem('status_quick_sub_lang')||'vi');
  const [quickAspect,setQuickAspect]=useState(localStorage.getItem('status_quick_aspect')||'auto');
  const [quickZoom,setQuickZoom]=useState(localStorage.getItem('status_quick_zoom')||'fit');
  const [quickSpeed,setQuickSpeed]=useState(localStorage.getItem('status_quick_speed')||'1');
  const [theme,setTheme]=useState(localStorage.getItem('flow_ui_theme')||'light');
  const [lang,setLang]=useState(localStorage.getItem('flow_lang')||'VI');
  const [langNotice,setLangNotice]=useState(false);
  const [videoFolder,setVideoFolder]=useState('');
  const [videoFiles,setVideoFiles]=useState<string[]>([]);
  const [audioFile,setAudioFile]=useState('');
  const [postMode,setPostMode]=useState<'ai'|'manual'>('ai');
  const [postScript,setPostScript]=useState('');
  const [sampleVideo,setSampleVideo]=useState('');
  const [sourceUrl,setSourceUrl]=useState('');
  const [danceVideo,setDanceVideo]=useState('');
  const [danceModelImage,setDanceModelImage]=useState('');
  const [danceOutfits,setDanceOutfits]=useState<any[]>([{id:1,files:[]}]);
  const [danceResult,setDanceResult]=useState('');
  const [dancePromptFile,setDancePromptFile]=useState('');
  const [danceApiModel,setDanceApiModel]=useState(localStorage.getItem('dance_api_model')||geminiApiModel);
  const [danceMode,setDanceMode]=useState(localStorage.getItem('dance_mode')||'createvideo');
  const [danceModel,setDanceModel]=useState(localStorage.getItem('dance_model')||'veo3_lite');
  const [danceRatio,setDanceRatio]=useState(localStorage.getItem('dance_ratio')||'9:16');
  const [danceDuration,setDanceDuration]=useState(localStorage.getItem('dance_duration')||'8s');
  const [danceCount,setDanceCount]=useState(localStorage.getItem('dance_count')||'1');
  const [dancePromptLang,setDancePromptLang]=useState(localStorage.getItem('dance_prompt_lang')||promptLang);
  const [danceRunMode,setDanceRunMode]=useState(localStorage.getItem('dance_run_mode')||'single');
  const [danceAutoDownload,setDanceAutoDownload]=useState((localStorage.getItem('dance_auto_download')||'true')==='true');
  const [danceDownloadDir,setDanceDownloadDir]=useState(localStorage.getItem('flow_download_dir')||localStorage.getItem('dance_download_dir')||'');
  const [timeline,setTimeline]=useState<any[]>([]);
  const [defaultTransition,setDefaultTransition]=useState(localStorage.getItem('post_default_transition')||'ai');
  const [postAspect,setPostAspect]=useState(localStorage.getItem('post_aspect')||'auto');
  const [postZoom,setPostZoom]=useState(localStorage.getItem('post_zoom')||'fit');
  const [postSpeed,setPostSpeed]=useState(localStorage.getItem('post_speed')||'1');
  const [subLang,setSubLang]=useState('vi');
  const [autoSub,setAutoSub]=useState(true);
  const [srtFile,setSrtFile]=useState('');
  const [subFont,setSubFont]=useState('Arial');
  const [subColor,setSubColor]=useState('#FFFFFF');
  const [subSize,setSubSize]=useState('42');
  const [manualCuts,setManualCuts]=useState('');
  const [manualSubs,setManualSubs]=useState('');
  const [manualClips,setManualClips]=useState<any[]>([]);
  const [subRows,setSubRows]=useState<any[]>([{start:'0',end:'3',text:''}]);
  const [musicFile,setMusicFile]=useState('');
  const [seoVideo,setSeoVideo]=useState('');
  const [seoLanguage,setSeoLanguage]=useState(localStorage.getItem('seo_language')||'Vietnamese');
  const [seoBusy,setSeoBusy]=useState(false);
  const [seoResult,setSeoResult]=useState<any>(null);
  const [musicVolume,setMusicVolume]=useState(Number(localStorage.getItem('post_music_volume')||'25'));
  const [removeOriginalAudio,setRemoveOriginalAudio]=useState(false);
  const subtitleFonts=['Arial','Be Vietnam Pro','Noto Sans','Noto Sans Vietnamese','Roboto','Inter','Montserrat','Open Sans','Tahoma','Verdana','Times New Roman','Georgia'];
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
  const availableModels=modelsForMode(mode);
  function normalizeModelForMode(m:string, md:string){ const list=modelsForMode(md); return list.includes(m)?m:list[0]; }
  function changeMode(v:string){ localStorage.setItem('flow_mode',v); setMode(v); const list=modelsForMode(v); if(!list.includes(model)){ setModel(list[0]); localStorage.setItem('flow_model',list[0]); } }
  function saveFlowSettings(){ const safeModel=normalizeModelForMode(model,mode); if(safeModel!==model)setModel(safeModel); localStorage.setItem('flow_mode',mode); localStorage.setItem('flow_model',safeModel); localStorage.setItem('flow_ratio',ratio); localStorage.setItem('flow_count',count); localStorage.setItem('flow_spacing',spacing); localStorage.setItem('flow_run_mode',runMode); localStorage.setItem('flow_auto_download',String(autoDownload)); localStorage.setItem('flow_download_dir',downloadDir); append('✅ Đã lưu cấu hình setting. Lần sau mở app sẽ giữ nguyên tùy chọn.'); }
  const nav=[['status',T('Trạng thái chạy','Run Status'),Play],['flow',T('Vận hành Flow','Flow Operation'),Film],['ai','AI Prompt Studio',Wand2],['seo','Video SEO Master AI',Search],['chars','Prompt nhân vật',ImagePlus],['multi',T('Đa luồng','Multi-profile'),Film],['post',T('Hậu kì video','Video Post-production'),Scissors],['dance','Dance Prompt Studio',Music],['payment',T('Thanh toán','Payment'),CreditCard],['license','License',KeyRound]];
  function switchLang(next:string){localStorage.setItem('flow_lang',next); setLang(next); setLangNotice(true); setActivity(next==='EN'?'Language changed. Please restart app to fully apply.':'Đã đổi ngôn ngữ. Vui lòng khởi động lại app để áp dụng đầy đủ.')}
  function saveApiConfig(){localStorage.setItem('gemini_api_keys',apiKeys); localStorage.setItem('gemini_api_model',geminiApiModel); localStorage.setItem('ai_style',style); localStorage.setItem('ai_media_type',mediaType); localStorage.setItem('ai_duration_value',durationValue); localStorage.setItem('ai_duration_unit',durationUnit); localStorage.setItem('ai_prompt_lang',promptLang); localStorage.setItem('ai_voice_lang',voiceLang); localStorage.setItem('ai_speaker_gender',speakerGender); localStorage.setItem('ai_speech_mode',speechMode); localStorage.setItem('ai_prompt_subtitles',promptSubtitles); localStorage.setItem('ai_prompt_safety_mode',promptSafetyMode); append(lang==='EN'?'✅ API configuration saved.':'✅ Đã lưu cấu hình API.')}
  async function pickImages(){const r=await api().openFile({properties:['openFile','multiSelections'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}]}); if(r?.length){setCharacterImages(r); append(`Đã chọn ${r.length} ảnh nhân vật`)}}
  async function pickPrompt(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Text',extensions:['txt','json']},{name:'All',extensions:['*']}]}); if(r?.[0]){setPromptFile(r[0]); append(`Prompt file: ${r[0]}`)}}
  async function pickRefs(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setRefsDir(r[0]); append(`Đường dẫn thư mục ảnh: ${r[0]}`)}}
  async function pickDownloadDir(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setDownloadDir(r[0]);setDanceDownloadDir(r[0]);setAutoDownload(true);setDanceAutoDownload(true);localStorage.setItem('flow_download_dir',r[0]);localStorage.setItem('dance_download_dir',r[0]);localStorage.setItem('flow_auto_download','true');localStorage.setItem('dance_auto_download','true');append(`✅ Đã lưu thư mục auto tải ảnh/video: ${r[0]}`)}}
  async function downloadGeneratedPrompt(){ if(!generatedFile){ append('Chưa có file prompt đã tạo.'); return; } append(await api().saveGeneratedPrompt(generatedFile)); }
  async function pickProfilePrompt(i:number){const r=await api().openFile({properties:['openFile'],filters:[{name:'Text',extensions:['txt','json']},{name:'All',extensions:['*']}]}); if(r?.[0]){setProfiles(p=>p.map((x,k)=>k===i?{...x,promptFile:r[0]}:x)); append(`Profile ${i+1} file prompt: ${r[0]}`)}}
  async function pickProfileRefs(i:number){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setProfiles(p=>p.map((x,k)=>k===i?{...x,refsDir:r[0]}:x)); append(`Profile ${i+1} thư mục ảnh: ${r[0]}`)}}
  async function pickVideoFolder(){const r=await api().openFile({properties:['openDirectory']}); if(r?.[0]){setVideoFolder(r[0]); const x=await api().videoList(r[0]); setVideoFiles(x?.files||[]); append(`Đã chọn thư mục video: ${r[0]}`)}}
  async function pickMusic(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Audio',extensions:['mp3','wav','m4a','aac']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setMusicFile(r[0]); append(`Nhạc nền: ${r[0]}`)}}
  async function pickDanceVideo(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','mkv','webm']}]});if(r?.[0])setDanceVideo(r[0])}
  async function pickDanceModel(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}]});if(r?.[0])setDanceModelImage(r[0])}
  async function pickDanceOutfit(i:number){const r=await api().openFile({properties:['openFile','multiSelections'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}]});if(r?.length)setDanceOutfits(x=>x.map((o,k)=>k===i?{...o,files:r}:o))}
  function addDanceOutfit(){setDanceOutfits(x=>x.length>=100?x:[...x,{id:Date.now(),files:[]}])}
  function changeDanceMode(v:string){setDanceMode(v);localStorage.setItem('dance_mode',v);const list=modelsForMode(v);if(!list.includes(danceModel)){setDanceModel(list[0]);localStorage.setItem('dance_model',list[0])}}
  function saveDanceSettings(){[['dance_api_model',danceApiModel],['dance_mode',danceMode],['dance_model',danceModel],['dance_ratio',danceRatio],['dance_duration',danceDuration],['dance_count',danceCount],['dance_prompt_lang',dancePromptLang],['dance_run_mode',danceRunMode],['dance_auto_download',String(danceAutoDownload)],['dance_download_dir',danceDownloadDir]].forEach(([k,v])=>localStorage.setItem(k,v));append('✅ Đã lưu cấu hình Dance Prompt Studio.')}
  function syncDanceSettings(){setDanceApiModel(geminiApiModel);setDanceMode(mode);setDanceModel(normalizeModelForMode(model,mode));setDanceRatio(ratio);setDanceCount(count);setDancePromptLang(promptLang);setDanceRunMode(runMode);setDanceAutoDownload(autoDownload);setDanceDownloadDir(downloadDir);append('✅ Đã đồng bộ cấu hình từ AI Prompt Studio / Flow.')}
  async function pickDanceDownloadDir(){const r=await api().openFile({properties:['openDirectory']});if(r?.[0]){setDanceDownloadDir(r[0]);setDownloadDir(r[0]);setDanceAutoDownload(true);setAutoDownload(true);localStorage.setItem('dance_download_dir',r[0]);localStorage.setItem('flow_download_dir',r[0]);localStorage.setItem('dance_auto_download','true');localStorage.setItem('flow_auto_download','true');append(`✅ Đã lưu thư mục auto tải ảnh/video: ${r[0]}`)}}
  async function generateDancePrompts(){const r=await api().danceGenerate({video:danceVideo,modelImage:danceModelImage,outfits:danceOutfits,apiKey:firstKey(),apiModel:danceApiModel,promptLang:dancePromptLang,segmentDuration:Number(danceDuration.replace(/[^0-9]/g,''))||8});if(r?.text)setDanceResult(r.text);if(r?.promptFile)setDancePromptFile(r.promptFile);append(r)}
  async function runDanceFlow(){if(!dancePromptFile){append('❌ Hãy tạo prompt Dance trước khi chạy Flow.');return}await start(dancePromptFile,{mode:danceMode,model:danceModel,ratio:danceRatio,count:danceCount,omniDuration:danceDuration,runMode:danceRunMode,autoDownload:danceAutoDownload,downloadDir:danceDownloadDir,refsDir:'',characterImages:[danceModelImage],pairedMode:false,refMode:'all'})}
  async function createWardrobeBatch(){if(!danceModelImage){append('❌ Hãy chọn ảnh người mẫu.');return}if(!danceOutfits.some(o=>o.files?.length)){append('❌ Hãy chọn ít nhất một bộ trang phục.');return}append('AI đang tạo prompt thay trang phục; video điệu nhảy được bỏ qua...');const r=await api().danceGenerate({generationMode:'wardrobe',modelImage:danceModelImage,outfits:danceOutfits,apiKey:firstKey(),apiModel:danceApiModel,promptLang:dancePromptLang});if(r?.text)setDanceResult(r.text);if(!r?.promptFile){append(r);return}setDancePromptFile(r.promptFile);const imageModel=imageModels.includes(danceModel)?danceModel:imageModels[0];await start(r.promptFile,{mode:'createimage',model:imageModel,ratio:danceRatio,count:danceCount,runMode:danceRunMode,autoDownload:danceAutoDownload,downloadDir:danceDownloadDir,refsDir:r.refsDir||'',characterImages:[],pairedMode:true,refMode:'paired'});}
  async function extractDanceAudio(){append(await api().danceExtractAudio({video:danceVideo}))}
  async function pickAudio(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Audio',extensions:['mp3','wav','m4a','aac']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setAudioFile(r[0]); append(`Audio: ${r[0]}`)}}
  async function pickSrt(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Subtitle',extensions:['srt','ass']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setSrtFile(r[0]); append(`File sub: ${r[0]}`)}}
  async function pickSampleVideo(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','mkv','webm','avi','m4v']},{name:'All',extensions:['*']} ]}); if(r?.[0]){setSampleVideo(r[0]); append(`Video mẫu: ${r[0]}`)}}
  async function pickSeoVideo(){const r=await api().openFile({properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','mkv','webm','avi','m4v']}]});if(r?.[0]){setSeoVideo(r[0]);setSeoResult(null);append(`Video SEO: ${r[0]}`)}}
  async function analyzeSeoVideo(){if(!seoVideo){append('❌ Hãy chọn video cần phân tích SEO.');return}if(!firstKey()){append('❌ Hãy nhập Gemini API key trong AI Prompt Studio.');return}setSeoBusy(true);append('AI đang phân tích video và tạo bộ SEO...');try{const r=await api().seoAnalyze({file:seoVideo,apiKey:apiKeys,apiModel:geminiApiModel,language:seoLanguage});if(r?.result)setSeoResult(r.result);append(r)}finally{setSeoBusy(false)}}

  function copySeo(value:any,label:string){navigator.clipboard?.writeText(Array.isArray(value)?value.join(', '):String(value||''));append(`✅ Đã copy ${label}.`)}
  async function analyzeSampleVideo(){append('AI đang phân tích video mẫu và tạo kịch bản tương tự...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().videoAnalyzeSample({file:sampleVideo,apiKey:firstKey(),apiModel:geminiApiModel,duration}); if(r?.script)setPostScript(r.script); append(r)}
  async function analyzeSampleVideoForAi(){ if(!sampleVideo){append('❌ Vui lòng chọn video mẫu trước.'); return;} append('AI đang phân tích video mẫu và viết kịch bản khớp nội dung video...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().videoAnalyzeSample({file:sampleVideo,apiKey:firstKey(),apiModel:geminiApiModel,duration}); if(r?.script){setTopic(r.script); setIdeas(r.script); append('✅ Đã phân tích video mẫu và tự điền vào ô kịch bản.');} append(r)}
  async function analyzeUrlForAi(){ const url=sourceUrl.trim(); if(!url){append('❌ Vui lòng nhập link video, link web hoặc link bài báo.'); return;} append('AI đang đọc link và viết lại kịch bản sát nội dung nguồn...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().analyzeUrl({url,apiKey:firstKey(),apiModel:geminiApiModel,duration,promptLang}); if(r?.script){setTopic(r.script); setIdeas(r.script); append('✅ Đã phân tích link và tự điền vào ô kịch bản.');} append(r)}
  async function rewriteArticleDeepForAi(){ const url=sourceUrl.trim(); if(!url){append('❌ Vui lòng nhập link bài báo trước.'); return;} append('AI đang đọc toàn bộ bài báo và viết lại kịch bản chuyên sâu...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().analyzeUrl({url,apiKey:firstKey(),apiModel:geminiApiModel,duration,promptLang,deepRewrite:true}); if(r?.script){setTopic(r.script);setIdeas(r.script);append('✅ Đã viết lại bài báo thành kịch bản chuyên sâu.');} append(r)}
  async function rewritePastedScriptDeep(){ const script=(ideas||topic).trim(); if(!script){append('❌ Vui lòng dán kịch bản vào ô trước.');return;} append('AI đang viết lại kịch bản chuyên sâu hơn...'); const duration=`${durationValue} ${durationUnit}`; const r=await api().rewriteScriptDeep({script,apiKey:firstKey(),apiModel:geminiApiModel,duration,promptLang,voiceLang,speakerGender}); if(r?.script){setIdeas(r.script);setTopic(r.script);append('✅ Đã viết lại kịch bản chuyên sâu hơn.');} append(r)}
  async function mergeVideos(){append('Đang ghép video...'); append(await api().videoMerge({folder:videoFolder,files:videoFiles}))}
  async function extractAudio(){append('Đang tách toàn bộ âm thanh các cảnh...'); for(const file of videoFiles) append(await api().videoExtractAudio({file}));}
  async function analyzeVideos(){append(postMode==='ai'?'AI đang phân tích video theo kịch bản...':'Đang tạo timeline thủ công...'); const r=await api().videoAnalyze({folder:videoFolder,files:videoFiles,script:postScript,useAi:postMode==='ai',apiKey:firstKey(),apiModel:geminiApiModel,defaultTransition}); if(r?.scenes)setTimeline(r.scenes); append(r)}
  async function exportTimeline(){append('Đang xuất video theo timeline...'); append(await api().videoExportTimeline({folder:videoFolder,scenes:timeline.length?timeline:videoFiles.map((f,i)=>({file:f,keep:true,order:i+1}))}))}
  async function aiPostPlan(){append('AI đang phân tích từng cảnh, cắt đoạn thừa/lỗi và tạo subtitle...'); const r=await api().videoPostPlan({folder:videoFolder,files:videoFiles,script:postScript,subLang,autoSub,srtFile,subStyle:{font:subFont,color:subColor,size:Number(subSize)||42},apiKey:firstKey(),apiModel:geminiApiModel,defaultTransition}); if(r?.scenes)setTimeline(r.scenes); if(r?.subtitles)setManualSubs(JSON.stringify(r.subtitles)); append(r)}
  async function exportPost(){append('Đang xuất hậu kì video AI tự động...'); let subtitles:any[]=[]; try{subtitles=JSON.parse(manualSubs||'[]')}catch{} append(await api().videoPostExport({folder:videoFolder,files:videoFiles,scenes:timeline.length?timeline:videoFiles.map((f,i)=>({file:f,keep:true,order:i+1})),subtitles,autoSub,script:postScript,srtFile,subStyle:{font:subFont||'Arial',color:subColor,size:Number(subSize)||42},musicFile,musicVolume:musicVolume/100,audioFile,removeOriginalAudio,subLang,defaultTransition,aspect:postAspect,zoom:postZoom,speed:Number(postSpeed)||1}))}
  const transitionOptions=[['ai','AI tự chọn'],['random','Tự động ngẫu nhiên mỗi cảnh'],['dissolve','Hòa tan mềm'],['circleopen','Mở vòng tròn'],['wipeleft','Quét sang trái'],['wiperight','Quét sang phải'],['pixelize','Pixel chuyển cảnh'],['fade','Mờ dần'],['fadeblack','Mờ qua màu đen'],['fadewhite','Mờ qua màu trắng'],['smoothleft','Trượt mượt sang trái'],['smoothright','Trượt mượt sang phải'],['smoothup','Trượt mượt lên trên'],['smoothdown','Trượt mượt xuống dưới']];
  function setSceneTransition(i:number,v:string){setTimeline(()=>baseTimeline().map((x,k)=>k===i?{...x,transition:v}:x))}
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
    append('🧑‍🎨 Đang tạo prompt ảnh nhân vật...');
    let r:any;
    try{ r=await timeoutPromise(api().generateCharacters({apiKey:apiKeys,apiModel:geminiApiModel,style,ideas:text,promptLang}), 310000, 'character_prompt_timeout_310s'); }
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
      const r=await api().generateScript({apiKey:apiKeys,apiModel:geminiApiModel,style,topic:scriptTopic,duration,characterImages,refsDir,promptLang,voiceLang,speakerGender,speechMode,promptSubtitles,promptSafetyMode});
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
  async function checkLicense(){ const r=await api().licenseCheck(); const msg=friendly(r); setLicenseText(msg); append(msg); const ok=!!r?.ok && r?.strictOnline===true && !r?.cached && !String(r?.reason||r?.error||'').match(/expired|revoked|invalid|missing|revoked/i); setLicenseLocked(!ok); setLicenseReady(true); if(ok)setPage('flow'); return r }
  async function activateLicense(){ append('🚀 Đang gửi yêu cầu kích hoạt...'); const r=await api().activateLicense({licenseKey}); const msg=friendly(r); setLicenseText(msg); append(msg); if(r?.ok){setLicenseLocked(false); setLicenseReady(true); setPage('flow');} else {setLicenseLocked(true); setLicenseReady(true);} return r }
  useEffect(()=>{ try{ const saved=JSON.parse(localStorage.getItem('flowProfilesConfig')||'[]'); if(Array.isArray(saved)&&saved.length) setProfiles(saved); }catch{} },[]);
  useEffect(()=>{ try{ localStorage.setItem('flowProfilesConfig', JSON.stringify(profiles)); }catch{} },[profiles]);

  useEffect(()=>{
    if(!runWatch) return;
    let seenRunning=false;
    const it=setInterval(async()=>{
      try{
        const st=await api().status();
        if(st?.running) seenRunning=true;
        if(seenRunning && !st?.running){
          setRunWatch(false);
          append('✅ Tiến trình tạo prompt đã hoàn tất.');
          setActivity('✅ Hoàn tất tiến trình');
          setTimeout(()=>{ try{ window.alert('✅ Tiến trình tạo prompt đã hoàn tất.'); }catch{} },100);
        }
      }catch{}
    },3000);
    return ()=>clearInterval(it);
  },[runWatch]);

  async function addStatusFolders(){const r=await api().openFile({properties:['openDirectory','multiSelections']});if(r?.length){setStatusProfiles((prev:any[])=>{const known=new Set(prev.map(x=>x.dir));const next=[...prev,...r.filter((dir:string)=>!known.has(dir)).map((dir:string,i:number)=>({id:Date.now()+i,name:`Profile ${prev.length+i+1}`,dir,timeline:{items:[]},merged:''}))].slice(0,100);localStorage.setItem('status_profiles',JSON.stringify(next.map(x=>({...x,timeline:{items:[]}}))));return next})}}
  function removeStatusProfile(id:any){setStatusProfiles((prev:any[])=>{const next=prev.filter(x=>x.id!==id);localStorage.setItem('status_profiles',JSON.stringify(next));return next})}
  async function quickMergeProfile(profile:any){if(!profile?.dir){append('❌ Chưa có thư mục video để ghép.');return}setActivity(`⏳ Đang ghép nhanh ${profile.name}...`);const r=await api().quickMerge({folder:profile.dir,transition:quickTransition,autoSub:quickAutoSub,subLang:quickSubLang,apiKey:firstKey(),apiModel:geminiApiModel,aspect:quickAspect,zoom:quickZoom,speed:Number(quickSpeed)||1});if(r?.out){if(profile.id==='default')setOutputTimeline((x:any)=>({...x,merged:r.out,mergedUrl:r.url}));else setStatusProfiles((prev:any[])=>prev.map(x=>x.id===profile.id?{...x,merged:r.out,mergedUrl:r.url}:x))}append(r)}
  async function quickMergeAll(){const targets=statusProfiles.length?statusProfiles:(outputTimeline.dir?[{id:'default',name:'Thư mục download',dir:outputTimeline.dir}]:[]);if(!targets.length){append('❌ Hãy chọn thư mục chứa video trước.');return}for(const profile of targets)await quickMergeProfile(profile)}

  useEffect(()=>{
    if(page!=='status')return;
    let active=true;
    const refresh=async()=>{try{const r=await api().outputTimeline([danceDownloadDir,downloadDir]);if(active&&r)setOutputTimeline(r);if(statusProfiles.length){const rows=await Promise.all(statusProfiles.map(async p=>({...p,timeline:await api().outputTimeline([p.dir])})));if(active)setStatusProfiles(prev=>rows.map(row=>({...row,merged:prev.find(x=>x.id===row.id)?.merged||row.merged,mergedUrl:prev.find(x=>x.id===row.id)?.mergedUrl||row.mergedUrl})))}}catch{}};
    refresh();const it=setInterval(refresh,2000);return()=>{active=false;clearInterval(it)};
  },[page,danceDownloadDir,downloadDir,statusProfiles.map(x=>x.dir).join('|')]);

  useEffect(()=>{ let p=0; const it=setInterval(()=>{p=Math.min(98,p+7); setBootPct(p)},90); const t=setTimeout(()=>{setBootPct(100); setTimeout(()=>setBootLoading(false),180)},1400); api().machineId().then((r:any)=>{ if(r?.machineId)setMachineId(r.machineId) }).catch(()=>{}); api().licenseCheck().then((r:any)=>{ const msg=friendly(r); setLicenseText(msg); const ok=!!r?.ok && r?.strictOnline===true && !r?.cached && !String(r?.reason||r?.error||'').match(/expired|revoked|invalid|missing|revoked/i); setLicenseLocked(!ok); setLicenseReady(true); if(ok) api().status().then(append).catch(()=>{}); }).catch((e:any)=>{ setLicenseText('❌ Không kiểm tra được license. Vui lòng nhập key kích hoạt.'); setLicenseLocked(true); setLicenseReady(true); }); return ()=>{clearTimeout(t); clearInterval(it)}; },[])
  async function ensureCdp(){append('Đang mở/kiểm tra Chrome CDP...'); append(await api().ensureCdp())}
  async function debugStart(){append('Đang bật ghi thao tác Flow...');append(await api().debugStart())}
  async function debugStop(){append(await api().debugStop())}
  async function debugExport(){append(await api().debugExport())}
  async function openProfileLogin(i:number){ const pr=profiles[i]||{}; append(`🌐 Mở Chrome profile ${i+1} để đăng nhập: ${pr.accountEmail||pr.name||''}`); append(await api().openProfileLogin(pr,i)); }
  function domValue(id:string, fallback:string){
    const el=document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return el?.value || fallback;
  }
  function runPayload(file?:string, overrides:any={}){
    const liveMode=overrides.mode ?? mode;
    const liveSubMode=overrides.subMode ?? subMode;
    const liveModel=normalizeModelForMode(overrides.model ?? model, liveMode);
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
      downloadDir:overrides.downloadDir || downloadDir || localStorage.getItem('flow_download_dir') || '',
      runMode:liveRunMode,
      flowThreads:liveThreads,
      autoDownload: overrides.autoDownload ?? autoDownload,
      pairedMode: overrides.pairedMode ?? (refMode === "paired"),
      refMode: overrides.refMode ?? refMode,
      subMode:liveSubMode, videoSubMode:liveSubMode,
    };
    append(`⚙️ Setting gửi vào worker: mode=${payload.mode}, model=${payload.model}, ratio=${payload.ratio}, count=${payload.count}${payload.omniDuration?', duration='+payload.omniDuration:''}, sub=${payload.subMode}`);
    return payload;
  }
  async function start(file?:string, overrides:any={}){ const p=runPayload(file,overrides); append(`🚀 Start (ID: ${Date.now()}): mode=${p.mode}, model=${p.model}`); const r=await api().start(p); append(r); if(r?.ok)setRunWatch(true)}
  async function quick(){append('Đang quick start...'); const r=await api().start({...runPayload(), startFrom:1}); append(r); if(r?.ok)setRunWatch(true)}
  return <div className={`app theme-${theme}`}>{bootLoading&&<div className="boot-loading"><div className="loader-card"><div className="spinner"></div><b>Đang tải ứng dụng... {bootPct}%</b><div className="boot-bar"><div style={{width:`${bootPct}%`}}></div></div><span>FLOW AUTO VEO 3 đang khởi động, vui lòng chờ.</span></div></div>}{!bootLoading&&licenseReady&&licenseLocked&&<div className="license-gate"><div className="license-gate-card"><div className="brand-row"><KeyRound/><b>Kích hoạt bản quyền Flow Auto</b></div><p>Vui lòng gửi mã máy cho admin để nhận key kích hoạt bản quyền.</p><Field label="Machine ID"><div className="machine-row"><input readOnly value={machineId}/><Button onClick={()=>{navigator.clipboard?.writeText(machineId); append('Đã copy Machine ID')}}>Copy</Button></div></Field><Field label="Nhập key kích hoạt"><input value={licenseKey} onChange={e=>setLicenseKey(e.target.value)} placeholder="Dán license key admin gửi" autoFocus/></Field><div className="license-box">{licenseText}</div><div className="actions"><Button variant="primary" onClick={activateLicense}>🔐 Kích hoạt bản quyền</Button><Button onClick={checkLicense}>🔄 Kiểm tra lại</Button></div><p className="hint">Nếu chưa có key hoặc key đã hết hạn, app sẽ giữ màn hình này và không mở giao diện tool.</p></div></div>}{!bootLoading&&licenseReady&&licenseLocked?null:langNotice&&<div className="modal-backdrop"><div className="small-modal"><b>{T('Đã đổi ngôn ngữ','Language changed')}</b><p>{T('Vui lòng khởi động lại app để áp dụng đầy đủ cài đặt ngôn ngữ.','Please restart the app to fully apply the language setting.')}</p><Button variant="primary" onClick={()=>setLangNotice(false)}>OK</Button></div></div>}
    <aside className="side"><div className="sidebar-caption">MENU</div><div className="brand"><Bot/><div><b>FLOW AUTO VEO 3</b><span>Modern UI</span></div></div><div className="lang-switch"><button type="button" className={lang==='VI'?'active':''} onClick={(e)=>{e.preventDefault();e.stopPropagation();switchLang('VI')}}>VI</button><button type="button" className={lang==='EN'?'active':''} onClick={(e)=>{e.preventDefault();e.stopPropagation();switchLang('EN')}}>EN</button></div><div className="nav-caption">WORKSPACE</div>{nav.map(([id,label,Icon]:any)=><button key={id} onClick={()=>setPage(id)} className={page===id?'active':''}><Icon size={18}/>{label}</button>)}<div className="sidebar-footer"><span>Gói bản quyền</span><div className="price">{T('1200K / vĩnh viễn','1200K / lifetime')}</div></div></aside>
    <main className="main">
      <header><div><h1>{page==='ai'?'AI Prompt Studio':page==='flow'?T('Vận hành Flow','Flow Operation'):page==='license'?T('License & Đăng ký','License & Activation'):page==='payment'?T('Thanh toán','Payment'):page==='chars'?'Prompt nhân vật':page==='multi'?T('Đa luồng Flow','Multi-profile Flow'):page==='post'?T('Hậu kì video','Video Post-production'):page==='dance'?'Dance Prompt Studio':page==='seo'?'Video SEO Master AI':page==='status'?T('Trạng thái chạy','Run Status'):'FLOW AUTO VEO 3'}</h1><p>FLOW AUTO VEO 3 Modern UI</p></div><div className="header-actions"><button type="button" className="theme-toggle" title={theme==='dark'?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối'} onClick={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);localStorage.setItem('flow_ui_theme',next)}}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{theme==='dark'?'Sáng':'Tối'}</span></button><div className="status">{activity}</div><div className="lang-switch header-lang"><button type="button" className={lang==='VI'?'active':''} onClick={(e)=>{e.preventDefault();switchLang('VI')}}>VI</button><button type="button" className={lang==='EN'?'active':''} onClick={(e)=>{e.preventDefault();switchLang('EN')}}>EN</button></div></div></header>
      {page==='flow'&&<div className="grid"><Card title="Thiết lập chạy" icon={<Film/>}><div className="actions"><Button onClick={saveFlowSettings}>💾 Lưu cấu hình setting</Button><Button onClick={pickPrompt}>📄 Chọn file prompt</Button><Button onClick={pickRefs}>🖼 Chọn đường dẫn thư mục ảnh</Button><Button onClick={pickDownloadDir}>💾 Cấu hình thư mục auto tải ảnh/video</Button><Button onClick={ensureCdp}>🌐 Mở Chrome Flow</Button><Button onClick={debugStart}>Bắt đầu ghi Debug</Button><Button onClick={debugStop}>Dừng ghi Debug</Button><Button onClick={debugExport}>Xuất gói Debug ZIP</Button></div><p className="hint">Prompt: {promptFile || generatedFile || 'chưa chọn'}<br/>Đường dẫn thư mục ảnh: {refsDir || 'chưa chọn'}<br/>Thư mục auto tải ảnh/video: {downloadDir || 'Downloads mặc định'}</p><div className="form4">
<Field label="Mode"><select id="flow-mode" value={mode} onChange={e=>changeMode(e.target.value)}><option value="createvideo">createvideo</option><option value="createimage">createimage</option></select></Field><Field label="Chế độ video"><select id="flow-sub-mode" value={subMode} onChange={e=>setSubMode(e.target.value)} disabled={mode==='createimage'}><option value="ingredients">Video thành phần</option><option value="frames">Khung hình</option></select></Field><Field label="Model"><select id="flow-model" value={model} onChange={e=>{setModel(e.target.value);localStorage.setItem('flow_model',e.target.value)}}>{availableModels.map(x=><option key={x} value={x}>{flowModelLabel(x)}</option>)}</select></Field><Field label="Model API Gemini"><select value={geminiApiModel} onChange={e=>setGeminiApiModel(e.target.value)}>{geminiApiModels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>{model==='omni_flash'&&<Field label="Thời lượng Omni Flash"><select id="flow-omni-duration" value={omniDuration} onChange={e=>setOmniDuration(e.target.value)}>{['4s','6s','8s','10s'].map(x=><option key={x} value={x}>{x}</option>)}</select></Field>}<Field label="Tỉ lệ"><select id="flow-ratio" value={ratio} onChange={e=>{setRatio(e.target.value);localStorage.setItem('flow_ratio',e.target.value)}}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Số output"><select id="flow-count" value={count} onChange={e=>{setCount(e.target.value);localStorage.setItem('flow_count',e.target.value)}}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Giãn cách prompt"><input id="flow-spacing" value={spacing} onChange={e=>{setSpacing(e.target.value);localStorage.setItem('flow_spacing',e.target.value)}}/></Field><Field label="Chế độ tham chiếu"><select id="flow-ref-mode-multi" value={refMode} onChange={e=>{setRefMode(e.target.value);localStorage.setItem("flow_ref_mode",e.target.value)}}><option value="paired">1 ảnh, 1 prompt</option><option value="all">Tham chiếu toàn bộ ảnh</option></select></Field>
<Field label="Chế độ chạy"><select id="flow-run-mode" value={runMode} onChange={e=>{setRunMode(e.target.value);localStorage.setItem('flow_run_mode',e.target.value)}}><option value="single">Chạy từng prompt một</option><option value="continuous_submit_only">Chạy liên tục - tải theo lô 3 prompt</option></select></Field><Field label="Auto tải ảnh/video"><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>{setAutoDownload(e.target.checked);localStorage.setItem('flow_auto_download',String(e.target.checked))}}/><span>{autoDownload?'Bật':'Tắt'}</span></label><small className="field-note">Ảnh và video hoàn tất được tự lưu vào thư mục đã cấu hình; chế độ liên tục tải theo lô 3 prompt.</small></Field><Field label="Số tab Flow"><select id="flow-threads" value={flowThreads} onChange={e=>setFlowThreads(e.target.value)}>{Array.from({length:100},(_,i)=>String(i+1)).map(x=><option key={x} value={x}>{x} tab</option>)}</select></Field></div></Card><Card title="Điều khiển" icon={<Play/>}><div className="actions"><Button variant="primary" onClick={()=>start()}><Play size={16}/> Bắt đầu</Button><Button variant="danger" onClick={stop}><Square size={16}/> Stop</Button></div></Card></div>}

      {page==='seo'&&<div className="seo-master-page"><div className="grid"><Card title="Video đầu vào" icon={<Search/>}><Field label="Video cần phân tích"><input readOnly value={seoVideo||'Chưa chọn video'}/></Field><div className="form4"><Field label="Ngôn ngữ kết quả"><select value={seoLanguage} onChange={e=>{setSeoLanguage(e.target.value);localStorage.setItem('seo_language',e.target.value)}}><option value="Vietnamese">Tiếng Việt</option><option value="English">English</option><option value="Spanish">Español</option><option value="Chinese">中文</option><option value="Japanese">日本語</option><option value="Korean">한국어</option></select></Field><Field label="Model Gemini"><select value={geminiApiModel} onChange={e=>setGeminiApiModel(e.target.value)}>{geminiApiModels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field></div><div className="actions"><Button onClick={pickSeoVideo}>🎬 Chọn video</Button><Button variant="primary" onClick={analyzeSeoVideo}>{seoBusy?'Đang phân tích…':'✨ Phân tích SEO bằng AI'}</Button></div><p className="hint">Dùng chung API key đã lưu trong AI Prompt Studio. AI trích các khung hình đại diện, phân tích nội dung thật và tạo metadata phù hợp; điểm tiềm năng không phải cam kết lượt xem.</p></Card><Card title="Xem trước video" icon={<Film/>}>{seoVideo?<video className="seo-video-preview" src={`file://${seoVideo}`} controls preload="metadata"/>:<div className="timeline-empty">Chưa chọn video</div>}</Card></div>{seoResult&&<><div className="seo-score"><b>{seoResult.viralScore||0}</b><span>/100 • Điểm tiềm năng nội dung</span></div><div className="grid seo-results"><Card title="Tiêu đề & Hook"><Field label="YouTube title"><textarea readOnly value={seoResult.youtubeTitle||''}/></Field><Button onClick={()=>copySeo(seoResult.youtubeTitle,'tiêu đề YouTube')}>Copy</Button><Field label="TikTok title"><textarea readOnly value={seoResult.tiktokTitle||''}/></Field><Button onClick={()=>copySeo(seoResult.tiktokTitle,'tiêu đề TikTok')}>Copy</Button><Field label="Hook 3 giây đầu"><textarea readOnly value={seoResult.hook||''}/></Field><Button onClick={()=>copySeo(seoResult.hook,'hook')}>Copy</Button></Card><Card title="Mô tả SEO"><textarea className="seo-description" readOnly value={seoResult.description||''}/><Button onClick={()=>copySeo(seoResult.description,'mô tả')}>Copy mô tả</Button></Card><Card title="Hashtag & Từ khóa"><Field label="Hashtag"><textarea readOnly value={(seoResult.hashtags||[]).join(' ')}/></Field><Button onClick={()=>copySeo((seoResult.hashtags||[]).join(' '),'hashtag')}>Copy hashtag</Button><Field label={`Từ khóa (${(seoResult.keywords||[]).join(', ').length}/500 ký tự)`}><textarea readOnly value={(seoResult.keywords||[]).join(', ')}/></Field><Button onClick={()=>copySeo(seoResult.keywords,'từ khóa')}>Copy từ khóa</Button></Card><Card title="Lịch đăng đề xuất"><div className="seo-schedule">{(seoResult.optimalPostTimes||[]).map((x:any,i:number)=><div key={i}><b>{x.day}</b><span>{(x.times||[]).join(' • ')}</span></div>)}</div></Card></div></>}</div>}

      {page==='chars'&&<div className="grid ai">
        <Card title="Prompt ảnh tạo nhân vật" icon={<ImagePlus/>}>
          <Field label="Gemini API keys">
            <textarea className="masked" value={apiKeys} onChange={e=>setApiKeys(e.target.value)} placeholder="Dán key, mỗi dòng hoặc dấu phẩy 1 key" />
          </Field>
          <div className="form4">
            <Field label="Style"><select value={style} onChange={e=>setStyle(e.target.value)}>{styles.map(x=><option key={x} value={x}>{x==='CINEMATIC'?'LIVE ACTION - người thật':x}</option>)}</select></Field>
            <Field label="Ngôn ngữ prompt"><select value={promptLang} onChange={e=>setPromptLang(e.target.value)}><option value="vi">Tiếng Việt</option><option value="en">Tiếng Anh</option><option value="zh">Tiếng Trung</option><option value="ko">Tiếng Hàn</option><option value="es">Tiếng Tây Ban Nha</option></select></Field><Field label="Model API Gemini"><select value={geminiApiModel} onChange={e=>setGeminiApiModel(e.target.value)}>{geminiApiModels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
          </div>
          <Field label="Danh sách nhân vật - mỗi dòng là 1 nhân vật">
            <textarea value={characterIdeas} onChange={e=>setCharacterIdeas(e.target.value)} placeholder={'Ví dụ:\nCô gái chiến binh cyberpunk tóc bạc\nÔng lão pháp sư mặc áo choàng xanh\nCậu bé phi hành gia trên sao Hỏa'} />
          </Field>
          <div className="actions">
            <Button onClick={saveApiConfig}>💾 Lưu cấu hình API</Button>
            <Button variant="primary" onClick={generateCharacterPrompts}>✨ Tạo prompt nhân vật</Button><Button onClick={downloadGeneratedPrompt}>⬇️ Tải prompt đã tạo</Button>
          </div>
          <p className="hint">Mỗi dòng sẽ xuất ra 1 prompt ảnh cho 1 nhân vật riêng. Dùng chung phong cách với AI Prompt Studio. File prompt: {generatedFile || 'chưa tạo'}</p>
        </Card>
        <Card title="Thiết lập Flow ảnh" icon={<Film/>}>
          <div className="form4">
<Field label="Mode"><select value={mode} onChange={e=>changeMode(e.target.value)}><option value="createimage">createimage</option><option value="createvideo">createvideo</option></select></Field><Field label="Model"><select value={model} onChange={e=>{setModel(e.target.value);localStorage.setItem('flow_model',e.target.value)}}>{availableModels.map(x=><option key={x} value={x}>{flowModelLabel(x)}</option>)}</select></Field><Field label="Tỉ lệ"><select value={ratio} onChange={e=>{setRatio(e.target.value);localStorage.setItem('flow_ratio',e.target.value)}}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Số output"><select value={count} onChange={e=>{setCount(e.target.value);localStorage.setItem('flow_count',e.target.value)}}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Giãn cách prompt"><input value={spacing} onChange={e=>{setSpacing(e.target.value);localStorage.setItem('flow_spacing',e.target.value)}} placeholder="10" /></Field><Field label="Chế độ tham chiếu"><select id="flow-ref-mode-multi" value={refMode} onChange={e=>{setRefMode(e.target.value);localStorage.setItem("flow_ref_mode",e.target.value)}}><option value="paired">1 ảnh, 1 prompt</option><option value="all">Tham chiếu toàn bộ ảnh</option></select></Field>
<Field label="Chế độ chạy"><select value={runMode} onChange={e=>{setRunMode(e.target.value);localStorage.setItem('flow_run_mode',e.target.value)}}><option value="single">Chạy từng prompt một</option><option value="continuous_submit_only">Chạy liên tục - tải theo lô 3 prompt</option></select></Field><Field label="Auto tải ảnh/video"><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>{setAutoDownload(e.target.checked);localStorage.setItem('flow_auto_download',String(e.target.checked))}}/><span>{autoDownload?'Bật':'Tắt'}</span></label><small className="field-note">Ảnh và video hoàn tất được tự lưu vào thư mục đã cấu hình; chế độ liên tục tải theo lô 3 prompt.</small></Field></div>
          <div className="actions"><Button onClick={saveFlowSettings}>💾 Lưu cấu hình setting</Button><Button variant="primary" onClick={()=>start(generatedFile,{mode,model,ratio,count,spacing,runMode,autoDownload,characterImages})}>▶ Chạy prompt nhân vật</Button><Button variant="danger" onClick={stop}>⏹ Stop</Button></div>
        </Card>
      </div>}

      {page==='ai'&&<div className="grid ai">
        <Card title="API & Kịch bản" icon={<Wand2/>}>
          <Field label="Gemini API keys">
            <textarea className="masked" value={apiKeys} onChange={e=>setApiKeys(e.target.value)} placeholder="Dán key, mỗi dòng hoặc dấu phẩy 1 key" />
          </Field>
          <div className="form4">
            <Field label="Style"><select value={style} onChange={e=>setStyle(e.target.value)}>{styles.map(x=><option key={x} value={x}>{x==='CINEMATIC'?'LIVE ACTION - người thật':x}</option>)}</select></Field>
            <Field label="Loại"><select value={mediaType} onChange={e=>setMediaType(e.target.value)}><option value="IMAGE">IMAGE</option><option value="VIDEO">VIDEO</option></select></Field><Field label="Ngôn ngữ prompt"><select value={promptLang} onChange={e=>setPromptLang(e.target.value)}><option value="vi">Tiếng Việt</option><option value="en">Tiếng Anh</option><option value="zh">Tiếng Trung</option><option value="ko">Tiếng Hàn</option><option value="es">Tiếng Tây Ban Nha</option></select></Field><Field label="Ngôn ngữ giọng nói nhân vật"><select value={voiceLang} onChange={e=>setVoiceLang(e.target.value)}><option value="vi_south">Tiếng Việt - giọng miền Nam</option><option value="vi_north">Tiếng Việt - giọng miền Bắc</option><option value="en">Nhân vật nói tiếng Anh</option></select><small className="field-note">Nếu prompt là tiếng Việt, toàn bộ prompt sẽ cố định đúng giọng Việt đã chọn: miền Nam hoặc miền Bắc.</small></Field><Field label="Chế độ lời nói"><select value={speechMode} onChange={e=>setSpeechMode(e.target.value)}><option value="fixed">Nhân vật có giọng nói cố định</option><option value="silent">Nhân vật không nói, không lời thoại</option></select><small className="field-note">Chế độ không nói sẽ loại bỏ Voiceover, lời thoại và khẩu hình nói trong mọi cảnh.</small></Field><Field label="Giới tính giọng nói"><select value={speakerGender} onChange={e=>setSpeakerGender(e.target.value)}><option value="male">Chỉ giọng nam</option><option value="female">Chỉ giọng nữ</option></select><small className="field-note">Áp dụng bắt buộc và đồng nhất cho toàn bộ prompt trong một kịch bản.</small></Field><Field label="Phụ đề trong video"><select value={promptSubtitles} onChange={e=>setPromptSubtitles(e.target.value)}><option value="off">Không hiển thị phụ đề</option><option value="on">Có hiển thị phụ đề</option></select><small className="field-note">Phụ đề tiếng Việt dùng font Unicode chuẩn, không lỗi dấu.</small></Field><Field label="Cấu trúc an toàn prompt"><select value={promptSafetyMode} onChange={e=>setPromptSafetyMode(e.target.value)}><option value="standard">Prompt hiện tại</option><option value="google_safe">Tránh vi phạm Google</option></select><small className="field-note">Chế độ Google-safe dùng nhân vật biểu tượng hư cấu, không tái tạo khuôn mặt/giọng thật, không chữ trên màn hình và không gore.</small></Field><Field label="Model API Gemini"><select value={geminiApiModel} onChange={e=>setGeminiApiModel(e.target.value)}>{geminiApiModels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
            <Field label="Thời lượng"><div className="duration-row"><input value={durationValue} onChange={e=>setDurationValue(e.target.value.replace(/[^0-9]/g,''))} placeholder="60"/><select value={durationUnit} onChange={e=>setDurationUnit(e.target.value as 'seconds'|'minutes')}><option value="seconds">Giây</option><option value="minutes">Phút</option></select></div></Field>
            <Field label="Giãn cách"><input value={spacing} onChange={e=>{setSpacing(e.target.value);localStorage.setItem('flow_spacing',e.target.value)}} /></Field>
          </div>
          <Field label="Kịch bản video / Ý tưởng tạo prompt">
            <textarea value={ideas} onChange={e=>setIdeas(e.target.value)} placeholder="Dán kịch bản, nhập ý tưởng, hoặc dùng nút phân tích video mẫu / phân tích link để AI tự điền kịch bản vào đây" />
          </Field>
          <div className="form4">
            <Field label="Link video / web / bài báo"><input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="Dán URL video, trang web hoặc bài báo" /></Field>
            <Field label="Video mẫu đã chọn"><input readOnly value={sampleVideo||'chưa chọn'} /></Field>
          </div>
          <div className="actions">
            <Button onClick={saveApiConfig}>💾 Lưu cấu hình API</Button>
            <Button onClick={pickRefs}><ImagePlus size={16}/> Chọn thư mục ảnh nhân vật</Button>
            <Button onClick={pickSampleVideo}>🎞 Chọn video mẫu</Button>
            <Button onClick={analyzeSampleVideoForAi}>🧠 Phân tích kịch bản video mẫu</Button>
            <Button onClick={analyzeUrlForAi}>🌐 Phân tích link thành kịch bản</Button><Button variant="primary" onClick={rewriteArticleDeepForAi}>📰 Viết lại chuyên sâu từ link báo</Button><Button variant="primary" onClick={rewritePastedScriptDeep}>✍️ Viết lại kịch bản chuyên sâu</Button>
            <Button variant="primary" onClick={generatePrompt}>✨ Tạo prompt</Button><Button onClick={downloadGeneratedPrompt}>⬇️ Tải prompt đã tạo</Button>
          </div>
          <p className="hint">Thư mục ảnh nhân vật: {refsDir||'chưa chọn'} • Video mẫu: {sampleVideo||'chưa chọn'} • Prompt/kịch bản sẽ ưu tiên giữ nhân vật tương đồng tối đa theo ảnh tham chiếu và xuất theo ngôn ngữ đã chọn{generatedFile?` • File prompt: ${generatedFile}`:''}</p>
        </Card>
        <Card title="Thiết lập Flow" icon={<Film/>}>
          <div className="form4">
            
<Field label="Mode"><select value={mode} onChange={e=>changeMode(e.target.value)}><option value="createvideo">createvideo</option><option value="createimage">createimage</option></select></Field>
            <Field label="Chế độ video"><select id="flow-sub-mode" value={subMode} onChange={e=>setSubMode(e.target.value)} disabled={mode==='createimage'}><option value="ingredients">Video thành phần</option><option value="frames">Khung hình</option></select></Field>
            
            <Field label="Model"><select id="flow-model-multi" value={model} onChange={e=>{setModel(e.target.value);localStorage.setItem('flow_model',e.target.value)}}>{availableModels.map(x=><option key={x} value={x}>{flowModelLabel(x)}</option>)}</select></Field>{model==='omni_flash'&&<Field label="Thời lượng Omni Flash"><select id="flow-omni-duration" value={omniDuration} onChange={e=>setOmniDuration(e.target.value)}>{['4s','6s','8s','10s'].map(x=><option key={x} value={x}>{x}</option>)}</select></Field>}
            <Field label="Tỉ lệ"><select id="flow-ratio-multi" value={ratio} onChange={e=>{setRatio(e.target.value);localStorage.setItem('flow_ratio',e.target.value)}}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="Số output"><select id="flow-count" value={count} onChange={e=>{setCount(e.target.value);localStorage.setItem('flow_count',e.target.value)}}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Chế độ tham chiếu"><select id="flow-ref-mode-multi" value={refMode} onChange={e=>{setRefMode(e.target.value);localStorage.setItem("flow_ref_mode",e.target.value)}}><option value="paired">1 ảnh, 1 prompt</option><option value="all">Tham chiếu toàn bộ ảnh</option></select></Field>
<Field label="Chế độ chạy"><select value={runMode} onChange={e=>{setRunMode(e.target.value);localStorage.setItem('flow_run_mode',e.target.value)}}><option value="single">Chạy từng prompt một</option><option value="continuous_submit_only">Chạy liên tục - tải theo lô 3 prompt</option></select></Field><Field label="Giãn cách prompt"><input id="flow-spacing" value={spacing} onChange={e=>{setSpacing(e.target.value);localStorage.setItem('flow_spacing',e.target.value)}}/></Field>
          </div>
          <div className="actions"><Button onClick={saveFlowSettings}>💾 Lưu cấu hình setting</Button></div><div className="form4"><Field label="Auto tải ảnh/video"><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>{setAutoDownload(e.target.checked);localStorage.setItem('flow_auto_download',String(e.target.checked))}}/><span>{autoDownload?'Bật':'Tắt'}</span></label><small className="field-note">Ảnh và video hoàn tất được tự lưu vào thư mục đã cấu hình; chế độ liên tục tải theo lô 3 prompt.</small></Field></div><div className="actions"><Button variant="primary" onClick={()=>start(generatedFile,{autoDownload,refsDir,pairedMode:false})}>▶ Chạy prompt AI</Button><Button variant="danger" onClick={stop}>⏹ Stop</Button></div>
        </Card>
      </div>}
      {page==='multi'&&<div className="multi-page">
        <Card title="Đa luồng profile Flow" icon={<Film/>}>
          <p className="hint">Mỗi profile mở Chrome riêng và giữ session đăng nhập riêng. Nhập email/nhãn tài khoản, bấm Mở profile đăng nhập một lần, sau đó chạy tự động bằng đúng profile đó. Tool không lưu mật khẩu Google.</p>
          <div className="form4"><Field label="Số profile"><select value={String(profiles.length)} onChange={e=>{const n=Number(e.target.value); setProfiles(p=>Array.from({length:n},(_,i)=>p[i]||{name:`Profile ${i+1}`,accountEmail:'',refMode:'paired',script:'',promptFile:'',refsDir:''}))}}>{Array.from({length:100},(_,i)=>String(i+1)).map(x=><option key={x} value={x}>{x} profile</option>)}</select></Field><Field label="Chế độ"><select id="flow-mode-multi" value={mode} onChange={e=>changeMode(e.target.value)}><option value="createimage">Tạo ảnh</option><option value="createvideo">Tạo video</option></select></Field><Field label="Model"><select id="flow-model-multi" value={model} onChange={e=>{setModel(e.target.value);localStorage.setItem('flow_model',e.target.value)}}>{availableModels.map(x=><option key={x} value={x}>{flowModelLabel(x)}</option>)}</select></Field>{model==='omni_flash'&&<Field label="Thời lượng Omni Flash"><select id="flow-omni-duration" value={omniDuration} onChange={e=>setOmniDuration(e.target.value)}>{['4s','6s','8s','10s'].map(x=><option key={x} value={x}>{x}</option>)}</select></Field>}<Field label="Tỉ lệ"><select id="flow-ratio-multi" value={ratio} onChange={e=>{setRatio(e.target.value);localStorage.setItem('flow_ratio',e.target.value)}}>{ratios.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Số output"><select id="flow-count-multi" value={count} onChange={e=>{setCount(e.target.value);localStorage.setItem('flow_count',e.target.value)}}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Chế độ tham chiếu"><select id="flow-ref-mode-multi" value={refMode} onChange={e=>{setRefMode(e.target.value);localStorage.setItem("flow_ref_mode",e.target.value)}}><option value="paired">1 ảnh, 1 prompt</option><option value="all">Tham chiếu toàn bộ ảnh</option></select></Field>
<Field label="Chế độ chạy"><select id="flow-run-mode-multi" value={runMode} onChange={e=>{setRunMode(e.target.value);localStorage.setItem('flow_run_mode',e.target.value)}}><option value="single">Chạy từng prompt một</option><option value="continuous_submit_only">Chạy liên tục - tải theo lô 3 prompt</option></select></Field><Field label="Giãn cách prompt"><input id="flow-spacing" value={spacing} onChange={e=>{setSpacing(e.target.value);localStorage.setItem('flow_spacing',e.target.value)}}/></Field></div>
          <div className="profile-grid">{profiles.map((pr:any,i:number)=><div className="profile-card" key={i}><Field label={`Tên profile ${i+1}`}><input value={pr.name} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,name:e.target.value}:x))}/></Field><Field label="Email / nhãn tài khoản Veo 3"><input value={pr.accountEmail||''} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,accountEmail:e.target.value}:x))} placeholder="email Google hoặc tên tài khoản"/></Field><div className="actions mini-actions"><Button onClick={()=>openProfileLogin(i)}>🌐 Mở profile đăng nhập</Button><Button onClick={()=>pickProfilePrompt(i)}>📄 Chọn file text prompt</Button><Button onClick={()=>pickProfileRefs(i)}>🖼 Chọn thư mục ảnh</Button></div><Field label="Tham chiếu"><select value={pr.refMode||"paired"} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,refMode:e.target.value}:x))}><option value="paired">1 ảnh, 1 prompt</option><option value="all">Toàn bộ ảnh</option></select></Field><p className="hint">File prompt: {pr.promptFile||'chưa chọn'}<br/>Thư mục ảnh: {pr.refsDir||'chưa chọn'}</p><Field label="Kịch bản / prompt cho profile này"><textarea value={pr.script} onChange={e=>setProfiles(p=>p.map((x,k)=>k===i?{...x,script:e.target.value}:x))} placeholder="Có thể nhập trực tiếp, hoặc chọn file text prompt ở trên"/></Field></div>)}</div>
          <div className="form4"><Field label="Auto tải ảnh/video"><label className="switch"><input type="checkbox" checked={autoDownload} onChange={e=>{setAutoDownload(e.target.checked);localStorage.setItem('flow_auto_download',String(e.target.checked))}}/><span>{autoDownload?'Bật':'Tắt'}</span></label><small className="field-note">Ảnh và video hoàn tất được tự lưu vào thư mục đã cấu hình; chế độ liên tục tải theo lô 3 prompt.</small></Field></div><div className="actions"><Button variant="primary" onClick={async()=>{append('Đang chạy đa luồng profile...'); append(await api().start({...runPayload(undefined,{autoDownload}),flowThreads:String(profiles.length),profiles}))}}>🚀 Chạy đa luồng profile</Button><Button variant="danger" onClick={stop}>⏹ Stop tất cả</Button></div>
        </Card>
      </div>}
      {page==='post'&&<div className="post-page">
        <div className="grid">
          <Card title="Nguồn video & chế độ hậu kì" icon={<Film/>}>
            <div className="actions"><Button onClick={pickVideoFolder}>📁 Chọn thư mục chứa video</Button><Button onClick={async()=>{if(videoFolder){const x=await api().videoList(videoFolder); setVideoFiles(x?.files||[]); append('Đã làm mới danh sách video')}}}>🔄 Làm mới</Button></div>
            <p className="hint">Thư mục: {videoFolder||'chưa chọn'}<br/>Số video: {videoFiles.length}</p>
            <div className="form4"><Field label="Chế độ"><input readOnly value="AI tự phân tích & ghép hậu kì tự động"/></Field><Field label="Chuyển cảnh mặc định"><select value={defaultTransition} onChange={e=>{setDefaultTransition(e.target.value);localStorage.setItem('post_default_transition',e.target.value)}}>{transitionOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Tỉ lệ xuất"><select value={postAspect} onChange={e=>{setPostAspect(e.target.value);localStorage.setItem('post_aspect',e.target.value)}}><option value="auto">Tự động</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></Field><Field label="Zoom/Crop"><select value={postZoom} onChange={e=>{setPostZoom(e.target.value);localStorage.setItem('post_zoom',e.target.value)}}><option value="fit">Fit toàn khung</option><option value="fill">Zoom lấp đầy + crop giữa</option></select></Field><Field label="Tốc độ video"><select value={postSpeed} onChange={e=>{setPostSpeed(e.target.value);localStorage.setItem('post_speed',e.target.value)}}>{['0.5','0.75','1','1.25','1.5','2'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Audio chèn"><input readOnly value={audioFile||'chưa chọn'}/></Field></div>
            <Field label="Kịch bản / mô tả thứ tự cảnh"><textarea value={postScript} onChange={e=>setPostScript(e.target.value)} placeholder="Dán kịch bản video để AI phân tích video và sắp xếp đúng cảnh"/></Field>
            <div className="form4"><Field label="Tự động tạo sub bằng AI"><label className="switch"><input type="checkbox" checked={autoSub} onChange={e=>setAutoSub(e.target.checked)}/><span>{autoSub?'Bật':'Tắt'}</span></label></Field><Field label="Ngôn ngữ sub"><select value={subLang} onChange={e=>setSubLang(e.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="zh">中文</option><option value="ko">한국어</option><option value="ja">日本語</option></select></Field><Field label="Font sub"><select value={subFont} onChange={e=>setSubFont(e.target.value)}>{subtitleFonts.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Màu chữ"><input type="color" value={subColor} onChange={e=>setSubColor(e.target.value)}/></Field><Field label="Cỡ chữ"><input value={subSize} onChange={e=>setSubSize(e.target.value.replace(/[^0-9]/g,''))}/></Field><Field label="File SRT/ASS tùy chọn"><input readOnly value={srtFile||'chưa chọn'}/></Field><Field label="Nhạc nền"><input readOnly value={musicFile||'chưa chọn'}/></Field><Field label={`Âm lượng nhạc nền ${musicVolume}%`}><input type="range" min="0" max="100" value={musicVolume} onChange={e=>{const v=Number(e.target.value);setMusicVolume(v);localStorage.setItem('post_music_volume',String(v))}}/></Field><Field label="Tách/bỏ âm thanh gốc"><label className="switch"><input type="checkbox" checked={removeOriginalAudio} onChange={e=>setRemoveOriginalAudio(e.target.checked)}/><span>{removeOriginalAudio?'Video xuất không có âm gốc':'Giữ âm gốc'}</span></label></Field></div><div className="actions"><Button variant="primary" onClick={aiPostPlan}>🤖 AI phân tích từng cảnh + tạo sub</Button><Button onClick={pickSrt}>💬 Chọn file SRT/ASS</Button><Button onClick={pickMusic}><Music size={16}/> Chọn nhạc nền</Button><Button onClick={pickAudio}><Music size={16}/> Chọn âm thanh chèn</Button><Button onClick={extractAudio}>🎧 Tách âm video đầu tiên</Button></div>
          </Card>
          <Card title="Danh sách video" icon={<Scissors/>}><div className="video-list">{videoFiles.map((f,i)=><div key={f} className="video-item video-preview-row"><video src={`file://${f}`} muted controls preload="metadata"/><div><b>{String(i+1).padStart(2,'0')}</b><span>{f.split(/[\\/]/).pop()}</span></div></div>)}</div></Card>
        </div>
        <Card title="Preview timeline / kéo thả sắp xếp cảnh" icon={<Scissors/>}>
          <div className="timeline-editor">{baseTimeline().map((sc:any,i:number)=><div key={sc.id||sc.file||i} className={sc.keep===false?'scene-card muted':'scene-card'}><div className="scene-thumb"><video src={`file://${sc.file}`} muted controls preload="metadata"/></div><div className="scene-info"><b>Scene {i+1} • {sc.name||String(sc.file||'').split(/[\\/]/).pop()}</b><span>{sc.reason||sc.note||'Sẵn sàng ghép'}</span><label className="scene-transition"><small>Chuyển cảnh sau cảnh này</small><select value={sc.transition||defaultTransition} onChange={e=>setSceneTransition(i,e.target.value)}>{transitionOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><div className="scene-actions"><button onClick={()=>moveScene(i,-1)}>↑</button><button onClick={()=>moveScene(i,1)}>↓</button><button onClick={()=>toggleScene(i)}>{sc.keep===false?'Khôi phục':'Xóa cảnh'}</button></div></div>)}</div>
          <p className="hint">Chỉ dùng hậu kì video bằng AI: AI phân tích từng cảnh, tự cắt đoạn thừa/lỗi, sắp xếp theo kịch bản và chèn subtitle nếu bật.</p><div className="actions"><Button variant="primary" onClick={exportPost}>📤 Xuất hậu kì video bằng AI</Button></div>
          <p className="hint">AI có thể đánh dấu cảnh không phù hợp để bỏ qua. Chế độ thủ công cho phép sắp xếp bằng nút ↑ ↓ và xóa/khôi phục cảnh trước khi xuất.</p>
        </Card>
      </div>}
            {page==='status'&&<div className="run-status-page"><div className="run-status-head"><div><b>{outputTimeline.running?'Đang chạy':'Theo dõi tiến trình toàn ứng dụng'}</b><span>{outputTimeline.progress?.total?`Prompt ${outputTimeline.progress.current||outputTimeline.progress.done}/${outputTimeline.progress.total}`:'Timeline tự cập nhật mỗi hai giây'}</span></div><div className="actions"><Button onClick={addStatusFolders}>Chọn nhiều thư mục/profile</Button><Button variant="primary" onClick={quickMergeAll}>Ghép nhanh tất cả</Button><Button onClick={()=>outputTimeline.dir&&api().openPath(outputTimeline.dir)}>Mở thư mục download</Button></div></div><div className="status-quick-config"><Field label="Hiệu ứng giữa mỗi prompt"><select value={quickTransition} onChange={e=>{setQuickTransition(e.target.value);localStorage.setItem('status_quick_transition',e.target.value)}}>{transitionOptions.filter(x=>x[0]!=='ai').map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Auto Sub + dịch"><label className="switch"><input type="checkbox" checked={quickAutoSub} onChange={e=>{setQuickAutoSub(e.target.checked);localStorage.setItem('status_quick_auto_sub',String(e.target.checked))}}/><span>{quickAutoSub?'Bật':'Tắt'}</span></label></Field><Field label="Tỉ lệ video"><select value={quickAspect} onChange={e=>{setQuickAspect(e.target.value);localStorage.setItem('status_quick_aspect',e.target.value)}}><option value="auto">Tự động</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></Field><Field label="Zoom/Crop"><select value={quickZoom} onChange={e=>{setQuickZoom(e.target.value);localStorage.setItem('status_quick_zoom',e.target.value)}}><option value="fit">Fit toàn khung</option><option value="fill">Zoom lấp đầy + crop giữa</option></select></Field><Field label="Tốc độ"><select value={quickSpeed} onChange={e=>{setQuickSpeed(e.target.value);localStorage.setItem('status_quick_speed',e.target.value)}}>{['0.5','0.75','1','1.25','1.5','2'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Ngôn ngữ sub"><select value={quickSubLang} onChange={e=>{setQuickSubLang(e.target.value);localStorage.setItem('status_quick_sub_lang',e.target.value)}}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select></Field></div>{!statusProfiles.length&&<div className="output-timeline">{outputTimeline.items?.length?outputTimeline.items.map((item:any,i:number)=><React.Fragment key={`${item.prompt}-${item.file}`}><div className="output-step"><div className="output-square">{item.kind==='video'?<video src={item.url} controls muted preload="metadata"/>:<img src={item.url}/>}</div><b>Prompt {item.prompt}</b><span>{item.name}</span></div>{i<outputTimeline.items.length-1&&<div className="output-arrow">→</div>}</React.Fragment>):<div className="timeline-empty">Chưa có output. Có thể chọn tối đa 100 thư mục profile.</div>}</div>}{!statusProfiles.length&&outputTimeline.merged&&<div className="merged-preview"><b>Preview video vừa ghép</b><video src={outputTimeline.mergedUrl||`file://${outputTimeline.merged}`} controls preload="metadata"/><span>{outputTimeline.merged}</span></div>}{!statusProfiles.length&&outputTimeline.dir&&<div className="actions"><Button variant="primary" onClick={()=>quickMergeProfile({id:'default',name:'Thư mục download',dir:outputTimeline.dir})}>Ghép video nhanh thư mục hiện tại</Button></div>}<div className="status-profile-list">{statusProfiles.map((profile:any)=><section className="status-profile" key={profile.id}><div className="status-profile-head"><div><b>{profile.name}</b><span>{profile.dir}</span></div><div className="actions"><Button onClick={()=>api().openPath(profile.dir)}>Mở thư mục</Button><Button variant="primary" onClick={()=>quickMergeProfile(profile)}>Ghép video nhanh</Button><Button variant="danger" onClick={()=>removeStatusProfile(profile.id)}>Xóa</Button></div></div><div className="output-timeline compact">{profile.timeline?.items?.length?profile.timeline.items.map((item:any,i:number)=><React.Fragment key={`${item.prompt}-${item.file}`}><div className="output-step"><div className="output-square">{item.kind==='video'?<video src={item.url} controls muted preload="metadata"/>:<img src={item.url}/>}</div><b>Prompt {item.prompt}</b><span>{item.name}</span></div>{i<profile.timeline.items.length-1&&<div className="output-arrow">→</div>}</React.Fragment>):<div className="timeline-empty">Đang chờ video tải về trong profile này…</div>}</div>{profile.merged&&<div className="merged-preview"><b>Preview video vừa ghép</b><video src={profile.mergedUrl||`file://${profile.merged}`} controls preload="metadata"/><span>{profile.merged}</span></div>}</section>)}</div></div>}
            {page==='dance'&&<div className="dance-studio"><div className="grid"><Card title="Nguồn chuyển động và người mẫu" icon={<Music/>}><Field label="Video mẫu điệu nhảy"><input readOnly value={danceVideo||'Chưa chọn video'}/></Field><Field label="Ảnh nhân vật/người mẫu"><input readOnly value={danceModelImage||'Chưa chọn ảnh'}/></Field><div className="actions"><Button onClick={pickDanceVideo}>Chọn video mẫu</Button><Button onClick={pickDanceModel}>Chọn ảnh người mẫu</Button><Button onClick={extractDanceAudio}>Xuất âm thanh gốc MP3</Button></div><p className="hint">Chỉ sử dụng video và hình ảnh mà người dùng có quyền sử dụng. AI phân tích timing, tư thế, hướng chuyển động và biểu cảm; kết quả tạo sinh có thể có sai số nhỏ so với từng khung hình gốc.</p></Card><Card title={`Bộ trang phục (${danceOutfits.length}/100)`} icon={<ImagePlus/>}><div className="outfit-rows">{danceOutfits.map((o,i)=><div className="outfit-row" key={o.id}><b>Bộ {i+1}</b><span>{o.files?.length?o.files.map((f:string)=>f.split(/[\\/]/).pop()).join(', '):'Chưa chọn quần áo/phụ kiện'}</span><Button onClick={()=>pickDanceOutfit(i)}>Chọn ảnh</Button>{danceOutfits.length>1&&<button className="btn" onClick={()=>setDanceOutfits(x=>x.filter((_,k)=>k!==i))}>Xóa</button>}</div>)}</div><button className="add-outfit" onClick={addDanceOutfit} disabled={danceOutfits.length>=100}>＋ Thêm bộ trang phục</button></Card></div><Card title="Model và cấu hình chạy Dance" icon={<Film/>}><div className="form4"><Field label="Model phân tích AI"><select value={danceApiModel} onChange={e=>setDanceApiModel(e.target.value)}>{geminiApiModels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></Field><Field label="Chế độ tạo"><select value={danceMode} onChange={e=>changeDanceMode(e.target.value)}><option value="createvideo">Tạo video</option><option value="createimage">Tạo ảnh thay trang phục</option></select></Field><Field label="Model Flow"><select value={danceModel} onChange={e=>setDanceModel(e.target.value)}>{modelsForMode(danceMode).map(x=><option key={x} value={x}>{flowModelLabel(x)}</option>)}</select></Field><Field label="Tỉ lệ"><select value={danceRatio} onChange={e=>setDanceRatio(e.target.value)}>{ratios.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Thời lượng mỗi prompt"><select value={danceDuration} onChange={e=>setDanceDuration(e.target.value)} disabled={danceMode==='createimage'}>{['4s','6s','8s','10s'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Số output"><select value={danceCount} onChange={e=>setDanceCount(e.target.value)}>{['1','2','3','4'].map(x=><option key={x} value={x}>{x}x</option>)}</select></Field><Field label="Ngôn ngữ prompt"><select value={dancePromptLang} onChange={e=>setDancePromptLang(e.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select></Field><Field label="Chế độ chạy"><select value={danceRunMode} onChange={e=>setDanceRunMode(e.target.value)}><option value="single">Từng prompt</option><option value="continuous_submit_only">Liên tục, tải lô 3 prompt</option></select></Field><Field label="Tự động tải"><label className="switch"><input type="checkbox" checked={danceAutoDownload} onChange={e=>setDanceAutoDownload(e.target.checked)}/><span>{danceAutoDownload?'Bật':'Tắt'}</span></label></Field><Field label="Thư mục tải"><input readOnly value={danceDownloadDir||'Downloads mặc định'}/></Field></div><div className="actions"><Button onClick={syncDanceSettings}>Đồng bộ cấu hình hiện tại</Button><Button onClick={pickDanceDownloadDir}>Chọn thư mục tải</Button><Button onClick={saveDanceSettings}>Lưu cấu hình Dance</Button></div></Card><Card title="AI phân tích và tạo prompt hàng loạt" icon={<Wand2/>}><p>AI tự phân loại áo, quần/váy, giày dép, mũ/nón, kính và phụ kiện; chỉ thay trang phục, giữ các đặc điểm ngoại hình và tỷ lệ cơ thể quan sát được của người mẫu.</p><div className="actions"><Button variant="primary" onClick={createWardrobeBatch}><ImagePlus size={16}/> Tạo ảnh trang phục hàng loạt</Button><Button variant="primary" onClick={generateDancePrompts}>Phân tích điệu nhảy + tạo prompt</Button><Button variant="primary" onClick={runDanceFlow}><Play size={16}/> Chạy prompt Dance trên Flow</Button><Button variant="danger" onClick={stop}><Square size={16}/> Dừng</Button></div><textarea className="dance-result" value={danceResult} onChange={e=>setDanceResult(e.target.value)} placeholder="Prompt từng đoạn chuyển động và từng bộ trang phục sẽ xuất hiện tại đây"/></Card></div>}
            {page==='payment'&&<div className="payment-page payment-single"><Card title={T('Thanh toán','Payment')} icon={<CreditCard/>}><div className="pay-info single"><div className="pay-block"><h3>USDT ETH</h3><p><b>{T('Người nhận','Receiver')}:</b> PHAM VAN VUONG</p><p><b>1.200.000 VNĐ / Vĩnh Viễn</b></p><p><b>{T('Ví USDT mạng ETH','USDT wallet on ETH network')}:</b><br/><code>0xcbcf357d5d2f5165c544d0ba1d520dbaaaef11c7</code></p><p>{T('Nội dung chuyển khoản','Transfer note')}: <b>FLOWAUTO + SĐT</b></p></div><div className="pay-contact"><b>{T('Hỗ trợ cấp key','Key/support contact')}</b><br/>Zalo: 0989139295<br/>Telegram: https://t.me/flowautotool<br/><span>{T('Sau khi thanh toán, gửi Machine ID cho admin để nhận key.','After payment, send Machine ID to admin to receive your key.')}</span></div></div></Card><Card title="QR USDT ETH - PHAM VAN VUONG" icon={<CreditCard/>}><img className="qr qr-huge" src="assets/subscription_qr.png"/></Card></div>}
            {page==='license'&&<div className="grid"><Card title="License hiện tại" icon={<KeyRound/>}><div className="license-box">{licenseText}</div><Field label="Machine ID - gửi mã này cho admin để lấy key kích hoạt"><div className="machine-row"><input readOnly value={machineId}/><Button onClick={()=>{navigator.clipboard?.writeText(machineId); append('Đã copy Machine ID')}}>Copy</Button></div></Field><div className="actions"><Button variant="primary" onClick={checkLicense}>🔄 Cập nhật trạng thái license</Button></div></Card><Card title="Kích hoạt online" icon={<KeyRound/>}><p>Nhập key admin gửi để kích hoạt.</p><Field label="License key admin gửi"><input value={licenseKey} onChange={e=>setLicenseKey(e.target.value)} placeholder="Nhập key kích hoạt"/></Field><div className="actions"><Button variant="primary" onClick={activateLicense}>🔐 Kích hoạt online</Button></div><div className="pricing"><div><b>1.200.000 VNĐ</b><span>/ vĩnh viễn</span></div></div><p>Zalo: 0989139295<br/>Telegram: https://t.me/flowautotool</p></Card></div>}

    
</main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>);
