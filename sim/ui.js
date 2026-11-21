/* ============================================================
   TNC 426 / 430 SIMULATOR — UI
   Loads after: THREE, OrbitControls, engine.js (TNC, TNC_SIM, TNC_STOCK), programs.js,
   lessons.js, and when present: tools3d.js, callouts.js, flow.js,
   fx.js, m430/*, ai.js, JSZip.  Optional modules degrade gracefully.
   ============================================================ */
(function(){
'use strict';

/* ================= basics ================= */
const $=id=>document.getElementById(id);
const T=k=>window.TNC_I18N?TNC_I18N.t(k):k;           // shell text (i18n.js SHELL)
const TR=m=>window.TNC_I18N?TNC_I18N.tr(m):m;         // UPPERCASE control text (i18n.js TR)
/* text written here in English, shown in the interface language (i18n.js TX); v fills {name} places */
const X=(m,v)=>window.TNC_I18N?TNC_I18N.x(m,v):(v?m.replace(/\{(\w+)\}/g,(a,k)=>v[k]==null?a:String(v[k])):m);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const SET=window.TNC_SETTINGS||null;                    // presentation settings (settings.js, "tnc.settings.v1")
const LANG=()=>window.TNC_I18N?TNC_I18N.lang:'en';
const LOCALES=(SET&&SET.LOCALES)||{en:{html:'en',name:'English',comma:false}};
let REDUCED=SET?SET.reducedMotion():matchMedia('(prefers-reduced-motion: reduce)').matches;   // follows Settings › Motion

const toastEl=$('toast');
function say(msg){ toastEl.textContent=window.TNC_I18N?TNC_I18N.toast(msg):msg; toastEl.classList.add('on');   // toasts are written in English and translated here
  clearTimeout(say._t); say._t=setTimeout(()=>toastEl.classList.remove('on'),1900); }

/* prose from lessons: **bold**, `code`, blank-line paragraphs, "- " bullets */
function md(text){
  const inl=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return String(text||'').trim().split(/\n\s*\n/).map(par=>{
    const out=[]; let ul=[];
    par.split('\n').forEach(l=>{
      if(/^\s*- /.test(l)) ul.push('<li>'+inl(l.replace(/^\s*- /,''))+'</li>');
      else { if(ul.length){ out.push('<ul>'+ul.join('')+'</ul>'); ul=[]; } if(l.trim()) out.push('<p>'+inl(l)+'</p>'); }
    });
    if(ul.length) out.push('<ul>'+ul.join('')+'</ul>');
    return out.join('');
  }).join('');
}

/* Every download goes to TNC-SIMULATOR/<AI-GEN|USER-GEN|SETTINGS|TOOL-TABLES>/. Browsers that can write
   into a folder (Chrome, Edge) do it after the Downloads folder is picked once; others (Firefox) get the
   folder as a name prefix: TNC-SIMULATOR_AI-GEN_PART.H */
const DL_ROOT='TNC-SIMULATOR'; let dlDir=null;
async function dlDirGet(ask){
  if(dlDir) return dlDir;
  try{ const h=window.idbKeyval&&await idbKeyval.get('tnc.dldir'); if(h){ let st=await h.queryPermission({mode:'readwrite'}); if(st!=='granted'&&ask) st=await h.requestPermission({mode:'readwrite'}); if(st==='granted') dlDir=h; } }catch(e){}
  return dlDir;
}
async function pickDlDir(){
  if(!window.showDirectoryPicker){ say('THIS BROWSER CANNOT WRITE INTO A FOLDER — FILES GO TO DOWNLOADS NAMED '+DL_ROOT+'_…'); return false; }
  try{ dlDir=await showDirectoryPicker({id:'tnc-downloads',mode:'readwrite',startIn:'downloads'}); if(window.idbKeyval) await idbKeyval.set('tnc.dldir',dlDir); say('SAVING INTO '+dlDir.name+'/'+DL_ROOT); return true; }catch(e){ return false; }
}
function download(name, blob, kind){
  kind=kind||'USER-GEN';
  (async()=>{ const d=await dlDirGet(true);
    if(d){ try{ const root=await d.getDirectoryHandle(DL_ROOT,{create:true}), sub=await root.getDirectoryHandle(kind,{create:true});
      const fh=await sub.getFileHandle(name,{create:true}), w=await fh.createWritable(); await w.write(blob); await w.close(); say('SAVED '+DL_ROOT+'/'+kind+'/'+name); return; }catch(e){} }
    dlPlain(DL_ROOT+'_'+kind+'_'+name, blob); })();
}
function dlPlain(name, blob){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}

/* ================= storage: programs & projects in localStorage, prefs in a cookie ================= */
const LS_KEY='tnc426.v1';
const local={ get:k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } },
              set:(k,v)=>{ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } },
              del:k=>{ try{ localStorage.removeItem(k); }catch(e){} } };
