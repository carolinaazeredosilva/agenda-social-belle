window.__check=async function(){
  function parseCSV(t){
    var rows=[], row=[], f='', q=false;
    for(var i=0;i<t.length;i++){ var c=t[i];
      if(q){ if(c==='"'){ if(t[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=c; }
      else if(c==='"') q=true; else if(c===','){ row.push(f); f=''; }
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&t[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f=''; }
      else f+=c; }
    if(f!==''||row.length){ row.push(f); rows.push(row); } return rows;
  }
  const norm=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  function parseDate(s){
    if(!s) return null;
    const m=String(s).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if(!m) return null;
    let y=m[3]?+m[3]:new Date().getFullYear(); if(y<100) y+=2000;
    return y+'-'+pad(+m[2])+'-'+pad(+m[1]);
  }  function normStatus(s){
    const n=norm(s);
    if(n.startsWith('public')) return 'Publicado';
    if(n.startsWith('agend')) return 'Agendado';
    if(n.startsWith('aprov')) return 'Aprovado';
    if(n.startsWith('em prod')) return 'Em produção';
    if(n.startsWith('ideia')||!n) return 'Ideia';
    return s;
  }  function colIndex(head,pred){ for(let i=0;i<head.length;i++){ if(pred(head[i])) return i; } return -1; }
  function parseFeed(values){
    if(!values||values.length<2) return [];
    const head=values[0].map(norm);
    const c={
      data:colIndex(head,h=>h==='data'), status:colIndex(head,h=>h==='status'), formato:colIndex(head,h=>h==='formato'),
      esp:colIndex(head,h=>h.startsWith('especialidade')), tema:colIndex(head,h=>h==='tema'), pilar:colIndex(head,h=>h==='pilar'),
      ig:colIndex(head,h=>h==='ig'), fb:colIndex(head,h=>h==='fb'), tt:colIndex(head,h=>h==='tiktok'), yt:colIndex(head,h=>h.startsWith('yt')), li:colIndex(head,h=>h==='linkedin'),
      gancho:colIndex(head,h=>h.startsWith('gancho')), roteiro:colIndex(head,h=>h.startsWith('roteiro')), legenda:colIndex(head,h=>h.startsWith('legenda')),
      cta:colIndex(head,h=>h==='cta')
    };
    const g=(r,i)=>i>=0&&r[i]!=null?String(r[i]):'';
    const perDate={}; const out=[];
    for(let k=1;k<values.length;k++){
      const r=values[k]; const d=parseDate(g(r,c.data)); if(!d) continue;
      const ord=perDate[d]=(perDate[d]==null?0:perDate[d]+1);
      const redes=[]; [['Instagram',c.ig],['Facebook',c.fb],['TikTok',c.tt],['YT Shorts',c.yt],['LinkedIn',c.li]].forEach(p=>{ if(norm(g(r,p[1]))==='x') redes.push(p[0]); });
      const st=normStatus(g(r,c.status));
      out.push({id:'f_'+d+'_'+ord,kind:'feed',date:d,sheetStatus:st,formato:g(r,c.formato),esp:g(r,c.esp),tema:g(r,c.tema)||g(r,c.esp),pilar:g(r,c.pilar),
        redes,gancho:g(r,c.gancho),roteiro:g(r,c.roteiro),legenda:g(r,c.legenda),cta:g(r,c.cta)});
    }
    return out;
  }  function labelled(text,word){
    const re=new RegExp(word+'\\s*(\\d+)\\s*:','gi'); const hits=[]; let m;
    while((m=re.exec(text))){ hits.push({n:+m[1],start:m.index,end:re.lastIndex}); }
    if(!hits.length) return null;
    const map={};
    hits.forEach((h,i)=>{ const seg=text.slice(h.end,i+1<hits.length?hits[i+1].start:text.length); map[h.n]=seg.replace(/\s*APROVADO em [\d\/]+[^\n]*$/i,'').replace(/^[\s'"“‘]+|[\s.;'"”’]+$/g,'').trim(); });
    return map;
  }  function parseFeed(values){
    if(!values||values.length<2) return [];
    const head=values[0].map(norm);
    const c={
      data:colIndex(head,h=>h==='data'), status:colIndex(head,h=>h==='status'), formato:colIndex(head,h=>h==='formato'),
      esp:colIndex(head,h=>h.startsWith('especialidade')), tema:colIndex(head,h=>h==='tema'), pilar:colIndex(head,h=>h==='pilar'),
      ig:colIndex(head,h=>h==='ig'), fb:colIndex(head,h=>h==='fb'), tt:colIndex(head,h=>h==='tiktok'), yt:colIndex(head,h=>h.startsWith('yt')), li:colIndex(head,h=>h==='linkedin'),
      gancho:colIndex(head,h=>h.startsWith('gancho')), roteiro:colIndex(head,h=>h.startsWith('roteiro')), legenda:colIndex(head,h=>h.startsWith('legenda')),
      cta:colIndex(head,h=>h==='cta')
    };
    const g=(r,i)=>i>=0&&r[i]!=null?String(r[i]):'';
    const perDate={}; const out=[];
    for(let k=1;k<values.length;k++){
      const r=values[k]; const d=parseDate(g(r,c.data)); if(!d) continue;
      const ord=perDate[d]=(perDate[d]==null?0:perDate[d]+1);
      const redes=[]; [['Instagram',c.ig],['Facebook',c.fb],['TikTok',c.tt],['YT Shorts',c.yt],['LinkedIn',c.li]].forEach(p=>{ if(norm(g(r,p[1]))==='x') redes.push(p[0]); });
      const st=normStatus(g(r,c.status));
      out.push({id:'f_'+d+'_'+ord,kind:'feed',date:d,sheetStatus:st,formato:g(r,c.formato),esp:g(r,c.esp),tema:g(r,c.tema)||g(r,c.esp),pilar:g(r,c.pilar),
        redes,gancho:g(r,c.gancho),roteiro:g(r,c.roteiro),legenda:g(r,c.legenda),cta:g(r,c.cta)});
    }
    return out;
  }  function parseStories(values){
    if(!values||values.length<2) return [];
    const head=values[0].map(norm);
    const c={data:colIndex(head,h=>h==='data'),dest:colIndex(head,h=>h.startsWith('salvar')),tipo:colIndex(head,h=>h==='tipo'),
      copy:colIndex(head,h=>h.startsWith('conteudo')),inter:colIndex(head,h=>h.startsWith('interacao')),obj:colIndex(head,h=>h==='objetivo'),status:colIndex(head,h=>h==='status')};
    const g=(r,i)=>i>=0&&r[i]!=null?String(r[i]):'';
    const perDate={}; const out=[];
    for(let k=1;k<values.length;k++){
      const r=values[k]; const d=parseDate(g(r,c.data)); if(!d) continue;
      const rowIdx=perDate[d]=(perDate[d]==null?0:perDate[d]+1);
      const tipo=g(r,c.tipo), copy=g(r,c.copy).trim(), inter=g(r,c.inter).trim(), obj=g(r,c.obj), dest=g(r,c.dest).trim();
      const st=normStatus(g(r,c.status));
      if(/destaque/i.test(tipo)){
        out.push({id:'s_'+d+'_'+rowIdx+'_d',kind:'destaque',date:d,rowIdx,n:1,sheetStatus:st,tipo,copy,sticker:inter,objetivo:obj,destaque:dest,rowNote:''});
        continue;
      }
      const labCopy=labelled(copy,'STORY');
      const labInter=inter?labelled(inter,'Story'):null;
      let parts=[];
      if(labCopy){ Object.keys(labCopy).map(Number).sort((a,b)=>a-b).forEach(n=>parts.push({n,copy:labCopy[n]})); }
      else if(copy.indexOf('→')>=0){ copy.split('→').map(x=>x.trim()).filter(Boolean).forEach((x,i)=>parts.push({n:i+1,copy:x})); }
      else if(copy){ parts.push({n:1,copy}); }
      const rowNote=(inter&&!labInter)?inter:'';
      parts.forEach(p=>{ out.push({id:'s_'+d+'_'+rowIdx+'_'+p.n,kind:'story',date:d,rowIdx,n:p.n,sheetStatus:st,tipo,copy:p.copy,sticker:labInter&&labInter[p.n]?labInter[p.n]:'',objetivo:obj,rowNote}); });
      if(labInter){ Object.keys(labInter).forEach(n=>{ if(!parts.some(p=>p.n===+n)) out.push({id:'s_'+d+'_'+rowIdx+'_'+n,kind:'story',date:d,rowIdx,n:+n,sheetStatus:st,tipo,copy:'',sticker:labInter[n],objetivo:obj,rowNote:''}); }); }
    }
    return out;
  }
async function rd(aba){ const r=await fetch('https://docs.google.com/spreadsheets/d/1iEN3AKjzzQcGcVVFjm1qB5kxCizmHHLOxRk-wo2tCz4/gviz/tq?tqx=out:csv&headers=0&sheet='+encodeURIComponent(aba)); let rows=parseCSV(await r.text());
 while(rows.length&&rows[rows.length-1].every(x=>x==='')) rows.pop();
      /* A leitura direta apaga o título de colunas de data; recoloca "Data" na coluna que tem datas. */
      if(rows.length>1&&rows[0].map(function(h){ return h.trim().toLowerCase(); }).indexOf('data')<0){
        for(var c=0;c<rows[0].length;c++){ if(rows[0][c].trim()) continue; var n=0,t=0;
          for(var k=1;k<rows.length;k++){ var v=(rows[k][c]||'').trim(); if(!v) continue; t++; if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) n++; }
          if(t&&n/t>=0.5){ rows[0][c]='Data'; break; } }
      }
 return rows; }
const A=await rd('Calendário'), B=await rd('Stories');
const F=parseFeed(A), St=parseStories(B);
const fdates=new Set(F.map(x=>x.date)), sdates=new Set(St.map(x=>x.date));
const lostF=A.slice(1).filter(r=>r.some(c=>c.trim())&&!parseDate(r[A[0].findIndex(h=>norm(h)==='data')]||'')).map(r=>r.slice(0,8).join(' | ').slice(0,120));
const ci=B[0].findIndex(h=>norm(h)==='data');
const lostS=B.slice(1).filter(r=>r.some(c=>c.trim())&&!parseDate(r[ci]||'')).map(r=>r.slice(0,7).join(' | ').slice(0,120));
return ({headF:A[0].slice(0,18), headS:B[0].slice(0,8), feed:F.length, feedList:F.map(x=>x.date.slice(5)+' '+x.sheetStatus+' · '+(x.tema||'').slice(0,28)+' · leg:'+(x.legenda?x.legenda.length:0)),
 storyItems:St.filter(x=>x.kind==='story').length, destaques:St.filter(x=>x.kind==='destaque').length, storyDays:[...sdates].sort().map(d=>d.slice(5)+':'+St.filter(x=>x.date===d&&x.kind==='story').length+'s'+St.filter(x=>x.date===d&&x.kind==='destaque').length+'d').join(' '),
 lostFeedRows:lostF, lostStoryRows:lostS, rowsF:A.length-1, rowsS:B.length-1})
};
