// supabase-js e bundlat local (vendor/supabase.esm.js) ca app-ul sa boot-eze si offline
import { createClient } from './vendor/supabase.esm.js';

const SUPABASE_URL = 'https://nkqncfxmarlcwvzqzzbl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rcW5jZnhtYXJsY3d2enF6emJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjU5MTgsImV4cCI6MjEwNTg0MTkxOH0.leTOr62c4uuKy1R8FbeYTvtCMm6927tsFMzXdl7qbiI';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DAYS=['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
const STATUS={lucru:'Lucru',concediu:'Concediu',liber:'Liber',medical:'Medical'};
const STATUS_OK=['lucru','concediu','liber','medical'];
function normStatus(t){return STATUS_OK.includes(t)?t:'lucru';}
let monday=getMonday(new Date());
let deferredPrompt=null;

const $=s=>document.querySelector(s);
const daysEl=$('#days'), histEl=$('#history');

// ---- Auth state ----
let currentUser=null;
let authMode='signin';
let cloudSyncTimer=null;
let isCloudPulling=false;

function getMonday(d){const x=new Date(d);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
function weekKey(dt){
  const d=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate()));
  const day=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-day+3);
  const firstThu=new Date(Date.UTC(d.getUTCFullYear(),0,4));
  const fday=(firstThu.getUTCDay()+6)%7;
  firstThu.setUTCDate(firstThu.getUTCDate()-fday+3);
  const w=1+Math.round((d-firstThu)/(7*864e5));
  return `${d.getUTCFullYear()}-W${String(w).padStart(2,'0')}`;
}
function legacyWeekKey(dt){const m=getMonday(dt);const y=m.getFullYear();const onejan=new Date(y,0,1);const w=Math.ceil((((m-onejan)/864e5)+onejan.getDay()+1)/7);return `${y}-W${String(w).padStart(2,'0')}`;}
function fmtDate(d){return d.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit'});}
function roDec(h){return h.toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})+' h';}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isWeekKey(k){return /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(k||'');}
function isTimeStr(t){return /^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');}
function isPauseStr(p){if(p==null||p==='')return true;const n=Number(p);return Number.isFinite(n)&&n>=0&&n<=600;}
function toMin(t){if(!isTimeStr(t))return null;const[a,b]=t.split(':').map(Number);return a*60+b;}
function sanitizeDay(v){v=v&&typeof v==='object'?v:{};const s=isTimeStr(v.s)?v.s:'';const e=isTimeStr(v.e)?v.e:'';const p=isPauseStr(v.p)?(v.p==null?'':String(v.p)):'';const t=STATUS_OK.includes(v.t)?v.t:'lucru';return{s,p,e,t};}
function calcDay(s,p,e,t){if(t&&t!=='lucru')return 0;const a=toMin(s),b=toMin(e);if(a==null||b==null)return 0;let d=b-a;if(d<0)d+=24*60;const pause=parseInt(p||'0',10);if(!Number.isFinite(pause)||pause<0)return Math.max(0,d);return Math.max(0,d-Math.min(600,pause));}
function hm(min){return `${Math.floor(min/60)}:${String(min%60).padStart(2,'0')}`;}

// ---- localStorage namespaced per cont ----
const LS_OWNER='pontaj:owner';
const K_THEME='pontaj:theme';
function lsScope(){return 'pontaj:'+(currentUser?currentUser.id:'local')+':';}
function kWeek(k){return lsScope()+k;}
function kTs(k){return lsScope()+k+':ts';}
function kIndex(){return lsScope()+'index';}

// Ruleaza o singura data: daca nu exista inca un owner, datele vechi
// (nescopate, de la versiunea precedenta) apartin primului cont care se logheaza.
// Daca owner-ul este deja alt cont, NU mutam nimic - altfel am scurgea date.
function migrateLegacyScope(){
  if(!currentUser) return;
  const owner=localStorage.getItem(LS_OWNER);
  if(owner===currentUser.id) return;
  if(owner!==null) return;
  const legacy=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(!k||k.indexOf('pontaj:')!==0) continue;
    if(k===LS_OWNER||k===K_THEME) continue;
    if(!isWeekKey(k.slice(7))) continue;
    legacy.push(k);
  }
  if(legacy.length){
    const scope=lsScope();
    legacy.forEach(k=>{const wk=k.slice(7);localStorage.setItem(scope+wk,localStorage.getItem(k));localStorage.removeItem(k);});
    const oldIdx=localStorage.getItem('pontaj:index');
    if(oldIdx){localStorage.setItem(scope+'index',oldIdx);localStorage.removeItem('pontaj:index');}
  }
  localStorage.setItem(LS_OWNER,currentUser.id);
}