const sess ={ get:k=>{ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
              set:(k,v)=>{ try{ sessionStorage.setItem(k,v); }catch(e){} },
              del:k=>{ try{ sessionStorage.removeItem(k); }catch(e){} } };

const PREF='tnc426_prefs';
function readPrefs(){
  try{ const m=document.cookie.match(/(?:^|;\s*)tnc426_prefs=([^;]*)/); return m?JSON.parse(decodeURIComponent(m[1])):{}; }
  catch(e){ return {}; }
}
function writePrefs(){
  try{
    const v=encodeURIComponent(JSON.stringify({speed:S.speed, ovr:S.ovr, view:S.view, mode:S.mode, fx:S.fx,
      cool:S.fxCool, fire:S.fxFire, labels:S.labels, vice:S.vice, sound:S.sound, machine:S.machine, flow:S.flowView, side:S.sideTab, ref:S.ref}));
    const path=location.pathname.replace(/[^/]*$/,'')||'/';
    document.cookie=`${PREF}=${v}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  }catch(e){}
  if(PROF) persist();
}
const prefsNow=()=>({speed:S.speed, ovr:S.ovr, view:S.view, mode:S.mode, fx:S.fx, cool:S.fxCool, fire:S.fxFire, labels:S.labels, vice:S.vice, sound:S.sound, machine:S.machine, flow:S.flowView, side:S.sideTab, ref:S.ref});

/* per-edition preferences: "tnc.edition.<edition>.v1" (docs/BUILD_STATE.md). Other fields in it are kept as they are. */
const ED_LS='tnc.edition.'+((SET&&SET.edition)||'core')+'.v1';
function edPref(){ try{ const o=JSON.parse(local.get(ED_LS)||'{}'); return o&&typeof o==='object'&&!Array.isArray(o)?o:{}; }catch{ return {}; } }
function edSet(k,v){ const o=edPref(); o[k]=v; local.set(ED_LS,JSON.stringify(o)); }

/* ================= machines ================= */
/* showcase programs: window.TNC_SHOWCASE = {manifest, sources:{FILE.H:text}}. An entry may name its machines
   ("machines":["430"] or "machine":"430"); without one it is offered on both. */
const SHOWCASE=(()=>{ const sc=window.TNC_SHOWCASE; if(!sc||!sc.sources) return {list:[],by:{}};
  const man=Array.isArray(sc.manifest)?sc.manifest:((sc.manifest&&(sc.manifest.programs||sc.manifest.items))||[]), list=[], by={};
  const upper=n=>String(n).split(/[\\/]/).pop().toUpperCase().replace(/\.[HI]$/,'')+'.H';
  Object.keys(sc.sources).sort().forEach(f=>{ const e=man.find(m=>m&&upper(m.file||m.name||m.id||'')===upper(f))||{};
    const ms=[].concat(e.machines||e.machine||[]).map(String).filter(m=>m==='426'||m==='430');
    const it={name:upper(f),text:String(sc.sources[f]).replace(/\r/g,'').trim(),machines:ms.length?ms:['426','430'],entry:e}; list.push(it); by[it.name]=it; });
  return {list,by}; })();
const showcaseFor=id=>{ const o={}; SHOWCASE.list.forEach(it=>{ if(it.machines.includes(id)) o[it.name]=it.text; }); return o; };
const MACHINES={
  '426':{ id:'426', label:'TNC 426', axes:['X','Y','Z'], tools:TNC.TOOLS,
    run:t=>TNC.run(t,{tools:mtools('426'),holder:holderOpt('426'),programs:S.pgms['426'],keepGoing:KEEPGOING()}), expand:r=>TNC_SIM.expand(r),
    analyse:(r,ex)=>TNC_SIM.analyse(r,ex,TNC_SIM.grid(r.stock,ex.segs)),
    programs:Object.assign({},window.TNC_PROGRAMS||{},showcaseFor('426')), lessons:window.TNC_LESSONS||null }
};
/* TNC 430: the operator's machine parameters live in machines.js (shared with the server's engine). */
const MACHINE_430=(window.TNC_MACHINE_CONFIGS||{})['430']||{};
MACHINES['430']={ id:'430', label:'TNC 430', axes:['X','Y','Z','B','A'], tools:TNC.TOOLS, machine:MACHINE_430,
  run:t=>TNC.run(t,{tools:mtools('430'),machine:MACHINE_430,holder:holderOpt('430'),programs:S.pgms['430'],keepGoing:KEEPGOING()}), expand:r=>TNC_SIM.expand(r),
  analyse:(r,ex)=>TNC_SIM.analyse(r,ex,TNC_SIM.grid(r.stock,ex.segs)),
  programs:Object.assign({},window.TNC_PROGRAMS||{},showcaseFor('430')), lessons:window.TNC_LESSONS||null };
Object.keys(window.TNC_MACHINES||{}).forEach(k=>{ MACHINES[k]=window.TNC_MACHINES[k]; });
const M=()=>MACHINES[S.machine];
/* "continue after errors" (settings keepgoing, default off = as the control): the engine runs past its own stops and a crash
   no longer holds the feed; every error and crash is still listed, marked on its block and raised as an alarm */
function KEEPGOING(){ try{ return !!(window.TNC_SETTINGS&&TNC_SETTINGS.get('keepgoing')); }catch(e){ return false; } }

/* ================= state ================= */
const P=readPrefs();
const S={
  machine: MACHINES[edPref().machine]?edPref().machine:(MACHINES[P.machine]?P.machine:'426'),   // the edition's own choice first (a file:// page has no cookie)
  pgms:{}, orig:{}, cur:{}, tools:{}, meta:{}, mset:{}, projects:[], active:null, pgm:null, text:'',
  res:null, ex:{segs:[],total:0}, segs:[], total:0, events:[], evIdx:0,
  t:0, stampT:0, running:false,
  speed:[1,4,16,64,0].includes(P.speed)?P.speed:4, ovr:clamp(+P.ovr||100,0,150),
  mode:['edit','test','single','full'].includes(P.mode)?P.mode:'test',
  view:['3D','TOP','FRONT','SIDE'].includes(P.view)?P.view:'3D',
  cursor:0, editing:false, raw:false, mgt:false, mgtSel:0, flowView:!!P.flow,
  fx:P.fx!==undefined?!!P.fx:!REDUCED, fxCool:P.cool!==undefined?!!P.cool:true, fxFire:!!P.fire,
  labels:P.labels!==undefined?!!P.labels:true, vice:P.vice!==undefined?!!P.vice:true, sound:SET?!!SET.get('sound'):(P.sound!==undefined?!!P.sound:true),
  /* insp = the inspector flyout over the view: closed by default; open = shown, pinned = stays open when the pointer leaves */
  cmpRef:null, pos:null, seg:null, shake:0, lesson:null, focus:null, insp:{open:false,pinned:false}, lock:null, cam:null, cutting:false, sideTab:P.side==='ref'?'ref':'diag', ref:P.ref||'keys', pickPath:null, execB:-1, wiz:null, pick:null, tt:false
};
const TEMP='LESSON.H';
const pg=()=>{ if(!S.pgms[S.machine]) S.pgms[S.machine]={}; return S.pgms[S.machine]; };

/* ---------- the operator profile (profile.js): IndexedDB, autosaved, exported by hand ---------- */
const PSTORE=window.TNC_PROFILE||{ load:()=>Promise.resolve(null), save:()=>Promise.resolve(false), wipe:()=>Promise.resolve(),
  blank:n=>({v:2,name:n||'',created:new Date().toISOString(),prefs:{},machines:{},projects:[],active:null}), legacy:()=>null };
let PROF=null;
/* the machine's tool table: built-ins, overridden / extended by the operator's own TOOL.T */
/* TOOL HOLDER LENGTH: the gauge length used for every tool with L = 0 (length measured on the machine) */
const mset=id=>(S.mset[id||S.machine]=S.mset[id||S.machine]||{holderLen:150,holderType:'ISO50'});
function holderOpt(id){ const m=mset(id); if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(m.holderType);
  return { stack:r=>window.TNC_TOOLS3D&&TNC_TOOLS3D.holderStack?TNC_TOOLS3D.holderStack(r):(m.holderType==='SK40'?70:100) }; }
function mtools(id){ id=id||S.machine; const base=(MACHINES[id]&&MACHINES[id].tools)||[], mine=S.tools[id]||[];
  const by={}; base.forEach(t=>{ by[t.t]=Object.assign({},t); }); mine.forEach(t=>{ by[t.t]=Object.assign({},t,{mine:true}); });
  return Object.values(by).sort((a,b)=>a.t-b.t); }

function loadStore(){
  const j=PROF||PSTORE.blank('');
  for(const id in MACHINES){
    const mm=(j.machines&&j.machines[id])||{};
    S.orig[id]=Object.assign({}, MACHINES[id].programs||{});
    S.pgms[id]=Object.assign({}, S.orig[id], mm.pgms||{});
    S.tools[id]=Array.isArray(mm.tools)?mm.tools:[];
    S.cur[id]=mm.cur||null;
    S.meta[id]=mm.meta||{};
    S.mset[id]=Object.assign({holderLen:150,holderType:'ISO50'},mm.settings||{});
  }
  S.projects=Array.isArray(j.projects)?j.projects:[];
  S.active=S.projects.some(p=>p.id===j.active)?j.active:((S.projects[0]||{}).id||null);
  const last=S.cur[S.machine];
  S.pgm=(last&&pg()[last]!=null)?last:(Object.keys(pg())[0]||null);
  if(!S.pgm){ S.pgm='NEW.H'; pg()[S.pgm]='BEGIN PGM NEW MM\nEND PGM NEW MM'; }
  S.text=pg()[S.pgm];
}
function profileNow(){
  if(S.pgm!==TEMP) S.cur[S.machine]=S.pgm;
  const machines={};
  for(const id in S.pgms){ const pg_={};          // only what differs from the built-ins, so fixes to them still arrive
    for(const n in S.pgms[id]) if(n!==TEMP && S.pgms[id][n]!==S.orig[id][n]) pg_[n]=S.pgms[id][n];
    machines[id]={pgms:pg_, cur:S.cur[id]||null, tools:S.tools[id]||[], meta:S.meta[id]||{}, settings:S.mset[id]||{}}; }
  return Object.assign({}, PROF||PSTORE.blank(''), {v:2, machines, projects:S.projects, active:S.active, prefs:prefsNow()});
}
let persistT=0;
function persist(){
  if(!PROF) return;
  clearTimeout(persistT);
  persistT=setTimeout(()=>{ PROF=profileNow(); PSTORE.save(PROF).then(r=>{ profChip(r); }); },300);
}

/* ================= undo / redo (per program) ================= */
const UNDO={}, REDO={};
const ukey=()=>S.machine+':'+S.pgm;
function snapshot(){ const k=ukey(); if(!UNDO[k]) UNDO[k]=[]; UNDO[k].push({text:S.text,cursor:S.cursor});
  if(UNDO[k].length>200) UNDO[k].shift(); REDO[k]=[]; }
function setText(t){ S.text=t; pg()[S.pgm]=t; raw.value=t; touchMeta(S.pgm); compile(); persist(); emit('text',{name:S.pgm,machine:S.machine,text:t}); }
function touchMeta(n,created){ if(!n||n===TEMP) return; if(!S.meta[S.machine]) S.meta[S.machine]={}; const mm=S.meta[S.machine], now=new Date().toISOString();
  if(!mm[n]) mm[n]={c:now,m:now,v:0}; const e=mm[n]; if(created){ e.c=now; e.v=0; } e.m=now; e.v++; }
function edit(t, cur, msg){
  if(t===S.text) return;
  snapshot(); setText(t);
  S.cursor=clamp(cur==null?S.cursor:cur,0,Math.max(0,S.res.blocks.length-1)); markRows(true);
  if(msg) say(msg);
}
function undo(){ const k=ukey(), u=UNDO[k];
  if(!u||!u.length){ say('NOTHING TO UNDO'); return; }
  if(!REDO[k]) REDO[k]=[]; REDO[k].push({text:S.text,cursor:S.cursor});
  const s=u.pop(); setText(s.text); S.cursor=clamp(s.cursor,0,S.res.blocks.length-1); markRows(true);
  say('UNDO · '+u.length+' LEFT'); }
function redo(){ const k=ukey(), r=REDO[k];
  if(!r||!r.length){ say('NOTHING TO REDO'); return; }
  if(!UNDO[k]) UNDO[k]=[]; UNDO[k].push({text:S.text,cursor:S.cursor});
  const s=r.pop(); setText(s.text); S.cursor=clamp(s.cursor,0,S.res.blocks.length-1); markRows(true);
  say('REDO · '+r.length+' LEFT'); }

/* ================= compile ================= */
const DEFAULT_STOCK={x0:0,y0:0,z0:-20,x1:100,y1:80,z1:0};
function compile(){
  const m=M(); let res;
  try{ res=m.run(S.text); }
  catch(e){ res={blocks:[],moves:[],stock:null,stats:{},errors:[{block:0,msg:'INTERNAL: '+e.message}]}; }
  const st=res.stock;
  if(!st||!(st.x1>st.x0)||!(st.y1>st.y0)||!(st.z1>st.z0)) res.stock=Object.assign({},DEFAULT_STOCK);
  S.res=res;
  try{ S.ex=m.expand(res); }catch(e){ S.ex={segs:[],total:0}; }
  S.segs=S.ex.segs; S.total=S.ex.total;
  try{ S.events=(m.analyse(res,S.ex)||[]).slice().sort((a,b)=>a.t-b.t); }catch(e){ S.events=[]; }
  S.evIdx=0; S.t=0; S.stampT=0; S.running=false; S.execB=-1; S.k=0; hideAlarm();
  S.cursor=clamp(S.cursor,0,Math.max(0,res.blocks.length-1));
  buildScene(); if(FXO) FXO.clear();
  $('pgm-path').textContent='TNC:\\'+S.pgm;
  renderList(); renderChecks(); renderKV(); renderCompare(); if(S.mgt) renderMgt(); flowUpdate(); traceFor(S.cursor);
  scrub.value=0; setState(S.mode==='edit'?'EDITING':'READY');
}
const nOf=i=>{ const b=S.res&&S.res.blocks[i]; return b&&b.n!=null?b.n:'--'; };

/* ================= three.js scene ================= */
const canvas=$('gl'), gfxEl=$('gfx');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x0b0b0d);   // applyEnv() sets it from the environment
const camera=new THREE.PerspectiveCamera(40,1,1,6000); camera.up.set(0,0,1);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.09;
/* touch (phones, tablets, touchscreen laptops): one finger orbits, two fingers pinch to zoom and drag to pan; #gl has touch-action:none */
controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
const LK=(+THREE.REVISION>=155)?Math.PI:1;       // r155+: physical light units; x PI keeps the r128 brightness
const hemiL=new THREE.HemisphereLight(0x9fc4ff,0x0a0f18,.6*LK); scene.add(hemiL);
const keyL=new THREE.DirectionalLight(0xffffff,1.35*LK); keyL.position.set(180,-140,260); scene.add(keyL);
const fillL=new THREE.DirectionalLight(0x6fa8ff,.5*LK); fillL.position.set(-200,160,120); scene.add(fillL);

/* ================= plugin bus: optional modules (materials.js, look.js, …) wire in here, never by editing ui.js =================
   A plugin does:  (window.TNC_UI_PLUGINS=window.TNC_UI_PLUGINS||[]).push(ui=>{ ui.on('scene',…) });
   Events: scene {partRoot,stock,gStock,gSkirt,gFloor,rig} · tool {t,entry,group,cutter,holder} · tick dt,{running,cutting,pos,seg}
           crash ev · resize {w,h} · program {name,machine}.   ui.render=(scene,camera)=>… replaces the default render call. */
const BUS={};
const emit=(ev,...a)=>{ (BUS[ev]||[]).forEach(fn=>{ try{ fn(...a); }catch(e){ console.warn('plugin '+ev,e); } }); };
const UIAPI={ THREE, scene, camera, renderer, controls, lights:{key:keyL,fill:fillL},
  on:(ev,fn)=>{ if(!BUS[ev]) BUS[ev]=[]; BUS[ev].push(fn); }, render:null,
  get state(){ return S; }, surfaceAt:(x,y)=>surfaceAt(x,y), say:m=>say(m),
  get program(){ return {name:S.pgm, machine:S.machine, text:S.text}; },
  open:(name,text,o)=>openExternal(name,text,o||{}),
  addProgram:(name,text)=>addPgm(name,text),            // a new program under a free name, opened: what New program does (aigen.js Load)
  /* AI "Change current" (aigen.js Load): the named program gets the new text as ONE undo step, Ctrl+Z gives the original back.
     A program that is gone meanwhile is not recreated over anything: the text opens as a new program instead. */
  changeProgram:(name,text)=>{ if(pg()[name]==null) return addPgm(name,text);
    if(S.editing) endEdit(false); if(S.pgm!==name) openPgm(name); if(S.mode!=='edit') setMode('edit');
    edit(text,0,'AI CHANGED '+name+' — CTRL+Z UNDOES IT'); return name; },
  /* bridge v2 (bridge.js): everything goes through the simulator's own controls */
  exec:cmd=>({start:ncStart,stop:stop,step:stepBlock,reset:reset}[cmd]||(()=>{}))(),
  lock:(on,reason)=>setLock(on,reason), cameraPreset:v=>camPreset(v), setMachine:id=>setMachine(id),
  tools:{ get:()=>mtools().map(t=>({t:t.t,name:t.name,l:t.l,r:t.r})), set:list=>setTools(list) },
  inspect:panel=>inspPanel(panel),
  /* ---- the profile sheet (sheet.js) and the text editor (editor.js). Added entries only: each one reuses the functions above. ---- */
  library:{
    /* every program on every machine: own = yours or a changed built-in; meta {c created, m edited, v versions, o last opened} */
    list:()=>{ const out=[]; for(const m in S.pgms) for(const n in S.pgms[m]){ if(n===TEMP) continue; const t=S.pgms[m][n], o=(S.orig[m]||{})[n];
      out.push({machine:m, label:(MACHINES[m]||{}).label||m, name:n, bytes:String(t).length, builtin:o!=null, changed:o!=null&&t!==o, own:o==null||t!==o,
        meta:Object.assign({},(S.meta[m]||{})[n]||{}), current:m===S.machine&&n===S.pgm}); } return out; },
    text:(m,n)=>{ const p=S.pgms[m||S.machine]; return p&&p[n]!=null?p[n]:null; },
    machines:()=>Object.values(MACHINES).map(x=>({id:x.id,label:x.label})),
    open:(m,n)=>{ m=m||S.machine; if(!S.pgms[m]||S.pgms[m][n]==null) return false; if(S.editing) endEdit(false); if(S.raw) toggleRaw();
      if(m!==S.machine) setMachine(m); if(S.pgm!==n) openPgm(n); return true; },
    /* last opened: kept in the program's meta, so "last used" survives a reload */
    stamp:(m,n)=>{ if(!n||n===TEMP||!S.pgms[m]||S.pgms[m][n]==null) return; const mm=S.meta[m]=S.meta[m]||{}, now=new Date().toISOString();
      if(!mm[n]) mm[n]={c:null,m:null,v:0}; mm[n].o=now; persist(); },
    /* text saved under a name (the editor's Save): an existing program gets it as one undo step, a new name is created; it becomes the active program */
    save:(m,n,text)=>{ m=MACHINES[m]?m:S.machine; text=String(text).replace(/\r/g,'');
      n=String(n||'PGM').toUpperCase().replace(/\.[HI]$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)+'.H';
      if(S.editing) endEdit(false); if(S.raw) toggleRaw(); if(m!==S.machine) setMachine(m);
      const had=pg()[n];
      if(had==null){ pg()[n]=text; touchMeta(n,true); openPgm(n); return n; }
      if(S.pgm===n){ if(text!==S.text) edit(text,S.cursor); return n; }
      if(had!==text){ const k=S.machine+':'+n; (UNDO[k]=UNDO[k]||[]).push({text:had,cursor:0}); REDO[k]=[]; pg()[n]=text; touchMeta(n); }
      openPgm(n); return n; },
    create:(name,text)=>addPgm(name,text||`BEGIN PGM ${String(name||'PGM').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,16)} MM\nEND PGM ${String(name||'PGM').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,16)} MM`),
    /* your own programs only (a built-in keeps its name); the file is renamed, the text is not touched. Returns the new name or {error} */
    rename:(m,n,to)=>{ const p=S.pgms[m]; if(!p||p[n]==null) return {error:'missing'}; if((S.orig[m]||{})[n]!=null) return {error:'builtin'};
      to=String(to||'').toUpperCase().replace(/\.[HI]$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16); if(!to) return {error:'empty'}; to+='.H';
      if(to===n) return to; if(p[to]!=null) return {error:'exists'};
      p[to]=p[n]; delete p[n]; const mm=S.meta[m]||{}; if(mm[n]){ mm[to]=mm[n]; delete mm[n]; }
      [[UNDO,m+':'],[REDO,m+':']].forEach(([o,k])=>{ if(o[k+n]){ o[k+to]=o[k+n]; delete o[k+n]; } });
      if(S.cur[m]===n) S.cur[m]=to; S.projects.forEach(pj=>{ (pj.pgms||[]).forEach(r=>{ if(r.m===m&&r.name===n) r.name=to; }); });
      if(m===S.machine&&S.pgm===n){ S.pgm=to; $('pgm-path').textContent='TNC:\\'+to; hdrStat(); }
      persist(); renderUserPrograms(); if(S.mgt) renderMgt(); return to; },
    /* delete (asked first by the caller): yours are removed, a changed built-in goes back to its original, an unchanged built-in stays */
    remove:(m,n)=>{ const p=S.pgms[m]; if(!p||p[n]==null) return false; const o=(S.orig[m]||{})[n];
      if(o!=null){ if(p[n]===o) return false; if(m===S.machine&&S.pgm===n) edit(o,0); else p[n]=o; persist(); return 'restored'; }
      delete p[n]; if(S.meta[m]) delete S.meta[m][n]; delete UNDO[m+':'+n]; delete REDO[m+':'+n];
      S.projects.forEach(pj=>{ pj.pgms=(pj.pgms||[]).filter(r=>!(r.m===m&&r.name===n)); }); if(S.cur[m]===n) S.cur[m]=null;
      if(m===S.machine&&S.pgm===n){ S.pgm=Object.keys(pg()).filter(x=>x!==TEMP)[0]||null;
        if(!S.pgm){ S.pgm='NEW.H'; pg()[S.pgm]='BEGIN PGM NEW MM\nEND PGM NEW MM'; } S.text=pg()[S.pgm]; raw.value=S.text; S.cursor=0; compile(); }
      persist(); renderUserPrograms(); if(S.mgt) renderMgt(); return true; },
    /* Save .H for any program: the numbered TNC listing into the downloads folder */
    download:(m,n)=>{ const t=(S.pgms[m]||{})[n]; if(t==null) return false; const keep=S.machine; S.machine=MACHINES[m]?m:keep; const lst=listing(t); S.machine=keep;
      download(n,new Blob([lst],{type:'text/plain'})); return true; },
    /* run a text on a machine's interpreter without touching the simulator (the editor's live check, the cards' summary) */
    run:(m,text,o)=>{ m=MACHINES[m]?m:S.machine; const mm=MACHINES[m]; let res=null, ex=null, events=null;
      try{ res=mm.run(String(text)); }catch(e){ res={blocks:[],moves:[],stats:{},errors:[{block:0,msg:'INTERNAL: '+e.message}]}; }
      if(o&&o.expand){ try{ ex=mm.expand(res); }catch(e){ ex=null; }
        if(o.analyse&&ex&&res.stock) try{ events=mm.analyse(res,ex)||[]; }catch(e){ events=null; } }
      if(m!==S.machine) holderOpt(S.machine);
      return {res,ex,events}; },
    unique:name=>uniqueName(name)
  },
  profile:{
    get name(){ return (PROF&&PROF.name)||''; },
    setName:v=>{ if(!PROF) return; PROF.name=String(v||'').trim().slice(0,40); profChip(); persist(); },
    get savedAt(){ return PSTORE.lastSaved||null; },
    get blocked(){ const b=$('b-prof'); return !!(b&&b.classList.contains('warn')); },
    export:()=>exportProfile(),
    importFiles:files=>importFiles([...files]),
    read:file=>window.TNC_PROFILE?TNC_PROFILE.readFile(file):Promise.reject(new Error('PROFILE MODULE MISSING FROM THIS BUILD')),
    describe:inc=>({name:inc.name||'', programs:Object.values(inc.machines||{}).reduce((a,m)=>a+Object.keys(m.pgms||{}).length,0)}),
    merge:inc=>{ const m=TNC_PROFILE.merge(profileNow(),inc); m.profile.name=(PROF&&PROF.name)||inc.name||''; return finishImport(m.profile,'MERGED'+(m.renamed?' · '+m.renamed+' RENAMED':'')); },
    replace:inc=>finishImport(inc,'REPLACED'),
    fresh:()=>newProfile(),
    pickFolder:()=>pickDlDir(),
    regrant:()=>dlDirGet(true).then(d=>!!d),
    /* the downloads folder: {state:'ok'|'warn'|'bad', path} — 'default' when none is picked (files go to Downloads) */
    folder:async()=>{ if(!window.showDirectoryPicker) return {state:'ok',path:'default',plain:true};
      let h=dlDir; try{ if(!h&&window.idbKeyval) h=await idbKeyval.get('tnc.dldir'); }catch(e){ h=null; }
      if(!h) return {state:'ok',path:'default'};
      const path=h.name+'/'+DL_ROOT;
      try{ const st=await h.queryPermission({mode:'readwrite'}); if(st==='denied') return {state:'bad',path,why:'denied'};
        if(st!=='granted') return {state:'warn',path,why:'permission'}; await h.values().next(); return {state:'ok',path}; }
      catch(e){ return {state:'bad',path,why:(e&&e.name)||'error'}; } }
  },
  download:(name,blob,kind)=>download(name,blob,kind),
  openSettings:tab=>openSettings(tab), toolTable:()=>act('tt'),
  runState:()=>runState(), get lang(){ return LANG(); } };
window.TNC_UI=UIAPI;

let world=null, partRoot=null, toolRoot=null, rig=null, stockH=null;
let gStock=null, gSkirt=null, gFloor=null, gPath=null, gTool=null, toolCutter=null, toolHolder=null, curToolT=null;
let HM=null, NX=0, NY=0, DX=0, DY=0, ST=null, hmDirty=false, CO=null, gGrid=null, SV=null;   // SV: stockview.js, how the height field is drawn

function disposeTree(o){ if(!o) return; o.parent&&o.parent.remove(o);
  o.traverse(c=>{ c.geometry&&c.geometry.dispose();
    const ms=Array.isArray(c.material)?c.material:(c.material?[c.material]:[]); ms.forEach(m=>{ m.map&&m.map.dispose(); m.dispose(); }); }); }

function buildScene(){
  if(CO){ CO.dispose(); CO=null; }
  if(stockH){ try{ stockH.dispose(); }catch(e){} stockH=null; }
  if(SV){ SV.dispose(); SV=null; gStock=gSkirt=gFloor=null; }
  disposeTree(world); rig=null; gTool=null; curToolT=null; gGrid=null;
  world=new THREE.Group(); scene.add(world);
  const m=M(); ST=S.res.stock;
  const w=ST.x1-ST.x0, h=ST.y1-ST.y0;

  if(m.kinematics && m.stock){                       // 5-axis profile: machine rig + its own material model
    rig=m.kinematics.build(THREE); world.add(rig.group);
    partRoot=rig.partMount; toolRoot=rig.toolMount;
    stockH=m.stock.create(THREE,S.res); partRoot.add(stockH.mesh);
  } else {                                           // 3-axis: part fixed, height field
    partRoot=new THREE.Group(); toolRoot=new THREE.Group(); world.add(partRoot); world.add(toolRoot);
    buildHeightField();
    gGrid=makeGrid(); partRoot.add(gGrid);
  }
  /* datum axes at the blank's min corner, top face */
  const L=Math.max(w,h)*0.22, ax=new THREE.Group();
  [[[L,0,0],0xff6b5e],[[0,L,0],0x7ddc7d],[[0,0,L],0x6fa8ff]].forEach(([v,c])=>{
    ax.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(...v)]),
      new THREE.LineBasicMaterial({color:c}))); });
  ax.position.set(ST.x0,ST.y0,ST.z1+.2); partRoot.add(ax);

  /* toolpath, revealed progressively with drawRange */
  const n=S.segs.length, pp=new Float32Array(n*6), pc=new Float32Array(n*6);
  const CA=new THREE.Color(0xffb03a), CF=new THREE.Color(0x6fdcff);
  S.segs.forEach((s,i)=>{ pp.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6);
    const c=s.kind==='rapid'?CA:CF; pc.set([c.r,c.g,c.b,c.r,c.g,c.b],i*6); });
  const pg_=new THREE.BufferGeometry();
  pg_.setAttribute('position',new THREE.BufferAttribute(pp,3)); pg_.setAttribute('color',new THREE.BufferAttribute(pc,3));
  pg_.setDrawRange(0,0);
  gPath=new THREE.LineSegments(pg_,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.8}));
  partRoot.add(gPath);

  buildTrace();
  setTool(firstTool());
  if(window.TNC_CALLOUTS){
    try{ CO=TNC_CALLOUTS.create(THREE,scene,camera,renderer); calloutsFor(); CO.setVisible(S.labels); }catch(e){ CO=null; }
  }
  fitView();
  emit('scene',{partRoot,stock:ST,gStock,gSkirt,gFloor,rig});
}
function firstTool(){ const s=S.segs.find(s=>s.tool); return s?s.tool:0; }
function toolEntry(t){ return mtools().find(x=>x.t===t)||null; }

/* ---------- tool: real geometry from tools3d.js when available ---------- */
function setTool(t){
  if(t===curToolT && gTool) return;
  if(gTool){ if(window.TNC_TOOLS3D&&TNC_TOOLS3D.dispose) TNC_TOOLS3D.dispose(gTool); disposeTree(gTool); }
  if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(mset().holderType);
  const A=window.TNC_TOOLS3D&&TNC_TOOLS3D.holderStack?TNC_TOOLS3D.holderStack():100;
  curToolT=t; const e0=toolEntry(t), e=e0&&!(e0.l>0)?Object.assign({},e0,{l:A+Math.max(30,e0.r*7)}):e0;   // L=0: holder A + a typical stick-out, drawn only
  if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(mset().holderType);
  if(window.TNC_TOOLS3D){
    try{ const b=TNC_TOOLS3D.build(THREE,e); gTool=b.group; toolCutter=b.cutter; toolHolder=b.holder; }
    catch(err){ gTool=null; }
  }
  if(!gTool){                                        // fallback: plain cutter + collet
    gTool=new THREE.Group(); const r=e?e.r:3, cone=TNC_SIM.isCone(t);
    const mat=new THREE.MeshStandardMaterial({color:0xd8dee8,metalness:.9,roughness:.22});
    toolCutter=new THREE.Group();
    if(cone){ const c=new THREE.Mesh(new THREE.ConeGeometry(r,r,24),new THREE.MeshStandardMaterial({color:0xc9a54a,metalness:.8,roughness:.3}));
      c.rotation.x=-Math.PI/2; c.position.z=r/2; toolCutter.add(c);
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(r*.6,r*.6,30,20),mat); sh.rotation.x=Math.PI/2; sh.position.z=r+15; toolCutter.add(sh); }
    else { const c=new THREE.Mesh(new THREE.CylinderGeometry(r,r,Math.max(12,r*3),20),new THREE.MeshStandardMaterial({color:0x2f3742,metalness:.75,roughness:.4}));
      c.rotation.x=Math.PI/2; c.position.z=Math.max(12,r*3)/2; toolCutter.add(c);
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,30,20),mat); sh.rotation.x=Math.PI/2; sh.position.z=Math.max(12,r*3)+15; toolCutter.add(sh); }
    toolHolder=new THREE.Mesh(new THREE.CylinderGeometry(Math.max(r*1.6,14),Math.max(r*1.6,14)*1.1,40,28),
      new THREE.MeshStandardMaterial({color:0x6b7686,metalness:.7,roughness:.35}));
    toolHolder.rotation.x=Math.PI/2; toolHolder.position.z=(e?e.l:60)+20;
    gTool.add(toolCutter); gTool.add(toolHolder);
  }
  toolRoot.add(gTool);
  if(CO) calloutsFor();
  emit('tool',{t,entry:e,group:gTool,cutter:toolCutter,holder:toolHolder});
}
function calloutsFor(){
  if(!CO) return;
  const e=toolEntry(curToolT), st=ST;
  const alloy='AlMg4.5Mn';
  try{
    CO.remove('tool'); CO.remove('holder'); CO.remove('part');
    if(e&&toolCutter) CO.add('tool',toolCutter,`T${e.t} ${e.name} Ø${(e.r*2).toFixed(e.r*2%1?1:0)}`,{anchor:[0,0,Math.min(8,e.l*.1)],offset:[70,-50],color:'#6fdcff'});
    const hk=mset().holderType==='SK40'?'SK40':'ISO 50';
    if(e&&toolHolder) CO.add('holder',toolHolder,/FACEMILL/.test(e.name)?hk+' SHELL-MILL ARBOR':(/PROBE/.test(e.name)?'TS 640 PROBE BODY':(window.TNC_TOOLS3D&&TNC_TOOLS3D.holderLabel?TNC_TOOLS3D.holderLabel():hk+' · ER COLLET CHUCK')),{anchor:[0,0,0],offset:[80,-20],color:'#a596ff'});
    const mesh=stockH?stockH.mesh:gStock;
    if(mesh) CO.add('part',mesh,`BLANK ${fmt(st.x1-st.x0)}×${fmt(st.y1-st.y0)}×${fmt(st.z1-st.z0)} ${alloy}`,{anchor:[st.x1,st.y0,st.z1],offset:[40,40],color:'#63e6b0'});
  }catch(err){}
}
const fmt=v=>(Math.round(v*100)/100).toString();

/* ---------- height field: the material model is the engine's TNC_STOCK (the same code the checks use) ---------- */
let GR=null;
function buildHeightField(){
  const st=ST, w=st.x1-st.x0, h=st.y1-st.y0;
  GR=TNC_STOCK.grid(st,S.segs); const g=GR; NX=g.NX; NY=g.NY; DX=g.DX; DY=g.DY;
  HM=TNC_STOCK.field(st,g);
  if(window.TNC_STOCKVIEW){                          // drawn by stockview.js: a finer display copy cut by the same engine stamp
    SV=TNC_STOCKVIEW.create(THREE,{st,grid:g,hm:HM,root:partRoot,stock:TNC_STOCK,quality:SET?SET.get('quality'):'high',replay:()=>rewind(S.stampT)});
    gStock=SV.top; gSkirt=SV.skirt; gFloor=SV.floor; return; }
  const pos=new Float32Array(NX*NY*3), col=new Float32Array(NX*NY*3), idx=[];
  for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){ const k=(j*NX+i)*3; pos[k]=st.x0+i*DX; pos[k+1]=st.y0+j*DY; pos[k+2]=st.z1; }
  for(let j=0;j<NY-1;j++)for(let i=0;i<NX-1;i++){ const a=j*NX+i,b=a+1,c=a+NX,d=c+1; idx.push(a,b,d,a,d,c); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3)); geo.setIndex(idx);
  gStock=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,metalness:.55,roughness:.52,side:THREE.DoubleSide}));
  partRoot.add(gStock);
  gSkirt=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x6b7686,metalness:.6,roughness:.5,side:THREE.DoubleSide}));
  partRoot.add(gSkirt);
  gFloor=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({color:0x4a535f,metalness:.5,roughness:.6,side:THREE.DoubleSide}));
  gFloor.position.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z0); partRoot.add(gFloor);
  /* vice jaws (TNC_STOCK.VICE; .on=false hides them and drops the vice checks — no UI toggle yet) */
  const vm=new THREE.MeshStandardMaterial({color:0x3d4a5c,metalness:.8,roughness:.38});
  TNC_STOCK.vice(st).forEach(b=>{ const j=new THREE.Mesh(new THREE.BoxGeometry(b.x1-b.x0,b.y1-b.y0,b.z1-b.z0),vm);
    j.position.set((b.x0+b.x1)/2,(b.y0+b.y1)/2,(b.z0+b.z1)/2); partRoot.add(j); });
  paintHM();
}
function cutSeg(s,u0,u1){
  if(s.kind!=='feed'||!s.spindle||s.probe) return;    // no removal with the spindle stopped (a crash, shown as such) or while probing
  const len=s.len*(u1-u0); if(len<=0) return;
  const step=Math.max(0.3,Math.min(s.toolR*0.45,2)), n=Math.max(1,Math.ceil(len/step));
  for(let i=0;i<=n;i++){ const u=u0+(u1-u0)*(i/n);          // eps 0: the view removes every sliver; a tilted tool cuts along its axis
    const p={x:s.a.x+(s.b.x-s.a.x)*u, y:s.a.y+(s.b.y-s.a.y)*u, z:s.a.z+(s.b.z-s.a.z)*u}, ax=TNC_STOCK.axis(s,u);
    const hit=TNC_STOCK.stamp(HM,ST,GR,s,p,ax,0); if(SV&&SV.stamp(s,p,ax,hit)) hmDirty=true; if(hit) hmDirty=true; }
}
function paintHM(){
  if(!gStock) return;
  if(SV){ SV.paint(); hmDirty=false; return; }
  const p=gStock.geometry.attributes.position, c=gStock.geometry.attributes.color, st=ST, span=Math.max(1e-6,st.z1-st.z0);
  for(let k=0;k<NX*NY;k++){ const z=HM[k]; p.array[k*3+2]=z; const cut=(st.z1-z)/span;
    if(cut<1e-4){ c.array[k*3]=.42; c.array[k*3+1]=.46; c.array[k*3+2]=.52; }
    else { c.array[k*3]=.20+cut*.10; c.array[k*3+1]=.55+cut*.20; c.array[k*3+2]=.72+cut*.22; } }
  p.needsUpdate=true; c.needsUpdate=true; gStock.geometry.computeVertexNormals();
  const q=[], at=(i,j)=>HM[j*NX+i];
  const push=(x1,y1,z1,x2,y2,z2)=>q.push(x1,y1,z1,x2,y2,z2,x2,y2,st.z0,x1,y1,z1,x2,y2,st.z0,x1,y1,st.z0);
  for(let i=0;i<NX-1;i++){ push(st.x0+i*DX,st.y0,at(i,0),st.x0+(i+1)*DX,st.y0,at(i+1,0));
    push(st.x0+(i+1)*DX,st.y1,at(i+1,NY-1),st.x0+i*DX,st.y1,at(i,NY-1)); }
  for(let j=0;j<NY-1;j++){ push(st.x1,st.y0+j*DY,at(NX-1,j),st.x1,st.y0+(j+1)*DY,at(NX-1,j+1));
    push(st.x0,st.y0+(j+1)*DY,at(0,j+1),st.x0,st.y0+j*DY,at(0,j)); }
  gSkirt.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(q),3));
  gSkirt.geometry.computeVertexNormals();
  hmDirty=false;
}
function surfaceAt(x,y){
  if(!HM||!ST) return ST?ST.z1:0;
  if(x<ST.x0||x>ST.x1||y<ST.y0||y>ST.y1) return ST.z0-0.5;
  return HM[Math.round((y-ST.y0)/DY)*NX+Math.round((x-ST.x0)/DX)];
}
function removedNow(){
  if(stockH&&stockH.removedVolume) try{ return stockH.removedVolume(); }catch(e){}
  if(!HM) return 0; let v=0; for(let k=0;k<NX*NY;k++) v+=ST.z1-HM[k]; return v*DX*DY;
}

/* ---------- live trace: the cursor block's path with a beaming comet ---------- */
let gTrace=null, gComet=null, trace=null;
const glowTex=(()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.25,'rgba(200,245,255,.9)');
  g.addColorStop(.6,'rgba(111,220,255,.25)'); g.addColorStop(1,'rgba(111,220,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c); })();
function buildTrace(){
  gTrace=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthTest:false}));
  gTrace.renderOrder=5; partRoot.add(gTrace);
  const N=14, g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(N*3),3));
  gComet=new THREE.Points(g,new THREE.PointsMaterial({size:14,sizeAttenuation:false,map:glowTex,vertexColors:true,
    transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending}));
  gComet.renderOrder=6; gComet.frustumCulled=false; partRoot.add(gComet);
  gTrace.visible=gComet.visible=false;
}
function traceFor(bi){
  trace=null; if(!gTrace) return;
  /* only one occurrence of the block (a block inside CALL LBL … REP runs many times): the next one after the machine */
  let segs=[], all=[]; S.segs.forEach((s,i)=>{ if(s.block===bi) all.push(i); });
  if(all.length){ let st=all.findIndex(i=>S.segs[i].t0>=S.t-1e-6); if(st<0) st=0; let i=all[st];
    while(i<S.segs.length&&S.segs[i].block===bi){ segs.push(S.segs[i]); i++; } }
  if(!segs.length){ gTrace.visible=gComet.visible=false; return; }
  const p=new Float32Array(segs.length*6); let L=0; const cum=[0];
  segs.forEach((s,i)=>{ p.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6); L+=s.len; cum.push(L); });
  gTrace.geometry.setAttribute('position',new THREE.BufferAttribute(p,3)); gTrace.geometry.computeBoundingSphere();
  trace={segs,cum,L,u:0,loops:0,period:clamp(L/60,0.9,3.2)};
  gTrace.visible=gComet.visible=true;
}
function tracePoint(d){
  const tr=trace; d=((d%tr.L)+tr.L)%tr.L;
  let i=0; while(i<tr.segs.length-1&&tr.cum[i+1]<d) i++;
  const s=tr.segs[i], u=(d-tr.cum[i])/Math.max(1e-9,s.len);
  return [s.a.x+(s.b.x-s.a.x)*u, s.a.y+(s.b.y-s.a.y)*u, s.a.z+(s.b.z-s.a.z)*u];
}
function traceTick(dt){
  if(!trace||!gComet) return;
  const show=!S.running && !S.lesson?.hideTrace && trace.loops<2;       // two passes, then it stands still
  gTrace.visible=!S.running; gComet.visible=show; if(!show){ gTrace.material.opacity=.35; return; }
  trace.u+=dt/trace.period; if(trace.u>=1){ trace.u-=1; trace.loops++; }
  const head=trace.u*trace.L, pos=gComet.geometry.attributes.position, col=gComet.geometry.attributes.color, N=pos.count;
  const tail=Math.min(trace.L*0.35, 22);
  for(let k=0;k<N;k++){ const d=Math.max(0,head-tail*(k/(N-1))); const q=tracePoint(d);
    pos.array[k*3]=q[0]; pos.array[k*3+1]=q[1]; pos.array[k*3+2]=q[2];
    const f=REDUCED?(k===0?1:0):Math.pow(1-k/(N-1),1.6); col.array[k*3]=f; col.array[k*3+1]=f; col.array[k*3+2]=f; }
  pos.needsUpdate=col.needsUpdate=true;
  gTrace.material.opacity=.55+.4*Math.sin(performance.now()/260)**2;
}

/* ---------- views ---------- */
function fitView(){ setView(S.view); }
function setView(v){ S.cam=null; S.view=v; fitCamera(); viewLabel(); writePrefs(); }
/* camera presets (bridge tnc:camera): orbit = the 3-D view, plan = from above, part = the blank alone from the far corner,
   tool = close on the cutter, pov = from the spindle down the tool. tool and pov follow the tool while the run moves it. */
const CAMS=['orbit','pov','tool','part','plan'];
let camAt=null;
function toolWorld(){ const p=S.pos||{x:0,y:0,z:0}; return toWorld(p); }
function camPreset(v){
  if(!CAMS.includes(v)||!ST) return false;
  if(v==='orbit'){ setView('3D'); return true; }
  if(v==='plan'){ setView('TOP'); return true; }
  const st=ST, span=Math.max(st.x1-st.x0,st.y1-st.y0,40);
  if(v==='part'){ S.cam='part'; const c=new THREE.Vector3((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z1);
    camera.position.copy(c).add(new THREE.Vector3(-.8,-1,.75).normalize().multiplyScalar(span*1.7)); controls.target.copy(c); }
  else { renderDro(0); const t=toolWorld(), e=toolEntry(curToolT), r=e?e.r:3, L=e&&e.l>0?e.l:80; S.cam=v; camAt=t.clone();
    if(v==='tool'){ const d=Math.max(45,r*14); camera.position.copy(t).add(new THREE.Vector3(.9,-1,.55).normalize().multiplyScalar(d)); controls.target.copy(t).add(new THREE.Vector3(0,0,r)); }
    else { camera.position.copy(t).add(new THREE.Vector3(r*2.5+14,-(r*2.5+14),L*.9+20)); controls.target.copy(t); } }
  camera.lookAt(controls.target); viewFitted=false; viewLabel(); return true;
}
function camFollow(){ if(S.cam!=='tool'&&S.cam!=='pov') return; const t=toolWorld(); if(!camAt){ camAt=t.clone(); return; }
  const d=t.clone().sub(camAt); if(d.lengthSq()<1e-12) return; camera.position.add(d); controls.target.add(d); camAt.copy(t); }
/* the blank's corners and the tool's (holder included) bounding box, world coordinates */
function framePoints(){
  const st=ST, P=[];
  for(const x of [st.x0,st.x1]) for(const y of [st.y0,st.y1]) for(const z of [st.z0,st.z1]) P.push(new THREE.Vector3(x,y,z));
  const tool=new THREE.Box3(); if(toolRoot){ toolRoot.updateMatrixWorld(true); tool.setFromObject(toolRoot); }
  return {blank:P, tool:tool.isEmpty()?[]:[0,1,2,3,4,5,6,7].map(i=>new THREE.Vector3(i&1?tool.max.x:tool.min.x,i&2?tool.max.y:tool.min.y,i&4?tool.max.z:tool.min.z))};
}
/* the part of the 3-D view not covered by its text overlays (top lines, coordinate box), in px from the canvas edges */
function freeInsets(){ const g=gfxEl.getBoundingClientRect(), m=8;
  const r=id=>{ const e=$(id); if(!e||!e.offsetParent||!e.textContent) return null; const b=e.getBoundingClientRect(); return {l:b.left-g.left,r:g.right-b.right,t:b.top-g.top,b:g.bottom-b.bottom,w:b.width,h:b.height}; };
  const L=r('ovl-l'), Rt=r('ovl-r'), D=r('dro');
  const top=Math.max(L?L.t+L.h:0,Rt?Rt.t+Rt.h:0), bot=D?D.b+D.h:0;
  // two ways round the text: bands above and below it (narrow views), or margins left and right of it (wide, short views)
  return {w:g.width,h:g.height,cands:[{top:top+m,bot:bot+m,left:m,right:m},
    {top:m,bot:m,left:Math.max(L?L.l+L.w:0,D?D.l+D.w:0)+m,right:(Rt?Rt.r+Rt.w:0)+m}]}; }
/* default / reset view: the view's direction, then the closest camera (and a sideways shift of the pivot) that keeps the
   whole blank and the tool inside the part of the canvas the text overlays leave free, whatever its aspect ratio */
let viewFitted=false;
function fitCamera(){
  if(!ST) return;
  const st=ST, cx=(st.x0+st.x1)/2, cy=(st.y0+st.y1)/2, cz=(st.z0+st.z1)/2;
  const D0={'3D':[.95,-1.05,.85],'TOP':[0,-0.0005,1],'FRONT':[0,-1,.026],'SIDE':[1,0,.026]}[S.view]||[1,-1,1];
  const dir=new THREE.Vector3(...D0).normalize(), c=new THREE.Vector3(cx,cy,cz);
  renderDro(0);                                         // puts the tool where the run stands (now=0: no DRO repaint)
  camera.position.copy(c).add(dir); camera.lookAt(c); camera.updateMatrixWorld();
  const e=camera.matrixWorld.elements, rt=new THREE.Vector3(e[0],e[1],e[2]), up=new THREE.Vector3(e[4],e[5],e[6]);
  const fp=framePoints(), pts=fp.blank.concat(fp.tool).map(p=>{ const q=p.clone().sub(c); return [q.dot(rt),q.dot(up),q.dot(dir)]; });
  const f=freeInsets(), tv=Math.tan(camera.fov*Math.PI/360), th=tv*(f.w/Math.max(1,f.h));
  // shift s along an axis fits at distance D when max(p-(D-z)·t·hi) <= min(p-(D-z)·t·lo); wider as D grows -> bisect
  const span=(D,k,t,lo,hi)=>{ let a=-Infinity,b=Infinity; for(const p of pts){ const r=(D-p[2])*t; a=Math.max(a,p[k]-r*hi); b=Math.min(b,p[k]-r*lo); } return [a,b]; };
  const ok=([a,b])=>a<=b, d0=Math.max(st.x1-st.x0,st.y1-st.y0,40);
  let best=null;
  for(const q of f.cands){
    const xl=-1+2*q.left/f.w, xr=1-2*q.right/f.w, yt=1-2*q.top/f.h, yb=-1+2*q.bot/f.h;
    if(!(xr-xl>0.4&&yt-yb>0.4)) continue;               // not laid out yet, or no room this way
    const fits=D=>pts.every(p=>D-p[2]>camera.near*2)&&ok(span(D,0,th,xl,xr))&&ok(span(D,1,tv,yb,yt));
    let lo=0, hi=d0; for(let i=0;i<40&&!fits(hi);i++) hi*=2; for(let i=0;i<40;i++){ const m=(lo+hi)/2; if(fits(m)) hi=m; else lo=m; }
    if(!best||hi<best.D) best={D:hi,q,xl,xr,yt,yb};
  }
  const mid=([a,b])=>isFinite(a)&&isFinite(b)?(a+b)/2:0;
  const D=best?best.D:d0*2.5;                           // canvas not laid out yet: a safe distance; resize() refits
  const tgt=best?c.clone().addScaledVector(rt,mid(span(D,0,th,best.xl,best.xr))).addScaledVector(up,mid(span(D,1,tv,best.yb,best.yt))):c;
  camera.position.copy(tgt).addScaledVector(dir,D); controls.target.copy(tgt); camera.lookAt(tgt);
  if(CO) try{ CO.setPad(f.cands[0].top-8,f.cands[0].bot-8); }catch(e){}
  viewFitted=true;
}
controls.addEventListener('start',()=>{ viewFitted=false; });   // the operator moved the view: a resize keeps it
/* test hook (read-only): where the blank, the tool and the visible 3-D view are, in client px */
UIAPI.framing=()=>{ const g=gfxEl.getBoundingClientRect(), fp=framePoints(), dock=isPhone()?$('dock').getBoundingClientRect().top:innerHeight;
  const rect=P=>{ if(!P.length) return null; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    P.forEach(p=>{ const v=p.clone().project(camera), x=g.left+(v.x+1)/2*g.width, y=g.top+(1-v.y)/2*g.height;
      x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y); }); return {x0,y0,x1,y1}; };
  return {view:{x0:Math.max(0,g.left),y0:Math.max(0,g.top),x1:Math.min(innerWidth,g.right),y1:Math.min(dock,g.bottom)},
    blank:rect(fp.blank),tool:rect(fp.tool),fitted:viewFitted}; };
function viewLabel(){ $('gfx-rt').textContent=S.cam?T('cam.'+S.cam):(S.view==='3D'?T('gfx.3d'):T('gfx.plan')+' '+S.view); }

/* ================= effects (fx.js) ================= */
let FXO=null;
if(window.TNC_FX){
  try{ FXO=TNC_FX.create(THREE,scene,{}); FXO.surfaceAt=(x,y)=>surfaceAt(x,y); }catch(e){ FXO=null; }
}
function fxApply(){ if(FXO) FXO.set({chips:S.fx,sparks:S.fx,coolant:S.fxCool,smoke:S.fxFire,fire:S.fxFire}); }
function toWorld(p){ const v=new THREE.Vector3(p.x,p.y,p.z); if(partRoot&&rig) partRoot.localToWorld(v); return v; }

/* ================= sound ================= */
let AC=null;
function beep(kind){
  if(!S.sound) return;
  try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(), g=AC.createGain(), t=AC.currentTime; o.connect(g); g.connect(AC.destination);
    if(kind==='crash'){ o.type='square'; [880,660,880,660].forEach((f,i)=>{ o.frequency.setValueAtTime(f,t+i*.17); });
      g.gain.setValueAtTime(.07,t); g.gain.exponentialRampToValueAtTime(.0001,t+.75); o.start(t); o.stop(t+.76); }
    else { o.type='sine'; o.frequency.setValueAtTime(kind==='warn'?990:1320,t);
      g.gain.setValueAtTime(.045,t); g.gain.exponentialRampToValueAtTime(.0001,t+.2); o.start(t); o.stop(t+.21); }
  }catch(e){}
}

/* ================= transport ================= */
const scrub=$('scrub');
function segAt(t){ let lo=0,hi=S.segs.length-1,r=-1;
  while(lo<=hi){ const m=(lo+hi)>>1; if(S.segs[m].t1<t) lo=m+1; else { r=m; hi=m-1; } }
  return r<0?S.segs.length-1:r; }
function applyCuts(toT){
  if(stockH){ try{ stockH.cutTo(S.ex,toT); }catch(e){} S.stampT=toT; return; }
  if(toT<=S.stampT) return;
  for(const s of S.segs){ if(s.t1<=S.stampT||s.t0>=toT) continue;
    cutSeg(s,Math.max(0,(S.stampT-s.t0)/(s.t1-s.t0)),Math.min(1,(toT-s.t0)/(s.t1-s.t0))); }
  S.stampT=toT;
}
function rewind(toT){
  if(stockH){ try{ stockH.reset(); }catch(e){} S.stampT=0; applyCuts(toT); return; }
  HM.fill(ST.z1); if(SV) SV.reset(); S.stampT=0; hmDirty=true; applyCuts(toT);
}
/* fire=true: a playing machine — crash events stop it where they happen */
function seek(t, fire){
  t=clamp(t,0,S.total);
  if(fire){
    while(S.evIdx<S.events.length && S.events[S.evIdx].t<=t+1e-9){
      const ev=S.events[S.evIdx++]; raise(ev);
      if(ev.sev==='crash'&&!KEEPGOING()){ t=ev.t; S.running=false; setState('CRASH · FEED HOLD'); break; }
    }
  } else { const i=S.events.findIndex(e=>e.t>t+1e-9); S.evIdx=i<0?S.events.length:i; }
  if(t<S.stampT-1e-9) rewind(t); else applyCuts(t);
  S.t=t; scrub.value=S.total>0?Math.round(t/S.total*1000):0;
  syncExec();
}
function syncExec(){
  if(!S.segs.length||!S.running) return;                 // while running, the highlight follows the machine
  const sg=S.segs[segAt(S.t)], b=sg.block; if(sg.seq!=null) S.k=sg.seq;
  if(b!==S.execB){ S.execB=b; if(!S.editing){ S.cursor=b; } markRows(); flowHighlight(); }
}
/* ---- single block by NC block, in execution order (res.exec from the interpreter; moves carry seq) ----
   The highlighted block is the one that runs next. The machine stands where it is just before it. */
const EX=()=>(S.res&&S.res.exec)||[];
function segFromSeq(k){ let lo=0,hi=S.segs.length; while(lo<hi){ const m=(lo+hi)>>1; if((S.segs[m].seq??-1)<k) lo=m+1; else hi=m; } return lo; }
function startT(k){ const i=segFromSeq(k); return i<S.segs.length?S.segs[i].t0:S.total; }
function selectStep(k){                                  // machine to just before step k, highlight its block
  const E=EX(); if(!E.length) return; k=clamp(k,0,E.length); S.k=k; S.running=false;
  seek(startT(k),false); S.cursor=k<E.length?E[k]:Math.max(0,S.res.blocks.length-1); S.execB=S.cursor; markRows(true); flowHighlight(); traceFor(S.cursor);
}
function stepFor(block){                                 // the next time this block runs (after the current step), else its first time
  const E=EX(), from=S.k||0; for(let k=from;k<E.length;k++) if(E[k]===block) return k;
  for(let k=0;k<E.length;k++) if(E[k]===block) return k; return -1;
}
function reset(){ S.running=false; hideAlarm(); if(FXO) FXO.clear(); S.k=0; selectStep(0); setState('READY'); }
/* interlock (bridge tnc:lock, the Play edition): while locked NC START is refused and the reason is shown. Not part of the interpreter. */
function setLock(on,reason){ S.lock=on?{reason:String(reason||'').slice(0,160)}:null; if(S.lock&&S.running) stop();
  const el=$('sb-lock'), txt=S.lock?T('lock.title')+' · '+(S.lock.reason||T('lock.default')):'';
  if(el){ el.hidden=!S.lock; el.textContent=txt; } $('b-start').setAttribute('aria-disabled',S.lock?'true':'false');
  if(!S.lock) hideAlarm('warn'); return !!S.lock; }
function locked(){ if(!S.lock) return false; showAlarm('warn',T('lock.title'),S.lock.reason||T('lock.default'),6000); beep('warn'); return true; }
function start(){
  if(locked()) return;
  if(!S.segs.length){ say('NO MOVES TO RUN'); return; }
  if(S.t>=S.total-1e-6){ seek(0,false); if(FXO) FXO.clear(); }
  hideAlarm('crash'); S.running=true; setState(S.mode==='single'?'SINGLE BLOCK':'RUNNING');
  if(S.speed===0) runMax();
}
function stop(){ if(S.running){ S.running=false; setState('FEED HOLD'); } }
/* NC START does what the operating mode says: SINGLE-BLOCK = the next block, TEST / FULL-RUN = run, PROGRAM = nothing */
function ncStart(){ if(S.mode==='single') stepBlock(); else if(S.mode==='edit') say('PROGRAM MODE — NC START WORKS IN 2 TEST, 3 SINGLE-BLOCK, 4 FULL-RUN'); else start(); }
function runMax(){ S.running=false; seek(S.total,true); if(S.t>=S.total-1e-6){ setState('PROGRAM END'); replayOffer(); } }
function stepBlock(){                                   // NC START in SINGLE-BLOCK: exactly the highlighted block, then the next one is highlighted
  if(locked()) return;
  const E=EX(); if(!E.length) return;
  let k=S.k==null?stepFor(S.cursor):S.k; if(k<0) k=0;
  if(E[k]!==S.cursor){ const k2=stepFor(S.cursor); if(k2>=0) k=k2; }
  if(k>=E.length){ setState('PROGRAM END'); return; }
  S.running=false; seek(startT(k+1),true);              // runs step k (crash events stop it where they happen)
  if(/CRASH/.test($('run-state').textContent)) return;
  S.k=k+1; S.cursor=S.k<E.length?E[S.k]:Math.max(0,S.res.blocks.length-1); S.execB=S.cursor; markRows(true); flowHighlight(); traceFor(S.cursor);
  setState(S.k>=E.length?'PROGRAM END':'SINGLE BLOCK');
}
function setState(s){ $('run-state').textContent=TR(s); const sb=$('sb-state'); if(sb) sb.textContent=TR(s); if(s!==setState.last){ setState.last=s; hdrStat(); announce(s); } }
/* what the web app is told about the run (bridge tnc:state) */
function runState(){ const s=S.seg, e=toolEntry(curToolT), p=S.pos, u=s?clamp((S.t-s.t0)/Math.max(1e-9,s.t1-s.t0),0,1):0;
  const ax=k=>s&&s.a&&s.a[k]!=null?s.a[k]+((s.b[k]||0)-s.a[k])*u:0, sp=s?(s.spindle||0):0;
  return {running:!!S.running, cutting:!!S.cutting, mode:S.mode, machine:S.machine, tool:e?{t:e.t,r:+e.r,l:+e.l}:null,
    pos:p?{x:+p.x.toFixed(4),y:+p.y.toFixed(4),z:+p.z.toFixed(4),a:+ax('a').toFixed(4),b:+ax('b').toFixed(4)}:null,
    spindle:{on:sp!==0,rpm:s&&s.sRpm!=null?+s.sRpm:Math.abs(sp)}, coolant:!!(s&&s.coolant),
    progress:S.total>0?+clamp(S.t/S.total,0,1).toFixed(4):0, errors:(S.res&&S.res.errors?S.res.errors.length:0)+S.events.filter(x=>x.sev==='crash').length,
    done:S.total>0&&S.t>=S.total-1e-6, locked:!!S.lock}; }

/* ================= alarms ================= */
const alarmEl=$('alarm'); let alarmT=0;
function raise(ev){
  const at=ev.at?` · T${ev.tool} X${ev.at.x.toFixed(2)} Y${ev.at.y.toFixed(2)} Z${ev.at.z.toFixed(2)}`:'';
  if(ev.sev==='crash'){
    showAlarm('crash','CRASH',`BLOCK ${nOf(ev.block)} · ${TR(ev.msg.replace(/^CRASH:\s*/,'CRASH: ')).replace(/^[^:]{3,12}:\s*/,'')}${at}`);
    S.shake=REDUCED?0:1; beep('crash');
    if(FXO&&ev.at) try{ FXO.crash(toWorld(ev.at)); }catch(e){}
    emit('crash',ev);
  } else if(ev.sev==='warn'){
    showAlarm('warn','WARNING',`BLOCK ${nOf(ev.block)} · ${TR(ev.msg).replace(/^[^:]{3,12}:\s*/,'')}`,6000); beep('warn');
  } else say(ev.msg);
}
function showAlarm(kind,title,text,ms){
  alarmEl.className='alarm '+kind; alarmEl.hidden=false;
  alarmEl.innerHTML=`<b>${esc(TR(title))}</b><span>${esc(text)}</span><button type="button" aria-label="CE">CE</button>`;
  alarmEl.querySelector('button').onclick=()=>hideAlarm();
  clearTimeout(alarmT); if(ms) alarmT=setTimeout(()=>hideAlarm(kind),ms);
  if(isPhone()&&paneNow()!=='gfx') say(title+' · '+text);
}
function hideAlarm(kind){ if(kind&&!alarmEl.classList.contains(kind)) return; alarmEl.hidden=true; }

/* ================= program listing ================= */
const plist=$('plist'), crt=$('crt'), raw=$('raw');
const HL=[
  [/(^|\s)(BEGIN PGM|END PGM|BLK FORM|TOOL CALL|CYCL DEF|CYCL CALL|CALL LBL|LBL|STOP|FN \d+:)/g,'$1<i class="t-key">$2</i>'],
  [/\b(F ?MAX|F ?AUTO)\b/g,'<i class="t-f">$1</i>'],[/\b(F\d+(?:[.,]\d+)?|FQ\d+)\b/g,'<i class="t-f">$1</i>'],
  [/\b(M\d+)\b/g,'<i class="t-m">$1</i>'],[/\b(Q\d+)\b/g,'<i class="t-q">$1</i>'],
  [/\b(I?[XYZABC]|I?P[RA]|R|S)([+-]?\d+(?:[.,]\d+)?)/g,'$1<i class="t-num">$2</i>']
];
/* a block as the screen shows it; the stored text is never changed (dialogs.js show) */
const shown=t=>DLG?DLG.show(t,SET?SET.decimalComma():false):t;   // the resolved decimal-character setting (MP 7280)
function hl(s){ const ci=s.indexOf(';'); let code=ci>=0?s.slice(0,ci):s; const cm=ci>=0?s.slice(ci):'';
  code=esc(code); for(const [re,rp] of HL) code=code.replace(re,rp);
  return code+(cm?'<i class="t-cm">'+esc(cm)+'</i>':''); }
let evBlocks={};
function renderList(){
  evBlocks={}; S.events.forEach(e=>{ if(e.sev==='crash'||e.sev==='warn') evBlocks[e.block]=evBlocks[e.block]==='crash'?'crash':e.sev; });
  plist.innerHTML=(S.res.blocks||[]).map((b,i)=>{
    const c=['blk']; if(b.indent) c.push('ind'); if(b.error||evBlocks[i]==='crash') c.push('err'); else if(evBlocks[i]==='warn') c.push('warn');
    return `<div class="${c.join(' ')}" data-i="${i}"><span class="bn">${b.indent||b.n==null?'':b.n}</span><span class="bt">${hl(shown(b.raw||''))}</span></div>`;
  }).join('');
  markRows(true);
}
let lastCur=-1, lastExec=-1;
function markRows(scroll){
  const rows=plist.children;
  const set=(i,cls,on)=>{ if(rows[i]) rows[i].classList.toggle(cls,on); };
  if(lastCur>=0) set(lastCur,'cur',false); if(lastExec>=0) set(lastExec,'exec',false);
  set(S.cursor,'cur',true); if(S.execB!==S.cursor&&S.running) set(S.execB,'exec',true);
  lastCur=S.cursor; lastExec=S.execB;
  const fset=new Set(S.focus||[]);
  for(let i=0;i<rows.length;i++) rows[i].classList.toggle('focus', fset.size>0 && fset.has(S.res.blocks[i].n) && !S.res.blocks[i].indent);
  if(scroll!==false){ const el=rows[S.cursor]; if(el){ const r=el.offsetTop, h=crt.clientHeight;
    if(isPhone()){ if(paneNow()==='pgm') el.scrollIntoView({block:'nearest'}); }
    else if(r<crt.scrollTop+12||r>crt.scrollTop+h-30) crt.scrollTop=r-h/2; } }
  if(!S.running) traceFor(S.cursor);
  if(S.flowView) flowHighlight();
}
/* TEST / SINGLE-BLOCK / FULL-RUN: moving the block cursor moves the machine to the end of that block */
function followCursor(){                                // run modes: selecting a block puts the machine just before it
  if(S.mode==='edit'||S.running) return;
  const k=stepFor(S.cursor); if(k>=0) selectStep(k);
}
function moveCursor(i){ S.cursor=clamp(i,0,Math.max(0,S.res.blocks.length-1)); markRows(); }
plist.addEventListener('click',e=>{ const d=e.target.closest('.blk'); if(!d) return;
  moveCursor(+d.dataset.i); followCursor(); });
plist.addEventListener('dblclick',e=>{ if(e.target.closest('.blk')) beginEdit(); });

/* ================= side panels ================= */
function fmtT(s){ const m=Math.floor(s/60); return (m<10?'0':'')+m+':'+(s%60<10?'0':'')+(s%60).toFixed(1); }
function renderKV(){
  const st=S.res.stats||{}, s=S.seg;
  const rows=[['kv.elapsed',fmtT(S.t)+' / '+fmtT(S.total)],['kv.blocks',(S.res.blocks.filter(b=>b.n!=null&&!b.indent).pop()||{n:0}).n+1],
    ['kv.moves',S.segs.length],['kv.feed',(st.pathFeed||0).toFixed(0)+' mm'],['kv.rapid',(st.pathRapid||0).toFixed(0)+' mm'],
    ['kv.minz',(st.minZ!=null?(+st.minZ).toFixed(3):'--')+' mm'],['kv.removed',(removedNow()/1000).toFixed(1)+' cm³'],
    ['kv.cycle',s&&s.cycle?s.cycle:'—'],['kv.ovr',S.ovr+' %'],['kv.machine',M().label]];
  // runs every 250 ms: rewrite only changed text, never the nodes (a swipe that starts on a <dt> must keep its target)
  const kv=$('runkv');
  if(kv.children.length!==rows.length*2) kv.innerHTML='<dt></dt><dd></dd>'.repeat(rows.length);
  rows.forEach(([k,v],i)=>{ const d=kv.children[i*2], e=d.nextElementSibling; k=T(k); v=String(v);
    if(d.textContent!==k) d.textContent=k; if(e.textContent!==v) e.textContent=v; });
}
function renderChecks(){
  const errs=S.res.errors||[], ev=S.events;
  const items=[...errs.map(e=>({cls:'',t:null,block:e.block,msg:e.msg})),
               ...ev.map(e=>({cls:e.sev==='crash'?'':e.sev,t:e.t,block:e.block,msg:e.msg}))];
  const nCrash=ev.filter(e=>e.sev==='crash').length, nWarn=ev.filter(e=>e.sev==='warn').length;
  $('errc').textContent=errs.length+nCrash+nWarn?`${errs.length} ${T('chk.err')} · ${nCrash} ${T('chk.crash')} · ${nWarn} ${T('chk.warn')}`:T('chk.clear');
  checksBadge(errs.length,nCrash,nWarn);
  $('elist').innerHTML=items.length?items.map((x,i)=>`<div class="${x.cls}" data-k="${i}">${T('chk.block')} ${nOf(x.block)} &nbsp;${esc(TR(x.msg))}</div>`).join('')
    :`<div class="ok">${T('chk.ok')}</div>`;
  $('elist').onclick=e=>{ const d=e.target.closest('[data-k]'); if(!d) return; const x=items[+d.dataset.k];
    moveCursor(x.block); if(x.t!=null){ S.running=false; seek(Math.max(0,x.t-1e-3),false); } };
}
const CMPF=[['cycleTime','kv.cycletime'],['pathFeed','kv.feed'],['pathRapid','kv.rapid'],['moveCount','kv.moves'],['minZ','kv.minz'],['removedVolume','kv.removed']];
function statsNow(){ return Object.assign({},S.res.stats||{},{removedVolume:removedNow()}); }
function renderCompare(){
  const b=statsNow(), a=S.cmpRef?S.cmpRef.stats:null;
  $('cmp-t').textContent=S.cmpRef?'A: '+S.cmpRef.name:T('cmp.none');
  const f=v=>v==null||isNaN(v)?'--':(Math.abs(v)>=100?(+v).toFixed(0):(+v).toFixed(2));
  let h=`<span class="h">${T('cmp.metric')}</span><span class="h">${T('cmp.aref')}</span><span class="h">${T('cmp.bnow')}</span><span class="h">Δ</span>`;
  for(const [k,l] of CMPF){ const bv=b[k], av=a?a[k]:null; let d='--',dc='eq';
    if(a&&av!=null&&bv!=null){ const dv=bv-av; d=(dv>0?'+':'')+f(dv); dc=Math.abs(dv)<1e-6?'eq':(k==='removedVolume'?(dv>0?'dn':'up'):(dv>0?'up':'dn')); }
    h+=`<span class="l">${T(l)}</span><span class="v">${f(av)}</span><span class="v">${f(bv)}</span><span class="d ${dc}">${d}</span>`; }
  $('cmp').innerHTML=h;
}
$('b-snap').onclick=()=>{ S.running=false; seek(S.total,false);
  S.cmpRef={stats:statsNow(),text:S.text,pgm:S.pgm,machine:S.machine,name:S.pgm+' @'+new Date().toTimeString().slice(0,5)};
  renderCompare(); say('REFERENCE STORED — CHANGE THE PROGRAM, RUN, COMPARE'); };
$('b-restore').onclick=()=>{ if(!S.cmpRef){ say('NO REFERENCE STORED'); return; }
  if(S.cmpRef.machine!==S.machine) setMachine(S.cmpRef.machine);
  if(pg()[S.cmpRef.pgm]==null) pg()[S.cmpRef.pgm]=S.cmpRef.text; openPgm(S.cmpRef.pgm); say('REFERENCE PROGRAM OPEN: '+S.cmpRef.pgm); };

let droT=0;
function renderDro(now){
  const i=S.segs.length?segAt(S.t):-1; let x=0,y=0,z=0,f=0,sp=0,tl=0,s=null,u=0;
  if(i>=0){ s=S.segs[i]; u=clamp((S.t-s.t0)/Math.max(1e-9,s.t1-s.t0),0,1);
    x=s.a.x+(s.b.x-s.a.x)*u; y=s.a.y+(s.b.y-s.a.y)*u; z=s.a.z+(s.b.z-s.a.z)*u;
    f=Math.round(s.f*(S.ovr/100)); sp=s.spindle||0; tl=s.tool||0; }
  S.seg=s; S.pos={x,y,z};
  if(s&&s.tool!==curToolT) setTool(s.tool);
  if(rig&&M().kinematics.poseAt){ try{ rig.set(M().kinematics.poseAt(S.ex,S.t)); }catch(e){} }
  else if(gTool){ gTool.position.set(x,y,z);
    if(s&&s.a&&s.a.a!=null){ const A=s.a.a+((s.b.a||0)-s.a.a)*u, B=s.a.b+((s.b.b||0)-s.a.b)*u;   // tool axis = Ry(-B)·Rx(A)·(0,0,-1)
      gTool.rotation.set(A*Math.PI/180,-B*Math.PI/180,0,'YXZ'); }
    else gTool.rotation.set(0,0,0); }
  if(now-droT<66) return; droT=now;
  const extra=(M().axes||[]).filter(a=>/[ABC]/.test(a)).map(a=>{ const k=a.toLowerCase(); let v=0;
    if(s&&s.a&&s.a[k]!=null) v=s.a[k]+((s.b[k]||0)-s.a[k])*u; return ['s',a,(+v).toFixed(3)]; });
  const R=[['x','X',x.toFixed(3)],['y','Y',y.toFixed(3)],['z','Z',z.toFixed(3)],...extra,
           ['s','S',(s&&s.sRpm!=null?s.sRpm:Math.abs(sp))+(sp<0?' M4':sp>0?' M3':' M5')],['f','F',s&&s.kind==='rapid'?'FMAX':f],['t','T',String(tl)]];
  $('dro').innerHTML=R.map(([c,a,v])=>`<div class="drow ${c}"><span class="ax">${a}</span><span class="val">${v}</span></div>`).join('');

}

/* ================= soft keys ================= */
const sks=$('sks');
const SK={
  /* EDIT: the path-function keys, the program keys (CYCL DEF, TOOL CALL …) and the editing keys — three rows */
  /* LP POLAR / CP POLAR are the simulator's shortcuts for L + P and C + P: the 426/430 has no key of their own, the polar
     form is entered with the orange P key in the coordinate question (manual 6.5; p. 155 "7 LP PR+60 PA+180 R0 F MAX").
     Both open the same dialog P gives (dialogs.js PATH.LP / PATH.CP). TOOL LIST is on T and the Tools button. */
  edit:  [['L','w:L'],['LP\nPOLAR','w:LP'],['CC','w:CC'],['C','w:C'],['CP\nPOLAR','w:CP'],['CR','w:CR'],['CT','w:CT'],['RND','w:RND'],
          ['CHF','w:CHF'],['APPR\nDEP','apprdep'],['TOOL\nDEF','w:TOOLDEF'],['TOOL\nCALL','w:TOOLCALL'],['CYCL\nDEF','cycldef'],['CYCL\nCALL','w:CYCLCALL'],['LBL\nSET','w:LBLSET'],['LBL\nCALL','w:LBLCALL'],
          ['Q','w:Q'],['EDIT','ed'],['INSERT','ins'],['DELETE','del'],['UNDO','undo'],['REDO','redo'],['RAW\nTEXT','rawt'],['CHECK','chk']],
  test:  [['START','start'],['START\nSINGLE','step'],['STOP','stop'],['RESET','reset'],['3-D\nVIEW','v3'],['PLAN\nVIEW','vt'],['FRONT','vf'],['SIDE','vs']],
  single:[['NC START\nNEXT BLOCK','step'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['TOOL\nLIST','tt'],['PROGRAMS','mgt']],
  full:  [['NC\nSTART','start'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['TOOL\nLIST','tt'],['PROGRAMS','mgt']],
  tt:    [['ADD\nMISSING','ttmiss'],['IMPORT\nTOOL.T','load'],['EXPORT\nTOOL.T','ttexp'],['',''],['',''],['',''],['',''],['END','ttend']],
  mgt:   [['NEW','new'],['OPEN','open'],['LOAD\nFROM PC','load'],['SAVE\n.H','save'],['RESTORE\nORIGINAL','restore'],['DELETE','mdel'],['',''],['END','end']]
};
/* a block open on the block line: DIALOG turns a path block (L LP CC C CP CR CT CTP RND CHF) back into its questions */
function lineSK(){ const b=S.res.blocks[S.cursor], d=DLG&&b&&!S.insertPending&&DLG.parseBlock(b.raw);
  return [d?['DIALOG','redlg']:['',''],['',''],['',''],['',''],['',''],['',''],['ENT','edok'],['ESC','edesc']]; }
function skRows(){ if(S.wiz) return wizSK(); if(S.editing) return lineSK(); if(S.pick) return S.pick; if(S.mgt) return SK.mgt; if(S.tt) return SK.tt; return SK[S.mode]||SK.test; }
/* soft keys: the same look and the same behaviour everywhere; NC START green, NC STOP red; a path row when nested */
const SKKEY={ed:'E',ins:'I',del:'DEL',undo:'CTRL Z',redo:'CTRL Y',rawt:'TAB',tt:'T',mgt:'M',focus:'F',start:'SPACE',stop:'ESC',reset:'R',
  v3:'G',vt:'G',vf:'G',vs:'G',ovrd:'−',ovru:'+',cycldef:'Y','w:TOOLCALL':'W',apprdep:'A','w:Q':'Q',load:'CTRL O',save:'CTRL S',new:'N',mdel:'DEL',restore:'R',end:'ESC',
  ttend:'ESC',pickend:'ESC',wend:'END',wcancel:'ESC',wskip:'⇧ ENTER',wok:'ENTER',wsign:'− / +',wact:'#',wce:'DELETE',redlg:'F2',edok:'ENTER',edesc:'ESC',wtext:'F2'};
function skKey(a){ if(a==='step') return S.mode==='single'?'SPACE / S':'S'; if(a.startsWith('wa:')) return 'XYZ'.includes(a.slice(3))?'':a.slice(3); return SKKEY[a]||''; }
function skClass(a){ const on=(a==='rawt'&&S.raw)||(a==='flow'&&S.flowView)||(a==='tt'&&S.tt)||(a==='mgt'&&S.mgt);
  return (a==='start'||(a==='step'&&S.mode==='single'))?' go':(a==='stop'?' stop':(on?' on':'')); }
function renderSK(){ const tr=window.TNC_I18N?(x=>TNC_I18N.tr(x)):(x=>x);
  sks.innerHTML=skRows().map(([l,a])=>{ const k=skKey(a); return `<button class="sk${skClass(a)}" data-a="${esc(a)}">${esc(tr(l.replace(/\n/g,' '))===l.replace(/\n/g,' ')?l:tr(l.replace(/\n/g,' '))).replace(/\n/g,'<br>')}${k?`<small class="kh">${esc(k)}</small>`:''}</button>`; }).join('');
  pageSK(); renderPath(); }
function renderPath(){
  const el=$('skpath'); if(!el) return; let path=null, back='';
  if(S.wiz){ path=['PROGRAM',S.wiz.spec.title,'QUESTION '+(S.wiz.i+1)+' / '+S.wiz.spec.steps.length]; back='DEL (ESC) = ABORT · END = FINISH'; }
  else if(S.editing){ path=['PROGRAM','BLOCK '+nOf(S.cursor)]; back='ENT = STORE · ESC = CANCEL'; }
  else if(S.pick){ path=(S.pickPath||['PROGRAM']); back='ESC = ONE LEVEL UP'; }
  else if(S.mgt){ path=['PROGRAMS']; back='ESC / M = BACK TO THE PROGRAM'; }
  else if(S.tt){ path=['TOOL LIST','TOOL.T']; back='ESC / T / END = BACK'; }
  el.hidden=!path; if(path) el.innerHTML=path.map((x,i)=>i===path.length-1?`<b>${esc(x)}</b>`:esc(x)).join(' › ')+`<span class="back">${esc(back)}</span>`;
}
sks.addEventListener('click',e=>{ const b=e.target.closest('.sk'); if(b&&b.dataset.a) act(b.dataset.a); if(S.wiz||S.editing) dlgIn.focus(); });
function act(a){
  if(a.startsWith('w:')){ startWiz(DLG&&DLG.PATH[a.slice(2)]); return; }
  if(a.startsWith('cg:')){ const L=DLG.cycleList(a.slice(3));
    const G=(DLG.GROUPS.find(g=>g[0]===a.slice(3))||['',''])[1].replace(/\n/g,' ');
    S.pickPath=['PROGRAM','CYCL DEF',G];
    S.pick=L.map(c=>[c.num+'\n'+c.name.split(' ').slice(0,2).join(' '),'cy:'+c.num]).concat([['BACK','cycldef'],['END','pickend']]); renderSK(); return; }
  if(a.startsWith('cy:')){ S.pick=null; startWiz(DLG.cycleSpec(+a.slice(3))); return; }
  if(a.startsWith('wv:')){ wizAccept(a.slice(3)); return; }
  if(a.startsWith('wa:')){ ckAxis(a.slice(3)); return; }
  if(a.startsWith('wd:')){ ckDigit(a.slice(3)); return; }
  switch(a){
    case 'cycldef': if(!DLG) return; if(S.mode!=='edit') setMode('edit'); S.pickPath=['PROGRAM','CYCL DEF']; S.pick=DLG.GROUPS.map(g=>[g[1],'cg:'+g[0]]).concat([['END','pickend']]); renderSK(); break;
    case 'apprdep': if(S.mode!=='edit') setMode('edit'); S.pickPath=['PROGRAM','APPR / DEP']; S.pick=[['APPR','w:APPR'],['DEP','w:DEP'],['',''],['',''],['',''],['',''],['',''],['END','pickend']]; renderSK(); break;
    case 'pickend': S.pick=null; renderSK(); break;
    case 'wskip': wizAccept('',true); break; case 'wend': wizEnd(); break; case 'wcancel': wizCancel(); break; case 'wok': wizAccept(dlgIn.value); break;
    case 'wi': ckInc(); break; case 'wp': ckPolar(); break; case 'wq': ckQ(); break; case 'wsign': ckSign(); break; case 'wact': ckActual(); break; case 'wce': ckCE(); break;
    case 'ttmiss': addMissingTools(); break;
    case 'ttexp': if(window.TNC_PROFILE) download('TOOL_TNC'+S.machine+'.T',new Blob([TNC_PROFILE.toolT(mtools())],{type:'text/plain'}),'TOOL-TABLES'); break;
    case 'ttend': closeTT(); break;
    case 'redlg': reopenBlock(); break; case 'edok': endEdit(true); break; case 'edesc': endEdit(false); break; case 'wtext': wizToText(); break;
    case 'start': start(); break; case 'stop': stop(); break; case 'step': stepBlock(); break;
    case 'reset': reset(); break; case 'rs': reset(); start(); break;
    case 'v3': setView('3D'); break; case 'vt': setView('TOP'); break; case 'vf': setView('FRONT'); break; case 'vs': setView('SIDE'); break;
    case 'ovrd': S.ovr=Math.max(0,S.ovr-10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ovru': S.ovr=Math.min(150,S.ovr+10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ed': beginEdit(); break; case 'ins': insertBlock(); break; case 'del': deleteBlock(); break; case 'cp': copyBlock(); break;
    case 'undo': undo(); break; case 'redo': redo(); break; case 'rawt': toggleRaw(); break;
    case 'chk': compile(); say(S.res.errors.length?`CHECK: ${S.res.errors.length} ERROR(S)`:(S.events.some(e=>e.sev==='crash')?'CHECK: WILL CRASH — SEE CHECKS':'PROGRAM CHECKED OK')); break;
    case 'tt': S.tt?closeTT():openTT(); break; case 'flow': toggleFlow(); break; case 'mgt': openMgt(); break;
    case 'new': closeMgt(); openNew(); break; case 'open': openPgm(mgtNames()[S.mgtSel]); break;
    case 'load': loadFromDisk(); break; case 'save': saveH(); break;
    case 'restore': restoreOriginal(mgtNames()[S.mgtSel]); break; case 'mdel': deletePgm(mgtNames()[S.mgtSel]); break;
    case 'end': closeMgt(); break;
  }
}

/* ================= block editing — the dialog line ================= */
const dlgIn=$('dlg-in'), dlgPr=$('dlg-pr'), dlgHint=$('dlg-hint');
const lines=()=>S.text.split('\n');
function srcLine(bi){ return clamp(bi,0,lines().length-1); }     // one source line per block, blank lines included
/* E / ENTER / double click on a block. A polar block (LP, CP, CTP) opens in its dialog, question by question with the
   present values; every other block opens as text on the block line, as before (DIALOG there does the same for L, C …). */
function beginEdit(asText){
  const b=S.res.blocks[S.cursor]; if(!b) return;
  if(asText!==true&&DLG&&!S.insertPending){ const d=DLG.parseBlock(b.raw); if(d&&DLG.isPolar(DLG.PATH[d.id])){ reopenBlock(d); return; } }
  S.editing=true; S.running=false; dlgIn.disabled=false; dlgIn.value=b.raw||'';
  dlgPr.textContent='BLOCK '+(b.n==null?'':b.n); dlgHint.textContent='ENT accept · ESC cancel · TAB takes the grey suggestion';
  dlgIn.focus(); dlgIn.select(); ghostUpdate(); renderSK();
  setTimeout(()=>{ if(S.editing&&document.activeElement!==dlgIn){ dlgIn.focus(); ghostUpdate(); } },0);   // after a dialog closes
}
/* the block under the cursor back in its programming dialog (dialogs.js parseBlock / reopenSpec); storing it replaces the block */
function reopenBlock(d){
  const at=S.cursor, b=S.res.blocks[at]; if(!b||!DLG) return; d=d||DLG.parseBlock(b.raw);
  if(!d){ say('THIS BLOCK HAS NO DIALOG — EDIT IT AS TEXT'); return; }
  if(S.editing){ S.insertPending=false; S.editing=false; dlgIn.value=''; ghostShow(''); }
  startWiz(DLG.reopenSpec(d.id,d.v),at);
}

/* ================= ghost autosuggest in the block line (like zsh): low-contrast rest of a block, TAB takes it =================
   Empty line: the next thing the program still needs. Typing: your own program's lines first (newest first), then common blocks. */
const SUGG=['BLK FORM 0.1 Z X+0 Y+0 Z-20','BLK FORM 0.2 X+100 Y+100 Z+0','TOOL CALL 1 Z S2000','TOOL DEF 1 L+0 R+3','L Z+50 R0 FMAX M3','L X+0 Y+0 R0 FMAX',
  'L Z+2 R0 FMAX','L Z-2 R0 F150','L X+50 Y+0 RL F300','L X+0 Y+0 R0 F300','L Z+100 R0 FMAX M5','CC X+50 Y+50','C X+50 Y+50 DR+','CR X+50 Y+50 R+20 DR-',
  'CT X+50 Y+50','CP IPA+360 IZ-2 DR+','LP PR+20 PA+0 R0 F300','RND R5','CHF 5','APPR LCT X+0 Y+0 R5 RL F300','DEP LCT X-20 Y-20 R5 F1000',
  'CYCL DEF 200 DRILLING','CYCL CALL','M99','M30','M3','M5','M8','M9','LBL 1','LBL 0','CALL LBL 1','CALL LBL 1 REP 3/3','FN 0: Q1 = +0','Q1 = Q1 + 1','STOP'];
function nextNeeded(){
  const T=S.text.toUpperCase(), ls=lines(), prev=(ls[srcLine(S.cursor)-1]||'').toUpperCase();
  if(!/BLK\s+FORM\s+0\.1/.test(T)) return 'BLK FORM 0.1 Z X+0 Y+0 Z-20';
  if(!/BLK\s+FORM\s+0\.2/.test(T)) return 'BLK FORM 0.2 X+100 Y+100 Z+0';
  if(!/TOOL\s+CALL/.test(T)) return 'TOOL CALL '+((mtools()[3]||mtools()[0]||{t:1}).t)+' Z S2000';
  if(/TOOL\s+CALL/.test(prev)) return 'L Z+50 R0 FMAX M3';
  if(/CYCL\s+DEF|^\s*Q2\d\d\s*=/.test(prev)) return 'L X+0 Y+0 R0 FMAX M99';
  return '';
}
function suggestFor(typed){
  const t=typed.replace(/^\s+/,'').toUpperCase();
  if(!t) return nextNeeded();
  const own=lines().map(l=>l.replace(/^\s*\d+\s+/,'').replace(/\s*;.*$/,'').trim()).filter(Boolean).reverse();
  for(const c of own.concat(SUGG)){ const C=c.toUpperCase(); if(C.startsWith(t)&&C.length>t.length&&!/^(BEGIN|END)\s+PGM/.test(C)) return c; }
  return '';
}
let ghostEl=null;
function ghostEnsure(){
  if(ghostEl) return ghostEl;
  const wrap=document.createElement('span'); wrap.className='dlgwrap'; dlgIn.parentNode.insertBefore(wrap,dlgIn); wrap.appendChild(dlgIn);
  ghostEl=document.createElement('span'); ghostEl.className='ghost'; ghostEl.setAttribute('aria-hidden','true'); wrap.appendChild(ghostEl);
  return ghostEl;
}
function ghostShow(rest,typed){
  const g=ghostEnsure(); if(!rest){ g.innerHTML=''; g.dataset.full=''; return; }
  const cs=getComputedStyle(dlgIn); ['font','letterSpacing','paddingLeft','paddingTop','paddingRight','paddingBottom','borderLeftWidth','borderTopWidth'].forEach(k=>{ g.style[k]=cs[k]; });
  g.innerHTML=`<span class="gt">${esc(typed)}</span><span class="gs">${esc(rest)}</span>`;
}
function ghostUpdate(){
  if(!S.editing){ ghostShow(''); return; }
  const v=dlgIn.value, sug=suggestFor(v);
  if(!sug||dlgIn.selectionStart!==v.length&&v.length){ ghostShow(''); ghostEnsure().dataset.full=''; return; }
  const rest=v.trim()?sug.slice(v.replace(/^\s+/,'').length):sug;
  ghostShow(rest,v); ghostEl.dataset.full=sug;
}
function ghostAccept(){ const full=ghostEl&&ghostEl.dataset.full; if(!full) return false; dlgIn.value=full; dlgIn.setSelectionRange(full.length,full.length); ghostUpdate(); return true; }
dlgIn.addEventListener('input',ghostUpdate);
dlgIn.addEventListener('click',ghostUpdate);
function endEdit(accept){
  if(!S.editing) return;
  const val=dlgIn.value, pend=S.insertPending; S.insertPending=false; S.editing=false; dlgIn.disabled=true; dlgIn.value=''; ghostShow('');
  if(pend&&(!accept||!val.trim())){ const ls=lines(), i=srcLine(S.cursor); if(!(ls[i]||'').trim()){ ls.splice(i,1); setText(ls.join('\n')); moveCursor(i-1); } accept=false; }
  dlgPr.textContent='BLOCK'; dlgHint.textContent=T('dlg.hint');
  if(accept){ const ls=lines(), i=srcLine(S.cursor), ind=(ls[i].match(/^\s*/)||[''])[0];
    ls[i]=(S.res.blocks[S.cursor]&&S.res.blocks[S.cursor].indent?ind:'')+val.trim(); edit(ls.join('\n'),S.cursor,'BLOCK '+nOf(S.cursor)+' STORED'); }
  document.activeElement&&document.activeElement.blur(); renderSK();
}
function insertBlock(){ const ls=lines(); let i=srcLine(S.cursor); if(/^\s*(\d+\s+)?END\s+PGM/i.test(ls[i]||'')) i--;
  ls.splice(i+1,0,''); edit(ls.join('\n'),i+1); S.insertPending=true; beginEdit(); }
function deleteBlock(){ const ls=lines(); if(ls.length<=1) return; const i=srcLine(S.cursor), n=nOf(S.cursor);
  ls.splice(i,1); edit(ls.join('\n'),S.cursor,'BLOCK '+n+' DELETED — CTRL+Z TO UNDO'); }
function copyBlock(){ const ls=lines(), i=srcLine(S.cursor); ls.splice(i+1,0,ls[i]); edit(ls.join('\n'),S.cursor+1,'BLOCK COPIED'); }
dlgIn.addEventListener('keydown',e=>{ if(S.wiz){ if(wizKey(e)) e.preventDefault(); e.stopPropagation(); return; }
  if(S.editing&&(e.key==='Tab'||(e.key==='ArrowRight'&&dlgIn.selectionStart===dlgIn.value.length))&&ghostEl&&ghostEl.dataset.full){ e.preventDefault(); ghostAccept(); e.stopPropagation(); return; }
  if(S.editing&&e.key==='F2'){ e.preventDefault(); e.stopPropagation(); reopenBlock(); return; }
  if(e.key==='Enter'){ e.preventDefault(); endEdit(true); }
  else if(e.key==='Escape'){ e.preventDefault(); endEdit(false); } e.stopPropagation(); });
function toggleRaw(){
  S.raw=!S.raw; raw.hidden=!S.raw; crt.hidden=S.raw;
  renderSK(); if(S.raw){ raw.value=S.text; raw.focus(); say('RAW TEXT — TAB TO RETURN'); }
  else { if(raw.value!==S.text) edit(raw.value,S.cursor,'PROGRAM RE-COMPILED'); try{ crt.focus({preventScroll:true}); }catch{} }   // focus stays in the program, TAB goes on from there
}
raw.addEventListener('keydown',e=>{
  if(e.key==='Tab'){ e.preventDefault(); toggleRaw(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){ e.preventDefault(); toggleRaw(); saveH(); }
  e.stopPropagation(); });

/* ================= programs: open / new / delete / restore / save / load ================= */
function uniqueName(base){
  base=(base||'PGM').toUpperCase().replace(/\.H$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)||'PGM';
  let n=base+'.H', k=2; while(pg()[n]!=null){ n=base.slice(0,13)+'_'+k+'.H'; k++; } return n;
}
function openPgm(name){
  if(!name||pg()[name]==null) return;
  if(S.editing) endEdit(false);
  if(S.lesson&&name!==TEMP) endLesson(true);
  S.pgm=name; S.text=pg()[name]; raw.value=S.text; S.cursor=0; closeMgt(); compile(); persist(); recentPush(name);
  say('PGM '+name+' SELECTED');
  emit('program',{name,machine:S.machine});
}
/* a program handed in from outside (bridge.js: the web app's library). Same name = replaced, not renamed. */
function openExternal(name,text,{machine,tools}={}){
  if(machine&&MACHINES[machine]&&machine!==S.machine) setMachine(machine);
  if(Array.isArray(tools)){ S.tools[S.machine]=tools; }
  const n=String(name||'PGM').toUpperCase().replace(/\.[HI]$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)+'.H';
  if(pg()[n]==null){ pg()[n]=text; touchMeta(n,true); } else pg()[n]=text;
  delete UNDO[S.machine+':'+n]; delete REDO[S.machine+':'+n];
  openPgm(n); return n;
}
function addPgm(name,text,{open=true,project=true}={}){
  const n=uniqueName(name); pg()[n]=text; touchMeta(n,true);
  if(project&&S.active){ const p=S.projects.find(p=>p.id===S.active); if(p&&!p.pgms.some(r=>r.m===S.machine&&r.name===n)) p.pgms.push({m:S.machine,name:n}); }
  persist(); if(open) openPgm(n); return n;
}
function deletePgm(name){
  if(!name) return;
  if(S.orig[S.machine][name]!=null){ say('BUILT-IN PROGRAM — USE RESTORE ORIGINAL INSTEAD'); return; }
  if(!confirm(X('Delete {n}? This cannot be undone.',{n:name}))) return;
  delete pg()[name]; if(S.meta[S.machine]) delete S.meta[S.machine][name]; S.projects.forEach(p=>{ p.pgms=p.pgms.filter(r=>!(r.m===S.machine&&r.name===name)); });
  if(S.pgm===name){ S.pgm=Object.keys(pg())[0]; S.text=pg()[S.pgm]; compile(); }
  S.mgtSel=Math.min(S.mgtSel,mgtNames().length-1); persist(); renderMgt(); say(name+' DELETED');
}
function restoreOriginal(name){
  const o=S.orig[S.machine][name]; if(o==null){ say('NOT A BUILT-IN PROGRAM'); return; }
  if(pg()[name]===o){ say(name+' IS ALREADY ORIGINAL'); return; }
  if(S.pgm===name) edit(o,0,name+' RESTORED — CTRL+Z TO UNDO'); else { pg()[name]=o; persist(); say(name+' RESTORED'); }
  if(S.mgt) renderMgt();
}
function listing(text){                                  // numbered TNC listing, one block per line
  const m=M(); let r; try{ r=m.run(text); }catch(e){ return text; }
  return r.blocks.filter(b=>b.kind!=='BLANK').map(b=>b.indent?'  '+b.raw:b.n+' '+b.raw).join('\r\n')+'\r\n';
}
function saveH(){
  if(S.editing) endEdit(true);
  if(S.raw&&raw.value!==S.text) edit(raw.value);
  const name=S.pgm===TEMP?uniqueName('LESSON'):S.pgm;
  download(name,new Blob([listing(S.text)],{type:'text/plain'})); say('SAVED '+name);
}
let fileIn=null;
function loadFromDisk(){
  if(!fileIn){ fileIn=document.createElement('input'); fileIn.type='file'; fileIn.multiple=true; fileIn.accept='.h,.H,.i,.I,.txt,.nc,.zip,.t,.T,.json';
    fileIn.hidden=true; document.body.appendChild(fileIn); fileIn.onchange=()=>{ importFiles([...fileIn.files]); fileIn.value=''; }; }
  fileIn.click();
}
const cleanPgm=t=>String(t).replace(/\r/g,'').split('\n').map(l=>l.replace(/\s*~\s*$/,'')).join('\n').trim();
/* .H / .I programs, a project or profile .zip, a TOOL.T or a profile .json — all land here */
async function importFiles(files){
  if(!files.length) return;
  let last=null, n=0, renamed=0; const texts=[];
  for(const f of files){
    let res;
    try{ res=window.TNC_PROFILE?await TNC_PROFILE.readFile(f):{kind:'programs',files:[{name:f.name,text:await f.text(),machine:null}]}; }
    catch(e){ say('CANNOT READ '+f.name+': '+(e.message||e)); continue; }
    if(res.kind==='profile'){ openProfile(); profImportAsk(res.profile,f.name); return; }
    if(res.kind==='tools'){ mergeTools(res.tools); say('TOOL TABLE '+f.name+' — '+res.tools.length+' TOOLS LOADED'); continue; }
    if(res.kind!=='programs'){ say('UNKNOWN FILE '+f.name); continue; }
    for(const pf of res.files){
      const keep=S.machine; if(pf.machine&&MACHINES[pf.machine]) S.machine=pf.machine;
      const want=uniqueName(pf.name.replace(/\.[^.]+$/,'')), exact=pf.name.toUpperCase().replace(/\.[^.]+$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)+'.H';
      if(want!==exact) renamed++;
      const nm=addPgm(pf.name.replace(/\.[^.]+$/,''),cleanPgm(pf.text),{open:false}); texts.push(pf.text);
      if(S.machine===keep) last=nm; S.machine=keep; n++;
    }
  }
  const added=toolsFor(texts);                     // a program from another control brings its tools along
  if(last) openPgm(last);
  if(n) say(n+' PROGRAM(S) LOADED'+(renamed?' · '+renamed+' RENAMED (NAME TAKEN)':'')+(added?' · '+added+' TOOL(S) ADDED TO YOUR TABLE — CHECK RADII':''));
  if(S.mgt) renderMgt();
}
const colPgm=document.querySelector('.col-pgm');
colPgm.addEventListener('dragover',e=>{ e.preventDefault(); });
colPgm.addEventListener('drop',e=>{ e.preventDefault(); importFiles([...(e.dataTransfer.files||[])]); });
$('b-save').onclick=saveH;

/* ================= PGM MGT ================= */
const mgtEl=$('mgt');
const mgtNames=()=>Object.keys(pg()).filter(n=>n!==TEMP);
function openMgt(){ if(S.tt) closeTT(); if(S.wiz) wizCancel(); if(S.editing) endEdit(false); if(S.raw) toggleRaw(); S.running=false; S.mgt=true;
  S.mgtSel=Math.max(0,mgtNames().indexOf(S.pgm)); plist.hidden=true; $('flow').hidden=true; mgtEl.hidden=false;
  renderMgt(); renderSK(); $('pgm-path').textContent='TNC:\\  PROGRAMS'; setState('PROGRAMS'); showPane('pgm'); }
function closeMgt(){ if(!S.mgt) return; S.mgt=false; mgtEl.hidden=true; plist.hidden=S.flowView&&!!FLOW; $('flow').hidden=!(S.flowView&&FLOW);
  renderSK(); $('pgm-path').textContent='TNC:\\'+S.pgm; setState('READY'); }
function renderMgt(){
  const names=mgtNames();
  mgtEl.innerHTML=`<div class="mhd"><span>FILE NAME</span><span style="text-align:right">BYTES</span><span>STATUS</span><span></span></div>`+
    names.map((n,i)=>{ const t=pg()[n], o=S.orig[S.machine][n];
      const st=(n===S.pgm?'S':' ')+(o==null?'+':(t!==o?'*':' '));
      return `<div class="mrow${i===S.mgtSel?' sel':''}" data-i="${i}"><span>${esc(n)}</span><span class="by">${t.length}</span><span class="st">${st}</span><span></span></div>`; }).join('')+
    `<div class="mft">TNC:\\ · ${M().label} · ${names.length} FILES · S SELECTED · * MODIFIED · + YOURS</div>`;
  const sel=mgtEl.querySelector('.mrow.sel'); if(sel) sel.scrollIntoView({block:'nearest'});
}
mgtEl.addEventListener('click',e=>{ const r=e.target.closest('.mrow'); if(!r) return;
  const i=+r.dataset.i; if(i===S.mgtSel) openPgm(mgtNames()[i]); else { S.mgtSel=i; renderMgt(); } });
function mgtKey(e){
  const n=mgtNames().length, k=e.key;
  if(k==='ArrowUp'){ e.preventDefault(); S.mgtSel=(S.mgtSel-1+n)%n; renderMgt(); }
  else if(k==='ArrowDown'){ e.preventDefault(); S.mgtSel=(S.mgtSel+1)%n; renderMgt(); }
  else if(k==='Enter'){ e.preventDefault(); openPgm(mgtNames()[S.mgtSel]); }
  else if(k==='Escape'||k==='m'||k==='M'){ e.preventDefault(); closeMgt(); }
  else if(k==='n'||k==='N'){ e.preventDefault(); closeMgt(); openNew(); }
  else if(k==='l'||k==='L'){ e.preventDefault(); loadFromDisk(); }
  else if(k==='r'||k==='R'){ e.preventDefault(); restoreOriginal(mgtNames()[S.mgtSel]); }
  else if(k==='Delete'||k==='Backspace'||k==='d'||k==='D'){ e.preventDefault(); deletePgm(mgtNames()[S.mgtSel]); }
}
$('b-mgt').onclick=()=>S.mgt?closeMgt():openMgt();

/* projects: stored in the profile and kept readable (S.projects), no UI any more */

/* ================= flow view (flow.js) ================= */
let FLOW=null;
function flowUpdate(){ if(FLOW&&S.flowView&&S.res) try{ FLOW.update(S.res,S.ex); flowHighlight(); }catch(e){} }
function flowHighlight(){ if(FLOW&&S.flowView) try{ FLOW.highlight(S.running?S.execB:S.cursor); }catch(e){} }
function toggleFlow(){
  if(!window.TNC_FLOW){ say('FLOW VIEW IS NOT IN THIS BUILD YET'); return; }
  if(!FLOW){ try{ FLOW=TNC_FLOW.create($('flow'),{}); FLOW.onSelect=i=>{ moveCursor(i); const s=S.segs.find(x=>x.block===i); if(s&&!S.running) seek(s.t0+1e-6,false); }; }
    catch(e){ say('FLOW VIEW FAILED TO START'); return; } }
  S.flowView=!S.flowView; if(S.mgt) closeMgt();
  plist.hidden=S.flowView; $('flow').hidden=!S.flowView; $('b-view').setAttribute('aria-pressed',S.flowView);
  $('b-view').firstElementChild.textContent=T(S.flowView?'btn.listing':'btn.flow'); if(S.flowView) flowUpdate(); writePrefs(); showPane('pgm'); renderSK();
}
$('b-view').onclick=toggleFlow;
if(!window.TNC_FLOW) $('b-view').hidden=true;

/* ================= lessons: the coach ================= */
const coach=$('coach');
{ const tp=document.querySelector('.tp'), sc=tp&&tp.querySelector('.scrub'); if(tp) tp.insertBefore(coach,sc?sc.nextSibling:tp.firstChild); }   // the lesson text replaces the run controls, never the 3-D view
function lessonsOf(){ return M().lessons||window.TNC_LESSONS||null; }
function stepsFor(kind,L){
  if(kind==='learn') return L.steps.map(s=>({say:s.say,program:s.program,focus:s.focus,run:s.run}));
  return [
    {say:`**${L.title}**\n\n${L.blurb}\n\nPress **Next**: it runs, and you watch.`,program:L.broken,focus:null,run:false},
    {say:L.story+(L.silentNote?'\n\n'+L.silentNote:''),program:null,focus:null,run:true},
    {say:'**Why it happened**\n\n'+L.why,program:null,focus:null,run:false},
    {say:'**The fix** — loaded and running now.',program:L.fix,focus:null,run:true},
    {say:'**The rule**\n\n'+L.rule,program:null,focus:null,run:false}];
}
function startLesson(kind,idx){
  const Ls=lessonsOf(); if(!Ls) return; const L=(kind==='learn'?Ls.learn:Ls.breakit)[idx]; if(!L) return;
  closeModal(); if(S.mgt) closeMgt();
  S.lesson={kind,idx,L,steps:stepsFor(kind,L),i:0,prev:S.lesson?S.lesson.prev:S.pgm};
  coach.hidden=false; if(S.insp.open) inspClose(true);   // the lesson text sits under the view: the inspector flyout must not cover it
  document.querySelector('.tp').classList.add('lesson'); $('coach-k').textContent=T(kind==='learn'?'coach.learn':'coach.break');
  $('coach-t').textContent=L.title;
  coachStep(0); showPane('gfx');
}
function coachStep(i){
  const Ls=S.lesson; if(!Ls) return; i=clamp(i,0,Ls.steps.length-1); Ls.i=i; const st=Ls.steps[i];
  if(st.program){ pg()[TEMP]=st.program; S.pgm=TEMP; S.text=st.program; raw.value=S.text; S.cursor=0; compile(); }
  S.focus=st.focus||null;
  if(S.focus&&S.focus.length){ const bi=S.res.blocks.findIndex(b=>b.n===S.focus[0]&&!b.indent); if(bi>=0) S.cursor=bi; }
  markRows();
  $('coach-bd').innerHTML=md(st.say); $('coach-bd').scrollTop=0;
  $('coach-pg').textContent=(i+1)+' / '+Ls.steps.length;
  $('coach-back').disabled=i===0; $('coach-next').textContent=T(i===Ls.steps.length-1?'coach.finish':'coach.next');
  if(st.run){ reset(); if(S.speed===0) setSpeed(16,true); start(); } else if(st.program){ reset(); }
}
function endLesson(silent){
  if(!S.lesson) return; const prev=S.lesson.prev; S.lesson=null; S.focus=null; coach.hidden=true; document.querySelector('.tp').classList.remove('lesson');
  delete pg()[TEMP]; if(!silent){ S.pgm=pg()[prev]!=null?prev:Object.keys(pg())[0]; S.text=pg()[S.pgm]; raw.value=S.text; S.cursor=0; compile(); }
}
$('coach-x').onclick=()=>endLesson(false);
$('coach-back').onclick=()=>coachStep(S.lesson.i-1);
$('coach-next').onclick=()=>{ if(S.lesson.i>=S.lesson.steps.length-1){ lessonDone(S.lesson.kind,S.lesson.idx,S.lesson.L); endLesson(false); say('LESSON DONE'); } else coachStep(S.lesson.i+1); };
const LESSON_LS='tnc.lessons.v1';
function lessonsDone(){ try{ const o=JSON.parse(local.get(LESSON_LS)||'{}'); return o&&typeof o==='object'?o:{}; }catch{ return {}; } }
const lessonKey=(kind,idx,L)=>kind+':'+((L&&L.id)||idx);
function lessonDone(kind,idx,L){ const o=lessonsDone(); o[lessonKey(kind,idx,L)]=1; local.set(LESSON_LS,JSON.stringify(o)); }

/* ================= modals ================= */
let openModalEl=null;
let modalReturn=null;
function openModal(id){ const back=openModalEl?modalReturn:document.activeElement; closeModal(true); closeDrawer(true); tipHide();
  const m=$(id); m.hidden=false; openModalEl=m; modalReturn=back; S.running=false; setInert(true);
  const f=m.querySelector('[data-close]'); f&&f.focus(); }
function closeModal(keep){ if(!openModalEl) return; openModalEl.hidden=true; openModalEl=null; setInert(false);
  if(keep) return; const r=modalReturn; modalReturn=null; restoreFocus(r); }
/* background of a modal: not clickable, not focusable, not read */
function setInert(on){ ['.app','#scrim'].forEach(q=>{ const el=document.querySelector(q); if(el) el.inert=on; }); }
function restoreFocus(el){ if(!el||el===document.body) return;
  const ok=el.isConnected&&(el.checkVisibility?el.checkVisibility({visibilityProperty:true}):el.offsetParent!==null)&&!el.closest('[inert]');
  const t=ok?el:(isPhone()&&$('b-menu').offsetParent?$('b-menu'):null); if(t) try{ t.focus({preventScroll:true}); }catch(e){} }
/* Tab stays inside an open modal (WAI-ARIA dialog pattern) */
document.addEventListener('keydown',e=>{ if(e.key!=='Tab'||!openModalEl) return;
  const card=openModalEl.querySelector('.mcard')||openModalEl;
  const f=[...card.querySelectorAll('button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.offsetParent!==null);
  if(!f.length) return; const first=f[0], lastF=f[f.length-1];
  if(!card.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); lastF.focus(); }
  else if(!e.shiftKey&&document.activeElement===lastF){ e.preventDefault(); first.focus(); } },true);
document.querySelectorAll('.modal').forEach(m=>{
  m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('[data-close]')) closeModal(); });
});

/* ---------- HELP ---------- */
let helpTab='learn';
function openHelp(tab){ helpTab=tab||helpTab; openModal('m-help'); renderHelp(); }
$('help-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b){ helpTab=b.dataset.tab; renderHelp(); } });
function renderHelp(){
  [...$('help-tabs').children].forEach(b=>{ b.setAttribute('aria-selected',b.dataset.tab===helpTab); });
  const Ls=lessonsOf(), body=$('help-body'); body.onclick=null;
  if(helpTab==='ai'){ body.innerHTML=`<div class="prose"><p>${esc(T('help.ai.body'))}</p></div>`; return; }   // AI lives in New program › AI (aigen.js); the key is on the server
  if(helpTab==='keys'){ body.innerHTML='<div class="klist">'+KEYS.map(([k,d])=>`<div><kbd>${esc(X(k))}</kbd><span>${esc(X(d))}</span></div>`).join('')+'</div>'; return; }
  if(!Ls){ body.innerHTML=`<div class="prose"><p>${esc(T('help.none'))}</p></div>`; return; }
  if(helpTab==='learn'||helpTab==='break'){
    const learn=helpTab==='learn', list=learn?Ls.learn:Ls.breakit, kind=learn?'learn':'breakit', done=lessonsDone();
    body.innerHTML=`<div class="prose" style="margin-bottom:12px"><p>${esc(T(learn?'help.learn.lead':'help.break.lead'))}</p></div>`+
      `<div class="lgrid">${list.map((L,i)=>`<button type="button" class="lcard ${learn?'learn':'break'}" data-i="${i}"><span class="n">${esc(T(learn?'help.lesson':'help.pitfall'))} ${i+1}</span><span class="t">${esc(L.title)}</span>${done[lessonKey(kind,i,L)]?`<span class="dn">✓ ${esc(T('help.done'))}</span>`:''}<span class="b">${esc(L.blurb||'')}</span></button>`).join('')}</div>`;
    body.onclick=e=>{ const c=e.target.closest('.lcard'); if(c) startLesson(kind,+c.dataset.i); };
    return;
  }
  body.innerHTML='<div class="prose help-manual">'+(Ls.manual||[]).map(sec=>`<details><summary>${esc(sec.title)}</summary>${md(sec.body)}`+
    (sec.rows&&sec.rows.length?`<div class="tblw"><table><thead><tr>${sec.rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      sec.rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'')+'</details>').join('')+'</div>';
}
$('b-help').onclick=()=>openHelp();
$('b-helppage').onclick=()=>helpPage();
$('help-setup').onclick=()=>{ closeModal(true); setupOpen(0); };

