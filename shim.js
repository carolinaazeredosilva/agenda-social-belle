/* Ponte entre a Agenda Social Belle e o Supabase: login, planilha publicada, dados e artes. */
(function(){
  'use strict';
  var CFG=window.BELLE_CONFIG||{};
  var PX='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  window.PX=PX;
  function err(code,message){ var e=new Error(message||code); e.code=code; return e; }
  function notify(msg){ window.dispatchEvent(new CustomEvent('belle-msg',{detail:msg})); }
  var sb=null;
  function client(){ if(!sb) sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true}}); return sb; }

  /* ---------- login (e-mail e senha) ---------- */
  var overlay=null, loginPromise=null, loginResolve=null;
  function showOverlay(msg){
    if(!overlay){
      overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg,#F8F3FB);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:var(--font-body,system-ui)';
      var inp='display:block;width:100%;box-sizing:border-box;min-height:48px;margin:0 0 10px;padding:0 14px;border:1px solid var(--line,#E6DCEE);border-radius:12px;background:var(--panel,#fff);color:var(--ink,#381B49);font:16px var(--font-body,system-ui)';
      overlay.innerHTML='<form id="lg-form" style="width:100%;max-width:320px"><div style="font:800 26px/1.1 var(--font-display,system-ui);color:var(--ink,#381B49)">Agenda Social</div>'+
        '<p id="lg-msg" style="margin:12px 0 20px;color:var(--body,#5A4869);font-size:15px;line-height:1.45">Entre para ver a planilha e salvar o que você organizar.</p>'+
        '<input id="lg-mail" type="email" autocomplete="username" placeholder="E-mail" style="'+inp+'" value="'+((function(){ try{ return localStorage.getItem('belle_mail')||''; }catch(_){ return ''; } })())+'">'+
        '<input id="lg-pass" type="password" autocomplete="current-password" placeholder="Senha" style="'+inp+'">'+
        '<button id="lg-btn" type="submit" style="width:100%;min-height:48px;margin-top:6px;border:0;border-radius:14px;background:var(--accent,#A11176);color:var(--accent-ink,#fff);font:700 15px var(--font-display,system-ui);cursor:pointer">Entrar</button></form>';
      document.body.appendChild(overlay);
      overlay.querySelector('#lg-form').addEventListener('submit',async function(e){
        e.preventDefault(); var b=overlay.querySelector('#lg-btn'); b.disabled=true; b.textContent='Entrando…';
        var r=await client().auth.signInWithPassword({email:overlay.querySelector('#lg-mail').value.trim(),password:overlay.querySelector('#lg-pass').value});
        b.disabled=false; b.textContent='Entrar';
        if(r.error){ overlay.querySelector('#lg-msg').textContent='E-mail ou senha incorretos. Tente de novo.'; return; }
        setRole(r.data.session); overlay.style.display='none'; if(loginResolve){ var f=loginResolve; loginResolve=null; loginPromise=null; f(r.data.session); }
      });
    }
    if(msg) overlay.querySelector('#lg-msg').textContent=msg;
    overlay.style.display='flex';
  }
  function setRole(sess){
    var em=(sess&&sess.user&&sess.user.email||'').toLowerCase(), dona=em===String(CFG.EMAIL||'').toLowerCase();
    window.belleRole=dona?'dona':'leitor'; window.belleEmail=em;
    var apply=function(){ document.body.classList.toggle('ro',!dona); window.dispatchEvent(new CustomEvent('belle-role',{detail:window.belleRole})); };
    if(document.body) apply(); else document.addEventListener('DOMContentLoaded',apply);
    try{ localStorage.setItem('belle_mail',em); }catch(_){}
  }
  async function ensureSession(){
    var s=(await client().auth.getSession()).data.session; if(s){ if(!window.belleRole) setRole(s); return s; }
    if(!loginPromise){ loginPromise=new Promise(function(res){ loginResolve=res; }); if(document.body) showOverlay(); else document.addEventListener('DOMContentLoaded',function(){ showOverlay(); }); }
    return loginPromise;
  }

  /* ---------- planilha (leitura direta das abas Calendário e Stories) ---------- */
  function parseCSV(t){
    var rows=[], row=[], f='', q=false;
    for(var i=0;i<t.length;i++){ var c=t[i];
      if(q){ if(c==='"'){ if(t[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=c; }
      else if(c==='"') q=true; else if(c===','){ row.push(f); f=''; }
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&t[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f=''; }
      else f+=c; }
    if(f!==''||row.length){ row.push(f); rows.push(row); } return rows;
  }
  var mcp={
    callTool:async function(server,tool,input){
      if(tool!=='get_values') throw err('tool_error');
      await ensureSession();
      var aba=/^([^!]+)!/.exec(input.range); aba=aba&&aba[1];
      if(aba!=='Calendário'&&aba!=='Stories') throw err('tool_error');
      var url='https://docs.google.com/spreadsheets/d/'+input.spreadsheetId+'/gviz/tq?tqx=out:csv&headers=0&sheet='+encodeURIComponent(aba);
      var r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw err('tool_error','Planilha '+r.status);
      var rows=parseCSV(await r.text());
      while(rows.length&&rows[rows.length-1].every(function(x){ return x===''; })) rows.pop();
      /* A leitura direta apaga o título de colunas de data; recoloca "Data" na coluna que tem datas. */
      if(rows.length>1&&rows[0].map(function(h){ return h.trim().toLowerCase(); }).indexOf('data')<0){
        for(var c=0;c<rows[0].length;c++){ if(rows[0][c].trim()) continue; var n=0,t=0;
          for(var k=1;k<rows.length;k++){ var v=(rows[k][c]||'').trim(); if(!v) continue; t++; if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) n++; }
          if(t&&n/t>=0.5){ rows[0][c]='Data'; break; } }
      }
      return {payload:{values:rows}};
    },
    invalidate:async function(){}
  };

  /* ---------- dados do app (tabela itens) ---------- */
  var state={}, dirty={}, cbs=[], flushTimer=null, flushing=null, lastJson='', started=false;
  function emit(){ var docs=Object.keys(state).map(function(id){ var d=state[id]; return {id:id,data:function(){ return d; }}; }); lastJson=JSON.stringify(state); cbs.forEach(function(cb){ try{ cb({docs:docs}); }catch(_){} }); }
  async function readAll(){
    var out={}, from=0; for(;;){ var r=await client().from('itens').select('id,data').range(from,from+999); if(r.error) throw r.error; r.data.forEach(function(x){ out[x.id]=x.data||{}; }); if(r.data.length<1000) break; from+=1000; }
    return out;
  }
  function schedule(){ clearTimeout(flushTimer); flushTimer=setTimeout(flush,600); }
  function flush(){
    if(flushing){ schedule(); return flushing; }
    var ids=Object.keys(dirty); if(!ids.length) return Promise.resolve();
    flushing=(async function(){
      try{
        var rows=ids.map(function(id){ return {id:id,data:state[id],updated_at:new Date().toISOString()}; });
        var r=await client().from('itens').upsert(rows); if(r.error) throw r.error;
        ids.forEach(function(id){ delete dirty[id]; });
      }catch(e){ notify('Não consegui salvar agora. Vou tentar de novo.'); setTimeout(schedule,5000); }
      finally{ flushing=null; }
    })();
    return flushing;
  }
  async function pull(){
    if(Object.keys(dirty).length||flushing) return;
    try{ var remote=await readAll(); var j=JSON.stringify(remote); if(j!==lastJson){ state=remote; emit(); } }catch(_){}
  }
  async function start(errCb){
    if(started) return; started=true;
    try{
      await ensureSession(); var remote=await readAll();
      if(!Object.keys(remote).length){
        try{ var s=await fetch('seed.json',{cache:'no-store'}); if(s.ok){ remote=await s.json(); Object.keys(remote).forEach(function(id){ dirty[id]=1; }); } }catch(_){}
      }
      state=remote; emit(); if(Object.keys(dirty).length) flush();
      setInterval(pull,60000); document.addEventListener('visibilitychange',function(){ if(!document.hidden) pull(); });
    }catch(e){ started=false; if(errCb) errCb(e); }
  }
  var db={
    collection:function(){ return {onSnapshot:function(cb,errCb){ cbs.push(cb); start(errCb); return function(){}; }}; },
    doc:function(path){ var id=path.split('/')[1]; return {set:function(data){ state[id]=data; dirty[id]=1; schedule(); return Promise.resolve(); }}; }
  };

  /* ---------- artes (armazenamento privado) ---------- */
  var cacheP=null; function cache(){ if(!cacheP) cacheP=(window.caches?caches.open('belle-artes'):Promise.reject()).catch(function(){ return null; }); return cacheP; }
  var urls={}, queue=[], active=0;
  async function fetchBlob(id){
    var c=await cache(), key='/_arte/'+id;
    if(c){ var hit=await c.match(key); if(hit) return hit.blob(); }
    await ensureSession(); var r=await client().storage.from('artes').download(id); if(r.error) throw r.error;
    var b=r.data; if(c){ try{ await c.put(key,new Response(b,{headers:{'Content-Type':b.type}})); }catch(_){} } return b;
  }
  function blobUrl(id){ if(!urls[id]) urls[id]=fetchBlob(id).then(function(b){ return URL.createObjectURL(b); }); return urls[id]; }
  function pump(){ while(active<4&&queue.length){ var job=queue.shift(); active++; job().finally(function(){ active--; pump(); }); } }
  function hydrate(root){
    (root.querySelectorAll?root.querySelectorAll('img[data-blob]:not([data-h])'):[]).forEach(function(img){
      img.dataset.h='1'; var id=img.dataset.blob;
      queue.push(function(){ return blobUrl(id).then(function(u){ img.src=u; }).catch(function(){ delete urls[id]; img.style.visibility='hidden'; }); }); pump();
    });
  }
  function uid(){ return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2); }
  var assets={
    upload:async function(file){
      await ensureSession(); var ext=((file.name||'').split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'')||'png', id=uid()+'.'+ext;
      var r=await client().storage.from('artes').upload(id,file,{contentType:file.type||'image/png',upsert:false}); if(r.error) throw r.error;
      return {id:id};
    },
    delete:async function(id){ await client().storage.from('artes').remove([id]); var c=await cache(); if(c) c.delete('/_arte/'+id); delete urls[id]; }
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


  /* ---------- Google Agenda: cria os alarmes direto na agenda ---------- */
  var gTok=null, gExp=0, gClient=null;
  function gToken(){
    if(gTok&&gExp>Date.now()+60000) return Promise.resolve(gTok);
    return new Promise(function(res,rej){
      if(!(window.google&&google.accounts&&google.accounts.oauth2)) return rej(err('gis'));
      gClient=gClient||google.accounts.oauth2.initTokenClient({client_id:CFG.GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets',callback:function(){}});
      gClient.callback=function(r){ if(r.error) return rej(err(r.error)); gTok=r.access_token; gExp=Date.now()+(r.expires_in-60)*1000; res(gTok); };
      gClient.error_callback=function(e){ rej(err(e&&e.type||'popup')); };
      gClient.requestAccessToken({prompt:'',login_hint:CFG.EMAIL});
    });
  }
  async function gcal(method,path,body){
    var t=await gToken();
    var r=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events'+path,{method:method,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(r.status===401){ gTok=null; }
    return r;
  }
  window.belleCal={
    remove:async function(eventId){
      var r=await gcal('DELETE','/'+encodeURIComponent(eventId));
      if(r.ok||r.status===404||r.status===410) return true;
      throw err('gcal','O Google Agenda recusou a remoção ('+r.status+').');
    },
    upsert:async function(list){
      var out={}; await gToken();
      for(var i=0;i<list.length;i++){ var x=list[i];
        var body=Object.assign({},x.ev,{colorId:'3',reminders:{useDefault:false,overrides:[{method:'popup',minutes:(CFG.AVISO_MIN||5)}]}});
        try{
          var r=null;
          if(x.eventId){ r=await gcal('PATCH','/'+encodeURIComponent(x.eventId),body); if(r.status===404||r.status===410) r=null; else if(r.ok){ var j0=await r.json(); if(j0.status==='cancelled') r=null; else { out[x.key]={id:j0.id}; continue; } } }
          r=await gcal('POST','',body); if(r.ok){ var j=await r.json(); out[x.key]={id:j.id}; } else out[x.key]={error:r.status};
        }catch(e){ out[x.key]={error:String(e&&e.message||e)}; }
      }
      return out;
    }
  };


  /* ---------- Planilha: grava novas datas (só com confirmação no app) ---------- */
  function colL(i){ var s=''; i++; while(i>0){ var m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; }
  function nrm(v){ return String(v==null?'':v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim(); }
  var WDS=['dom','seg','ter','qua','qui','sex','sáb'];
  window.belleSheets={
    applyDates:async function(sheetId,changes,parseDate){
      var t=await gToken();
      var base='https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values';
      var r=await fetch(base+'/'+encodeURIComponent('Calendário!A1:Z400')+'?valueRenderOption=FORMATTED_VALUE',{headers:{Authorization:'Bearer '+t}});
      if(!r.ok) throw err('sheet','Não consegui ler a planilha para gravar ('+r.status+').');
      var rows=(await r.json()).values||[], hi=-1, dc=-1, wc=-1;
      for(var i=0;i<rows.length&&hi<0;i++){ var h=(rows[i]||[]).map(nrm); var k=h.indexOf('data'); if(k>=0){ hi=i; dc=k; wc=h.indexOf('dia'); } }
      if(hi<0) throw err('sheet','Não achei a coluna Data na aba Calendário.');
      var per={}, pos={};
      for(var j=hi+1;j<rows.length;j++){ var d=parseDate((rows[j]||[])[dc]||''); if(!d) continue; var o=per[d]=(per[d]==null?0:per[d]+1); pos[d+'#'+o]=j+1; }
      var data=[], miss=[];
      changes.forEach(function(c){ var row=pos[c.from+'#'+c.ord]; if(!row){ miss.push(c.from); return; }
        var p=c.to.split('-'); data.push({range:'Calendário!'+colL(dc)+row,values:[[p[2]+'/'+p[1]+'/'+p[0]]]});
        if(wc>=0){ var dt=new Date(+p[0],+p[1]-1,+p[2],12); data.push({range:'Calendário!'+colL(wc)+row,values:[[WDS[dt.getDay()]]]}); } });
      if(miss.length) throw err('sheet','A planilha mudou desde a última leitura. Atualize e organize de novo.');
      var w=await fetch(base+':batchUpdate',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'USER_ENTERED',data:data})});
      if(!w.ok) throw err('sheet','O Google recusou a gravação na planilha ('+w.status+').');
      return {updated:changes.length};
    }
  };

  window.claude={use:async function(n){ return n==='mcp'?mcp:n==='db'?db:n==='assets'?assets:n==='downloads'?downloads:null; }};
  window.addEventListener('belle-msg',function(e){ var t=document.getElementById('toast'); if(t){ t.textContent=e.detail; t.hidden=false; clearTimeout(window.__bt); window.__bt=setTimeout(function(){ t.hidden=true; },3500); } });

  /* ---------- importação das artes (uma vez, no computador) ---------- */
  async function importArts(files,setStatus){
    var map=await (await fetch('artmap.json',{cache:'no-store'})).json(); var by={};
    files.forEach(function(f){ var rel=(f.webkitRelativePath||f.name).split('/').slice(1).join('/')||f.name; var hit=map[rel]||map[f.name]; if(hit) (by[hit[0]]=by[hit[0]]||[]).push({pos:hit[1],file:f}); });
    var ids=Object.keys(by), total=ids.reduce(function(s,i){ return s+by[i].length; },0), n=0;
    if(!started) await start();
    for(var i=0;i<ids.length;i++){
      var id=ids[i], list=by[id].sort(function(a,b){ return a.pos-b.pos; }), art=[];
      if(state[id]&&state[id].art&&state[id].art.length){ n+=list.length; continue; }
      for(var k=0;k<list.length;k++){ setStatus('Enviando '+(++n)+' de '+total+'…'); art.push((await assets.upload(list[k].file)).id); }
      state[id]=Object.assign({},state[id],{art:art}); dirty[id]=1; await flush();
    }
    emit(); return {itens:ids.length,arquivos:total,ignorados:files.length-total};
  }
  if(location.hash==='#importar'){ document.addEventListener('DOMContentLoaded',function(){
    var box=document.createElement('div'); box.style.cssText='position:fixed;inset:0;z-index:9000;background:var(--bg,#F8F3FB);padding:24px;overflow:auto;font-family:var(--font-body,system-ui);color:var(--ink,#381B49)';
    box.innerHTML='<h2 style="font:800 22px var(--font-display,system-ui)">Importar artes</h2><p style="line-height:1.5">Escolha a pasta <b>Instagram</b> do seu computador (a que tem as pastas por data). As artes são enviadas ao seu armazenamento privado e ligadas aos posts e stories certos. Nada é apagado e artes já existentes são mantidas.</p>'+
      '<p><input id="imp-in" type="file" webkitdirectory multiple></p><p id="imp-st" style="font-weight:700"></p><p><a href="./">Voltar ao app</a></p>';
    document.body.appendChild(box);
    box.querySelector('#imp-in').addEventListener('change',async function(e){ var fs=[].slice.call(e.target.files).filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); }); var st=box.querySelector('#imp-st');
      try{ var r=await importArts(fs,function(t){ st.textContent=t; }); st.textContent='Pronto: '+r.arquivos+' artes ligadas a '+r.itens+' itens'+(r.ignorados?' ('+r.ignorados+' arquivos sem correspondência foram ignorados)':'')+'.'; }catch(x){ st.textContent='Não deu certo: '+(x&&x.message||x); } });
  }); }
})();