function loadWeek(k){try{return JSON.parse(localStorage.getItem(kWeek(k)))||{}}catch{return{}}}
let histT=null;
function scheduleHistory(){clearTimeout(histT);histT=setTimeout(()=>{try{renderHistory();}catch{}},300);}
function saveWeek(){
  const k=weekKey(monday);
  const data={};
  document.querySelectorAll('.day').forEach((el,i)=>{const raw={s:el.querySelector('.in-s').value,p:el.querySelector('.in-p').value,e:el.querySelector('.in-e').value,t:el.dataset.status||'lucru'};data[i]=sanitizeDay(raw);});
  localStorage.setItem(kWeek(k),JSON.stringify(data));
  localStorage.setItem(kTs(k),String(Date.now()));
  const idx=getIndex();if(!idx.includes(k)){idx.push(k);idx.sort().reverse();localStorage.setItem(kIndex(),JSON.stringify(idx.slice(0,52)));}
  const d=$('#save-dot');if(d){d.classList.add('show');clearTimeout(d._t);d._t=setTimeout(()=>d.classList.remove('show'),1200);}
  scheduleHistory();
  // cloud sync
  scheduleCloudPush(k);
}
function getIndex(){try{return JSON.parse(localStorage.getItem(kIndex()))||[]}catch{return[]}}

function setCloudDot(state,msg){
  const el=$('#cloud-dot'); if(!el) return;
  el.classList.remove('ok','sync','err');
  if(state==='ok'){ el.classList.add('ok'); el.textContent='● sincronizat'; el.removeAttribute('title'); }
  else if(state==='sync'){ el.classList.add('sync'); el.textContent='● se sincronizează…'; }
  else if(state==='err'){ el.classList.add('err'); el.textContent='● offline'; if(msg) el.title=msg; }
  else { el.textContent='● sincronizat'; }
}

function scheduleCloudPush(k){
  if(!currentUser) return;
  clearTimeout(cloudSyncTimer);
  setCloudDot('sync');
  cloudSyncTimer=setTimeout(()=> cloudPushWeek(k), 700);
}

async function cloudPushWeek(k){
  if(!currentUser) return;
  const data = loadWeek(k);
  // nu trimite saptamani complet goale? totusi trimite ca sa pastreze index; daca e goala complet, sterge din cloud
  const hasData = Object.values(data).some(v=>v.s||v.p||v.e||(v.t&&v.t!=='lucru'));
  try{
    if(!hasData){
      // daca e goala si exista in cloud, stergem
      const { error } = await supabase.from('pontaj_weeks').delete().eq('user_id', currentUser.id).eq('week_key', k);
      if(error) throw error;
    } else {
      const { error } = await supabase.from('pontaj_weeks').upsert({ user_id: currentUser.id, week_key: k, data }, { onConflict: 'user_id,week_key' });
      if(error) throw error;
    }
    setCloudDot('ok');
  }catch(e){
    console.warn('cloud push failed', e);
    setCloudDot('err', e.message||'eroare');
  }
}

async function cloudDeleteWeek(k){
  if(!currentUser) return;
  try{
    const { error } = await supabase.from('pontaj_weeks').delete().eq('user_id', currentUser.id).eq('week_key', k);
    if(error) throw error;
    setCloudDot('ok');
  }catch(e){
    console.warn('cloud delete failed', e);
    setCloudDot('err', e.message);
  }
}

async function cloudPull(){
  if(!currentUser || isCloudPulling) return;
  isCloudPulling=true;
  setCloudDot('sync');
  try{
    const { data, error } = await supabase.from('pontaj_weeks').select('week_key,data,updated_at').order('week_key', {ascending:false}).limit(52);
    if(error) throw error;
    const idx=[];const pushLater=[];
    (data||[]).forEach(row=>{
      if(!isWeekKey(row.week_key)) return;
      const k=row.week_key;
      const cloudTs=row.updated_at?Date.parse(row.updated_at):0;
      const localTs=Number(localStorage.getItem(kTs(k))||0);
      const local=loadWeek(k);
      const localHas=Object.values(local).some(v=>v&&(v.s||v.p||v.e||(v.t&&v.t!=='lucru')));
      // local mai nou decat cloud (editat offline) -> pastram local si urcam inapoi
      if(localHas && localTs>cloudTs){ idx.push(k); pushLater.push(k); return; }
      // salveaza in localStorage; cloud e sursa de adevar dupa login
      try{
        const clean={};
        Object.keys(row.data||{}).forEach(di=>{
          if(!/^[0-6]$/.test(di)) return;
          clean[di]=sanitizeDay(row.data[di]);
        });
        localStorage.setItem(kWeek(k), JSON.stringify(clean));
        if(cloudTs) localStorage.setItem(kTs(k), String(cloudTs));
        idx.push(k);
      }catch{}
    });
    pushLater.forEach(k=>cloudPushWeek(k));
    // pastreaza si saptamanile locale care nu sunt inca in cloud (offline create) - mergem in push separat
    const localIdx=getIndex();
    localIdx.forEach(k=>{
      if(!idx.includes(k) && isWeekKey(k)){
        const localData=loadWeek(k);
        const hasData=Object.values(localData).some(v=>v.s||v.p||v.e||(v.t&&v.t!=='lucru'));
        if(hasData && !idx.includes(k)){
          // push in background
          cloudPushWeek(k);
          idx.push(k);
        }
      }
    });
    idx.sort().reverse();
    localStorage.setItem(kIndex(), JSON.stringify(idx.slice(0,52)));
    setCloudDot('ok');
    render(); // re-render cu date din cloud
  }catch(e){
    console.warn('cloud pull failed', e);
    setCloudDot('err', e.message);
    render();
  }finally{
    isCloudPulling=false;
  }
}