/* ---------- NEW PROGRAM ---------- */
/* NEW PROGRAM: one dialog, two tabs. Manual = the name, then block by block; AI = describe the part: that view is aigen.js, mounted into #new-ai. */
function openNew(which){ openModal('m-new'); newGo(which||'scratch'); }
function newGo(w){
  w=w==='ai'?'ai':'scratch';
  [...$('new-tabs').children].forEach(b=>{ b.setAttribute('aria-selected',b.dataset.go===w); });
  $('new-scratch').hidden=w!=='scratch'; $('new-ai').hidden=w!=='ai';
  if(w==='scratch') $('ns-name').focus();   // the AI view (aigen.js) takes the focus itself when its panel is shown
}
$('new-tabs').addEventListener('click',e=>{ const g=e.target.closest('[data-go]'); if(g) newGo(g.dataset.go); });
$('ns-go').onclick=()=>{
  const name=($('ns-name').value.trim()||'MY_PART').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,16);
  const txt=[`BEGIN PGM ${name} MM`,`END PGM ${name} MM`].join('\n');     // what the control creates: nothing else
  GCDraft.clear($('ns-name')); closeModal(); addPgm(name,txt); setMode('edit'); moveCursor(0); showPane('pgm'); insertBlock();
  say('NEW PROGRAM — TYPE A BLOCK · TAB TAKES THE GREY SUGGESTION · ENT STORES · I INSERTS THE NEXT');
};

