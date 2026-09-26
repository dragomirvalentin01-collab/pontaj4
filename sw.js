const C='pontaj-v31';
const ASSETS=[
  './','./index.html','./styles.css?v=31','./app.js?v=31',
  './vendor/supabase.esm.js',
  './manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-maskable-512.png'
];
let userConfirmedUpdate=false;

// 503 curat in loc de index.html: un .js/.css lipsa nu trebuie servit ca text/html
// (ar da "expected a JavaScript module but the server responded with text/html")
const OFFLINE_JS=new Response('/* offline: asset lipsa din cache */',{
  status:503,headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'}
});

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
  // cross-origin (Supabase API, etc.) -> lasam browserul sa le trateze normal.
  // NICIODATA nu cache-uitam raspunsuri de autentificare sau de la API.
  if(url.origin!==location.origin)return;
  if(url.pathname.endsWith('/sw.js'))return;

  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{
      const cp=r.clone();
      caches.open(C).then(c=>{c.put('./index.html',cp.clone()).catch(()=>{});c.put('./',cp).catch(()=>{});}).catch(()=>{});
      return r;
    }).catch(()=>caches.match('./index.html').then(h=>h||caches.match('./'))));
    return;
  }

  // JS/CSS: network-first, cauti din cache doar daca retea pica
  if(/\.(js|css)$/.test(url.pathname)){
    e.respondWith(fetch(e.request).then(res=>{
      if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});}
      return res;
    }).catch(()=>caches.match(e.request).then(h=>h||caches.match(e.request,{ignoreSearch:true}).then(h2=>h2||OFFLINE_JS))));
    return;
  }

  // restul (iconuri, manifest): cache-first cu write-through
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});}
    return res;
  }).catch(()=>caches.match(e.request))));
});
