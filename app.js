const DAYS=['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
let monday=getMonday(new Date());
let deferredPrompt=null;

const $=s=>document.querySelector(s);
const daysEl=$('#days'), histEl=$('#history');

function getMonday(d){const x=new Date(d);const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
function weekKey(dt){const m=getMonday(dt);const y=m.getFullYear();const onejan=new Date(y,0,1);const w=Math.ceil((((m-onejan)/864e5)+onejan.getDay()+1)/7);return `${y}-W${String(w).padStart(2,'0')}`;}
function fmtDate(d){return d.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit'});}
function roDec(h){return h.toLocaleString('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2})+' h';}
function toMin(t){if(!t)return null;const[a,b]=t.split(':').map(Number);return a*60+b;}
function calcDay(s,p,e){const a=toMin(s),b=toMin(e);if(a==null||b==null)return 0;let d=b-a;if(d<0)d+=24*60;const pause=parseInt(p||'0',10)||0;return Math.max(0,d-pause);}
function hm(min){return `${Math.floor(min/60)}:${String(min%60).padStart(2,'0')}`;}

function loadWeek(k){try{return JSON.parse(localStorage.getItem('pontaj:'+k))||{}}catch{return{}}}
function saveWeek(){const k=weekKey(monday);const data={};document.querySelectorAll('.day').forEach((el,i)=>{data[i]={s:el.querySelector('.in-s').value,p:el.querySelector('.in-p').value,e:el.querySelector('.in-e').value};});
  localStorage.setItem('pontaj:'+k,JSON.stringify(data));
  const idx=getIndex();if(!idx.includes(k)){idx.push(k);idx.sort().reverse();localStorage.setItem('pontaj:index',JSON.stringify(idx.slice(0,52)));}
  const d=$('#save-dot');d.classList.add('show');clearTimeout(d._t);d._t=setTimeout(()=>d.classList.remove('show'),1200);
  renderHistory();}
function getIndex(){try{return JSON.parse(localStorage.getItem('pontaj:index'))||[]}catch{return[]}}

function render(){
  const m=new Date(monday);const end=new Date(m);end.setDate(end.getDate()+6);
  $('#week-range').textContent=`${fmtDate(m)} – ${fmtDate(end)} ${end.getFullYear()}`;
  $('#week-label').textContent='Săpt. '+weekKey(monday);
  const saved=loadWeek(weekKey(monday));
  const todayStr=new Date().toDateString();
  daysEl.innerHTML='';
  for(let i=0;i<7;i++){
    const dt=new Date(m);dt.setDate(dt.getDate()+i);
    const v=saved[i]||{s:'',p:'',e:''};
    const card=document.createElement('div');card.className='day'+(dt.toDateString()===todayStr?' today':'');
    card.innerHTML=`<div class="day-head"><div><b>${DAYS[i]}</b> <span>${fmtDate(dt)}</span></div><span class="day-total"></span></div>
    <div class="grid3">
      <label>🕐 Început<input type="text" inputmode="none" readonly placeholder="--:--" class="in-s" value="${v.s||''}"></label>
      <label>⏸️ Pauză (min)<input type="number" class="in-p" min="0" max="600" step="5" inputmode="numeric" value="${v.p||''}" placeholder="30"></label>
      <label>🏁 Sfârșit<input type="text" inputmode="none" readonly placeholder="--:--" class="in-e" value="${v.e||''}"></label>
    </div><div class="chips">${[0,15,30,45,60].map(x=>`<button class="chip" data-p="${x}">${x}</button>`).join('')}</div>`;
    daysEl.appendChild(card);
  }
  daysEl.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{recalc();saveWeek();}));
  daysEl.querySelectorAll('.in-s,.in-e').forEach(inp=>inp.addEventListener('click',()=>openClock(inp)));
  daysEl.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',ev=>{ev.preventDefault();const card=c.closest('.day');card.querySelector('.in-p').value=c.dataset.p;recalc();saveWeek();}));
  recalc();renderHistory();
}
function recalc(){
  let total=0,days=0;
  document.querySelectorAll('.day').forEach(card=>{
    const s=card.querySelector('.in-s').value,p=card.querySelector('.in-p').value,e=card.querySelector('.in-e').value;
    const min=calcDay(s,p,e);total+=min;if(min>0)days++;
    const out=card.querySelector('.day-total');
    out.textContent=min>0?`${roDec(min/60)} (${hm(min)})`:'—';
    card.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',String(p||'')===c.dataset.p));
  });
  $('#total-dec').textContent=roDec(total/60);
  $('#total-hm').textContent=`${hm(total)} • ${days} ${days===1?'zi':'zile'}`;
}
function renderHistory(){
  const idx=getIndex();histEl.innerHTML=idx.length?'':'<li class="muted">Nicio săptămână salvată încă.</li>';
  idx.slice(0,12).forEach(k=>{
    let tot=0;const d=loadWeek(k);Object.values(d).forEach(v=>tot+=calcDay(v.s,v.p,v.e));
    const li=document.createElement('li');
    li.innerHTML=`<span><b>${k}</b><br><span class="muted">${roDec(tot/60)} • ${hm(tot)}</span></span><span><button class="btn small" data-open="${k}">Deschide</button> <button class="btn small" data-del="${k}">✕</button></span>`;
    histEl.appendChild(li);
  });
  histEl.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const[y,w]=b.dataset.open.split('-W');monday=mondayFromWeek(+y,+w);render();window.scrollTo({top:0,behavior:'smooth'});});
  histEl.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{if(!confirm('Ștergi '+b.dataset.del+'?'))return;localStorage.removeItem('pontaj:'+b.dataset.del);localStorage.setItem('pontaj:index',JSON.stringify(getIndex().filter(x=>x!==b.dataset.del)));renderHistory();});
}
function mondayFromWeek(y,w){const s=new Date(y,0,1+(w-1)*7);const d=getMonday(s);if(d.getFullYear()<y)d.setDate(d.getDate()+7);return d;}