/* ---------- DEV ---------- */
let devTab='features';
const DEVTXT={features:()=>window.TNC_DEVLOG,history:()=>window.TNC_HISTORY};
function renderDev(){ [...$('dev-tabs').children].forEach(b=>{ b.setAttribute('aria-selected',b.dataset.tab===devTab); });
  $('dev-pre').textContent=(DEVTXT[devTab]&&DEVTXT[devTab]())||'Not written yet — in progress.'; }
$('dev-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b){ devTab=b.dataset.tab; renderDev(); } });
function openDev(){ openModal('m-dev'); renderDev(); }

/* ================= PROFILE: name, autosave, export / import, tool table ================= */
function profChip(saved){
  const b=$('b-prof'); if(!b) return;
  b.textContent=(PROF&&PROF.name)?PROF.name:T('prof.who');
  const t=PSTORE.lastSaved; b.setAttribute('data-tip',(PROF&&PROF.name?PROF.name+' · ':'')+(t?X('autosaved {t}',{t:t.toLocaleTimeString()}):X('not saved yet'))+(saved===false?' · '+X('STORAGE BLOCKED — EXPORT TO KEEP YOUR WORK'):''));
  b.classList.toggle('warn',saved===false);
  if(openModalEl===$('m-prof')) { const st=$('prof-saved'); if(st) st.textContent=t?X('Autosaved {t} — in this browser',{t:t.toLocaleTimeString()}):X('Not saved yet'); }
}
function openProfile(){ openModal('m-prof'); renderProfile(); }
function profCounts(){ let pg_=0; for(const id in S.pgms) for(const n in S.pgms[id]) if(n!==TEMP&&S.pgms[id][n]!==S.orig[id][n]) pg_++;
  return {programs:pg_, projects:S.projects.length, tools:Object.values(S.tools).reduce((a,t)=>a+(t||[]).length,0)}; }
function renderProfile(){
  const c=profCounts(), t=PSTORE.lastSaved;
  $('prof-body').innerHTML=`<div class="prose">${PROF&&PROF.name?'':`<h4>${esc(X('Welcome. What\'s your name?'))}</h4><p>${esc(X('Everything you make — programs, projects, tools, settings — is kept under your name in this browser and saved automatically. Export it to move it to another computer.'))}</p>`}</div>
<div class="fgrid" style="max-width:760px">
 <label class="fld wide"><span>${esc(X('YOUR NAME'))}</span><input id="prof-name" data-autosave-exempt="saved to the profile on every keystroke" maxlength="40" autocomplete="name" spellcheck="false" value="${esc(PROF&&PROF.name||'')}" placeholder="${esc(X('your name'))}"></label>
</div>
<p class="note" id="prof-saved" style="margin:8px 0 0">${esc(t?X('Autosaved {t} — in this browser',{t:t.toLocaleTimeString()}):X('Not saved yet'))}</p>
<p class="note" style="margin:4px 0 0">${esc(X('{p} program(s) of yours · {j} project(s) · {t} tool(s) of yours · machines: {m}',{p:c.programs,j:c.projects,t:c.tools,m:Object.values(MACHINES).map(m=>m.label).join(', ')}))}</p>

<div class="actrow"><button class="cbtn" id="prof-dldir">${esc(X('Downloads folder…'))}</button><span class="note" id="prof-dlnote">${esc(X(window.showDirectoryPicker?'Pick your Downloads folder once: files go to TNC-SIMULATOR/AI-GEN, USER-GEN, SETTINGS, TOOL-TABLES.':'This browser saves to Downloads as TNC-SIMULATOR_AI-GEN_… (Chrome/Edge can write the folders).'))}</span></div>
<div class="actrow"><button class="cbtn pri" id="prof-export">${esc(X('Export profile (.zip)'))}</button><button class="cbtn" id="prof-import">${esc(X('Import…'))}</button>
 <button class="cbtn" id="prof-new">${esc(X('Start a new profile…'))}</button></div>
<div id="prof-ask"></div>
<p class="note" style="margin-top:14px">${esc(X('The tool list (TOOL.T) is under Tools, next to Save .H, or key T.'))}</p>`;
  const nm=$('prof-name');
  nm.addEventListener('input',()=>{ PROF.name=nm.value.trim().slice(0,40); profChip(); persist(); });
  nm.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); nm.blur(); } });
  $('prof-export').onclick=exportProfile;
  $('prof-dldir').onclick=pickDlDir;
  $('prof-import').onclick=loadFromDisk;
  $('prof-new').onclick=newProfile;
  if(!(PROF&&PROF.name)) setTimeout(()=>nm.focus(),30);
}
function toolTableHTML(){
  return `<div class="tblw"><table class="ttab"><thead><tr><th>T</th><th>${esc(X('NAME'))}</th><th>L</th><th>R</th><th></th></tr></thead><tbody>${
  mtools().map(x=>`<tr data-t="${x.t}"${x.mine?' class="mine"':''}${x.t===curToolT?' data-cur="1"':''}><td>${x.t}${x.mine?' *':''}</td><td><input data-k="name" data-autosave="tool-${S.machine}-${x.t}-name" data-autosave-commit value="${esc(x.name)}" maxlength="16" aria-label="T${x.t} name"></td>
   <td><input data-k="l" data-autosave="tool-${S.machine}-${x.t}-l" data-autosave-commit inputmode="decimal" value="${(+x.l).toFixed(3)}" aria-label="T${x.t} length"></td><td><input data-k="r" data-autosave="tool-${S.machine}-${x.t}-r" data-autosave-commit inputmode="decimal" value="${(+x.r).toFixed(3)}" aria-label="T${x.t} radius"></td>
   <td>${x.mine?`<button data-del="${x.t}" data-tip="${esc(X('Remove your entry'))}" aria-label="${esc(X('Remove your entry'))} T${x.t}">×</button>`:''}</td></tr>`).join('')}</tbody></table></div>
<div class="actrow"><label class="fld" style="flex-direction:row;align-items:center;gap:6px"><span>T</span><input data-tt="new" data-autosave="new-tool" inputmode="numeric" style="width:70px" aria-label="${esc(X('New tool number'))}"></label>
 <button class="cbtn" data-tt="add">${esc(X('Add tool'))}</button><button class="cbtn" data-tt="missing">${esc(X('Add tools this program calls'))}</button>
 <button class="cbtn" data-tt="import">${esc(X('Import TOOL.T'))}</button><button class="cbtn" data-tt="export">${esc(X('Export TOOL.T'))}</button></div>`;
}
function wireToolTable(root,rerender){
  root.querySelectorAll('[data-tt]').forEach(b=>{ const k=b.dataset.tt; if(k==='new') return; b.onclick=()=>{
    if(k==='add'){ const t=parseInt(root.querySelector('[data-tt=new]').value,10); if(!(t>=0&&t<=32767)){ say('TOOL NUMBER 0–32767'); return; } mergeTools([{t,name:'T'+t,l:0,r:3}],true); GCDraft.clear(root.querySelector('[data-tt=new]')); }
    else if(k==='missing') addMissingTools();
    else if(k==='import') loadFromDisk();
    else if(k==='export'&&window.TNC_PROFILE) download('TOOL_TNC'+S.machine+'.T',new Blob([TNC_PROFILE.toolT(mtools())],{type:'text/plain'}),'TOOL-TABLES'); }; });
  const tb=root.querySelector('.ttab'); if(!tb) return;
  tb.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter') e.target.blur(); });
  tb.addEventListener('change',e=>{ const inp=e.target.closest('input'); if(!inp) return; GCDraft.clear(inp); const tr=inp.closest('tr'), t=+tr.dataset.t;
    const cur=mtools().find(x=>x.t===t); if(!cur) return; const v=inp.dataset.k==='name'?inp.value.trim().toUpperCase().slice(0,16)||('T'+t):parseFloat(String(inp.value).replace(',','.'));
    if(inp.dataset.k!=='name'&&!isFinite(v)){ say('NOT A NUMBER'); rerender(); return; }
    if(inp.dataset.k==='r'&&v<0){ say('RADIUS MUST BE ≥ 0'); rerender(); return; }
    const e2={t,name:cur.name,l:+cur.l,r:+cur.r}; e2[inp.dataset.k]=v; mergeTools([e2],true); });
  tb.addEventListener('click',e=>{ const d=e.target.closest('[data-del]'); if(!d) return; const t=+d.dataset.del;
    S.tools[S.machine]=(S.tools[S.machine]||[]).filter(x=>x.t!==t); persist(); curToolT=null; compile(); rerender(); say('T'+t+' REMOVED FROM YOUR TABLE'); });
}
function mergeTools(list,quiet){
  if(!S.tools[S.machine]) S.tools[S.machine]=[]; const mine=S.tools[S.machine];
  list.forEach(n=>{ const i=mine.findIndex(x=>x.t===n.t); const e={t:n.t,name:String(n.name||'T'+n.t).toUpperCase().slice(0,16),l:+n.l||0,r:+n.r||0}; if(i>=0) mine[i]=e; else mine.push(e); });
  persist(); curToolT=null; compile(); if(openModalEl===$('m-prof')) renderProfile(); if(S.tt) renderTT(); if(!quiet) say(list.length+' TOOL(S) IN YOUR TABLE');
}
/* uploaded programs: every TOOL CALL number missing from the table gets an entry (radius from ";T5 D=+8" or TOOL DEF, else R3) */
function toolsFor(texts){
  const have=new Set(mtools().map(t=>t.t)), add={};
  texts.forEach(t=>{ const hint={}, def=new Set();
    t.split(/\r?\n/).forEach(l=>{ let m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l); if(m) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2;
      m=/TOOL\s+DEF\s+(\d+)\s+L/i.exec(l); if(m) def.add(+m[1]); });
    t.split(/\r?\n/).forEach(l=>{ const m=/TOOL\s+CALL\s+(\d+)/i.exec(l); if(!m) return; const n=+m[1];
      if(n&&!have.has(n)&&!def.has(n)&&!add[n]) add[n]={t:n,name:'T'+n+(hint[n]!=null?'_D'+(hint[n]*2):''),l:0,r:hint[n]!=null?hint[n]:3}; }); });
  const list=Object.values(add); if(list.length) mergeTools(list,true); return list.length;
}
/* tools called by the program but missing from the table: radius from a CAM comment (";T5 D=+8") when there is one */
function addMissingTools(){
  const miss=[...new Set((S.res.errors||[]).map(e=>(/^TOOL (\d+) NOT DEFINED/.exec(e.msg)||[])[1]).filter(Boolean).map(Number))];
  if(!miss.length){ say('EVERY TOOL THIS PROGRAM CALLS IS IN THE TABLE'); return; }
  const hint={}; S.text.split('\n').forEach(l=>{ const m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l); if(m) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2; });
  mergeTools(miss.map(t=>({t,name:'T'+t+(hint[t]!=null?'_D'+(hint[t]*2):''),l:0,r:hint[t]!=null?hint[t]:3})),true);
  say(miss.length+' TOOL(S) ADDED'+(miss.some(t=>hint[t]==null)?' — CHECK THE RADII, SOME ARE GUESSES (R3)':' — RADII FROM THE PROGRAM COMMENTS'));
}
function exportProfile(){
  if(!window.TNC_PROFILE){ say('PROFILE MODULE MISSING FROM THIS BUILD'); return; }
  PROF=profileNow();
  const lst=(m,t)=>{ const keep=S.machine; S.machine=MACHINES[m]?m:keep; const r=listing(t); S.machine=keep; return r; };
  TNC_PROFILE.exportZip(PROF,lst).then(r=>{ download(r.name,r.blob,'SETTINGS'); say('PROFILE EXPORTED — '+r.count+' PROGRAM(S)'); }).catch(e=>say(String(e.message||e)));
}
function profImportAsk(inc,fname){
  const box=$('prof-ask'); if(!box) return;
  const n=Object.values(inc.machines||{}).reduce((a,m)=>a+Object.keys(m.pgms||{}).length,0);
  box.innerHTML=`<div class="warnbox" style="margin-top:12px"><b>${esc(fname)}</b> — ${esc(X('profile “{n}”, {p} program(s), {j} project(s).',{n:inc.name||X('unnamed'),p:n,j:(inc.projects||[]).length}))}<br>
   ${esc(X('Merge adds its programs, projects and tools to yours (name clashes get _IMP). Replace throws yours away — export first if unsure.'))}
   <div class="actrow"><button class="cbtn pri" id="imp-merge">${esc(X('Merge into mine'))}</button><button class="cbtn" id="imp-replace">${esc(X('Replace mine'))}</button><button class="cbtn" id="imp-cancel">${esc(X('Cancel'))}</button></div></div>`;
  $('imp-cancel').onclick=()=>{ box.innerHTML=''; };
  $('imp-merge').onclick=async()=>{ const m=TNC_PROFILE.merge(profileNow(),inc); m.profile.name=(PROF&&PROF.name)||inc.name||''; await finishImport(m.profile,'MERGED'+(m.renamed?' · '+m.renamed+' RENAMED':'')); };
  $('imp-replace').onclick=async()=>{ if(!confirm(X('Replace your whole profile with {n}? Your current programs will be gone.',{n:inc.name||X('this one')}))) return; await finishImport(inc,'REPLACED'); };
}
async function finishImport(prof,msg){
  clearTimeout(persistT); PROF=prof; await PSTORE.save(PROF); sess.set('tnc.flash','PROFILE '+msg);
  location.reload();                                  // a clean start on the imported state
}
async function newProfile(){
  if(!confirm(X('Start a new, empty profile? Your programs, projects and tools in this browser will be deleted.\n\nPress Cancel and use “Export profile” first if you want to keep them.'))) return;
  clearTimeout(persistT); await PSTORE.wipe(); try{ localStorage.removeItem(LS_KEY); }catch(e){}
  PROF=PSTORE.blank(''); await PSTORE.save(PROF); sess.set('tnc.askname','1'); location.reload();   // the new profile asks for its name once
}
if($('b-prof')) $('b-prof').onclick=()=>{ if(window.TNC_SHEET) TNC_SHEET.open(); else openProfile(); };