function render(){
  const m=new Date(monday);const end=new Date(m);end.setDate(end.getDate()+6);
  const wr=$('#week-range'); if(wr) wr.textContent=`${fmtDate(m)} – ${fmtDate(end)} ${end.getFullYear()}`;
  const wk=weekKey(monday);
  const wl=$('#week-label'); if(wl) wl.textContent='Săpt. '+wk;
  try{
    if(!localStorage.getItem(kWeek(wk))){
      const lk=legacyWeekKey(monday);
      if(lk!==wk){const old=localStorage.getItem(kWeek(lk));if(old)localStorage.setItem(kWeek(wk),old);}
    }
  }catch{}
  const saved=loadWeek(wk);
  const todayStr=new Date().toDateString();
  if(!daysEl) return;
  daysEl.innerHTML='';
  for(let i=0;i<7;i++){
    const dt=new Date(m);dt.setDate(dt.getDate()+i);
    const v=sanitizeDay(saved[i]);
    const st=normStatus(v.t);
    const card=document.createElement('div');card.className='day st-'+st+(dt.toDateString()===todayStr?' today':'');card.dataset.date=dt.toISOString().slice(0,10);card.dataset.status=st;
    card.innerHTML=`<div class="day-head"><div><b>${DAYS[i]}</b> <span>${fmtDate(dt)}</span></div><span class="day-total"></span></div>
    <div class="status-row" role="group" aria-label="Status ${DAYS[i]}">${STATUS_OK.map(k=>`<button type="button" class="st-btn${k===st?' on-'+k:''}" data-st="${k}" aria-pressed="${k===st}">${k==='lucru'?'💼 ':k==='concediu'?'🌿 ':k==='liber'?'☀️ ':'🏥 '}${STATUS[k]}</button>`).join('')}</div>
    <div class="time-wrap"${st!=='lucru'?' hidden':''}>
    <div class="grid3">
      <label>🕐 Început<input type="text" inputmode="none" readonly placeholder="--:--" class="in-s" aria-haspopup="dialog" value="${esc(v.s)}"></label>
      <label>⏸️ Pauză (min)<input type="number" class="in-p" min="0" max="600" step="5" inputmode="numeric" value="${esc(v.p)}" placeholder="30"></label>
      <label>🏁 Sfârșit<input type="text" inputmode="none" readonly placeholder="--:--" class="in-e" aria-haspopup="dialog" value="${esc(v.e)}"></label>
    </div><div class="chips">${[0,15,30,45,60].map(x=>`<button type="button" class="chip" data-p="${x}" aria-pressed="${String(v.p||'')===String(x)}">${x}</button>`).join('')}</div>
    </div>`;
    daysEl.appendChild(card);
  }
  daysEl.querySelectorAll('.st-btn').forEach(b=>b.addEventListener('click',ev=>{ev.preventDefault();const card=b.closest('.day');const st=b.dataset.st;card.dataset.status=st;card.classList.remove('st-lucru','st-concediu','st-liber','st-medical');card.classList.add('st-'+st);card.querySelectorAll('.st-btn').forEach(x=>{const on=x.dataset.st===st;x.classList.remove('on-lucru','on-concediu','on-liber','on-medical');if(on)x.classList.add('on-'+st);x.setAttribute('aria-pressed',on?'true':'false');});const tw=card.querySelector('.time-wrap');if(tw)tw.hidden=st!=='lucru';recalc();saveWeek();}));
  daysEl.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{recalc();saveWeek();}));
  daysEl.querySelectorAll('.in-s,.in-e').forEach(inp=>{
    inp.addEventListener('click',()=>openClock(inp));
    inp.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openClock(inp);}});
  });
  daysEl.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',ev=>{ev.preventDefault();const card=c.closest('.day');card.querySelector('.in-p').value=c.dataset.p;recalc();saveWeek();}));
  recalc();renderHistory();
}
function recalc(){
  let total=0,days=0;
  document.querySelectorAll('.day').forEach(card=>{
    const st=normStatus(card.dataset.status);
    const s=card.querySelector('.in-s').value,p=card.querySelector('.in-p').value,e=card.querySelector('.in-e').value;
    const min=calcDay(s,p,e,st);total+=min;if(min>0)days++;
    const out=card.querySelector('.day-total');
    if(st!=='lucru'){out.innerHTML=`<span class="day-badge b-${st}">${STATUS[st]}</span>`;}
    else{out.textContent=min>0?`${roDec(min/60)} (${hm(min)})`:'—';}
    card.querySelectorAll('.chip').forEach(c=>{const on=String(p||'')===c.dataset.p;c.classList.toggle('on',on);c.setAttribute('aria-pressed',on?'true':'false');});
  });
  const td=$('#total-dec'); if(td) td.textContent=roDec(total/60);
  const th=$('#total-hm'); if(th) th.textContent=`${hm(total)} • ${days} ${days===1?'zi':'zile'}`;
}
function renderHistory(){
  if(!histEl) return;
  const idx=getIndex().filter(isWeekKey);histEl.innerHTML=idx.length?'':'<li class="muted">Nicio săptămână salvată încă.</li>';
  idx.slice(0,12).forEach(k=>{
    let tot=0;const d=loadWeek(k);Object.values(d).forEach(raw=>{const v=sanitizeDay(raw);tot+=calcDay(v.s,v.p,v.e,v.t);});
    const li=document.createElement('li');
    const b=document.createElement('b');b.textContent=k;
    const sub=document.createElement('span');sub.className='muted';sub.textContent=`${roDec(tot/60)} • ${hm(tot)}`;
    const left=document.createElement('span');left.append(b,document.createElement('br'),sub);
    const open=document.createElement('button');open.className='btn small';open.textContent='Deschide';open.setAttribute('aria-label','Deschide săptămâna '+k);open.onclick=()=>{const[y,w]=k.split('-W');monday=mondayFromWeek(+y,+w);render();window.scrollTo({top:0,behavior:'smooth'});};
    const del=document.createElement('button');del.className='btn small';del.textContent='✕';del.setAttribute('aria-label','Șterge săptămâna '+k);
    del.onclick=async()=>{if(!confirm('Ștergi '+k+'?'))return;localStorage.removeItem(kWeek(k));localStorage.removeItem(kTs(k));localStorage.setItem(kIndex(),JSON.stringify(getIndex().filter(x=>x!==k)));await cloudDeleteWeek(k);renderHistory();recalc();if(weekKey(monday)===k) render();};
    const right=document.createElement('span');right.append(open,' ',del);
    li.append(left,right);
    histEl.appendChild(li);
  });
}
function mondayFromWeek(y,w){const jan4=new Date(y,0,4);const d=getMonday(jan4);d.setDate(d.getDate()+(w-1)*7);return d;}