$('#btn-prev').onclick=()=>{monday.setDate(monday.getDate()-7);render();};
$('#btn-next').onclick=()=>{monday.setDate(monday.getDate()+7);render();};
$('#btn-today').onclick=()=>{monday=getMonday(new Date());render();};
$('#btn-clear').onclick=()=>{if(!confirm('Ștergi toate orele din săptămâna afișată?'))return;localStorage.removeItem('pontaj:'+weekKey(monday));render();};
$('#btn-copy-weekdays').onclick=()=>{const f=document.querySelectorAll('.day')[0];const s=f.querySelector('.in-s').value,p=f.querySelector('.in-p').value,e=f.querySelector('.in-e').value;document.querySelectorAll('.day').forEach((c,i)=>{if(i>=1&&i<=4){c.querySelector('.in-s').value=s;c.querySelector('.in-p').value=p;c.querySelector('.in-e').value=e;}});recalc();saveWeek();};
$('#btn-export').onclick=()=>{
  const data={};
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.indexOf('pontaj:')===0){try{data[k]=JSON.parse(localStorage.getItem(k));}catch{data[k]=localStorage.getItem(k);}}}
  data._exportedAt=new Date().toISOString();data._app='pontaj';
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  const d=new Date();const stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  a.download='pontaj-backup-'+stamp+'.json';document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
};
$('#btn-import').onclick=()=>$('#file-import').click();
$('#file-import').onchange=(ev)=>{
  const f=ev.target.files&&ev.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const data=JSON.parse(rd.result);
      if(!data||typeof data!=='object')throw new Error('bad');
      const keys=Object.keys(data).filter(k=>k.indexOf('pontaj:')===0);
      if(!keys.length){alert('Fișierul nu conține backup de pontaj.');return;}
      if(!confirm('Import '+keys.length+' intrări? Datele existente cu aceeași cheie se suprascriu.'))return;
      keys.forEach(k=>localStorage.setItem(k,JSON.stringify(data[k])));
      render();alert('Import gata: '+keys.length+' intrări.');
    }catch{alert('Fișier invalid. Alege un JSON exportat din Pontaj.');}
    ev.target.value='';
  };
  rd.readAsText(f);
};
$('#btn-print').onclick=()=>{
  const m=new Date(monday);let rows='',tot=0;
  for(let i=0;i<7;i++){const card=document.querySelectorAll('.day')[i];const s=card.querySelector('.in-s').value||'—',p=card.querySelector('.in-p').value||'0',e=card.querySelector('.in-e').value||'—';const min=calcDay(card.querySelector('.in-s').value,card.querySelector('.in-p').value,card.querySelector('.in-e').value);tot+=min;const dt=new Date(m);dt.setDate(dt.getDate()+i);
    rows+=`<tr><td>${DAYS[i]} ${fmtDate(dt)}</td><td>${s}</td><td>${p} min</td><td>${e}</td><td>${min>0?roDec(min/60)+' ('+hm(min)+')':'—'}</td></tr>`;}
  $('#print-area').innerHTML=`<h1>Pontaj ${weekKey(monday)} — ${$('#week-range').textContent}</h1><p>Total: <b>${roDec(tot/60)} (${hm(tot)})</b></p><table><tr><th>Zi</th><th>Început</th><th>Pauză</th><th>Sfârșit</th><th>Total</th></tr>${rows}</table>`;
  window.print();
};

