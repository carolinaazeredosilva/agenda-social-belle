/* Aba Respostas: caixa de entrada do agente do Instagram.
   Lê a tabela ig_mensagens do Supabase (gravada pela função ig-webhook) e envia pela função ig-enviar.
   Só a dona vê as conversas (regra no banco). Usada pelo index.html: belleRespostas.render(), .count(). */
(function(){
  'use strict';
  var S={auto:null, autoSalvando:false, lista:null, carregando:false, erro:null, filtro:'pendentes', edit:{}, envio:{}, aviso:{}, canal:null, rerender:null};
  var CAT={preco:'Preço',demonstracao:'Quer conhecer',concorrente:'Vem de outro sistema',duvida_produto:'Dúvida sobre o Belle',
    teste_gratis:'Teste grátis',acesso_teste:'Acesso ao teste',suporte:'Suporte',financeiro:'Financeiro',vagas:'Vagas',
    parceria:'Parceria',eventos:'Eventos',fora_escopo:'Fora do escopo',reclamacao:'Reclamação',saudacao:'Saudação',
    elogio:'Elogio',spam:'Spam',outro:'Outro'};
  var PEND={novo:1,sugerido:1,erro:1};
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function sb(){ return window.belleSb&&window.belleSb.client(); }
  function dona(){ return window.belleRole==='dona'; }
  function redraw(){ if(S.rerender) S.rerender(); }
  function quando(iso){
    var d=new Date(iso), min=Math.round((Date.now()-d)/60000);
    if(min<1) return 'agora'; if(min<60) return 'há '+min+' min'; if(min<24*60) return 'há '+Math.round(min/60)+' h';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  }
  /* DM: a Meta só deixa responder até 24h depois da última mensagem da pessoa naquela conversa. */
  function prazo(m){
    if(m.canal!=='dm') return null;
    var ult=S.lista.filter(function(x){ return x.canal==='dm'&&x.conversa===m.conversa; }).reduce(function(a,x){ return Math.max(a,Date.parse(x.recebido_em)); },0);
    return ult+24*3600e3-Date.now();
  }

  async function carregar(){
    if(S.carregando||!sb()) return; S.carregando=true;
    try{
      await window.belleSb.ensureSession();
      if(!dona()){ S.lista=[]; S.erro=null; return; }
      var r=await sb().from('ig_mensagens').select('*').order('recebido_em',{ascending:false}).limit(300);
      if(r.error) throw r.error;
      S.lista=r.data||[]; S.erro=null; ouvir();
      var c=await sb().from('ig_config').select('auto').eq('id',1).maybeSingle();
      S.auto=c.error?null:!!(c.data&&c.data.auto);
    }catch(e){
      S.erro=/relation|does not exist|schema cache/i.test(e.message||'')?'A caixa de entrada ainda não foi criada no Supabase. Ela aparece quando o servidor do agente for publicado.':(e.message||String(e));
      if(!S.lista) S.lista=[];
    }finally{ S.carregando=false; redraw(); }
  }
  /* Recebe as mensagens novas na hora, sem recarregar a página. */
  function ouvir(){
    if(S.canal||!sb().channel) return;
    S.canal=sb().channel('ig-mensagens').on('postgres_changes',{event:'*',schema:'public',table:'ig_mensagens'},function(p){
      var n=p.new, id=(n&&n.id)||(p.old&&p.old.id); if(!id||!S.lista) return;
      var i=S.lista.findIndex(function(x){ return x.id===id; });
      if(p.eventType==='DELETE'){ if(i>=0) S.lista.splice(i,1); }
      else if(i>=0) S.lista[i]=n; else S.lista.unshift(n);
      redraw();
    }).subscribe();
  }

  async function enviar(id,via){
    var m=S.lista.find(function(x){ return x.id===id; }); if(!m) return;
    var texto=(S.edit[id]!=null?S.edit[id]:m.sugestao||'').trim();
    if(!texto){ S.aviso[id]='Escreva a resposta antes de enviar.'; redraw(); return; }
    S.envio[id]=true; S.aviso[id]=''; redraw();
    try{
      var r=await sb().functions.invoke('ig-enviar',{body:{id:id,texto:texto,via:via}});
      if(r.error){ var msg=r.error.message; try{ var j=await r.error.context.json(); if(j&&j.erro) msg=j.erro; }catch(_){} throw new Error(msg); }
      Object.assign(m,{status:'enviado',resposta:texto,resposta_via:r.data&&r.data.via,enviado_em:r.data&&r.data.enviado_em,erro:null});
      delete S.edit[id];
    }catch(e){ S.aviso[id]=e.message||String(e); }
    finally{ S.envio[id]=false; redraw(); }
  }
  async function marcar(id,status){
    var m=S.lista.find(function(x){ return x.id===id; }); if(!m) return;
    var antes=m.status; m.status=status; redraw();
    var r=await sb().from('ig_mensagens').update({status:status}).eq('id',id);
    if(r.error){ m.status=antes; S.aviso[id]=r.error.message; redraw(); }
  }

  async function mudarAuto(){
    if(S.auto===null||S.autoSalvando) return;
    var novo=!S.auto, antes=S.auto; S.auto=novo; S.autoSalvando=true; redraw();
    var r=await sb().from('ig_config').update({auto:novo,atualizado_em:new Date().toISOString()}).eq('id',1).select('auto');
    if(r.error||!r.data||!r.data.length){ S.auto=antes; S.erro='Não consegui mudar o "Responder sozinho": '+((r.error&&r.error.message)||'sem permissão'); }
    S.autoSalvando=false; redraw();
  }

  function cartao(m){
    var pend=!!PEND[m.status], p=prazo(m), venc=p!=null&&p<=0, envio=!!S.envio[m.id];
    var h='<article class="vcard rsp'+(m.urgente&&pend?' urg':'')+'" data-id="'+esc(m.id)+'">';
    h+='<div class="rsp-top"><span class="chip">'+(m.canal==='dm'?'DM':'Comentário')+'</span>'
      +(m.categoria?'<span class="chip">'+esc(CAT[m.categoria]||m.categoria)+'</span>':'')
      +(m.urgente?'<span class="chip rsp-urg">Urgente</span>':'')
      +'<b>'+(m.autor?'@'+esc(m.autor):'Alguém')+'</b><span class="rsp-q">'+quando(m.recebido_em)+'</span>'
      +(m.post_link?'<a class="linkbtn" href="'+esc(m.post_link)+'" target="_blank" rel="noopener">ver post</a>':'')+'</div>';
    h+='<p class="rsp-txt">'+esc(m.texto||'(sem texto)')+'</p>';
    if(m.resumo) h+='<p class="hint">'+esc(m.resumo)+'</p>';
    if(m.status==='enviado'){
      h+='<div class="rsp-env"><span>Respondido '+(m.resposta_via==='dm'&&m.canal==='comentario'?'na DM ':'')+(m.enviado_em?quando(m.enviado_em):'')+(m.enviado_por==='agente'?' pelo agente':'')+'</span><p>'+esc(m.resposta)+'</p></div>';
    }else if(m.status==='descartado'){
      h+='<div class="row"><span class="hint">Descartada'+(m.categoria==='spam'?' (parece spam)':'')+'.</span><button class="btn" data-rsp="voltar" data-id="'+esc(m.id)+'">Voltar para a caixa</button></div>';
    }else{
      var val=S.edit[m.id]!=null?S.edit[m.id]:(m.sugestao||'');
      h+='<label class="rsp-lb">Resposta'+(m.sugestao?' sugerida':'')+'</label><textarea class="rsp-ta" data-rsp-ta="'+esc(m.id)+'" rows="3" maxlength="1000" placeholder="Escreva a resposta">'+esc(val)+'</textarea>';
      if(p!=null) h+='<p class="hint">'+(venc?'Passou o prazo de 24 horas da Meta. Responda pelo app do Instagram.':'Dá para responder por mais '+(p<3600e3?Math.max(1,Math.round(p/60000))+' min':Math.floor(p/3600e3)+' h')+'.')+'</p>';
      if(m.erro||S.aviso[m.id]) h+='<p class="rsp-err">'+esc(S.aviso[m.id]||m.erro)+'</p>';
      h+='<div class="row">'
        +'<button class="btn primary" data-rsp="enviar" data-id="'+esc(m.id)+'"'+(envio||venc?' disabled':'')+'>'+(envio?'Enviando…':m.canal==='dm'?'Enviar na DM':'Responder no post')+'</button>'
        +(m.canal==='comentario'?'<button class="btn" data-rsp="dm" data-id="'+esc(m.id)+'"'+(envio?' disabled':'')+'>Responder na DM</button>':'')
        +'<button class="btn" data-rsp="descartar" data-id="'+esc(m.id)+'"'+(envio?' disabled':'')+'>Descartar</button></div>';
    }
    return h+'</article>';
  }

  function render(rerender){
    S.rerender=rerender||S.rerender;
    if(S.lista===null) carregar();
    var h='<div class="vcard"><h3>Respostas do Instagram</h3><p class="hint">Comentários e DMs do @bellesoftware chegam aqui na hora, com a resposta que o agente sugere. '
      +(S.auto?'O agente responde sozinho os assuntos simples (saudação, elogio, teste grátis, dúvidas, preço, demonstração, vagas e fora do escopo). O resto espera você aqui.</p>':'Nada sai sozinho: revise, ajuste se quiser e envie.</p>')
      +(S.auto===null?'':'<div class="row" style="margin-top:8px"><button class="btn'+(S.auto?' primary':'')+'" data-rsp="auto" aria-pressed="'+S.auto+'"'+(S.autoSalvando?' disabled':'')+'>Responder sozinho: '+(S.auto?'ligado':'desligado')+'</button></div>');
    if(S.lista===null) return h+'<p class="empty">Carregando…</p></div>';
    if(!dona()) return h+'<p class="empty">Só a dona da Agenda vê as conversas do Instagram.</p></div>';
    var L=S.lista, n={pendentes:0,enviadas:0,descartadas:0,todas:L.length};
    L.forEach(function(m){ if(PEND[m.status]) n.pendentes++; else if(m.status==='enviado') n.enviadas++; else if(m.status==='descartado') n.descartadas++; });
    var F={pendentes:'Para responder',enviadas:'Respondidas',descartadas:'Descartadas',todas:'Todas'};
    h+='<div class="seg2 wrapx" role="group" aria-label="Filtrar" style="margin:10px 0">'+Object.keys(F).map(function(k){ return '<button data-rsp="filtro" data-f="'+k+'" aria-pressed="'+(S.filtro===k)+'">'+F[k]+' ('+n[k]+')</button>'; }).join('')
      +'<button data-rsp="recarregar" title="Recarregar">Recarregar</button></div>';
    if(S.erro) h+='<p class="rsp-err">'+esc(S.erro)+'</p>';
    h+='</div>';
    var V=L.filter(function(m){ return S.filtro==='todas'||(S.filtro==='pendentes'?!!PEND[m.status]:S.filtro==='enviadas'?m.status==='enviado':m.status==='descartado'); });
    if(S.filtro==='pendentes') V.sort(function(a,b){ return (b.urgente-a.urgente)||(Date.parse(b.recebido_em)-Date.parse(a.recebido_em)); });
    if(!V.length) h+='<p class="empty" style="margin-top:14px">'+(S.filtro==='pendentes'?'Nada esperando resposta. Tudo em dia.':'Nada por aqui.')+'</p>';
    else h+='<div class="rsp-list">'+V.map(cartao).join('')+'</div>';
    return h;
  }
  function count(){ if(S.lista===null&&dona()) carregar(); return S.lista?S.lista.filter(function(m){ return PEND[m.status]; }).length:0; }

  document.addEventListener('input',function(e){ var id=e.target&&e.target.getAttribute&&e.target.getAttribute('data-rsp-ta'); if(id!=null) S.edit[id]=e.target.value; });
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-rsp]'); if(!b) return;
    var a=b.getAttribute('data-rsp'), id=b.getAttribute('data-id');
    if(a==='filtro'){ S.filtro=b.getAttribute('data-f'); redraw(); }
    else if(a==='recarregar'){ carregar(); }
    else if(a==='auto'){ if(S.auto||confirm('Ligar o "Responder sozinho"? O agente vai responder na hora, sem você revisar, os comentários e DMs de assuntos simples.')) mudarAuto(); }
    else if(a==='enviar') enviar(id,'comentario');
    else if(a==='dm') enviar(id,'dm');
    else if(a==='descartar') marcar(id,'descartado');
    else if(a==='voltar') marcar(id,'sugerido');
  });
  window.addEventListener('belle-role',function(){ if(dona()&&S.lista&&!S.lista.length) { S.lista=null; } });
  window.belleRespostas={render:render,count:count};
})();
