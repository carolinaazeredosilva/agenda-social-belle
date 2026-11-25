// Envia no Instagram a resposta que a Kaká aprovou na aba Respostas da Agenda Social.
// Só aceita pedidos de quem entrou na Agenda com o e-mail da dona.
//
// Corpo: { id: "c_..." | "d_...", texto: "resposta", via?: "comentario" | "dm" }
//   via "dm" num comentário manda a resposta em particular para quem comentou.
import { banco, CFG, dmDeComentario, enviarDm, MetaErro, responderComentario } from "../_shared/agente.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resp(405, { erro: "método não aceito" });

  // Quem está pedindo?
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await banco().auth.getUser(jwt) : { data: null };
  if ((u?.user?.email || "").toLowerCase() !== CFG.dona) return resp(403, { erro: "Só a dona da Agenda pode enviar respostas." });

  let b: { id?: string; texto?: string; via?: string };
  try {
    b = await req.json();
  } catch {
    return resp(400, { erro: "pedido sem corpo" });
  }
  const texto = String(b.texto || "").trim();
  if (!b.id || !texto) return resp(400, { erro: "Falta a mensagem ou o texto da resposta." });
  if (texto.length > 1000) return resp(400, { erro: "A resposta passou de 1000 caracteres." });

  const db = banco();
  const { data: m, error } = await db.from("ig_mensagens").select("*").eq("id", b.id).maybeSingle();
  if (error) return resp(500, { erro: error.message });
  if (!m) return resp(404, { erro: "Mensagem não encontrada." });
  if (m.status === "enviado") return resp(409, { erro: "Esta mensagem já foi respondida." });

  const via = m.canal === "dm" ? "dm" : b.via === "dm" ? "dm" : "comentario";
  try {
    if (m.canal === "dm") {
      // A Meta só deixa responder DM até 24h depois da última mensagem da pessoa.
      const { data: ult } = await db.from("ig_mensagens").select("recebido_em").eq("conversa", m.conversa).eq("canal", "dm")
        .order("recebido_em", { ascending: false }).limit(1);
      const desde = Date.now() - Date.parse(ult?.[0]?.recebido_em || m.recebido_em);
      if (desde > 24 * 3600e3) {
        return resp(422, { erro: "Já passaram 24 horas desde a última mensagem dessa pessoa. A Meta não deixa mais responder por aqui; responda pelo app do Instagram." });
      }
      await enviarDm(m.conversa, texto);
    } else if (via === "dm") {
      await dmDeComentario(m.ig_id, texto);
    } else {
      await responderComentario(m.ig_id, texto);
    }
  } catch (e) {
    const msg = e instanceof MetaErro ? e.message : String(e);
    await db.from("ig_mensagens").update({ erro: msg }).eq("id", m.id);
    return resp(502, { erro: "A Meta recusou o envio: " + msg });
  }

  const agora = new Date().toISOString();
  await db.from("ig_mensagens").update({
    status: "enviado", resposta: texto, resposta_via: via, enviado_em: agora, enviado_por: "dona", erro: null,
  }).eq("id", m.id);
  return resp(200, { ok: true, enviado_em: agora, via });
});
