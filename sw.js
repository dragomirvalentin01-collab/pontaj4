const C='pontaj-v17';
const ASSETS=['./','./index.html','./styles.css?v=17','./app.js?v=17','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
let userConfirmedUpdate=false;
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()).then(()=>{
  if(!userConfirmedUpdate)return;
  userConfirmedUpdate=false;
  return self.clients.matchAll({type:'window'}).then(cs=>Promise.all(cs.map(c=>{
    try{const r=c.navigate(c.url);if(r&&typeof r.catch==='function')return r.catch(()=>{});return r;}catch{return Promise.resolve();}
  })));
}));});
self.addEventListener('message',e=>{if(e&&e.data==='SKIP_WAITING'){userConfirmedUpdate=true;self.skipWaiting();}});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>{c.put('./index.html',cp.clone()).catch(()=>{});c.put('./',cp).catch(()=>{});}).catch(()=>{});return r;}).catch(()=>caches.match('./index.html').then(h=>h||caches.match('./'))));
    return;
  }
  const fresh=/\.(js|css)(\?|$)/.test(url.pathname+url.search);
  if(fresh){
    e.respondWith(fetch(e.request).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});}return res;}).catch(()=>caches.match(e.request).then(h=>h||caches.match(e.request,{ignoreSearch:true}).then(h2=>h2||caches.match('./index.html')))));
    return;
  }
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});}return res;}).catch(()=>caches.match(e.request))));
});
