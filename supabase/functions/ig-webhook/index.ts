// Recebe da Meta, na hora, cada comentário e cada DM do @bellesoftware.
// Guarda na tabela ig_mensagens com a categoria e a resposta sugerida pela IA.
// Nesta etapa (modo rascunho) nada é enviado sozinho: a Kaká aprova na aba Respostas da Agenda.
//
// Endereço para colar no painel da Meta (Webhooks, objeto Instagram, campos comments e messages):
//   https://<projeto>.supabase.co/functions/v1/ig-webhook
import {
  assinaturaOk, banco, CFG, classificar, dmDeComentario, enviarDm, infoPost, MetaErro, nomeDe, responderComentario, type Entrada,
} from "../_shared/agente.ts";
import { modelo } from "../_shared/base.ts";

type Linha = Record<string, unknown> & { id: string; canal: "comentario" | "dm"; texto: string };

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1) Verificação: a Meta chama com GET uma vez, quando o endereço é cadastrado.
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && CFG.verifyToken &&
      url.searchParams.get("hub.verify_token") === CFG.verifyToken;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
      : new Response("verificação recusada", { status: 403 });
  }
  if (req.method !== "POST") return new Response("método não aceito", { status: 405 });

  // 2) Avisos: só aceita o que veio assinado pela Meta com a chave secreta do app.
  const corpo = await req.text();
  if (!(await assinaturaOk(corpo, req.headers.get("x-hub-signature-256")))) {
    console.warn("assinatura inválida ou META_APP_SECRET ausente");
    return new Response("assinatura inválida", { status: 401 });
  }
  let aviso: any;
  try {
    aviso = JSON.parse(corpo);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const linhas = extrair(aviso);
  // Responde 200 logo (a Meta reenvia se demorar) e processa em segundo plano.
  const trabalho = Promise.allSettled(linhas.map(processar)).then((rs) =>
    rs.forEach((r) => r.status === "rejected" && console.error("processar", r.reason))
  );
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(trabalho);
  else await trabalho;
  return new Response("ok", { status: 200 });
});

/** Tira do aviso da Meta só o que interessa: comentários de outras pessoas e DMs recebidas. */
function extrair(aviso: any): Linha[] {
  const out: Linha[] = [];
  if (aviso?.object !== "instagram") return out;
  for (const entry of aviso.entry || []) {
    const contaId = String(entry.id || "");
    for (const ch of entry.changes || []) {
      if (ch.field !== "comments" && ch.field !== "live_comments") continue;
      const v = ch.value || {};
      if (!v.id || v.from?.id === contaId) continue; // resposta da própria Belle
      out.push({
        id: "c_" + v.id, canal: "comentario", ig_id: String(v.id), conversa: v.media?.id ?? null,
        autor_id: v.from?.id ?? null, autor: v.from?.username ?? null, texto: String(v.text || ""),
        pai_id: v.parent_id ?? null, post_id: v.media?.id ?? null,
        recebido_em: new Date((entry.time || Date.now() / 1000) * 1000).toISOString(),
      });
    }
    for (const m of entry.messaging || []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_echo || msg.is_deleted) continue; // mensagens enviadas pela própria Belle
      if (m.sender?.id === contaId) continue;
      const anexos = (msg.attachments || []).map((a: any) => a.type).filter(Boolean);
      out.push({
        id: "d_" + msg.mid, canal: "dm", ig_id: String(msg.mid), conversa: m.sender?.id ?? null,
        autor_id: m.sender?.id ?? null, texto: String(msg.text || (anexos.length ? `[${anexos.join(", ")}]` : "")),
        recebido_em: new Date(m.timestamp || Date.now()).toISOString(),
      });
    }
  }
  return out;
}