/* ================= programming dialogs (dialogs.js): one question per step, soft keys for the choices ================= */
const DLG=window.TNC_DIALOGS||null;
/* at = the block this dialog rewrites (a stored block opened again); without it the finished block is inserted after the cursor */
function startWiz(spec,at){
  if(!spec) return;
  if(S.mode!=='edit') setMode('edit');
  if(S.editing) endEdit(false); if(S.raw) toggleRaw(); if(S.mgt) closeMgt(); if(S.tt) closeTT();
  S.pick=null; S.running=false; S.wiz={spec, i:0, v:{}, at:at==null?null:at};
  dlgIn.disabled=false; wizShow();
}
function wizStep(){ return S.wiz.spec.steps[S.wiz.i]; }
function wizShow(){
  const st=wizStep(), d=st.dflt!=null&&st.dflt!==''?st.dflt:null;
  dlgPr.textContent=st.ask;
  dlgHint.textContent=S.wiz.spec.title+' · '+(S.wiz.i+1)+'/'+S.wiz.spec.steps.length+' · ENT '+(d!=null?'= '+d:(st.opt||st.type==='feed'||st.type==='m'?'= NONE':''))
    +(padStep(st)?' · '+(st.type==='coords'?'X 10 Y 20 · ':'')+'I INCR.'+(st.type==='coords'?' · P POLAR':''):'')+' · ⇧ENT NO ENT · END · ESC DEL';
  dlgIn.value=''; dlgIn.placeholder=d!=null?shown(String(d)):''; renderSK(); wizPreview(); dlgIn.focus();
}
/* the block as far as it is answered, in its screen form; a polar dialog says so */
function wizPreview(){ const el=$('dlg-prev'); if(!el) return; if(!S.wiz){ el.hidden=true; el.textContent=''; return; }
  const w=S.wiz, vv=Object.assign({},w.v); w.spec.steps.forEach((st,i)=>{ if(i>=w.i&&vv[st.k]==null&&st.dflt!=null&&w.at!=null) vv[st.k]=st.dflt; });
  el.hidden=false; el.innerHTML=(DLG.isPolar(w.spec)?`<span class="sys" id="dlg-sys">${esc(T('sys.polar'))}</span>`:'')+`<span class="blkp" id="dlg-blk">${esc(shown(DLG.preview(w.spec,vv)))}</span>`; }
function wizSK(){
  const st=wizStep(), tail=[['NO\nENT','wskip'],['ENT','wok'],['END','wend'],['DEL','wcancel']];   // manual 4.5 p. 67: NO ENT ignores, END ends, DEL aborts
  let k=[];
  if(st.type==='choice') k=st.opts.map(o=>[o,'wv:'+o]);
  else if(padStep(st)) k=wizPad(st);
  else if(st.type==='feed') k=[['F MAX','wv:FMAX'],['F AUTO','wv:FAUTO']];
  else if(st.type==='tool') k=mtools().slice(0,13).map(t=>['T'+t.t+'\n'+String(t.name).slice(0,10),'wv:'+t.t]);
  if(S.wiz.at!=null&&!padStep(st)) k=k.concat([['TEXT','wtext']]);          // a stored block: back to the block line
  return k.concat(tail);
}
function wizToText(){ if(!S.wiz||S.wiz.at==null) return; const at=S.wiz.at; wizDone(); S.cursor=at; markRows(); beginEdit(true); }
/* one answer: checked and normalised by TNC_DIALOGS.answer (dialogs.js; decimal comma or point, tested in tests/polar.js) */
function wizAccept(raw,skip){
  if(!S.wiz) return;
  const st=wizStep(), r=DLG.answer(st,raw,{skip:!!skip,axes:M().axes||['X','Y','Z']});
  if(r.err){ say(r.err); if(r.entry) dlgIn.focus(); else dlgIn.select(); return; }
  S.wiz.v[st.k]=r.v; S.wiz.i++;
  if(S.wiz.i>=S.wiz.spec.steps.length) wizFinish(); else wizShow();
}
/* ---- the coordinate keypad (TNC 426/430 keyboard, manual inside front cover: "Coordinate axes and numbers"):
   axis keys X Y Z IV V, 0-9, decimal point, -/+, P polar, I incremental, Q parameter, actual-position capture,
   NO ENT, ENT, END, CE, DEL. Every key works on the word being entered = the last word on the line.
   The PC keyboard does the same: axis letters, I, P, + -, # = actual position, DELETE = CE, SHIFT+ENTER = NO ENT.
   NOT verified against a control (key images only in the manual): I and -/+ toggle the word being entered,
   I after a word that has its value starts the next word (X 1 0 I Y 5 = X+10 IY+5, as typing x10iy5);
   CE pressed twice also drops the axis; "actual position" = the simulated tool position (DRO).
   PR / PA questions take bare (-90, I-90) and whole words (PA-90, IPA+60). ---- */
const padStep=st=>!!st&&(st.type==='coords'||!!st.pol);
function wizPad(st){
  const C=st.type==='coords', ax=M().axes||['X','Y','Z'], roman=['IV','V'];
  const axk=C?ax.slice(0,5).map((a,i)=>[i<3?a:roman[i-3]+'\n'+a,'wa:'+a]):[];   // 430: IV = B, V = A (machine axis order, machines.js)
  while(axk.length<5) axk.push(['','']);
  return axk.concat([['I','wi'],C?['P','wp']:['',''],['Q','wq']],
    '12345678'.split('').map(d=>[d,'wd:'+d]),
    [['9','wd:9'],['0','wd:0'],['.','wd:.'],['−/+','wsign'],C?['ACTUAL\nPOSITION','wact']:['',''],['CE','wce'],['',''],['','']]);
}
/* the word logic is TNC_DIALOGS.PAD (dialogs.js, tested in tests/manual.js); these put its result on the line */
function cwSet(line){ dlgIn.value=line; dlgIn.focus(); const L=dlgIn.value.length; dlgIn.setSelectionRange(L,L); }
function ckAxis(a){ if(S.wiz) cwSet(DLG.PAD.axis(dlgIn.value,a)); }
function ckDigit(d){ if(S.wiz) cwSet(DLG.PAD.digit(dlgIn.value,d)); }
function ckSign(force){ if(S.wiz) cwSet(DLG.PAD.sign(dlgIn.value,force)); }
function ckInc(){ if(S.wiz) cwSet(DLG.PAD.inc(dlgIn.value,wizStep().type==='coords')); }
function ckQ(){ if(S.wiz) cwSet(DLG.PAD.q(dlgIn.value)); }
function ckCE(){ if(S.wiz) cwSet(DLG.PAD.ce(dlgIn.value)); }
function ckPolar(){ if(!S.wiz) return; const sp=S.wiz.spec, t=sp.polar&&DLG&&DLG.PATH[sp.polar];
  if(wizStep().type!=='coords') return;
  if(!t){ say(sp.key==='CC'?'P: THE POLE CC IS ENTERED IN CARTESIAN COORDINATES ONLY':'P: NO POLAR FORM OF '+sp.title); return; }
  const no=sp.polarIf&&sp.polarIf(S.wiz.v); if(no){ say(no); return; }
  S.wiz={spec:t, i:S.wiz.i, v:S.wiz.v, at:null}; wizShow();              // answers so far are kept (APPR/DEP: the form)
  say('POLAR COORDINATES — '+(S.wiz.v.form?t.key.split(' ')[0]+' P'+S.wiz.v.form:t.title)); }
/* the simulator's "actual position" = the tool position at the current point of the run (the DRO) */
function actPos(){ const p=S.pos||{x:0,y:0,z:0}, s=S.seg, o={X:p.x,Y:p.y,Z:p.z}, u=s?clamp((S.t-s.t0)/Math.max(1e-9,s.t1-s.t0),0,1):0;
  (M().axes||[]).filter(a=>/[ABC]/.test(a)).forEach(a=>{ const k=a.toLowerCase(); o[a]=s&&s.a&&s.a[k]!=null?s.a[k]+((s.b[k]||0)-s.a[k])*u:0; });
  return o; }
