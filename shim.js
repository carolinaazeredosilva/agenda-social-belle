/* Ponte entre a Agenda Social Belle e o Google: login, leitura da planilha, dados no Drive do app e artes. */
(function(){
  'use strict';
  var CFG=window.BELLE_CONFIG||{};
  var SCOPES='https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.appdata';
  var PX='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  window.PX=PX;
  function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(_){ return null; } }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function err(code,message){ var e=new Error(message||code); e.code=code; return e; }
  function notify(msg){ window.dispatchEvent(new CustomEvent('belle-msg',{detail:msg})); }

  /* ---------- login ---------- */
  var token=null, tokenExp=0, tokenClient=null, loginPromise=null, overlay=null;
  (function restore(){ var t=ls('belle_tok'), e=+ls('belle_exp'); if(t&&e>Date.now()+60000){ token=t; tokenExp=e; } })();
  function valid(){ return token&&tokenExp>Date.now()+30000; }
  function gisReady(){ return new Promise(function(res){ (function w(){ if(window.google&&google.accounts&&google.accounts.oauth2) return res(); setTimeout(w,100); })(); }); }
  function showOverlay(msg){
    if(!overlay){
      overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg,#F8F3FB);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:var(--font-body,system-ui)';
      overlay.innerHTML='<div style="max-width:320px"><div style="font:800 26px/1.1 var(--font-display,system-ui);color:var(--ink,#381B49)">Agenda Social</div>'+
        '<p id="lg-msg" style="margin:12px 0 22px;color:var(--body,#5A4869);font-size:15px;line-height:1.45">Entre com a sua conta Google para ver a planilha e salvar o que você organizar.</p>'+
        '<button id="lg-btn" style="min-height:48px;padding:0 24px;border:0;border-radius:14px;background:var(--accent,#A11176);color:var(--accent-ink,#fff);font:700 15px var(--font-display,system-ui);cursor:pointer">Entrar com Google</button></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('#lg-btn').addEventListener('click',function(){ doLogin(); });
    }
    if(msg) overlay.querySelector('#lg-msg').textContent=msg;
    overlay.style.display='flex';
  }
  function hideOverlay(){ if(overlay) overlay.style.display='none'; }
  var loginResolve=null;
  function doLogin(){
    if(!CFG.CLIENT_ID){ showOverlay('A configuração do acesso Google ainda não foi feita (falta o ID do cliente em config.js).'); return; }
    gisReady().then(function(){
      tokenClient=tokenClient||google.accounts.oauth2.initTokenClient({client_id:CFG.CLIENT_ID,scope:SCOPES,callback:function(){}});
      tokenClient.callback=function(r){
        if(r.error){ showOverlay('Não consegui entrar ('+r.error+'). Toque para tentar de novo.'); return; }
        token=r.access_token; tokenExp=Date.now()+(r.expires_in-60)*1000; ls('belle_tok',token); ls('belle_exp',String(tokenExp));
        hideOverlay(); if(loginResolve){ var f=loginResolve; loginResolve=null; loginPromise=null; f(token); }
      };
      tokenClient.error_callback=function(e){ showOverlay('O Google não abriu a janela de login ('+(e&&e.type||'erro')+'). Toque para tentar de novo.'); };
      tokenClient.requestAccessToken({prompt:''});
    });
  }
  function ensureToken(){
    if(valid()) return Promise.resolve(token);
    if(!loginPromise){ loginPromise=new Promise(function(res){ loginResolve=res; }); var go=function(){ showOverlay(); }; if(document.body) go(); else document.addEventListener('DOMContentLoaded',go); }
    return loginPromise;
  }
  async function gfetch(url,opts,retry){
    var t=await ensureToken(); opts=opts||{}; opts.headers=Object.assign({},opts.headers,{Authorization:'Bearer '+t});
    var r=await fetch(url,opts);
    if(r.status===401&&!retry){ token=null; ls('belle_tok',null); return gfetch(url,opts,true); }
    return r;
  }

  /* ---------- planilha ---------- */
  var mcp={
    callTool:async function(server,tool,input){
      if(tool!=='get_values') throw err('tool_error');
      var r=await gfetch('https://sheets.googleapis.com/v4/spreadsheets/'+input.spreadsheetId+'/values/'+encodeURIComponent(input.range)+'?valueRenderOption=FORMATTED_VALUE');
      if(r.status===403||r.status===404) throw err('tool_error');
      if(!r.ok) throw err('upstream_error','Google Sheets '+r.status);
      var j=await r.json(); return {payload:{values:j.values||[]}};
    },
    invalidate:async function(){}
  };

  /* ---------- dados do app (arquivo no Drive do app) ---------- */
  var DRIVE='https://www.googleapis.com/drive/v3/files', UP='https://www.googleapis.com/upload/drive/v3/files';
  var state={itens:{},seeded:false}, stateId=null, dirty={}, cbs=[], flushTimer=null, flushing=null, lastJson='';
  async function findState(){
    var r=await gfetch(DRIVE+"?spaces=appDataFolder&q="+encodeURIComponent("name='state.json'")+'&fields=files(id)&pageSize=1');
    if(!r.ok) throw err('upstream_error','Drive '+r.status);
    var j=await r.json(); return j.files&&j.files[0]?j.files[0].id:null;
  }
  async function readRemote(){
    if(!stateId) stateId=await findState();
    if(!stateId) return null;
    var r=await gfetch(DRIVE+'/'+stateId+'?alt=media'); if(!r.ok) throw err('upstream_error','Drive '+r.status);
    return r.json();
  }
  function multipart(meta,blob){
    var b='belle'+Math.random().toString(36).slice(2), enc=new TextEncoder();
    var head=enc.encode('--'+b+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+b+'\r\nContent-Type: '+(blob.type||'application/octet-stream')+'\r\n\r\n');
    var tail=enc.encode('\r\n--'+b+'--');
    return {body:new Blob([head,blob,tail]),type:'multipart/related; boundary='+b};
  }
  async function writeRemote(obj){
    var blob=new Blob([JSON.stringify(obj)],{type:'application/json'});
    if(!stateId){
      var m=multipart({name:'state.json',parents:['appDataFolder']},blob);
      var r=await gfetch(UP+'?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':m.type},body:m.body});
      if(!r.ok) throw err('upstream_error','Drive '+r.status); stateId=(await r.json()).id;
    }else{
      var r2=await gfetch(UP+'/'+stateId+'?uploadType=media',{method:'PATCH',headers:{'Content-Type':'application/json'},body:blob});
      if(!r2.ok) throw err('upstream_error','Drive '+r2.status);
    }
  }
  function emit(){ var docs=Object.keys(state.itens).map(function(id){ var d=state.itens[id]; return {id:id,data:function(){ return d; }}; }); lastJson=JSON.stringify(state.itens); cbs.forEach(function(cb){ try{ cb({docs:docs}); }catch(_){} }); }
  function schedule(){ clearTimeout(flushTimer); flushTimer=setTimeout(flush,700); }
  function flush(){
    if(flushing) { schedule(); return flushing; }
    var ids=Object.keys(dirty); if(!ids.length) return Promise.resolve();
    flushing=(async function(){
      try{
        var remote=await readRemote(); var itens=(remote&&remote.itens)||{};
        ids.forEach(function(id){ itens[id]=state.itens[id]; delete dirty[id]; });
        await writeRemote({itens:itens,seeded:true,updated:Date.now()});
        state.itens=Object.assign({},itens,pick(state.itens,Object.keys(dirty)));
      }catch(e){ ids.forEach(function(id){ dirty[id]=1; }); notify('Não consegui salvar agora. Vou tentar de novo.'); setTimeout(schedule,5000); }
      finally{ flushing=null; }
    })();
    return flushing;
  }
  function pick(o,keys){ var r={}; keys.forEach(function(k){ if(k in o) r[k]=o[k]; }); return r; }
  async function pull(){
    if(Object.keys(dirty).length||flushing) return;
    try{ var remote=await readRemote(); if(!remote) return; var j=JSON.stringify(remote.itens||{}); if(j!==lastJson){ state.itens=remote.itens||{}; emit(); } }catch(_){}
  }
  var started=false;
  async function start(errCb){
    if(started) return; started=true;
    try{
      var remote=await readRemote();
      if(remote){ state.itens=remote.itens||{}; state.seeded=!!remote.seeded; }
      else{
        try{ var s=await fetch('seed.json',{cache:'no-store'}); if(s.ok){ state.itens=await s.json(); } }catch(_){}
        state.seeded=true; Object.keys(state.itens).forEach(function(id){ dirty[id]=1; }); await writeRemote({itens:state.itens,seeded:true,updated:Date.now()}); dirty={};
      }
      emit();
      setInterval(pull,90000);
      document.addEventListener('visibilitychange',function(){ if(!document.hidden) pull(); });
    }catch(e){ started=false; if(errCb) errCb(e); }
  }
  var db={
    collection:function(){ return {onSnapshot:function(cb,errCb){ cbs.push(cb); start(errCb); return function(){}; }}; },
    doc:function(path){ var id=path.split('/')[1]; return {set:function(data){ state.itens[id]=data; dirty[id]=1; schedule(); return Promise.resolve(); }}; }
  };

  /* ---------- artes (arquivos no Drive do app) ---------- */
  var cacheP=null; function cache(){ if(!cacheP) cacheP=(window.caches?caches.open('belle-artes'):Promise.reject()).catch(function(){ return null; }); return cacheP; }
  var urls={}, queue=[], active=0;
  async function fetchBlob(id){
    var c=await cache(), key='/_arte/'+id;
    if(c){ var hit=await c.match(key); if(hit) return hit.blob(); }
    var r=await gfetch(DRIVE+'/'+id+'?alt=media'); if(!r.ok) throw err('upstream_error','Drive '+r.status);
    var b=await r.blob(); if(c){ try{ await c.put(key,new Response(b,{headers:{'Content-Type':b.type}})); }catch(_){} } return b;
  }
  function blobUrl(id){ if(!urls[id]) urls[id]=fetchBlob(id).then(function(b){ return URL.createObjectURL(b); }); return urls[id]; }
  function pump(){ while(active<4&&queue.length){ var job=queue.shift(); active++; job().finally(function(){ active--; pump(); }); } }
  function hydrate(root){
    (root.querySelectorAll?root.querySelectorAll('img[data-blob]:not([data-h])'):[]).forEach(function(img){
      img.dataset.h='1'; var id=img.dataset.blob;
      queue.push(function(){ return blobUrl(id).then(function(u){ img.src=u; }).catch(function(){ delete urls[id]; img.style.visibility='hidden'; }); }); pump();
    });
  }
  var assets={
    upload:async function(file){
      var m=multipart({name:file.name||'arte',parents:['appDataFolder']},file);
      var r=await gfetch(UP+'?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':m.type},body:m.body});
      if(!r.ok) throw err('upstream_error','Drive '+r.status);
      var j=await r.json(); return {id:j.id};
    },
    delete:async function(id){ await gfetch(DRIVE+'/'+id,{method:'DELETE'}); var c=await cache(); if(c) c.delete('/_arte/'+id); delete urls[id]; }
  };
  var realFetch=window.fetch.bind(window);
  window.fetch=function(u,o){ if(typeof u==='string'&&u.indexOf('/_blob/')===0){ return fetchBlob(u.slice(7)).then(function(b){ return new Response(b,{headers:{'Content-Type':b.type}}); }); } return realFetch(u,o); };
  document.addEventListener('DOMContentLoaded',function(){ hydrate(document); new MutationObserver(function(ms){ ms.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType===1){ if(n.matches&&n.matches('img[data-blob]')) hydrate({querySelectorAll:function(){ return [n]; }}); else hydrate(n); } }); }); }).observe(document.body,{childList:true,subtree:true}); });

  /* ---------- downloads ---------- */
  var downloads={
    save:async function(o){
      var f=new File([o.data],o.filename,{type:o.data.type||'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[f]})&&/iPhone|iPad|Android/i.test(navigator.userAgent)){
        try{ await navigator.share({files:[f]}); return {status:'saved'}; }catch(e){ if(e&&e.name==='AbortError') throw err('declined'); }
      }
      var a=document.createElement('a'); a.href=URL.createObjectURL(o.data); a.download=o.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); },4000);
      return {status:'saved'};
    }
  };

  window.claude={use:async function(n){ return n==='mcp'?mcp:n==='db'?db:n==='assets'?assets:n==='downloads'?downloads:null; }};
  window.addEventListener('belle-msg',function(e){ var t=document.getElementById('toast'); if(t){ t.textContent=e.detail; t.hidden=false; clearTimeout(window.__bt); window.__bt=setTimeout(function(){ t.hidden=true; },3500); } });

  /* ---------- importação das artes (uma vez, no computador) ---------- */
  async function importArts(files,setStatus){
    var map=await (await fetch('artmap.json',{cache:'no-store'})).json(); var by={};
    files.forEach(function(f){ var rel=(f.webkitRelativePath||f.name).split('/').slice(1).join('/')||f.name; var hit=map[rel]||map[f.name]; if(hit) (by[hit[0]]=by[hit[0]]||[]).push({pos:hit[1],file:f}); });
    var ids=Object.keys(by), done=0, total=ids.reduce(function(s,i){ return s+by[i].length; },0), n=0;
    if(!stateId&&!started) await start();
    for(var i=0;i<ids.length;i++){
      var id=ids[i], list=by[id].sort(function(a,b){ return a.pos-b.pos; }), art=[];
      if(state.itens[id]&&state.itens[id].art&&state.itens[id].art.length){ n+=list.length; continue; }
      for(var k=0;k<list.length;k++){ setStatus('Enviando '+(++n)+' de '+total+'…'); art.push((await assets.upload(list[k].file)).id); }
      state.itens[id]=Object.assign({},state.itens[id],{art:art}); dirty[id]=1; await flush();
    }
    emit(); return {itens:ids.length,arquivos:total,ignorados:files.length-total};
  }
  if(location.hash==='#importar'){ document.addEventListener('DOMContentLoaded',function(){
    var box=document.createElement('div'); box.style.cssText='position:fixed;inset:0;z-index:9000;background:var(--bg,#F8F3FB);padding:24px;overflow:auto;font-family:var(--font-body,system-ui);color:var(--ink,#381B49)';
    box.innerHTML='<h2 style="font:800 22px var(--font-display,system-ui)">Importar artes</h2><p style="line-height:1.5">Escolha a pasta <b>Instagram</b> do seu computador (a que tem as pastas por data). As artes são enviadas ao seu Drive e ligadas aos posts e stories certos. Nada é apagado e artes já existentes são mantidas.</p>'+
      '<p><input id="imp-in" type="file" webkitdirectory multiple></p><p id="imp-st" style="font-weight:700"></p><p><a href="./">Voltar ao app</a></p>';
    document.body.appendChild(box);
    box.querySelector('#imp-in').addEventListener('change',async function(e){ var fs=[].slice.call(e.target.files).filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); }); var st=box.querySelector('#imp-st');
      try{ var r=await importArts(fs,function(t){ st.textContent=t; }); st.textContent='Pronto: '+r.arquivos+' artes ligadas a '+r.itens+' itens'+(r.ignorados?' ('+r.ignorados+' arquivos sem correspondência foram ignorados)':'')+'.'; }catch(x){ st.textContent='Não deu certo: '+(x&&x.message||x); } });
  }); }
})();