$('#btn-prev')&&($('#btn-prev').onclick=()=>{monday.setDate(monday.getDate()-7);render();});
$('#btn-next')&&($('#btn-next').onclick=()=>{monday.setDate(monday.getDate()+7);render();});
$('#btn-today')&&($('#btn-today').onclick=()=>{monday=getMonday(new Date());render();});
$('#btn-clear')&&($('#btn-clear').onclick=async()=>{if(!confirm('Ștergi toate orele din săptămâna afișată?'))return;const k=weekKey(monday);try{localStorage.removeItem(kWeek(k));localStorage.removeItem(kTs(k));const lk=legacyWeekKey(monday);if(lk)localStorage.removeItem(kWeek(lk));}catch{} await cloudDeleteWeek(k); render();});
$('#btn-copy-weekdays')&&($('#btn-copy-weekdays').onclick=()=>{const f=document.querySelectorAll('.day')[0];const s=f.querySelector('.in-s').value,p=f.querySelector('.in-p').value,e=f.querySelector('.in-e').value;document.querySelectorAll('.day').forEach((c,i)=>{if(i>=1&&i<=4){c.querySelector('.in-s').value=s;c.querySelector('.in-p').value=p;c.querySelector('.in-e').value=e;}});recalc();saveWeek();});
$('#btn-export')&&($('#btn-export').onclick=()=>{
  const data={};const scope=lsScope();
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(!k||k.indexOf(scope)!==0) continue;
    const wk=k.slice(scope.length);
    if(!isWeekKey(wk)) continue;
    try{data['pontaj:'+wk]=JSON.parse(localStorage.getItem(k));}catch{}
  }
  if(!Object.keys(data).length){alert('Nu ai săptămâni salvate de exportat.');return;}
  data._exportedAt=new Date().toISOString();data._app='pontaj';
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  const d=new Date();const stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  a.download='pontaj-backup-'+stamp+'.json';document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
});
$('#btn-import')&&($('#btn-import').onclick=()=>$('#file-import').click());
$('#file-import')&&($('#file-import').onchange=(ev)=>{
  const f=ev.target.files&&ev.target.files[0];if(!f)return;
  if(f.size>1024*1024){alert('Fișierul e prea mare (max 1 MB).');ev.target.value='';return;}
  const rd=new FileReader();
  rd.onload=async()=>{
    try{
      const data=JSON.parse(rd.result);
      if(!data||typeof data!=='object')throw new Error('bad');
      const keys=Object.keys(data).filter(k=>k.indexOf('pontaj:')===0&&isWeekKey(k.slice(7)));
      if(!keys.length){alert('Fișierul nu conține backup de pontaj.');return;}
      const clean={};let skipped=0;
      keys.forEach(k=>{
        const week=data[k];
        if(!week||typeof week!=='object'){skipped++;return;}
        const days={};let ok=false;
        Object.keys(week).forEach(di=>{
          if(!/^[0-6]$/.test(di))return;
          const v=sanitizeDay(week[di]);
          if(v.s||v.p||v.e||(v.t&&v.t!=='lucru'))ok=true;
          days[di]=v;
        });
        if(!ok&&Object.keys(days).length===0){skipped++;return;}
        clean[k]=days;
      });
      const good=Object.keys(clean);
      if(!good.length){alert('Fișierul nu conține intrări valide.');return;}
      if(!confirm('Import '+good.length+' intrări?'+(skipped?' ('+skipped+' ignorate ca invalide)':'')+' Datele existente cu aceeași cheie se suprascriu.'))return;
      for(const fk of good){
        const wk=fk.slice(7);
        localStorage.setItem(kWeek(wk),JSON.stringify(clean[fk]));
        localStorage.setItem(kTs(wk),String(Date.now()));
        await cloudPushWeek(wk);
      }
      // rebuild index
      const idx=getIndex();
      good.forEach(fk=>{
        const wk=fk.slice(7);
        if(!idx.includes(wk)) idx.push(wk);
      });
      idx.sort().reverse();
      localStorage.setItem(kIndex(), JSON.stringify(idx.slice(0,52)));
      render();alert('Import gata: '+good.length+' intrări.');
    }catch{alert('Fișier invalid. Alege un JSON exportat din Pontaj.');}
    ev.target.value='';
  };
  rd.readAsText(f);
});
$('#btn-print')&&($('#btn-print').onclick=()=>{
  const m=new Date(monday);let rows='',tot=0;
  for(let i=0;i<7;i++){const card=document.querySelectorAll('.day')[i];const raw={s:card.querySelector('.in-s').value,p:card.querySelector('.in-p').value,e:card.querySelector('.in-e').value,t:card.dataset.status||'lucru'};const v=sanitizeDay(raw);const st=normStatus(v.t);const s=st!=='lucru'?'—':(v.s||'—'),p=st!=='lucru'?'—':((v.p||'0')+' min'),e=st!=='lucru'?'—':(v.e||'—');const min=calcDay(v.s,v.p,v.e,st);tot+=min;const dt=new Date(m);dt.setDate(dt.getDate()+i);
    rows+=`<tr><td>${esc(DAYS[i])} ${esc(fmtDate(dt))}</td><td>${esc(STATUS[st])}</td><td>${esc(s)}</td><td>${esc(p)}</td><td>${esc(e)}</td><td>${min>0?esc(roDec(min/60)+' ('+hm(min)+')'):'—'}</td></tr>`;}
  const email=currentUser&&currentUser.email?esc(currentUser.email):'';
  $('#print-area').innerHTML=`<h1>Pontaj ${esc(weekKey(monday))} — ${esc($('#week-range').textContent)}</h1>${email?`<p>Angajat: <b>${email}</b></p>`:''}<p>Total lucrat: <b>${esc(roDec(tot/60)+' ('+hm(tot)+')')}</b></p><table><tr><th>Zi</th><th>Status</th><th>Început</th><th>Pauză</th><th>Sfârșit</th><th>Total</th></tr>${rows}</table>`;
  window.print();
});