const fmtPos=n=>(n<-5e-4?'-':'+')+(+Math.abs(n).toFixed(3));
function ckActual(){ if(!S.wiz||wizStep().type!=='coords') return; const c=DLG.PAD.word(dlgIn.value), P=actPos();
  if(c.a&&!c.n){ cwSet(c.head+c.a+fmtPos(P[c.a])); say('ACTUAL POSITION '+c.a+fmtPos(P[c.a])); return; }   // the selected axis
  const have=new Set((c.v.toUpperCase().match(/I?[XYZABC]/g)||[]).map(x=>x.slice(-1)));                        // no axis selected: the missing ones
  const add=(S.wiz.spec.key==='CC'?['X','Y']:['X','Y','Z']).filter(a=>!have.has(a)).map(a=>a+fmtPos(P[a]));
  if(!add.length) return; cwSet((c.v.trim()?c.v.trim()+' ':'')+add.join(' ')); say('ACTUAL POSITION '+add.join(' ')); }
function wizKey(e){
  if(!S.wiz||e.ctrlKey||e.metaKey||e.altKey) return false;
  const k=e.key;
  if(k==='Enter'){ if(e.shiftKey) wizAccept('',true); else wizAccept(dlgIn.value); return true; }
  if(k==='Escape'){ wizCancel(); return true; }
  if(k==='End'){ wizEnd(); return true; }
  if(k==='F2'&&S.wiz.at!=null){ wizToText(); return true; }
  const st=wizStep(); if(!padStep(st)) return false;
  if(k==='Delete'){ ckCE(); return true; }
  if(k==='#'&&st.type==='coords'){ ckActual(); return true; }
  const L=dlgIn.value.length; if(dlgIn.selectionStart!==L||dlgIn.selectionEnd!==L||k.length!==1) return false;   // caret inside the line: plain text editing
  if(k.toUpperCase()==='P'&&st.type==='coords'){ ckPolar(); return true; }
  const nl=DLG.PAD.type(dlgIn.value,k,st.type==='coords',M().axes||['X','Y','Z']);   // axis letters, I, + - (dialogs.js PAD)
  if(nl==null) return false; cwSet(nl); return true;
}
function wizEnd(){
  if(!S.wiz) return;
  if(dlgIn.value.trim()){ const i0=S.wiz.i; wizAccept(dlgIn.value); if(!S.wiz||S.wiz.i===i0) return; }   // END takes the entry on the line first — NOT VERIFIED: p. 67 says only "end the dialog immediately" (CONTINUE OPEN K1)
  while(S.wiz&&S.wiz.i<S.wiz.spec.steps.length){
    const st=wizStep(), d=st.dflt!=null&&st.dflt!==''?st.dflt:null;
    if(d==null&&!(st.opt||st.type==='feed'||st.type==='m'||st.type==='choice')){ wizShow(); say('ENTRY REQUIRED — '+st.ask); return; }
    S.wiz.v[st.k]=d!=null?d:(st.type==='choice'?st.opts[0]:''); S.wiz.i++;
  }
  if(S.wiz) wizFinish();
}
function wizDone(){ S.wiz=null; dlgIn.value=''; dlgIn.placeholder=''; dlgIn.disabled=true; dlgPr.textContent='BLOCK'; dlgHint.textContent=T('dlg.hint'); wizPreview(); renderSK(); }
function wizCancel(){ if(!S.wiz) return; wizDone(); say('DIALOG CANCELLED'); }
function wizFinish(){
  const txt=S.wiz.spec.build(S.wiz.v), add=txt.split('\n'), ls=lines(), at=S.wiz.at;
  if(at!=null){                                                                       // a stored block opened again: it is replaced, its indent kept
    const j=srcLine(at), ind=S.res.blocks[at]&&S.res.blocks[at].indent?(ls[j].match(/^\s*/)||[''])[0]:'';
    ls[j]=ind+add[0]; wizDone(); edit(ls.join('\n'),at,'BLOCK '+nOf(at)+' STORED — '+shown(add[0])); markRows(true); return; }
  let i=srcLine(S.cursor); if(/^\s*(\d+\s+)?END\s+PGM/i.test(ls[i]||'')) i--;                 // never after END PGM
  ls.splice(i+1,0,...add); wizDone();
  edit(ls.join('\n'),Math.min(i+1,Math.max(0,S.res.blocks.length)),'BLOCK STORED — '+add[0]);
  markRows(true);
}

/* ================= tool table in the machine view (T) ================= */
function openTT(){ if(S.wiz) wizCancel(); if(S.editing) endEdit(false); if(S.mgt) closeMgt(); S.tt=true;
  plist.hidden=true; $('flow').hidden=true; mgtEl.hidden=false; renderTT(); renderSK(); $('pgm-path').textContent='TNC:\\TOOL.T'; showPane('pgm'); }
function renderTT(){ const ms=mset(); mgtEl.innerHTML=`<div class="ttview"><div class="mhd" style="display:block">TOOL LIST · ${esc(M().label)} · TNC:\\TOOL.T · * = YOURS · ENT STORES A VALUE · T / END CLOSES</div>
  <div class="actrow" style="padding:6px 10px"><span class="note">L = gauge length, spindle face to tool tip. L = 0: measured on the machine — drawn at holder A + a typical stick-out, holder check off.</span>
  <label class="fld" style="flex-direction:row;align-items:center;gap:8px"><span>HOLDER</span><select id="tt-ht"><option value="ISO50">ISO 50 (SK50) · DIN 69871 ER32 · A = 100 mm</option><option value="SK40">SK40 · DIN 69871 ER32 · A = 70 mm</option></select></label></div>
  ${toolTableHTML()}</div>`;
  const ht=$('tt-ht'); ht.value=ms.holderType;
  ht.addEventListener('change',()=>{ ms.holderType=ht.value; persist(); curToolT=null; compile(); say('HOLDER '+ht.options[ht.selectedIndex].text); });
  wireToolTable(mgtEl,renderTT); const cur=mgtEl.querySelector('tr[data-cur]'); if(cur){ cur.style.outline='2px solid var(--cyan)'; cur.scrollIntoView({block:'nearest'}); } }
function closeTT(){ if(!S.tt) return; S.tt=false; mgtEl.hidden=true; plist.hidden=S.flowView&&!!FLOW; $('flow').hidden=!(S.flowView&&FLOW); renderSK(); $('pgm-path').textContent='TNC:\\'+S.pgm; }

/* ================= inspector: a 40 px rail on the right; its flyout opens over the view, the columns never reflow =================
   Collapsed by default, every time. The pointer resting on the rail opens it (a short intent delay) and leaving closes it, unless a
   click pinned it; F and the bottom bar's F toggle it pinned; a tap toggles it; the arrow keys on the focused rail open it and move
   into it; Esc or × closes it. Phones: it is the Status workspace, always there. */
var railB=$('insp-rail'), flyEl=$('insp-fly'), inspT=0;
function inspSync(){ const ph=isPhone(), o=S.insp.open&&!ph;
  flyEl.classList.toggle('open',o); railB.setAttribute('aria-expanded',String(o)); $('b-insp-k').setAttribute('aria-expanded',String(o));
  $('insp-pin').hidden=!(o&&S.insp.pinned); flyEl.inert=!ph&&!o; }
function inspOpenFly(pinned){ clearTimeout(inspT); S.insp.open=true; if(pinned) S.insp.pinned=true; inspSync(); }
function inspClose(keepFocus){ clearTimeout(inspT); const inside=flyEl.contains(document.activeElement); S.insp.open=false; S.insp.pinned=false; inspSync();
  if(inside&&!keepFocus) try{ railB.focus({preventScroll:true}); }catch(e){} }
function inspToggle(){ if(isPhone()){ showPane(paneNow()==='side'?'gfx':'side'); return; }
  if(S.insp.open&&S.insp.pinned) inspClose(); else inspOpenFly(true); }
function inspOpen(tab){ if(isPhone()) showPane('side'); else inspOpenFly(true); if(tab) setSideTab(tab); }
function inspPanel(panel){
  if(panel==='progs'){ if(window.TNC_SHEET) TNC_SHEET.open(); else openMgt(); return true; }   // programs live in the profile sheet now
  const tab={compare:'diag',diag:'diag',run:'diag',ref:'ref',manual:'ref'}[panel]; if(!tab) return false; inspOpen(tab);
  if(panel==='compare'){ const c=document.querySelector('.card-compare'); if(c) c.scrollIntoView({block:'nearest'}); } return true; }
{ const side=$('ws-side');
  side.addEventListener('pointerenter',e=>{ if(e.pointerType==='touch'||isPhone()) return; clearTimeout(inspT);
    if(!S.insp.open) inspT=setTimeout(()=>inspOpenFly(false),160); });
  side.addEventListener('pointerleave',e=>{ if(e.pointerType==='touch'||isPhone()) return; clearTimeout(inspT);
    if(S.insp.open&&!S.insp.pinned&&!flyEl.contains(document.activeElement)) inspT=setTimeout(()=>inspClose(true),280); });
}
railB.addEventListener('click',()=>{ if(S.insp.open&&S.insp.pinned) inspClose(); else inspOpenFly(true); });
railB.addEventListener('keydown',e=>{ if(!/^Arrow(Left|Down|Up|Right)$/.test(e.key)) return; e.preventDefault(); e.stopPropagation();
  inspOpenFly(true); const t=$('stabs').querySelector('[aria-selected="true"]'); if(t) requestAnimationFrame(()=>t.focus()); });
flyEl.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!isPhone()){ e.preventDefault(); e.stopPropagation(); inspClose(); } });
document.addEventListener('pointerdown',e=>{ if(!S.insp.open||isPhone()) return; if($('ws-side').contains(e.target)||$('b-insp-k').contains(e.target)||$('sb-chk').contains(e.target)) return;
  if(e.pointerType==='touch'||!S.insp.pinned) inspClose(true); },true);
$('insp-x').onclick=()=>{ inspClose(true); railB.focus(); };
$('b-insp-k').onclick=()=>inspToggle();
$('sb-chk').onclick=()=>{ inspOpen('diag'); const el=$('elist'); if(el) el.scrollIntoView({block:'nearest'}); };

/* ================= inspector tabs: RUN (state, checks, compare) · MANUAL (keys, cycles, tools, machine, the manual) ================= */
function setSideTab(t){ if(t!=='ref') t='diag'; S.sideTab=t; [...$('stabs').children].forEach(b=>{ b.setAttribute('aria-selected',b.dataset.tab===t); });
  ['diag','ref'].forEach(k=>{ const el=$('sp-'+k); if(el) el.hidden=k!==t; }); if(t==='ref') renderRef(); writePrefs(); }