async function processar(l: Linha) {
  const db = banco();
  // A Meta pode mandar o mesmo aviso mais de uma vez: grava só se ainda não existe.
  const ins = await db.from("ig_mensagens").upsert(l, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (ins.error) throw ins.error;
  if (!ins.data?.length) return;

  const extra: Record<string, unknown> = {};
  const e: Entrada = { canal: l.canal, texto: l.texto };
  if (l.canal === "comentario" && l.post_id) {
    const p = await infoPost(String(l.post_id));
    extra.post_link = p.link ?? null;
    extra.post_legenda = p.legenda ?? null;
    e.post_legenda = p.legenda;
  }
  if (l.canal === "dm" && l.conversa) {
    const quem = await nomeDe(String(l.conversa));
    if (quem.usuario) extra.autor = quem.usuario;
    e.nome = quem.primeiro;
    const h = await db.from("ig_mensagens").select("texto,resposta,status,recebido_em")
      .eq("conversa", l.conversa).eq("canal", "dm").neq("id", l.id)
      .order("recebido_em", { ascending: false }).limit(6);
    e.historico = (h.data || []).reverse().flatMap((x: any) => {
      const a: { de: "cliente" | "belle"; texto: string }[] = [{ de: "cliente", texto: x.texto || "" }];
      if (x.status === "enviado" && x.resposta) a.push({ de: "belle", texto: x.resposta });
      return a;
    });
  }
  e.autor = (extra.autor as string) ?? (l.autor as string | undefined);

  const c = await classificar(e);
  const up = await db.from("ig_mensagens").update({
    ...extra, ...c,
    status: c.acao === "ignorar" ? "descartado" : "sugerido",
  }).eq("id", l.id);
  if (up.error) throw up.error;

  // Comentários públicos nunca saem sozinhos (agente.md: resposta a comentário fica com a Kaká).
  if (c.acao === "auto" && c.sugestao && l.canal === "dm") await responderSozinho(db, l, e, c);
}

// Assuntos em que, num comentário, além da resposta no post o agente chama a pessoa na DM.
const CHAMA_NA_DM = new Set(["preco", "demonstracao", "duvida_produto", "teste_gratis"]);

/** "Responder sozinho": só quando a Kaká ligou na aba Respostas. */
async function responderSozinho(db: ReturnType<typeof banco>, l: Linha, e: Entrada, c: Awaited<ReturnType<typeof classificar>>) {
  const { data: cfg } = await db.from("ig_config").select("auto").eq("id", 1).maybeSingle();
  if (!cfg?.auto) return;
  if (l.canal === "dm") {
    // Sem a IA, o texto é fixo: responde só a primeira mensagem da conversa no dia, para não repetir.
    if (c.classificado_por === "regras") {
      const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
      const { count } = await db.from("ig_mensagens").select("id", { count: "exact", head: true })
        .eq("conversa", l.conversa).eq("canal", "dm").eq("enviado_por", "agente").gte("enviado_em", desde);
      if (count) return;
    }
  }
  const texto = c.sugestao.trim();
  let via: "comentario" | "dm" = l.canal === "dm" ? "dm" : "comentario";
  try {
    if (l.canal === "dm") await enviarDm(String(l.conversa), texto);
    else {
      await responderComentario(String(l.ig_id), texto);
      if (CHAMA_NA_DM.has(c.categoria)) {
        const dm = modelo(c.categoria, "dm", e.nome);
        if (dm) {
          await dmDeComentario(String(l.ig_id), dm).catch((err) => console.warn("dm do comentário", err));
          via = "comentario";
        }
      }
    }
  } catch (err) {
    const msg = err instanceof MetaErro ? err.message : String(err);
    await db.from("ig_mensagens").update({ status: "erro", erro: "Envio automático: " + msg }).eq("id", l.id);
    return;
  }
  await db.from("ig_mensagens").update({
    status: "enviado", resposta: texto, resposta_via: via, enviado_em: new Date().toISOString(), enviado_por: "agente", erro: null,
  }).eq("id", l.id);
}