// theme
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem(K_THEME,t);const b=$('#btn-theme'); if(b) b.textContent=t==='dark'?'🌙':'☀️';const mt=$('#meta-theme'); if(mt) mt.content=t==='dark'?'#0f172a':'#ffffff';}
$('#btn-theme')&&($('#btn-theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
setTheme(localStorage.getItem(K_THEME)||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));

// install
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;const b=$('#btn-install'); if(b) b.hidden=false;});
$('#btn-install')&&($('#btn-install').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#btn-install').hidden=true;});

// update disponibil (PWA)
(function swUpdate(){
  if(!('serviceWorker' in navigator))return;
  let refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;window.location.reload();});
  function showToast(reg){
    const toast=$('#sw-toast');if(!toast||!reg)return;
    if(!reg.waiting)return;
    toast.hidden=false;
    $('#sw-reload').onclick=()=>{
      toast.hidden=true;
      let done=false;
      const force=()=>{if(done)return;done=true;window.location.reload();};
      try{
        const w=reg.waiting||reg.installing;
        if(w){try{w.postMessage('SKIP_WAITING');}catch{}}
      }catch{}
      setTimeout(force,1500);
    };
  }
  navigator.serviceWorker.getRegistration().then(reg=>{
    if(!reg)return;
    if(reg.waiting)showToast(reg);
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller)showToast(reg);});
    });
  }).catch(()=>{});
})();