$('stabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b) setSideTab(b.dataset.tab); });
function refOptions(){
  const o=[['keys','Keys'],['cycles','Cycles — CYCL DEF'],['tools','Tool list'],['machine','Machine: '+M().label]], Ls=lessonsOf();
  (Ls&&Ls.manual||[]).forEach((sec,i)=>{ o.push(['man:'+i,'Manual · '+sec.title]); });
  const sel=$('ref-sel'), cur=S.ref||'keys'; sel.innerHTML=o.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join(''); sel.value=o.some(x=>x[0]===cur)?cur:'keys';
}
$('ref-sel').addEventListener('change',()=>{ S.ref=$('ref-sel').value; renderRef(); writePrefs(); });
$('ref-sel').addEventListener('keydown',e=>e.stopPropagation());
function renderRef(){
  refOptions(); const v=$('ref-sel').value, b=$('ref-body'), Ls=lessonsOf();
  if(v==='keys') b.innerHTML='<table>'+KEYS.map(([k,d])=>`<tr><td class="k">${esc(X(k))}</td><td>${esc(X(d))}</td></tr>`).join('')+'</table>';
  else if(v==='cycles'&&DLG) b.innerHTML='<table>'+
    DLG.GROUPS.map(g=>`<tr><th colspan="2">${esc(g[1].replace(/\n/g,' '))}</th></tr>`+DLG.cycleList(g[0]).map(c=>`<tr class="cyc" data-cy="${c.num}"><td>${c.num}</td><td>${esc(c.name)}</td></tr>`).join('')).join('')+'</table>';
  else if(v==='tools') b.innerHTML='<table><tr><th>T</th><th>NAME</th><th>R</th><th>L</th></tr>'+
    mtools().map(t=>`<tr${t.t===curToolT?' class="now"':''}><td>${t.t}${t.mine?' *':''}</td><td>${esc(t.name)}</td><td>${(+t.r).toFixed(3)}</td><td>${(+t.l).toFixed(2)}</td></tr>`).join('')+'</table>';
  else if(v==='machine'){ const mc=M().machine; b.innerHTML=mc?`<table>
    <tr><td>Axes</td><td>${esc(M().axes.join(' '))}</td></tr>`+Object.entries(mc.limits).map(([a,l])=>`<tr><td>Limit ${a}</td><td>${l[0]} … ${l[1]}${'AB'.includes(a)?'°':' mm'}</td></tr>`).join('')+
    `<tr><td>Spindle max</td><td>${mc.sMax} rpm (MP 3515)</td></tr><tr><td>Feed max</td><td>${mc.fMax} mm/min (MP 1020)</td></tr>
     <tr><td>Rapid X Y Z</td><td>${mc.rapid.x} / ${mc.rapid.y} / ${mc.rapid.z} mm/min</td></tr><tr><td>Rapid A B</td><td>${mc.rapid.a} / ${mc.rapid.b} °/min</td></tr>
     <tr><td>Acceleration</td><td>${mc.accel} m/s² (MP 1060)</td></tr><tr><td>Arc end tolerance</td><td>${mc.arcTol} mm (MP 7431)</td></tr>
     <tr><td>Pocket overlap</td><td>${mc.pocketK} × R (MP 7430)</td></tr><tr><td>Head</td><td>B carries A · A+ → Y+ · B+ → X+ · pivots ≈ ${mc.head.pivotA} mm</td></tr>
     <tr><td>Cycle 19</td><td>positions A/B itself (MP 7500 bit 2)</td></tr></table>`
    :'<p>Generic TNC 426: no machine limits. Choose <b>TNC 430</b> in the machine selector for the operator\'s machine.</p>'; }
  else if(/^man:/.test(v)&&Ls){ const sec=Ls.manual[+v.slice(4)]; b.innerHTML=`<div class="prose"><h4>${esc(sec.title)}</h4>${md(sec.body)}`+
    (sec.rows&&sec.rows.length?`<div class="tblw"><table><thead><tr>${sec.rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${sec.rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'')+'</div>'; }
  b.onclick=e=>{ const c=e.target.closest('[data-cy]'); if(c) act('cy:'+c.dataset.cy); };
}

/* ================= Program menu (top bar): New · text editor · open · save · recent · all programs =================
   WAI-ARIA menu button: Enter / Space / ↓ open on the first item, ↑ on the last; ↑ ↓ Home End move; Esc closes and gives the focus
   back to the button; Tab or a click outside closes it. N and M inside it are the same shortcuts as outside. */
var pmBtn=$('b-pgm'), pmMenu=$('pgm-menu');
function pmItems(){ return [...pmMenu.querySelectorAll('[role=menuitem]')].filter(b=>!b.hidden&&b.offsetParent!==null); }
function pmOpen(last){ if(!pmMenu.hidden) return; tipHide(); recentRender(); pmMenu.hidden=false; pmBtn.setAttribute('aria-expanded','true');
  const it=pmItems(); const t=last?it[it.length-1]:it[0]; if(t) t.focus(); }
function pmClose(ret){ if(pmMenu.hidden) return; pmMenu.hidden=true; pmBtn.setAttribute('aria-expanded','false'); if(ret) pmBtn.focus(); }
pmBtn.addEventListener('click',()=>{ pmMenu.hidden?pmOpen():pmClose(true); });
pmBtn.addEventListener('keydown',e=>{ if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); pmOpen(e.key==='ArrowUp'); } });
pmMenu.addEventListener('keydown',e=>{ const it=pmItems(), i=it.indexOf(document.activeElement), k=e.key;
  e.stopPropagation();                                               // the menu owns its keys: no global shortcut fires behind it
  if(k==='ArrowDown'||k==='ArrowUp'){ e.preventDefault(); const j=i<0?0:(i+(k==='ArrowDown'?1:-1)+it.length)%it.length; it[j].focus(); }
  else if(k==='Home'||k==='End'){ e.preventDefault(); it[k==='Home'?0:it.length-1].focus(); }
  else if(k==='Escape'){ e.preventDefault(); pmClose(true); }
  else if(k==='Tab'){ pmClose(false); }
  else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(k==='n'||k==='N')){ e.preventDefault(); $('b-new').click(); }
  else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(k==='m'||k==='M')){ e.preventDefault(); $('pm-all').click(); } });
pmMenu.addEventListener('pointermove',e=>{ const b=e.target.closest('[role=menuitem]'); if(b&&document.activeElement!==b) b.focus({preventScroll:true}); });
document.addEventListener('pointerdown',e=>{ if(!pmMenu.hidden&&!$('pgmwrap').contains(e.target)) pmClose(false); },true);
function pmDo(fn){ return ()=>{ pmClose(false); fn(); }; }
function pmEditor(){ if(window.TNC_EDITOR) TNC_EDITOR.open(); else { if(S.mgt) closeMgt(); if(!S.raw) toggleRaw(); showPane('pgm'); } }
$('b-new').onclick=pmDo(()=>openNew());
$('pm-edit').onclick=pmDo(pmEditor);
$('pm-load').onclick=pmDo(loadFromDisk);
$('pm-save').onclick=pmDo(saveH);
$('pm-all').onclick=pmDo(()=>{ S.mgt?closeMgt():openMgt(); });   // like M: opens, or closes again
$('pm-rec').addEventListener('click',e=>{ const b=e.target.closest('[data-n]'); if(!b) return; pmClose(false);
  if(b.dataset.m!==S.machine) setMachine(b.dataset.m); openPgm(b.dataset.n); });
/* the last programs opened (this browser): name and machine, newest first */
var RECENT_LS='tnc.recent.v1';
function recentGet(){ try{ const a=JSON.parse(local.get(RECENT_LS)||'[]'); return Array.isArray(a)?a.filter(r=>r&&typeof r.n==='string'&&typeof r.m==='string'):[]; }catch{ return []; } }
function recentPush(n){ if(!n||n===TEMP) return; const a=recentGet().filter(r=>!(r.m===S.machine&&r.n===n)); a.unshift({m:S.machine,n}); local.set(RECENT_LS,JSON.stringify(a.slice(0,8))); recentRender(); }
function recentRender(){ const box=$('pm-rec'); if(!box) return;
  let list=recentGet().filter(r=>S.pgms[r.m]&&S.pgms[r.m][r.n]!=null);
  if(!list.length&&S.pgm&&S.pgm!==TEMP) list=[{m:S.machine,n:S.pgm}];
  box.innerHTML=list.slice(0,3).map(r=>`<button role="menuitem" type="button" tabindex="-1" class="rec" data-m="${esc(r.m)}" data-n="${esc(r.n)}">${esc(r.n)}${r.m!==S.machine?`<small>${esc((MACHINES[r.m]||{}).label||r.m)}</small>`:''}</button>`).join('')||'<div class="pm-none">—</div>'; }

/* ================= bottom bar: the panel keys, full screen, help as its own page, the Play edition ================= */
function openGear(){ if(window.TNC_SETPANEL) TNC_SETPANEL.open(); else openSettings(); }
function openView(){ if(window.TNC_SETPANEL) TNC_SETPANEL.open('view'); else openSettings('look'); }
$('b-viewk').onclick=()=>openView();
/* full screen: the Fullscreen API on the whole page (a user gesture = the browser's own permission); the key comes from Settings */
function fsEl(){ return document.fullscreenElement||document.webkitFullscreenElement||null; }
function fsKey(){ return (SET&&SET.get('fskey'))||'F11'; }
function fullscreen(){ const d=document.documentElement;
  if(fsEl()){ const ex=document.exitFullscreen||document.webkitExitFullscreen; if(ex) try{ const p=ex.call(document); if(p&&p.catch) p.catch(()=>{}); }catch(e){} return; }
  const rq=d.requestFullscreen||d.webkitRequestFullscreen;
  if(!rq||(document.fullscreenEnabled===false&&!document.webkitFullscreenEnabled)){ say(T('fs.denied')); return; }
  try{ const p=rq.call(d,{navigationUI:'hide'}); if(p&&p.catch) p.catch(()=>say(T('fs.denied'))); }catch(e){ say(T('fs.denied')); } }
function fsSync(){ const b=$('b-fs'); if(!b) return; const k=fsKey(); b.setAttribute('aria-pressed',String(!!fsEl())); $('b-fs-k').textContent=k;
  b.setAttribute('aria-label',T('sb.fs')+' ('+k+')'); b.setAttribute('aria-keyshortcuts',k); }
document.addEventListener('fullscreenchange',()=>{ fsSync(); requestAnimationFrame(resize); });
document.addEventListener('webkitfullscreenchange',()=>{ fsSync(); requestAnimationFrame(resize); });
$('b-fs').onclick=()=>fullscreen();
addEventListener('keydown',e=>{ const k=fsKey(); if(e.key!==k||e.ctrlKey||e.metaKey||e.altKey) return;
  const tg=e.target&&e.target.tagName; if(k.length===1&&(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT'||(e.target&&e.target.isContentEditable))) return;   // a letter key still types
  e.preventDefault(); e.stopPropagation(); fullscreen(); },true);
/* help as its own page: a new window built from the help content (works in the offline file); a full-page view when no window may open */
function helpBodyHTML(){ const Ls=lessonsOf(), tbl=rows=>`<div class="tblw"><table><thead><tr>${rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let h=`<h2>${esc(T('help.keys'))}</h2><div class="klist">`+KEYS.map(([k,d])=>`<div><kbd>${esc(X(k))}</kbd><span>${esc(X(d))}</span></div>`).join('')+'</div>';
  if(Ls&&Ls.manual&&Ls.manual.length) h+=`<h2>${esc(T('help.manual'))}</h2>`+Ls.manual.map(sec=>`<section><h3>${esc(sec.title)}</h3>${md(sec.body)}${sec.rows&&sec.rows.length?tbl(sec.rows):''}</section>`).join('');
  if(Ls&&Ls.learn&&Ls.learn.length) h+=`<h2>${esc(T('help.learn'))}</h2><ol>`+Ls.learn.map(L=>`<li><b>${esc(L.title)}</b> — ${esc(L.blurb||'')}</li>`).join('')+'</ol>';
  return `<div class="prose" style="max-width:none">${h}</div>`; }
function helpPage(){ const cs=getComputedStyle(document.documentElement), v=k=>cs.getPropertyValue(k).trim();
  const css=`body{margin:0;background:${v('--gc-canvas')};color:${v('--gc-ink')};font:15px/1.55 ${v('--gc-font-sans')};color-scheme:${cs.colorScheme||'dark'}}
main{max-width:880px;margin:0 auto;padding:24px 20px 60px}h1{font-size:20px;margin:0 0 16px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid ${v('--gc-line')};padding-bottom:4px}
h3{font-size:14.5px;margin:18px 0 6px}code,kbd{font-family:${v('--gc-font-mono')};font-size:.92em}code{background:${v('--gc-fill')};padding:0 4px}
.klist div{display:grid;grid-template-columns:150px 1fr;gap:10px;padding:4px 0;border-bottom:1px solid ${v('--gc-line')}}.klist kbd{font-weight:600}.klist span{color:${v('--gc-ink-2')}}
table{border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid ${v('--gc-line')};padding:4px 8px;text-align:left;vertical-align:top}td{font-family:${v('--gc-font-mono')}}
a{color:${v('--gc-accent')}}li{margin:.3em 0}`;
  const title=T('helppage.title'), body=helpBodyHTML();
  const doc=`<!DOCTYPE html><html lang="${esc(document.documentElement.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  let w=null; try{ w=window.open('','_blank'); }catch(e){ w=null; }
  if(w) try{ w.document.open(); w.document.write(doc); w.document.close(); try{ w.opener=null; }catch(e){} return w; }catch(e){ try{ w.close(); }catch(e2){} }
  /* no new window here (an embed, a blocker): the same help as a full-page view over the simulator */
  let pgEl=$('helppage'); if(pgEl) pgEl.remove();
  pgEl=document.createElement('div'); pgEl.className='helppage'; pgEl.id='helppage'; pgEl.setAttribute('role','dialog'); pgEl.setAttribute('aria-modal','true'); pgEl.setAttribute('aria-label',title);
  pgEl.innerHTML=`<div class="hp-bar"><b>${esc(title)}</b><button class="cbtn" type="button" id="hp-x">${esc(T('btn.close'))} <small aria-hidden="true">ESC</small></button></div><div class="hp-in">${body}</div>`;
  document.body.appendChild(pgEl); const ret=document.activeElement, close=()=>{ pgEl.remove(); setInert(false); restoreFocus(ret); };
  setInert(true); $('hp-x').onclick=close; pgEl.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape'){ e.preventDefault(); close(); } }); $('hp-x').focus(); return null; }
/* the Play edition: a quiet link where the web app serves /play (http(s), the core edition); none in the offline file or on GitHub Pages */
function playLink(){ const a=$('a-play'); if(!a) return; const ed=(SET&&SET.edition)||'core';
  a.hidden=!(/^https?:$/.test(location.protocol)&&!/\.github\.io$/i.test(location.hostname)&&ed==='core'); }

/* ================= Replay (cine.js, when present): a button by the speed chip, and a short offer when a run reaches its end ================= */
var offerT=0;
function replaySync(){ $('b-replay').hidden=!window.TNC_CINE; }
function replayOpen(){ $('replay-offer').hidden=true; if(window.TNC_CINE) try{ TNC_CINE.open(); }catch(e){ console.warn('replay',e); } }
function replayOffer(){ if(!window.TNC_CINE||(SET&&SET.get('replay')===false)) return; const o=$('replay-offer'); o.hidden=false;
  clearTimeout(offerT); offerT=setTimeout(()=>{ o.hidden=true; },8000); }
$('b-replay').onclick=replayOpen; $('replay-offer').onclick=replayOpen;

function shellReady(){ inspSync(); speedSync(); fsSync(); replaySync(); playLink(); recentRender(); }

if($('b-tools')) $('b-tools').onclick=()=>act('tt');


/* ================= machine selector ================= */
function setMachine(id){
  if(!MACHINES[id]||id===S.machine) return;
  if(S.lesson) endLesson(true);
  if(S.pgm!==TEMP) S.cur[S.machine]=S.pgm;
  S.machine=id; S.pgm=(S.cur[id]&&pg()[S.cur[id]]!=null)?S.cur[id]:Object.keys(pg())[0];
  if(!S.pgm){ S.pgm='NEW.H'; pg()[S.pgm]='BEGIN PGM NEW MM\nEND PGM NEW MM'; }
  S.text=pg()[S.pgm]; raw.value=S.text; S.cursor=0; curToolT=null; compile(); persist(); writePrefs();
  edSet('machine',id); machSync(); say(M().label+' SELECTED');
}
function machSync(){ document.querySelector('.ttl').textContent=M().label; $('mach-sel').value=S.machine; skinApply(); }
$('mach-sel').innerHTML=Object.values(MACHINES).map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
$('mach-sel').addEventListener('change',e=>{ setMachine(e.target.value); });
$('mach-sel').addEventListener('keydown',e=>e.stopPropagation());
$('mach-sel').closest('.machwrap').hidden=Object.keys(MACHINES).length<2;

/* ================= modes, toggles, keyboard ================= */
function setMode(m){ if(m!=='edit'){ if(S.wiz) wizCancel(); S.pick=null; } S.mode=m; document.body.dataset.mode=m;
  const tps=$('tp-state'); if(tps) tps.textContent=T('tp.'+m); [...document.querySelectorAll('.mode')].forEach(b=>{ b.setAttribute('aria-pressed',b.dataset.m===m); });
  if(!S.mgt) renderSK(); if(m==='edit'){ S.running=false; setState('EDITING'); } else setState('READY'); writePrefs(); }
$('modes').addEventListener('click',e=>{ const b=e.target.closest('.mode'); if(b) setMode(b.dataset.m); });
/* speed: one chip. The pointer on it + the wheel or ← →, the focus on it + ← → (↑ ↓), a click or a tap steps (Shift = back). Keys 5–9 as before. */
var SPEEDS=[1,4,16,64,0];
function speedSync(){ const v=$('spd-v'), c=$('spd-chip'); if(!v) return; const t=S.speed?S.speed+'×':'MAX'; v.textContent=t; c.dataset.s=String(S.speed);
  c.setAttribute('aria-label',T('aria.speed')+': '+t); }
function setSpeed(v,quiet){ if(!SPEEDS.includes(v)) v=16; S.speed=v; speedSync(); writePrefs();
  if(v===0&&S.running) runMax(); if(!quiet) say(v?'SPEED '+v+'×':'MAX — RUNS TO THE END OR THE FIRST CRASH'); }
function speedStep(d,wrap){ let i=SPEEDS.indexOf(S.speed); if(i<0) i=2; let j=i+d; j=wrap?(j+SPEEDS.length)%SPEEDS.length:clamp(j,0,SPEEDS.length-1); if(j!==i) setSpeed(SPEEDS[j]); }
{ const chip=$('spd-chip'); let acc=0, lastW=0, hov=false;
  chip.addEventListener('click',e=>speedStep(e.shiftKey?-1:1,true));
  chip.addEventListener('wheel',e=>{ e.preventDefault(); const now=performance.now(); if(now-lastW>400) acc=0;
    acc+=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX; lastW=now;
    if(Math.abs(acc)>=40){ speedStep(acc<0?1:-1,false); acc=0; } },{passive:false});
  chip.addEventListener('keydown',e=>{ const d={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[e.key]; if(!d) return; e.preventDefault(); e.stopPropagation(); speedStep(d,false); });
  chip.addEventListener('pointerenter',e=>{ if(e.pointerType!=='touch'){ hov=true; chip.classList.add('hov'); } });
  chip.addEventListener('pointerleave',()=>{ hov=false; chip.classList.remove('hov'); });
  /* while the pointer rests on the chip, ← → change the speed, not the run position */
  addEventListener('keydown',e=>{ if(!hov||openModalEl||e.ctrlKey||e.metaKey||e.altKey||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')) return;
    const tg=e.target&&e.target.tagName; if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT'||S.editing||S.raw||S.wiz) return;
    e.preventDefault(); e.stopPropagation(); speedStep(e.key==='ArrowRight'?1:-1,false); },true);
}
/* what the settings panel (setpanel.js) and other modules call: the view toggles, speed, theme, full screen, the inspector */
var VIEWB={fx:'b-fx',cool:'b-cool',fire:'b-fire',labels:'b-labels',vice:'b-vice'}, VIEWS_K={fx:'fx',cool:'fxCool',fire:'fxFire',labels:'labels',vice:'vice'};
UIAPI.view={
  get:()=>{ const on=id=>$(id)?$(id).dataset.on==='1':null;
    return {fx:!!S.fx,cool:!!S.fxCool,fire:!!S.fxFire,labels:!!S.labels,vice:!!S.vice,flow:!!S.flowView,pick:on('b-pick'),axes:on('b-vec'),
      material:$('mat-sel')?$('mat-sel').value:null,view:S.view,speed:S.speed,
      available:{fx:!!window.TNC_FX,cool:!!window.TNC_FX,fire:!!window.TNC_FX,labels:!!window.TNC_CALLOUTS,vice:true,flow:!!window.TNC_FLOW,
        pick:!!$('b-pick'),axes:!!$('b-vec'),material:!!$('mat-sel')}}; },
  set:(k,v)=>{
    if(VIEWB[k]){ if(!!S[VIEWS_K[k]]!==!!v) $(VIEWB[k]).click(); return true; }
    if(k==='flow'){ if(!!S.flowView!==!!v) toggleFlow(); return true; }
    if(k==='pick'||k==='axes'){ const b=$(k==='pick'?'b-pick':'b-vec'); if(b&&(b.dataset.on==='1')!==!!v) b.click(); return !!b; }
    if(k==='material'){ const sl=$('mat-sel'); if(sl&&sl.value!==v){ sl.value=v; sl.dispatchEvent(new Event('change')); } return !!sl; }
    if(k==='view'){ if(['3D','TOP','FRONT','SIDE'].includes(v)) setView(v); return true; }
    if(k==='speed'){ setSpeed(+v); return true; }
    return false; },
  keys:{fx:'P',cool:'K',fire:'B',labels:'L',view:'G'},
  materials:()=>$('mat-sel')?[...$('mat-sel').options].map(o=>({id:o.value,label:o.textContent})):[] };
UIAPI.setSpeed=v=>setSpeed(+v);
UIAPI.speeds=SPEEDS.slice();
UIAPI.setTheme=id=>SET?SET.set('theme',id):[];
UIAPI.fullscreen=()=>fullscreen();
UIAPI.inspector={open:tab=>inspOpen(tab),close:()=>inspClose(),toggle:()=>inspToggle(),get open(){ return !!S.insp.open; }};

function syncToggles(){ $('b-fx').dataset.on=S.fx?'1':'0'; $('b-cool').dataset.on=S.fxCool?'1':'0'; $('b-fire').dataset.on=S.fxFire?'1':'0';
  $('b-labels').dataset.on=S.labels?'1':'0'; $('b-vice').dataset.on=S.vice?'1':'0'; if(window.TNC_STOCK) TNC_STOCK.VICE.on=S.vice;
  ['b-fx','b-cool','b-fire','b-labels','b-vice'].forEach(id=>{ $(id).setAttribute('aria-pressed',String($(id).dataset.on==='1')); }); fxApply(); if(CO) CO.setVisible(S.labels); writePrefs(); }
function tog(k,label){ S[k]=!S[k]; syncToggles(); say(label+(S[k]?' ON':' OFF')); }
$('b-fx').onclick=()=>tog('fx','CHIPS & SPARKS'); $('b-cool').onclick=()=>tog('fxCool','COOLANT');
$('b-fire').onclick=()=>tog('fxFire','SMOKE & FIRE'); $('b-labels').onclick=()=>tog('labels','LABELS');
$('b-vice').onclick=()=>{ tog('vice','VICE'); compile(); };   // standard vice (TNC_STOCK.VICE): drawn + crash-checked; off = part on a fixture plate
if(!window.TNC_FX){ ['b-fx','b-cool','b-fire'].forEach(id=>{ $(id).hidden=true; }); }
if(!window.TNC_CALLOUTS) $('b-labels').hidden=true;
$('b-start').onclick=ncStart; $('b-stop').onclick=stop; $('b-reset').onclick=reset;      // run · pause (feed hold) · stop (reset to the start)
scrub.addEventListener('input',()=>{ S.running=false; seek(+scrub.value/1000*S.total,false); });

const KEYS=[['↑ ↓','Block cursor'],['← →','Scrub the run (Shift ×5)'],['ENTER','Step one block · edit in EDIT mode'],['ESC','Stop · cancel · close'],['F11','Full screen (Settings: the key)'],
  ['SPACE','NC START (what the mode does) / NC STOP'],['S · R','Single block · reset'],['E I D C','Edit · insert · delete · copy'],['CTRL+Z','Undo  (CTRL+SHIFT+Z / CTRL+Y redo)'],
  ['CTRL+S','Save as .H'],['CTRL+O','Load .H from your computer'],['TAB','Raw text editor (when no control has the focus; otherwise TAB moves the focus)'],['M','Programs'],['N','New program (manual or AI)'],['H','Help, lessons, manual'],
  [',','Settings'],['F2','A path block as its dialog (while editing a block) · back to text'],
  ['V','View and effects'],['G','3D / TOP / FRONT / SIDE'],['1 – 4','Operating mode'],['5 – 9','Speed 1× 4× 16× 64× MAX'],['T','Tool table'],['F','Inspector: open / close'],['PRG EDIT','Y CYCL DEF · W TOOL CALL · A APPR/DEP · Q Q-parameter · soft keys for L CC C CR CT CP RND CHF, TOOL DEF, LBL'],
  ['COORDINATES ?','X Y Z (B A) axis · I incremental · P polar · Q parameter · + − sign · # actual position · DELETE = CE · ENTER = ENT · ⇧ENTER = NO ENT · END · ESC = DEL'],['+ / −','Feed override'],
  ['P K B','Chips · coolant · smoke & fire'],['L','Labels'],['N (in a lesson)','Next lesson step'],['HOME/END','First / last block'],['PGUP/PGDN','Page']];

const VIEWS=['3D','TOP','FRONT','SIDE'];
addEventListener('keydown',e=>{
  const k=e.key, mod=e.ctrlKey||e.metaKey;
  if(openModalEl){ if(k==='Escape'){ e.preventDefault(); closeModal(); } return; }
  if(drawerOpen()){ if(k==='Escape'){ e.preventDefault(); closeDrawer(); } return; }
  if(!$('setup').hidden&&(k==='Escape'||$('setup').contains(e.target))){ if(k==='Escape'){ e.preventDefault(); setupClose(); } return; }
  if(e.target.closest&&e.target.closest('[role=tablist]')&&/^(Arrow|Home$|End$)/.test(k)) return;
  if((k==='Enter'||k===' ')&&e.target.matches&&e.target.matches('button:focus-visible,a:focus-visible,summary:focus-visible,[role=tab]:focus-visible')) return;
  if(mod&&k.toLowerCase()==='s'){ e.preventDefault(); saveH(); return; }
  if(mod&&k.toLowerCase()==='o'){ e.preventDefault(); loadFromDisk(); return; }
  if(mod&&!e.shiftKey&&!e.altKey&&k.toLowerCase()==='e'&&window.TNC_EDITOR){ e.preventDefault(); pmEditor(); return; }
  if(S.wiz){ if(e.target!==dlgIn) dlgIn.focus(); if(wizKey(e)) e.preventDefault(); return; }
  if(S.pick&&k==='Escape'){ e.preventDefault(); if(S.pickPath&&S.pickPath.length>2&&S.pickPath[1]==='CYCL DEF') act('cycldef'); else { S.pick=null; renderSK(); } return; }
  if(S.tt&&k==='Escape'){ e.preventDefault(); closeTT(); return; }
  if(S.editing&&e.target!==dlgIn){                               // editing a block: keys belong to the block line
    if(k==='Tab'){ e.preventDefault(); dlgIn.focus(); ghostAccept(); } else if(k==='Enter'){ e.preventDefault(); endEdit(true); } else if(k==='Escape'){ e.preventDefault(); endEdit(false); } else dlgIn.focus(); return; }
  if(S.editing||S.raw) return;
  const tg=e.target.tagName; if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT') return;
  if(mod&&(k==='y'||(k.toLowerCase()==='z'&&e.shiftKey))){ e.preventDefault(); redo(); return; }
  if(mod&&k.toLowerCase()==='z'){ e.preventDefault(); undo(); return; }
  if(mod||e.altKey) return;                                       // leave browser shortcuts alone
  if(S.mgt){ mgtKey(e); return; }
  const nb=(S.res.blocks||[]).length;
  switch(k){
    case 'ArrowUp': e.preventDefault(); moveCursor(S.cursor-1); followCursor(); break;
    case 'ArrowDown': e.preventDefault(); moveCursor(S.cursor+1); followCursor(); break;
    case 'ArrowLeft': e.preventDefault(); S.running=false; seek(S.t-(e.shiftKey?5:1),false); break;
    case 'ArrowRight': e.preventDefault(); S.running=false; seek(S.t+(e.shiftKey?5:1),false); break;
    case 'Enter': e.preventDefault(); if(S.mode==='edit') beginEdit(); else stepBlock(); break;
    case 'Escape': e.preventDefault(); if(!alarmEl.hidden) hideAlarm(); else stop(); break;
    case ' ': e.preventDefault(); S.running?stop():ncStart(); break;
    case 'Home': e.preventDefault(); moveCursor(0); break;
    case 'End': e.preventDefault(); moveCursor(nb-1); break;
    case 'PageUp': e.preventDefault(); moveCursor(S.cursor-12); break;
    case 'PageDown': e.preventDefault(); moveCursor(S.cursor+12); break;
    case 'Tab': if(e.target!==document.body&&e.target!==document.documentElement) break;   // a focused control: TAB moves the focus (keyboard access, no trap)
      e.preventDefault(); toggleRaw(); break;
    case 'Delete': e.preventDefault(); deleteBlock(); break;
    case '+': case '=': act('ovru'); break;
    case '-': case '_': act('ovrd'); break;
    default:{
      const K=k.toLowerCase();
      if(/^[1-4]$/.test(k)) setMode(['edit','test','single','full'][+k-1]);
      else if(/^[5-9]$/.test(k)) setSpeed([1,4,16,64,0][+k-5]);
      else if(/^F[1-4]$/.test(k)){ e.preventDefault(); setMode(['edit','test','single','full'][+k[1]-1]); }
      else if(K==='t') act('tt'); else if(K==='f') inspToggle(); else if(k===',') openGear();
      else if(K==='n'&&!S.lesson){ e.preventDefault(); openNew(); }
      else if(S.mode==='edit'&&K==='y') act('cycldef'); else if(S.mode==='edit'&&K==='w') act('w:TOOLCALL');
      else if(S.mode==='edit'&&K==='a') act('apprdep'); else if(S.mode==='edit'&&K==='q') act('w:Q');
      else if(K==='s') stepBlock(); else if(K==='r') reset();
      else if(K==='e'){ e.preventDefault(); beginEdit(); } else if(K==='i'){ e.preventDefault(); insertBlock(); }
      else if(K==='d'){ e.preventDefault(); deleteBlock(); } else if(K==='c'){ e.preventDefault(); copyBlock(); }
      else if(K==='m'){ e.preventDefault(); openMgt(); } else if(K==='h'){ e.preventDefault(); openHelp(); }
      else if(K==='v'){ openView(); } else if(K==='g'){ setView(VIEWS[(VIEWS.indexOf(S.view)+1)%4]); }
      else if(K==='p') $('b-fx').click(); else if(K==='k') $('b-cool').click(); else if(K==='b') $('b-fire').click();
      else if(K==='l') $('b-labels').click(); else if(K==='n'&&S.lesson) $('coach-next').click();
    }
  }
});

/* ================= phones: workspaces, drawer, dock, swipes =================
 * At ≤ 900 px the three columns become three workspaces (Program · Graphics · Status) in the page's
 * own vertical scroll, picked by the tab bar or a horizontal swipe. The soft keys (and the block line
 * in PRG EDIT) move into a dock fixed at the bottom so NC START / STOP / RESET are reachable from every
 * workspace; rows of more than 8 keys page like the control's soft-key row switch. The header keeps the
 * modes, the program, the run state and the check count; DEV, + NEW, LESSONS, AI, HELP, FOCUS and the
 * profile go into a drawer (MENU). Nodes are moved, never copied: one id, one handler, one state.
 * Wide screens are untouched. */
/* var + lookups, not const: these run from functions that may fire before this point of the file has executed */
var PHONE=matchMedia('(max-width:900px)');
function isPhone(){ return matchMedia('(max-width:900px)').matches; }
var mainEl=document.querySelector('.main');
function paneNow(){ return document.querySelector('.main').dataset.pane||'gfx'; }
var PANES=['pgm','gfx','side'], paneScroll={};
function paneTabs(){ return [...$('mtabs').querySelectorAll('[role=tab]')]; }
function showPane(p,how){ how=how||{}; if(!isPhone()||!PANES.includes(p)) return;
  const was=paneNow(); if(was!==p) paneScroll[was]=scrollY;
  mainEl.dataset.pane=p;
  paneTabs().forEach(b=>{ const on=b.dataset.pane===p; b.setAttribute('aria-selected',on); b.tabIndex=on?0:-1; });
  if(was!==p) scrollTo(0,paneScroll[p]||0);
  if(how.focus) $('mt-'+p).focus();
  requestAnimationFrame(resize); }
$('mtabs').addEventListener('click',e=>{ const b=e.target.closest('[role=tab]'); if(b) showPane(b.dataset.pane); });
/* Program → Graphics → Status: the neighbour in a direction, or null at the ends */
function paneStep(d){ const i=PANES.indexOf(paneNow())+d; return PANES[i]||null; }

/* tab lists (workspaces, status, help, DEV): arrow keys / Home / End move and select (WAI-ARIA tabs, automatic activation) */
document.addEventListener('keydown',e=>{ const list=e.target.closest&&e.target.closest('[role=tablist]'); if(!list||e.altKey||e.ctrlKey||e.metaKey) return;
  const tabs=[...list.querySelectorAll('[role=tab]')].filter(t=>t.offsetParent!==null), i=tabs.indexOf(e.target); if(i<0) return;
  const j=(list.getAttribute('aria-orientation')==='vertical'?{ArrowDown:i+1,ArrowUp:i-1,Home:0,End:tabs.length-1}:{ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:tabs.length-1})[e.key]; if(j==null) return;
  e.preventDefault(); e.stopPropagation(); const t=tabs[(j+tabs.length)%tabs.length]; t.focus(); t.click(); });
/* roving tabindex: only the selected tab is in the Tab order */
function rove(list){ const tabs=[...list.querySelectorAll('[role=tab]')]; if(!tabs.some(t=>t.getAttribute('aria-selected')==='true')) return;
  tabs.forEach(t=>{ t.tabIndex=t.getAttribute('aria-selected')==='true'?0:-1; }); }
document.querySelectorAll('[role=tablist]').forEach(l=>{ rove(l); new MutationObserver(()=>rove(l)).observe(l,{subtree:true,attributes:true,attributeFilter:['aria-selected']}); });

/* header: program · state, and the check count as a button that opens the checks */
function hdrStat(){ const el=$('hdr-stat'); if(!el) return; const st=TR(setState.last||''), t=S.pgm+'|'+st; if(el.dataset.t===t) return; el.dataset.t=t;
  el.innerHTML=`<b>${esc(S.pgm)}</b><span>&nbsp;· ${esc(st)}</span>`; }
var lastChecks=null;
function checksBadge(nErr,nCrash,nWarn){
  const bad=nErr+nCrash, n=bad+nWarn, tt=x=>window.TNC_I18N?TNC_I18N.t(x):x;
  const txt=n?(bad?bad+' '+tt(bad===1?'chk.error':'chk.errors'):'')+(bad&&nWarn?' · ':'')+(nWarn?nWarn+' '+tt(nWarn===1?'chk.warning':'chk.warnings'):''):tt('chk.clear');
  const he=$('hdr-err'); he.className='hdr-m hdr-err'+(bad?' bad':nWarn?' warn':'');
  $('hdr-err-t').textContent=n?(bad?'⚠ '+bad:'! '+nWarn):'✓'; he.setAttribute('aria-label',tt('panel.checks')+': '+txt);
  const bd=$('mt-badge'); bd.hidden=!n; bd.className='tbadge'+(bad?'':' warn'); bd.textContent=n?String(n):''; bd.setAttribute('aria-label',txt);
  const sc=$('sb-chk'); sc.className='sb-chk '+(bad?'bad':nWarn?'warn':'ok'); sc.textContent=tt('panel.checks')+': '+txt;
  const dot=$('insp-dot'); if(dot) dot.className='dot'+(bad?' bad':nWarn?' warn':'');
  const key=nErr+'/'+nCrash+'/'+nWarn; if(lastChecks!==null&&key!==lastChecks) announce(tt('panel.checks')+': '+txt); lastChecks=key; }
$('hdr-err').onclick=()=>$('sb-chk').click();

/* polite announcements: state changes and check counts only — never coordinates, frames or scrubbing */
function announce(msg){ const el=$('sr-live'); if(!el||!msg) return; clearTimeout(announce._t);
  announce._t=setTimeout(()=>{ el.textContent=''; requestAnimationFrame(()=>{ el.textContent=msg; }); },350); }

/* soft keys on phones: 8 at a time (2 × 4), ◀ ▶ switch the row */
var skPage=0, skSig='';
function pageSK(){ const sks=$('sks'), keys=[...sks.children], pager=$('skpager'), rows=Math.ceil(keys.length/8);
  const sig=keys.map(k=>k.dataset.a).join('|'); if(sig!==skSig){ skSig=sig; skPage=0; }
  if(!isPhone()||rows<2){ keys.forEach(k=>{ k.hidden=false; }); pager.hidden=true; return; }
  skPage=Math.min(skPage,rows-1); keys.forEach((k,i)=>{ k.hidden=Math.floor(i/8)!==skPage; });
  pager.hidden=false; $('sk-page').textContent=(window.TNC_I18N?TNC_I18N.t('sk.row'):'Row')+' '+(skPage+1)+' / '+rows; }
$('sk-prev').onclick=()=>{ const rows=Math.ceil(sks.children.length/8); skPage=(skPage-1+rows)%rows; pageSK(); };
$('sk-next').onclick=()=>{ const rows=Math.ceil(sks.children.length/8); skPage=(skPage+1)%rows; pageSK(); };

/* the drawer (phones): a modal dialog — focus inside, the rest inert, Esc / scrim / swipe right close it */
var hmore=$('hmore'), scrim=$('scrim');
function drawerOpen(){ return $('hmore').classList.contains('open'); }
function openDrawer(){ if(!isPhone()||drawerOpen()) return;
  hmore.setAttribute('role','dialog'); hmore.setAttribute('aria-modal','true'); hmore.classList.add('open'); scrim.hidden=false;
  $('b-menu').setAttribute('aria-expanded','true'); drawerInert(true); $('hmore-x').focus(); }
function closeDrawer(quiet){ if(!drawerOpen()) return; const hmore=$('hmore'), scrim=$('scrim'); hmore.classList.remove('open'); scrim.hidden=true; drawerInert(false);
  $('b-menu').setAttribute('aria-expanded','false'); if(!quiet) $('b-menu').focus(); }
function drawerInert(on){ [document.querySelector('.main'),$('mtabs'),$('dock'),...[...document.querySelector('.bar').children].filter(c=>c!==hmore)].forEach(el=>{ if(el) el.inert=on; }); }
$('b-menu').onclick=openDrawer; $('hmore-x').onclick=()=>closeDrawer(); scrim.onclick=()=>closeDrawer();
hmore.addEventListener('keydown',e=>{ if(!drawerOpen()) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeDrawer(); return; }
  if(e.key!=='Tab') return; const f=[...hmore.querySelectorAll('button')].filter(b=>!b.hidden&&b.offsetParent!==null); if(!f.length) return;
  if(e.shiftKey&&document.activeElement===f[0]){ e.preventDefault(); f[f.length-1].focus(); }
  else if(!e.shiftKey&&document.activeElement===f[f.length-1]){ e.preventDefault(); f[0].focus(); } });
/* drawer buttons that open a dialog or start something close the drawer first (menus stay on top of it) */
['b-new','pm-edit','pm-load','pm-save','pm-all','b-prof','b-gear','b-exit'].forEach(id=>{ const b=$(id); if(b) b.addEventListener('click',()=>closeDrawer(true),true); });

/* swipes: left / right on a workspace switches workspace; right on the drawer closes it.
 * Passive listeners only (vertical scroll and pinch zoom are never blocked). Ignored when the touch
 * starts on the 3-D view, a slider, a text field, the soft keys or anything that scrolls sideways,
 * when two fingers are down, while zoomed in, or when text is selected. A swipe only ever navigates. */
function swipeable(el,root){
  for(let n=el;n&&n!==root;n=n.parentElement){
    if(n.matches('canvas,input,textarea,select,[contenteditable],.sks,.skpager,.dlg,.dlgprev,.tp,.ghost')) return false;
    if(n.scrollWidth>n.clientWidth+2){ const ox=getComputedStyle(n).overflowX; if(ox==='auto'||ox==='scroll') return false; } }
  return true; }
function onSwipe(root,fn){ let s0=null;
  root.addEventListener('touchstart',e=>{ s0=null; if(e.touches.length!==1||!isPhone()) return;
    if(window.visualViewport&&visualViewport.scale>1.05) return; if(!swipeable(e.target,root)) return;
    const t=e.touches[0]; s0={x:t.clientX,y:t.clientY,t:performance.now(),dead:false}; },{passive:true});
  root.addEventListener('touchmove',e=>{ if(!s0) return; if(e.touches.length!==1){ s0=null; return; }
    const t=e.touches[0], dx=t.clientX-s0.x, dy=t.clientY-s0.y; if(Math.abs(dy)>30&&Math.abs(dy)>Math.abs(dx)) s0.dead=true; },{passive:true});
  root.addEventListener('touchcancel',()=>{ s0=null; },{passive:true});
  root.addEventListener('touchend',e=>{ if(!s0||s0.dead) { s0=null; return; } const t=e.changedTouches[0], dx=t.clientX-s0.x, dy=t.clientY-s0.y, dt=performance.now()-s0.t; s0=null;
    const sel=getSelection&&getSelection(); if(sel&&!sel.isCollapsed&&String(sel).trim()) return;
    if(Math.abs(dx)>=Math.max(64,innerWidth*.18)&&Math.abs(dx)>Math.abs(dy)*2&&dt<2500) fn(dx<0?1:-1); },{passive:true}); }
onSwipe(mainEl,d=>{ if(drawerOpen()||openModalEl) return; const p=paneStep(d); if(p) showPane(p); });
onSwipe(hmore,d=>{ if(d<0) closeDrawer(); });

/* layout follows the breakpoint: dock in or out, ARIA roles on the workspaces, canvas size */
const pgmCol=document.querySelector('.col-pgm'), dlgEl=document.querySelector('.col-pgm .dlg');
function layout(){ const phone=isPhone(), dock=$('dock'), act=document.activeElement;
  const parts=[dlgEl,$('dlg-prev'),$('skpath'),sks,$('skpager')];
  if(phone&&parts[0].parentElement!==dock) parts.forEach(n=>{ dock.appendChild(n); });
  if(!phone&&parts[0].parentElement===dock) parts.forEach(n=>{ pgmCol.appendChild(n); });
  const gear=$('b-gear'), gh=phone?$('gear-row'):$('sbar');                 // the settings gear: bottom bar, or the bottom of the drawer on phones
  if(gear.parentElement!==gh) gh.insertBefore(gear,gh.firstChild);
  const md=$('modes'), mh=phone?document.querySelector('.bar'):$('sbar');   // the operating modes: bottom bar, or the header on phones
  if(md.parentElement!==mh){ if(phone) mh.insertBefore(md,$('b-menu')); else mh.insertBefore(md,gear.nextSibling); }
  const hb=$('b-help');                                                       // help: the bottom bar, or the drawer on phones (no bottom bar there)
  if(phone&&hb.parentElement!==hmore){ hmore.insertBefore(hb,$('b-prof')); hb.className='hbtn'; }
  if(!phone&&hb.parentElement!==$('sbar')){ $('b-viewk').after(hb); hb.className='sbk'; }
  inspSync();
  if(act&&act!==document.activeElement&&act.isConnected) try{ act.focus({preventScroll:true}); }catch(e){}
  PANES.forEach(p=>{ const sec=$('ws-'+p); if(phone){ sec.setAttribute('role','tabpanel'); sec.setAttribute('aria-labelledby','mt-'+p); sec.removeAttribute('aria-label'); }
    else { sec.removeAttribute('role'); sec.removeAttribute('aria-labelledby'); sec.setAttribute('aria-label',T({pgm:'panel.program',gfx:'panel.testgfx',side:'btn.insp'}[p])); } });
  if(phone){ hmore.removeAttribute('aria-labelledby'); hmore.setAttribute('aria-labelledby','hmore-t'); showPane(paneNow()); }
  else { closeDrawer(true); hmore.removeAttribute('role'); hmore.removeAttribute('aria-modal'); hmore.removeAttribute('aria-labelledby'); }
  pageSK(); measure(); requestAnimationFrame(resize); }
/* CSS sizes: dock height, tab-bar height, and how much of the screen the software keyboard covers */
function measure(){ const r=document.documentElement.style, d=$('dock'), tb=$('mtabs');
  r.setProperty('--dock-h',(isPhone()?d.offsetHeight:0)+'px'); r.setProperty('--tabs-h',(isPhone()?tb.offsetHeight:0)+'px');
  r.setProperty('--bar-h2',(isPhone()?document.querySelector('.bar').offsetHeight:0)+'px');
  const vv=window.visualViewport; if(vv){ r.setProperty('--vvh',vv.height+'px'); r.setProperty('--vvt',vv.offsetTop+'px');
    r.setProperty('--kb',Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop))+'px'); } }
new ResizeObserver(measure).observe($('dock'));
if(window.visualViewport){ visualViewport.addEventListener('resize',measure); visualViewport.addEventListener('scroll',measure); }
PHONE.addEventListener('change',layout);
/* a field that gets focus inside a dialog or the dock stays above the software keyboard */
document.addEventListener('focusin',e=>{ if(!isPhone()) return; const t=e.target; if(!t.matches||!t.matches('input,textarea,select')) return;
  if(t.closest('.modal,.dock')) setTimeout(()=>{ measure(); if(t.closest('.modal')) t.scrollIntoView({block:'nearest'}); },300); });
layout();

/* ================= tooltips: on hover, on keyboard focus and on a tap (data-tip; the shortcut comes from data-key) ================= */
const tipEl=$('tip'); let tipT=0, tipFor=null;
function tipHide(){ clearTimeout(tipT); tipFor=null; if(tipEl) tipEl.hidden=true; }
function tipShow(el){ const t=el.getAttribute('data-tip'); if(!t||!el.isConnected) return; tipFor=el;
  const k=SET&&!SET.get('tips')?'':el.getAttribute('data-key');
  tipEl.innerHTML=esc(t)+(k?`<kbd>${esc(k)}</kbd>`:''); tipEl.hidden=false;
  const r=el.getBoundingClientRect(), w=tipEl.offsetWidth, h=tipEl.offsetHeight; let y=r.bottom+6; if(y+h>innerHeight-6) y=r.top-h-6;
  tipEl.style.left=clamp(r.left+r.width/2-w/2,6,Math.max(6,innerWidth-w-6))+'px'; tipEl.style.top=Math.max(6,y)+'px'; }
document.addEventListener('pointerover',e=>{ if(e.pointerType==='touch') return; const el=e.target.closest&&e.target.closest('[data-tip]'); if(el===tipFor) return;
  tipHide(); if(el) tipT=setTimeout(()=>tipShow(el),350); });
document.addEventListener('focusin',e=>{ const el=e.target.closest&&e.target.closest('[data-tip]'); if(el&&el.matches(':focus-visible')) tipShow(el); });
document.addEventListener('focusout',tipHide);
document.addEventListener('pointerdown',e=>{ const el=e.pointerType==='touch'&&e.target.closest&&e.target.closest('[data-tip]'); tipHide();
  if(el){ tipShow(el); tipT=setTimeout(tipHide,1600); } },true);
addEventListener('keydown',e=>{ if(e.key==='Escape') tipHide(); },true);
addEventListener('scroll',tipHide,true);
document.querySelectorAll('[data-key]').forEach(el=>{ const k=el.getAttribute('data-key'); if(k&&k.length<8) el.setAttribute('aria-keyshortcuts',k.replace(/^CTRL /,'Control+').replace(/^SPACE$/,'Space').replace(/^ESC$/,'Escape')); });

/* ================= settings (settings.js): applied here; the panel behind the gear =================
   Presentation only: language, controller skin, environment, graphics quality, motion, sound, hints. Nothing here reaches the interpreter. */
function envColors(){ const cs=getComputedStyle(document.documentElement), c=k=>{ const col=new THREE.Color(); try{ col.setStyle(cs.getPropertyValue(k).trim()||'#000'); }catch{} return col; };
  return {bg:c('--scene-bg'),grid:c('--scene-grid'),grid2:c('--scene-grid-2'),tint:c('--scene-tint'),ink:c('--gc-ink')}; }
function envApply(){ const h=document.documentElement; h.setAttribute('data-env',SET?SET.get('env'):'cold-steel');
  const ec=envColors(); scene.background=ec.bg.clone();
  hemiL.color.copy(ec.ink).lerp(ec.tint,.3); hemiL.groundColor.copy(ec.bg); fillL.color.copy(ec.ink).lerp(ec.tint,.55);
  if(gGrid&&gGrid.parent&&ST){ const par=gGrid.parent; par.remove(gGrid); gGrid.geometry.dispose(); gGrid.material.dispose(); gGrid=makeGrid(); par.add(gGrid); }
  emit('env',{name:h.getAttribute('data-env'),colors:ec}); }
function makeGrid(){ const st=ST, ec=envColors(), g=new THREE.GridHelper(Math.max(st.x1-st.x0,st.y1-st.y0)*2,20,ec.grid,ec.grid2);
  g.rotation.x=Math.PI/2; g.position.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z0-0.3); return g; }
function qualityApply(){ const q=SET?SET.get('quality'):'high', dpr=window.devicePixelRatio||1;
  renderer.setPixelRatio(q==='low'?1:Math.min(dpr,q==='medium'?1.5:2));
  if(window.TNC_LOOK) try{ TNC_LOOK.set({fxaa:q!=='low'}); }catch{}
  document.documentElement.setAttribute('data-quality',q); resize(); }
function motionApply(){ if(SET) REDUCED=SET.reducedMotion(); document.documentElement.setAttribute('data-motion',REDUCED?'reduced':'full'); if(REDUCED) S.shake=0; }
try{ matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',motionApply); }catch{}
function skinApply(){ document.documentElement.setAttribute('data-skin',SET?SET.skinFor(S.machine):(S.machine==='430'?'430':'426')); requestAnimationFrame(resize); }
function tipsApply(){ document.documentElement.setAttribute('data-tips',SET&&!SET.get('tips')?'off':'on'); }
function themeApply(){ const ids=(window.TNC_THEMES||[]).map(t=>t.id), t=SET?SET.get('theme'):'night';
  document.documentElement.setAttribute('data-theme',ids.includes(t)?t:'night'); }
function settingsApply(){ themeApply(); motionApply(); tipsApply(); envApply(); qualityApply(); skinApply(); }
/* what the web app is told (bridge tnc:settings) and may set (tnc:present): the effective values */
function presentNow(){ return {lang:LANG(), skin:SET?SET.skinFor(S.machine):'426', env:SET?SET.get('env'):'cold-steel', theme:SET?SET.get('theme'):'night', quality:SET?SET.get('quality'):'high',
  motion:REDUCED?'reduced':'full', sound:!!S.sound}; }
UIAPI.settings=presentNow;
UIAPI.present=o=>SET?SET.set(o,{silent:true}):[];
if(SET) SET.on((keys,o)=>{
  if(keys.includes('lang')){ if(window.TNC_I18N) TNC_I18N.set(SET.get('lang')); langSync(); }
  else if(keys.includes('decimal')){ if(S.res) renderList(); if(S.wiz){ const d=wizStep().dflt; dlgIn.placeholder=d!=null&&d!==''?shown(String(d)):''; wizPreview(); } }
  if(keys.includes('theme')){ themeApply(); envApply(); }
  if(keys.includes('env')&&!keys.includes('theme')) envApply();
  if(keys.includes('fskey')) fsSync();
  if(keys.includes('keepgoing')) compile();
  if(keys.includes('quality')) qualityApply();
  if(keys.includes('motion')) motionApply();
  if(keys.includes('skin')) skinApply();
  if(keys.includes('sound')){ S.sound=!!SET.get('sound'); writePrefs(); }
  if(keys.includes('tips')) tipsApply();
  if(openModalEl===$('m-set')) renderSettings();
  if(!$('setup').hidden) setupRender();
  if(keys.some(k=>k!=='setup'&&k!=='tips')) emit('settings',presentNow(),o||{});
});
/* everything written by script follows a language change */
function langSync(){
  document.documentElement.lang=(LOCALES[LANG()]||{html:LANG()}).html; renderSK(); if(S.res){ renderList(); renderChecks(); renderKV(); renderCompare(); } viewLabel();
  const st=TR(setState.last||''); $('run-state').textContent=st; $('sb-state').textContent=st; $('hdr-stat').dataset.t=''; hdrStat();
  $('tp-state').textContent=T('tp.'+S.mode); lockText(); profChip(); recentRender(); speedSync(); fsSync(); if(S.sideTab==='ref') renderRef();
  $('b-view').firstElementChild.textContent=T(S.flowView?'btn.listing':'btn.flow');
  if(S.lesson){ $('coach-k').textContent=T(S.lesson.kind==='learn'?'coach.learn':'coach.break'); $('coach-next').textContent=T(S.lesson.i===S.lesson.steps.length-1?'coach.finish':'coach.next'); }
  else $('coach-next').textContent=T('coach.next');
  if(!S.wiz&&!S.editing) dlgHint.textContent=T('dlg.hint'); if(S.wiz) wizPreview();
  if(openModalEl===$('m-help')) renderHelp(); if(openModalEl===$('m-prof')) renderProfile();
  document.querySelectorAll('[data-label]').forEach(b=>{ b.textContent=X(b.dataset.label); });           // plugin controls (viz.js)
  document.querySelectorAll('[data-aria]').forEach(b=>{ b.setAttribute('aria-label',X(b.dataset.aria)); });   // (materials.js)
  if(S.tt) renderTT();
  layout();
}
function lockText(){ const el=$('sb-lock'); if(el) el.textContent=S.lock?T('lock.title')+' · '+(S.lock.reason||T('lock.default')):''; }
/* the tool table handed in from outside (bridge tnc:tools:set): checked, then stored like the operator's own TOOL.T */
function setTools(list){
  if(!Array.isArray(list)||list.length>999) return false;
  const out=[]; for(const t of list){ if(!t||typeof t!=='object') return false; const n=+t.t, l=+t.l, r=+t.r;
    if(!Number.isInteger(n)||n<0||n>32767||!Number.isFinite(l)||!Number.isFinite(r)||r<0) return false;
    out.push({t:n,name:String(t.name==null?'TOOL_'+n:t.name).slice(0,32),l,r}); }
  S.tools[S.machine]=out; curToolT=null; compile(); persist(); if(S.tt) renderTT(); return true;
}

let setTab='general';
function openSettings(tab){ if(tab) setTab=tab; openModal('m-set'); renderSettings(); }
$('b-gear').onclick=()=>openGear();
$('set-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b){ setTab=b.dataset.tab; renderSettings(); } });
const segHTML=(key,opts,cur,label)=>`<div class="seg" role="radiogroup" aria-label="${esc(label)}" data-set="${key}">`+
  opts.map(([v,l])=>`<button type="button" role="radio" aria-checked="${String(v)===String(cur)}" data-v="${esc(v)}">${esc(l)}</button>`).join('')+'</div>';
const swatchHTML=(key,opts,cur,label,cols)=>`<div class="swatch" role="radiogroup" aria-label="${esc(label)}" data-set="${key}" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">`+
  opts.map(([v,l,pv])=>`<button type="button" role="radio" aria-checked="${String(v)===String(cur)}" data-v="${esc(v)}"><span class="pv ${pv}" aria-hidden="true"><i></i><u></u></span><span class="nm">${esc(l)}</span></button>`).join('')+'</div>';
const srow=(l,d,c,col)=>`<div class="srow${col?' col':''}"><span class="sl">${esc(l)}</span><span class="sd">${esc(d)}</span><div class="sc">${c}</div></div>`;
const themeHTML=cur=>`<div class="swatch" role="radiogroup" aria-label="${esc(T('set.theme'))}" data-set="theme" style="grid-template-columns:repeat(3,minmax(0,1fr))">`+
  (window.TNC_THEMES||[]).map(t=>`<button type="button" role="radio" aria-checked="${t.id===cur}" data-v="${esc(t.id)}"><span class="pv" aria-hidden="true" style="background:${t.swatch[0]};grid-template-columns:1fr 6px"><i style="background:${t.swatch[1]};border:1px solid ${t.swatch[2]}33"></i><u style="background:${t.swatch[3]}"></u></span><span class="nm">${esc(t.name[LANG()]||t.name.en)}</span></button>`).join('')+'</div>';
const sbtn=(id,l)=>`<button class="cbtn" type="button" id="${id}">${esc(T(l))}</button>`;
const LANGS=Object.keys(LOCALES).map(k=>[k,LOCALES[k].name]);
function diagText(){ const gl=renderer.getContext(), st=S.res&&S.res.stats||{}, t=PSTORE.lastSaved;
  return ['edition    '+((SET&&SET.edition)||'core'), 'embedded   '+((window.TNC_BRIDGE||{}).embedded?'yes':'no')+' · server '+(window.TNC_BACKEND?'yes':'no'),
    'engine     tnc-core WebAssembly · '+(window.TNC_ENGINE&&TNC_ENGINE.ready()?'loaded':'not loaded'),
    'three.js   r'+THREE.REVISION+' · WebGL2 '+(typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext?'yes':'no')+' · pixel ratio '+renderer.getPixelRatio(),
    'viewport   '+innerWidth+' x '+innerHeight+' · reduced motion '+(REDUCED?'yes':'no'),
    'machine    '+M().label+' · '+S.pgm+' · '+(S.res?S.res.blocks.length:0)+' blocks · '+S.segs.length+' moves · '+(S.res&&S.res.errors?S.res.errors.length:0)+' errors',
    'run        '+(setState.last||'')+' · t '+S.t.toFixed(1)+' / '+S.total.toFixed(1)+' s · feed path '+(+st.pathFeed||0).toFixed(0)+' mm',
    'settings   '+JSON.stringify(SET?SET.all():{}), 'profile    '+(t?'autosaved '+t.toLocaleTimeString():'not saved yet')].join('\n'); }
function renderSettings(){
  [...$('set-tabs').children].forEach(b=>{ b.setAttribute('aria-selected',b.dataset.tab===setTab); });
  const b=$('set-body'), g=k=>SET?SET.get(k):null; let h='';
  if(setTab==='general') h=srow(T('set.lang'),T('set.lang.d'),segHTML('lang',LANGS,g('lang'),T('set.lang')))+
    srow(T('set.decimal'),T('set.decimal.d'),segHTML('decimal',[['auto',T('dec.auto')],['comma',T('dec.comma')],['point',T('dec.point')]],g('decimal'),T('set.decimal')))+
    srow(T('set.motion'),T('set.motion.d'),segHTML('motion',[['auto',T('motion.auto')],['full',T('motion.full')],['reduced',T('motion.reduced')]],g('motion'),T('set.motion')))+
    srow(T('set.sound'),T('set.sound.d'),segHTML('sound',[[true,T('opt.on')],[false,T('opt.off')]],g('sound'),T('set.sound')))+
    srow(T('set.tips'),T('set.tips.d'),segHTML('tips',[[true,T('opt.on')],[false,T('opt.off')]],g('tips'),T('set.tips')))+
    srow(T('set.profile'),T('set.profile.d'),sbtn('set-prof','set.open'));
  else if(setTab==='look') h=srow(T('set.theme'),T('set.theme.d'),themeHTML(g('theme')),true)+srow(T('set.skin'),T('set.skin.d'),swatchHTML('skin',[['auto',T('skin.auto'),S.machine==='430'?'s430':'s426'],['426',T('skin.426'),'s426'],['430',T('skin.430'),'s430']],g('skin'),T('set.skin'),3),true)+
    srow(T('set.env'),T('set.env.d'),swatchHTML('env',[['cold-steel',T('env.cold-steel'),'ecs'],['workshop-night',T('env.workshop-night'),'ewn']],g('env'),T('set.env'),2),true)+
    srow(T('set.quality'),T('set.quality.d'),segHTML('quality',[['low',T('q.low')],['medium',T('q.medium')],['high',T('q.high')]],g('quality'),T('set.quality')));
  else if(setTab==='help') h=srow(T('set.helpopen'),T('set.helpopen.d'),sbtn('set-help','set.open'))+srow(T('set.keys'),T('set.keys.d'),sbtn('set-keys','set.show'))+
    srow(T('set.replay'),T('set.replay.d'),sbtn('set-setup','set.show'))+srow(T('set.reset'),T('set.reset.d'),sbtn('set-reset','set.reset.go'));
  else if(setTab==='adv') h=srow(T('set.dev'),T('set.dev.d'),sbtn('set-dev','set.open'))+
    `<div class="sech">${esc(T('set.diag'))}</div><pre class="diag" id="set-diag" tabindex="0">${esc(diagText())}</pre>${sbtn('set-copy','set.copy')}`;
  else h=`<div class="prose"><h4>TNC 426 / 430 Simulator</h4><p class="mono">NC SW 280 476-17 (SIM)</p>
    <p><a id="about-gh" href="https://github.com/gigacook" target="_blank" rel="noopener noreferrer">${esc(T('about.gh'))}</a></p>
    <p id="about-notice">${esc(T('about.notice'))}</p><p>${esc(T('about.edu'))}</p><p>${esc(T('about.lic'))}</p></div>`;
  b.innerHTML=h; b.setAttribute('aria-labelledby','set-t-'+setTab); b.removeAttribute('aria-label');
  const on=(id,fn)=>{ const el=$(id); if(el) el.onclick=fn; };
  on('set-prof',openProfile); on('set-help',()=>openHelp('learn')); on('set-keys',()=>openHelp('keys')); on('set-dev',openDev);
  on('set-setup',()=>{ closeModal(true); setupOpen(0); });
  on('set-reset',()=>{ local.del(LESSON_LS); if(SET) SET.set('setup',0); say(T('set.reset.done')); });
  on('set-copy',()=>{ const t=diagText(); (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).then(()=>say(T('set.copied')),()=>{ const r=document.createRange(); r.selectNodeContents($('set-diag')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }); });
}
/* a choice in a radio group of the settings panel or the setup card: set it, then put the focus back on the chosen option */
function setPick(root,e){ const b=e.target.closest('[data-v]'), g=b&&b.closest('[data-set]'); if(!g||!SET) return false;
  const key=g.dataset.set, raw=b.dataset.v, v=raw==='true'?true:raw==='false'?false:raw; SET.set(key,v);   // the listener above redraws the panel
  const again=root.querySelector(`[data-set="${key}"] [data-v="${raw}"]`); if(again) again.focus(); return true; }
$('set-body').addEventListener('click',e=>{ setPick($('set-body'),e); });
/* radio groups: arrow keys move and choose (WAI-ARIA radio group) */
document.addEventListener('keydown',e=>{ const g=e.target.closest&&e.target.closest('[role=radiogroup]'); if(!g||e.altKey||e.ctrlKey||e.metaKey) return;
  const d={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key]; if(!d) return; const rs=[...g.querySelectorAll('[role=radio]')], i=rs.indexOf(e.target); if(i<0) return;
  e.preventDefault(); e.stopPropagation(); rs[(i+d+rs.length)%rs.length].click(); },true);

/* ================= first-run setup: language → controller → motion and graphics → a first program =================
   A compact card over the open workspace, never a wall: Skip or ESC closes it for good, Help brings it back. No key, no account. */
const SETUP={i:0,pick:null,ret:null};
function setupList(){ const sc=SHOWCASE.list.filter(it=>it.machines.includes(S.machine)&&pg()[it.name]!=null).map(it=>it.name);
  return (sc.length?sc:mgtNames()).slice(0,4); }
function setupOpen(i,first){ if(openModalEl) closeModal(true); SETUP.i=i||0; SETUP.pick=null; SETUP.ret=first?null:document.activeElement;
  $('setup').hidden=false; setupRender(); if(first) announce(T('setup.aria')+' · ESC = '+T('setup.skip')); else $('setup-next').focus(); }
function setupRender(){ const i=SETUP.i; $('setup-t').textContent=T('setup.t.'+(i+1)); $('setup-n').textContent=(i+1)+' / 4';
  let h=`<p>${esc(T('setup.p.'+(i+1)))}</p>`;
  if(i===0) h+=segHTML('lang',LANGS,SET.get('lang'),T('set.lang'));
  else if(i===1) h+=`<div class="seg" role="radiogroup" aria-label="${esc(T('aria.machine'))}" data-mach="1">`+Object.values(MACHINES).map(m=>`<button type="button" role="radio" aria-checked="${m.id===S.machine}" data-v="${esc(m.id)}">${esc(m.label)}</button>`).join('')+'</div>';
  else if(i===2) h+=segHTML('motion',[['full',T('motion.full')],['reduced',T('motion.reduced')]],REDUCED?'reduced':'full',T('set.motion'))+
    segHTML('quality',[['low',T('q.low')],['medium',T('q.medium')],['high',T('q.high')]],SET.get('quality'),T('set.quality'));
  else { const L=setupList(); if(!L.includes(SETUP.pick)) SETUP.pick=L.includes(S.pgm)?S.pgm:L[0];
    h+=`<div class="olist" role="group" aria-label="${esc(T('setup.t.4'))}">`+L.map(n=>`<button type="button" data-pgm="${esc(n)}" aria-pressed="${n===SETUP.pick}">${esc(n)}</button>`).join('')+'</div>'; }
  $('setup-bd').innerHTML=h; $('setup-back').disabled=i===0; $('setup-next').textContent=T(i===3?'setup.start':'coach.next'); }
$('setup-bd').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; const bd=$('setup-bd');
  if(b.dataset.pgm){ SETUP.pick=b.dataset.pgm; setupRender(); const a=bd.querySelector(`[data-pgm="${b.dataset.pgm}"]`); if(a) a.focus(); return; }
  if(b.closest('[data-mach]')){ const v=b.dataset.v; setMachine(v); setupRender(); const a=bd.querySelector(`[data-mach] [data-v="${v}"]`); if(a) a.focus(); return; }
  const g=b.closest('[data-set]'); if(!g) return; const key=g.dataset.set, raw=b.dataset.v; SET.set(key,raw); setupRender();
  const a=bd.querySelector(`[data-set="${key}"] [data-v="${raw}"]`); if(a) a.focus(); });
$('setup-skip').onclick=()=>setupClose();
$('setup-back').onclick=()=>{ SETUP.i=Math.max(0,SETUP.i-1); setupRender(); };
$('setup-next').onclick=()=>{ if(SETUP.i<3){ SETUP.i++; setupRender(); return; }
  const n=SETUP.pick; setupClose(); if(n&&pg()[n]!=null){ openPgm(n); showPane('gfx'); } };
function setupClose(){ $('setup').hidden=true; if(SET) SET.set('setup',1); const r=SETUP.ret; SETUP.ret=null; restoreFocus(r); }

/* ================= render loop ================= */
function resize(){
  const r=gfxEl.getBoundingClientRect(); if(r.width<2||r.height<2) return;
  renderer.setSize(r.width,r.height,false); camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
  if(FXO) try{ FXO.resize(r.height,camera.fov,renderer.getPixelRatio()); }catch(e){}
  if(CO) try{ CO.resize(r.width,r.height); }catch(e){}
  if(viewFitted) fitCamera();                           // still the default view: refit to the new shape
  emit('resize',{w:r.width,h:r.height});
}
new ResizeObserver(resize).observe(gfxEl);
addEventListener('resize',resize);

let last=performance.now(), kvT=0, paintAcc=0, ovlPainted=false;
function tick(now){
  const dt=Math.min(.1,(now-last)/1000); last=now;
  if(S.running&&S.speed>0){ const nt=S.t+dt*S.speed*(S.ovr/100);
    if(nt>=S.total){ seek(S.total,true); if(S.running){ S.running=false; setState('PROGRAM END · M2'); replayOffer(); } } else seek(nt,true); }
  if(hmDirty){ paintAcc+=dt; if(paintAcc>(NX*NY>60000?.1:.05)){ paintHM(); paintAcc=0; } }
  if(gPath){ const n=S.segs.length?segAt(S.t)+1:0; gPath.geometry.setDrawRange(0,S.t>0?n*2:0); }
  renderDro(now);
  if(toolCutter&&S.seg&&S.seg.spindle&&!REDUCED) toolCutter.rotation.z+=dt*Math.sign(S.seg.spindle)*-Math.min(Math.abs(S.seg.spindle)/60,9)*Math.PI*2*.25;
  { const s=S.seg, p=S.pos;
    const cutting=!!(s&&p&&s.kind==='feed'&&s.spindle&&p.z<ST.z1-1e-3&&p.x>ST.x0-s.toolR&&p.x<ST.x1+s.toolR&&p.y>ST.y0-s.toolR&&p.y<ST.y1+s.toolR);
    if(FXO){ let dir={x:0,y:0}; if(s){ const dx=s.b.x-s.a.x, dy=s.b.y-s.a.y, l=Math.hypot(dx,dy); if(l>1e-6) dir={x:dx/l,y:dy/l}; }
      try{ FXO.update(dt,{running:S.running,cutting,pos:p?toWorld(p):{x:0,y:0,z:0},dir,toolR:s?s.toolR:3,spindle:s?s.spindle:0,
        coolant:!!(s&&s.coolant),speed:S.speed||64,stockTop:ST.z1}); }catch(e){} }
    S.cutting=cutting; camFollow();
    if(BUS.tick) emit('tick',dt,{running:S.running,cutting,pos:p?toWorld(p):null,seg:s}); }
  traceTick(dt);
  if(now-kvT>250){ kvT=now; renderKV();
    const b=S.res.blocks[S.cursor];
    $('ovl-l').innerHTML=`PGM <b>${esc(S.pgm)}</b><br>BLOCK <b>${b&&b.n!=null?b.n:'--'}</b> / ${(S.res.blocks.filter(x=>x.n!=null).pop()||{n:0}).n}<br>`+
      `BLANK <b>${fmt(ST.x1-ST.x0)}×${fmt(ST.y1-ST.y0)}×${fmt(ST.z1-ST.z0)}</b> mm`;
    hdrStat();
    $('ovl-r').innerHTML=`${S.view} · ${S.speed?S.speed+'×':'MAX'}<br>${fmtT(S.t)} / ${fmtT(S.total)}<br>OVR <b>${S.ovr}%</b>`;
    if(!ovlPainted){ ovlPainted=true; if(viewFitted) fitCamera(); } }   // the first fit ran before the overlays had text
  controls.update();
  if(CO) try{ CO.update(); }catch(e){}
  const draw=()=>{ if(UIAPI.render) try{ UIAPI.render(scene,camera); return; }catch(e){ UIAPI.render=null; } renderer.render(scene,camera); };
  if(S.shake>0){ const o=camera.position.clone(), k=S.shake*4; camera.position.x+=(Math.random()-.5)*k; camera.position.y+=(Math.random()-.5)*k; camera.position.z+=(Math.random()-.5)*k;
    draw(); camera.position.copy(o); S.shake=Math.max(0,S.shake-dt*2.2); }
  else draw();
  requestAnimationFrame(tick);
}

/* ================= boot ================= */
(window.TNC_UI_PLUGINS||[]).forEach(fn=>{ try{ fn(UIAPI); }catch(e){ console.warn('plugin failed',e); } });
(async function boot(){
let fresh=false;
try{ PROF=await PSTORE.load(); }catch(e){ PROF=null; }
if(!PROF){ PROF=PSTORE.legacy()||PSTORE.blank(''); fresh=true; }
loadStore();
if(fresh) persist();
raw.value=S.text;
speedSync();
[...document.querySelectorAll('.mode')].forEach(b=>{ b.setAttribute('aria-pressed',b.dataset.m===S.mode); });
if(window.TNC_I18N) try{ TNC_I18N.set(TNC_I18N.lang||'sv'); }catch{}
settingsApply();
compile(); machSync(); setMode(S.mode); syncToggles(); resize(); profChip(); setSideTab(S.sideTab); recentRender(); langSync(); shellReady();
if(S.flowView&&window.TNC_FLOW){ S.flowView=false; toggleFlow(); }
const flash=sess.get('tnc.flash'); if(flash){ sess.del('tnc.flash'); setTimeout(()=>say(flash),400); }
if(sess.get('tnc.askname')){ sess.del('tnc.askname'); if(!PROF.name) openProfile(); }
/* first visit: the optional setup card over the open workspace. Not inside the plain web-app embed, and not in Play
   (its shell teaches the first steps); the Business edition shows it embedded too. */
const BR=window.TNC_BRIDGE||{}, edition=(SET&&SET.edition)||'core';
if(SET&&!SET.get('setup')&&edition!=='play'&&(!BR.embedded||edition==='business')) setupOpen(0,true);
$('b-exit').hidden=!(edition==='play'&&BR.embedded); $('b-exit').onclick=()=>{ if(BR.exit) BR.exit(); };
requestAnimationFrame(tick);
emit('ready');
})();
})();