// theme
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem('pontaj:theme',t);$('#btn-theme').textContent=t==='dark'?'🌙':'☀️';$('#meta-theme').content=t==='dark'?'#0f172a':'#ffffff';}
$('#btn-theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
setTheme(localStorage.getItem('pontaj:theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));

// install
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#btn-install').hidden=false;});
$('#btn-install').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#btn-install').hidden=true;};


// ---------- ceas propriu (rotund, 24h) ----------
let ckTarget=null,ckH=8,ckM=0,ckMode='h';
const ckPad=n=>String(n).padStart(2,'0');
function openClock(inp){
  ckTarget=inp;
  const m=(inp.value||'').match(/^(\d{1,2}):(\d{2})$/);
  const now=new Date();
  ckH=m?Math.min(23,+m[1]):now.getHours();
  ckM=m?Math.min(59,+m[2]):(Math.round(now.getMinutes()/5)*5)%60;
  ckMode='h';ckDraw();
  const d=$('#dlg-clock');if(d&&typeof d.showModal==='function')d.showModal();
}
function ckNum(x,y,label,sel){
  return `<g class="ck-tap" data-v="${label}"><circle cx="${x}" cy="${y}" r="17" class="${sel?'ck-sel':''}"/><text x="${x}" y="${y+5}" text-anchor="middle" class="${sel?'ck-selt':''}">${label}</text></g>`;
}
function ckHand(ang,r){
  const x2=130+Math.cos(ang)*r,y2=130+Math.sin(ang)*r;
  return `<line x1="130" y1="130" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="ck-hand"/><circle cx="130" cy="130" r="5" class="ck-handdot"/>`;
}
function ckDraw(){
  $('#ck-h').textContent=ckPad(ckH);$('#ck-m').textContent=ckPad(ckM);
  $('#ck-h').classList.toggle('on',ckMode==='h');
  $('#ck-m').classList.toggle('on',ckMode==='m');
  $('#ck-fine').hidden=ckMode!=='m';
  const cx=130,cy=130;let h='<circle cx="130" cy="130" r="124" class="ck-bg"/>';
  if(ckMode==='h'){
    const outer=[13,14,15,16,17,18,19,20,21,22,23,0],inner=[1,2,3,4,5,6,7,8,9,10,11,12];
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2-Math.PI/2;
      h+=ckNum(cx+Math.cos(a)*96,cy+Math.sin(a)*96,outer[i],ckH===outer[i]);
      h+=ckNum(cx+Math.cos(a)*58,cy+Math.sin(a)*58,inner[i],ckH===inner[i]);
    }
    const oi=outer.indexOf(ckH),inr=oi<0;
    const pos=inr?inner.indexOf(ckH):oi;
    h+=ckHand((pos/12)*Math.PI*2-Math.PI/2,inr?58:96);
  }else{
    for(let i=0;i<12;i++){
      const a=(i/12)*Math.PI*2-Math.PI/2;
      h+=ckNum(cx+Math.cos(a)*96,cy+Math.sin(a)*96,ckPad(i*5),ckM===i*5);
    }
    h+=ckHand((ckM/60)*Math.PI*2-Math.PI/2,96);
  }
  $('#ck-face').innerHTML=h;
}
$('#ck-face').addEventListener('click',ev=>{
  const g=ev.target.closest('.ck-tap');if(!g)return;
  const v=g.dataset.v;
  if(ckMode==='h'){ckH=(+v)%24;ckMode='m';}
  else{ckM=(+v)%60;}
  ckDraw();
});
$('#ck-h').onclick=()=>{ckMode='h';ckDraw();};
$('#ck-m').onclick=()=>{ckMode='m';ckDraw();};
$('#ck-dec').onclick=()=>{ckM=(ckM+59)%60;ckDraw();};
$('#ck-inc').onclick=()=>{ckM=(ckM+1)%60;ckDraw();};
$('#ck-cancel').onclick=()=>$('#dlg-clock').close();
$('#ck-clear').onclick=()=>{if(ckTarget){ckTarget.value='';ckTarget.dispatchEvent(new Event('input',{bubbles:true}));}$('#dlg-clock').close();};
$('#ck-ok').onclick=()=>{if(ckTarget){ckTarget.value=ckPad(ckH)+':'+ckPad(ckM);ckTarget.dispatchEvent(new Event('input',{bubbles:true}));}$('#dlg-clock').close();};

render();