// ---------- ceas analogic ----------
let ckTarget=null,ckH=8,ckM=0,ckMode='h',ckReturnFocus=null;
const ckPad=n=>String(n).padStart(2,'0');
function ckClose(returnFocus){
  try{$('#dlg-clock').close();}catch{}
  if(returnFocus!==false&&ckReturnFocus&&document.contains(ckReturnFocus)){try{ckReturnFocus.focus();}catch{}}
  ckReturnFocus=null;
}
function openClock(inp){
  ckTarget=inp;
  ckReturnFocus=document.activeElement;
  const m=(inp.value||'').match(/^(\d{1,2}):(\d{2})$/);
  const now=new Date();
  ckH=m?Math.min(23,+m[1]):now.getHours();
  ckM=m?Math.min(59,+m[2]):(Math.round(now.getMinutes()/5)*5)%60;
  if(!Number.isFinite(ckH))ckH=now.getHours();
  if(!Number.isFinite(ckM))ckM=0;
  ckMode='h';ckDraw();
  const d=$('#dlg-clock');if(d&&typeof d.showModal==='function'){d.showModal();try{$('#ck-ok').focus();}catch{}}
}
function ckNum(x,y,label,sel,kind){
  const aria=kind==='h'?'Ora '+label:'Minutul '+label;
  return `<g class="ck-tap" data-v="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}"><circle cx="${x}" cy="${y}" r="17" class="${sel?'ck-sel':''}"/><text x="${x}" y="${y+5}" text-anchor="middle" class="${sel?'ck-selt':''}">${esc(label)}</text></g>`;
}
function ckHand(ang,r){
  const x2=130+Math.cos(ang)*r,y2=130+Math.sin(ang)*r;
  return `<line x1="130" y1="130" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="ck-hand"/><circle cx="130" cy="130" r="5" class="ck-handdot"/>`;
}
function ckDraw(){
  const ch=$('#ck-h'); if(ch) ch.textContent=ckPad(ckH);
  const cm=$('#ck-m'); if(cm) cm.textContent=ckPad(ckM);
  if(ch) ch.classList.toggle('on',ckMode==='h');
  if(cm) cm.classList.toggle('on',ckMode==='m');
  const fine=$('#ck-fine'); if(fine) fine.hidden=ckMode!=='m';
  const cx=130,cy=130;let h='<circle cx="130" cy="130" r="124" class="ck-bg"/>';
  if(ckMode==='h'){
    const outer=[0,13,14,15,16,17,18,19,20,21,22,23],inner=[12,1,2,3,4,5,6,7,8,9,10,11];
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2-Math.PI/2;
      h+=ckNum(cx+Math.cos(a)*96,cy+Math.sin(a)*96,outer[i],ckH===outer[i],'h');
      h+=ckNum(cx+Math.cos(a)*58,cy+Math.sin(a)*58,inner[i],ckH===inner[i],'h');
    }
    const oi=outer.indexOf(ckH),inr=oi<0;
    const pos=inr?inner.indexOf(ckH):oi;
    h+=ckHand((pos/12)*Math.PI*2-Math.PI/2,inr?58:96);
  }else{
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2-Math.PI/2;
      h+=ckNum(cx+Math.cos(a)*96,cy+Math.sin(a)*96,ckPad(i*5),ckM===i*5,'m');
    }
    h+=ckHand((ckM/60)*Math.PI*2-Math.PI/2,96);
  }
  const face=$('#ck-face'); if(face) face.innerHTML=h;
}
function ckPick(v){
  if(ckMode==='h'){ckH=(+v)%24;ckMode='m';}
  else{ckM=(+v)%60;}
  ckDraw();
  try{const sel=$('#ck-face .ck-tap[tabindex]');if(sel)sel.focus();}catch{}
}
$('#ck-face')&&$('#ck-face').addEventListener('click',ev=>{
  const g=ev.target.closest('.ck-tap');if(!g)return;
  ckPick(g.dataset.v);
});
$('#ck-face')&&$('#ck-face').addEventListener('keydown',ev=>{
  const g=ev.target.closest('.ck-tap');if(!g)return;
  if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ckPick(g.dataset.v);}
});
$('#ck-h')&&($('#ck-h').onclick=()=>{ckMode='h';ckDraw();});
$('#ck-h')&&$('#ck-h').addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ckMode='h';ckDraw();}});
$('#ck-m')&&($('#ck-m').onclick=()=>{ckMode='m';ckDraw();});
$('#ck-m')&&$('#ck-m').addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ckMode='m';ckDraw();}});
$('#ck-dec')&&($('#ck-dec').onclick=()=>{ckM=(ckM+59)%60;ckDraw();});
$('#ck-inc')&&($('#ck-inc').onclick=()=>{ckM=(ckM+1)%60;ckDraw();});
$('#ck-cancel')&&($('#ck-cancel').onclick=()=>ckClose(true));
$('#ck-clear')&&($('#ck-clear').onclick=()=>{if(ckTarget){ckTarget.value='';ckTarget.dispatchEvent(new Event('input',{bubbles:true}));}ckClose(true);});
$('#ck-ok')&&($('#ck-ok').onclick=()=>{if(ckTarget){ckTarget.value=ckPad(ckH)+':'+ckPad(ckM);ckTarget.dispatchEvent(new Event('input',{bubbles:true}));}ckClose(true);});
try{$('#dlg-clock')&&$('#dlg-clock').addEventListener('close',()=>{if(ckReturnFocus&&document.contains(ckReturnFocus)){try{ckReturnFocus.focus();}catch{}}ckReturnFocus=null;});}catch{}

// ---- AUTH UI ----
function setAuthError(msg){
  const el=$('#auth-error');
  if(!el) return;
  el.textContent=msg||'';
  el.style.display=msg?'block':'none';
}
function updateAuthTabs(){
  $('#tab-signin')&&$('#tab-signin').classList.toggle('on', authMode==='signin');
  $('#tab-signup')&&$('#tab-signup').classList.toggle('on', authMode==='signup');
  const btn=$('#btn-auth'); if(btn) btn.textContent=authMode==='signup'?'Creează cont':'Intră în cont';
}
$('#tab-signin')&&($('#tab-signin').onclick=()=>{authMode='signin';updateAuthTabs();setAuthError('');});
$('#tab-signup')&&($('#tab-signup').onclick=()=>{authMode='signup';updateAuthTabs();setAuthError('');});

$('#form-auth')&&$('#form-auth').addEventListener('submit', async (e)=>{
  e.preventDefault();
  setAuthError('');
  const email=$('#auth-email')?.value.trim();
  const pass=$('#auth-pass')?.value;
  if(!email || !pass) return setAuthError('Completează emailul și parola.');
  if(pass.length<6) return setAuthError('Parola trebuie să aibă minim 6 caractere.');
  const btn=$('#btn-auth'); const orig=btn?btn.textContent:'';
  if(btn){btn.disabled=true; btn.textContent='Se procesează…';}
  try{
    let res;
    if(authMode==='signup'){
      res= await supabase.auth.signUp({ email, password: pass });
      if(res.error) throw res.error;
      // auto sign-in daca autoconfirm e activ
      if(!res.data.session){
        setAuthError('Cont creat! Verifică emailul dacă e nevoie, apoi intră în cont.');
        authMode='signin'; updateAuthTabs();
        return;
      }
    } else {
      res= await supabase.auth.signInWithPassword({ email, password: pass });
      if(res.error) throw res.error;
    }
    // onAuthStateChange va face restul
  }catch(err){
    setAuthError(err.message||'Eroare la autentificare');
  }finally{
    if(btn){btn.disabled=false; btn.textContent=orig;}
  }
});

$('#btn-forgot')&&$('#btn-forgot').addEventListener('click', async ()=>{
  const email=$('#auth-email')?.value.trim();
  if(!email) return setAuthError('Scrie emailul mai sus, apoi apasă „Ai uitat parola?”');
  setAuthError('');
  const btn=$('#btn-forgot');
  if(btn) btn.disabled=true;
  try{
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) throw error;
    setAuthError('Ți-am trimis email de resetare. Verifică inbox (și Spam).');
  }catch(err){
    setAuthError(err.message||'Nu s-a putut trimite emailul.');
  }finally{
    if(btn) btn.disabled=false;
  }
});

$('#btn-google')&&$('#btn-google').addEventListener('click', async ()=>{
  setAuthError('');
  const btn=$('#btn-google'); if(btn) btn.disabled=true;
  try{
    const { error } = await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin + window.location.pathname } });
    if(error) throw error;
  }catch(err){
    setAuthError(err.message||'Google login indisponibil. Activează providerul Google în Supabase Dashboard → Authentication → Providers.');
    if(btn) btn.disabled=false;
  }
});

function setRecoveryError(msg){
  const el=$('#recovery-error');
  if(!el) return;
  el.textContent=msg||'';
  el.style.display=msg?'block':'none';
}
$('#form-recovery')&&$('#form-recovery').addEventListener('submit', async (e)=>{
  e.preventDefault();
  setRecoveryError('');
  const p1=$('#new-pass')?.value||'';
  const p2=$('#new-pass2')?.value||'';
  if(p1.length<6) return setRecoveryError('Parola trebuie să aibă minim 6 caractere.');
  if(p1!==p2) return setRecoveryError('Parolele nu coincid.');
  const btn=e.target.querySelector('button');
  if(btn){btn.disabled=true; btn.textContent='Se salvează…';}
  try{
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if(error) throw error;
    setRecoveryError('Parola a fost schimbată! Te loghez…');
    // curata URL de tokenuri
    try{ window.history.replaceState({}, document.title, window.location.pathname); }catch{}
    setTimeout(async ()=>{
      const rc=$('#recovery-card'); if(rc) rc.hidden=true;
      const { data } = await supabase.auth.getSession();
      currentUser=data.session?.user||null;
      if(currentUser){ migrateLegacyScope(); showAppView(currentUser); await cloudPull(); }
    }, 900);
  }catch(err){
    setRecoveryError(err.message||'Eroare la schimbarea parolei.');
  }finally{
    if(btn){btn.disabled=false; btn.textContent='Salvează parola';}
  }
});

$('#btn-logout')&&$('#btn-logout').addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  // cache-ul local ramane, dar e namespocat per cont (pontaj:<userId>:),
  // deci nu mai poate fi vazut de alt cont. Vezi migrateLegacyScope().
});

function showAuthView(){
  const a=$('#auth-card'), c=$('#app-content'), l=$('#auth-loading'), ub=$('#user-bar'), rc=$('#recovery-card');
  if(a) a.hidden=false;
  if(c) c.hidden=true;
  if(l) l.hidden=true;
  if(ub) ub.hidden=true;
  if(rc) rc.hidden=true;
}
function showAppView(user){
  const a=$('#auth-card'), c=$('#app-content'), l=$('#auth-loading'), ub=$('#user-bar'), ue=$('#user-email'), rc=$('#recovery-card');
  if(a) a.hidden=true;
  if(c) c.hidden=false;
  if(l) l.hidden=true;
  if(ub) ub.hidden=false;
  if(rc) rc.hidden=true;
  if(ue) ue.textContent=user?.email||'';
  const av=$('#user-avatar'); if(av) av.textContent=((user?.email||'?').trim().charAt(0)||'?').toUpperCase();
}

function isRecoveryUrl(){
  try{
    const u=new URL(window.location.href);
    const hash=u.hash||'';
    if(hash.includes('type=recovery')) return true;
    if(u.searchParams.get('error_code')==='otp_expired') return true;
    if(hash.includes('access_token')) return true;
    // ATENTIE: ?code= NU mai inseamna recovery — vine si de la loginul
    // OAuth (Google) prin PKCE. Tipul evenimentului de auth
    // (SIGNED_IN vs PASSWORD_RECOVERY) decide ecranul, vezi initAuth.
  }catch{}
  return false;
}
async function handleRedirectCode(){
  // Exchange pentru ?code= din redirect: fie login OAuth (Google) -> SIGNED_IN,
  // fie link de resetare parola -> PASSWORD_RECOVERY. Curata URL-ul dupa.
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if(code){
    try{
      const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if(error) console.warn('exchangeCode error', error);
      url.searchParams.delete('code');
      window.history.replaceState({}, document.title, url.pathname + url.search + window.location.hash);
    }catch(e){ console.warn('exchange failed', e); }
  }
}
async function initAuth(){
  updateAuthTabs();

  // Listenerul trebuie inregistrat INAINTE de orice return, altfel tabul
  // care a venit din linkul de recovery nu primeste niciun eveniment de auth.
  supabase.auth.onAuthStateChange((event, session)=>{
    // supabase-js cere sa NU facem await pe operatii supabase inauntrul
    // acestui callback (deadlock pe lock-ul intern de auth) -> declansam async.
    setTimeout(()=>{ handleAuthEvent(event, session); }, 0);
  });

  const url = new URL(window.location.href);
  if(url.searchParams.get('code')){
    // Intoarcere din redirect (Google OAuth sau link resetare). Stam pe
    // loading pana vine evenimentul de auth, care decide ecranul:
    // SIGNED_IN -> aplicatie, PASSWORD_RECOVERY -> schimbare parola.
    await handleRedirectCode();
    try{
      const { data } = await supabase.auth.getSession();
      currentUser=data.session?.user||null;
      if(!currentUser){ showAuthView(); return; }
      migrateLegacyScope();
      await new Promise(r=>setTimeout(r, 500));
      const rc=$('#recovery-card');
      if(rc && !rc.hidden) return; // recovery a preluat ecranul
      const c=$('#app-content');
      if(c && c.hidden){ showAppView(currentUser); await cloudPull(); }
    }catch{ showAuthView(); }
    return;
  }
  if(isRecoveryUrl()){
    const rc=$('#recovery-card'), a=$('#auth-card'), l=$('#auth-loading'), c=$('#app-content');
    if(rc) rc.hidden=false;
    if(a) a.hidden=true; if(l) l.hidden=true; if(c) c.hidden=true;
    // incearca sa ia sesiunea dupa exchange, dar ramai in recovery pana schimbi parola
    try{
      const { data: recData } = await supabase.auth.getSession();
      currentUser=recData.session?.user||null;
      if(currentUser) migrateLegacyScope();
    }catch{}
    return;
  }
  const { data } = await supabase.auth.getSession();
  currentUser=data.session?.user||null;
  if(currentUser){
    migrateLegacyScope();
    showAppView(currentUser);
    await cloudPull();
  } else {
    showAuthView();
  }
}

async function handleAuthEvent(event, session){
  console.log('auth event', event);
  if(event==='PASSWORD_RECOVERY' || (isRecoveryUrl() && session)){
    const a=$('#auth-card'), l=$('#auth-loading'), c=$('#app-content'), rc=$('#recovery-card');
    if(a) a.hidden=true; if(l) l.hidden=true; if(c) c.hidden=true; if(rc) rc.hidden=false;
    return;
  }
  const prevId=currentUser?currentUser.id:null;
  currentUser=session?.user||null;
  if(currentUser){
    if(currentUser.id!==prevId) migrateLegacyScope();
    // daca suntem in recovery, nu face pull inca
    const rc=$('#recovery-card');
    if(rc && !rc.hidden) return;
    showAppView(currentUser);
    await cloudPull();
  } else {
    // logout: golim formularul ca datele contului anterior sa nu ramana in DOM
    monday=getMonday(new Date());
    try{ render(); }catch{}
    showAuthView();
  }
}

initAuth();

// initial render va fi facut dupa cloudPull sau daca nu e user nu conteaza
// fallback: daca auth-loading ramane, ascunde dupa 3 sec
setTimeout(()=>{
  const l=$('#auth-loading');
  if(l && !l.hidden && !currentUser) showAuthView();
}, 3000);
