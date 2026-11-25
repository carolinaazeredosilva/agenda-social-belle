// Peças comuns do agente de respostas do Instagram: Meta (Graph API), banco e a IA que classifica e sugere.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const env = (k: string, padrao = "") => (Deno.env.get(k) ?? padrao).trim();

export const CFG = {
  token: env("IG_RESPOSTAS_TOKEN"),
  igUserId: env("IG_USER_ID"),
  appSecret: env("META_APP_SECRET"),
  verifyToken: env("IG_VERIFY_TOKEN"),
  api: "https://graph.facebook.com/" + env("IG_API_VERSION", "v23.0"),
  anthropicKey: env("ANTHROPIC_API_KEY"),
  modelo: env("AGENTE_MODELO", "claude-opus-5-5"),
  dona: env("AGENTE_DONA_EMAIL", "carolinaazeredosilva@gmail.com").toLowerCase(),
  linkTeste: env("AGENTE_LINK_TESTE", "https://bellesoftware.com.br"),
  whatsComercial: env("AGENTE_WHATSAPP", "https://wa.me/551132305180"),
  contatoSuporte: env("AGENTE_SUPORTE", ""),
};

export function banco(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/* ---------------- Meta (Graph API) ---------------- */

export class MetaErro extends Error {}

async function meta(metodo: "GET" | "POST", caminho: string, params: Record<string, unknown> = {}, token = CFG.token) {
  if (!token) throw new MetaErro("falta a chave IG_RESPOSTAS_TOKEN");
  const url = new URL(CFG.api + "/" + caminho.replace(/^\//, ""));
  let init: RequestInit = { method: metodo };
  if (metodo === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("access_token", token);
  } else {
    init = { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(params) };
  }
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw new MetaErro(`${e.message || "erro HTTP " + r.status} (código ${e.code ?? r.status})`);
  }
  return j;
}

type Pagina = { id: string; token: string; igId: string };
let paginaCache: Pagina | null = null;

/** Página do Facebook ligada ao Instagram da Belle, com a chave da página (necessária para DMs). */
export async function pagina(): Promise<Pagina> {
  if (paginaCache) return paginaCache;
  const r = await meta("GET", "me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100 });
  const ps = (r.data || []).filter((p: any) => p.instagram_business_account);
  if (!ps.length) throw new MetaErro("a chave não enxerga nenhuma página com Instagram profissional ligado");
  const p = ps.find((p: any) => p.instagram_business_account.id === CFG.igUserId)
    || ps.find((p: any) => /belle/i.test(p.instagram_business_account.username || ""))
    || ps[0];
  paginaCache = { id: p.id, token: p.access_token, igId: p.instagram_business_account.id };
  return paginaCache;
}

export async function infoPost(mediaId: string): Promise<{ link?: string; legenda?: string }> {
  try {
    const r = await meta("GET", mediaId, { fields: "permalink,caption" });
    return { link: r.permalink, legenda: (r.caption || "").slice(0, 500) };
  } catch {
    return {};
  }
}

export async function nomeDe(igsid: string): Promise<string | undefined> {
  try {
    const p = await pagina();
    const r = await meta("GET", igsid, { fields: "username,name" }, p.token);
    return r.username || r.name;
  } catch {
    return undefined;
  }
}

/** Responde um comentário publicamente, logo abaixo dele. */
export async function responderComentario(commentId: string, texto: string) {
  return await meta("POST", `${commentId}/replies`, { message: texto });
}

/** Manda uma DM para quem escreveu (IGSID). Só funciona até 24h depois da última mensagem da pessoa. */
export async function enviarDm(igsid: string, texto: string) {
  const p = await pagina();
  return await meta("POST", `${p.id}/messages`, { recipient: { id: igsid }, message: { text: texto } }, p.token);
}

/** Responde um comentário com uma DM privada para quem comentou (a Meta permite uma por comentário, até 7 dias). */
export async function dmDeComentario(commentId: string, texto: string) {
  const p = await pagina();
  return await meta("POST", `${p.id}/messages`, { recipient: { comment_id: commentId }, message: { text: texto } }, p.token);
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda em cada aviso. */
export async function assinaturaOk(corpo: string, cabecalho: string | null): Promise<boolean> {
  if (!CFG.appSecret) return false;
  if (!cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(CFG.appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7).toLowerCase();
  if (recebido.length !== hex.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

/* ---------------- Classificação e resposta sugerida ---------------- */

export const CATEGORIAS = [
  "elogio", "saudacao", "duvida_produto", "teste_gratis", "demonstracao",
  "preco", "suporte", "reclamacao", "concorrente", "parceria", "spam", "outro",
] as const;
type Categoria = typeof CATEGORIAS[number];

// O que pode sair sozinho (quando o modo automático for ligado) e o que vai para a caixa da Kaká.
const ACAO: Record<Categoria, "auto" | "caixa" | "ignorar"> = {
  elogio: "auto", saudacao: "auto", duvida_produto: "auto", teste_gratis: "auto", demonstracao: "auto",
  preco: "caixa", suporte: "caixa", reclamacao: "caixa", concorrente: "caixa", parceria: "caixa", outro: "caixa",
  spam: "ignorar",
};

export type Classificacao = {
  categoria: Categoria;
  acao: "auto" | "caixa" | "ignorar";
  resumo: string;
  sugestao: string;
  urgente: boolean;
  classificado_por: "ia" | "regras";
};

export type Entrada = {
  canal: "comentario" | "dm";
  texto: string;
  autor?: string;
  post_legenda?: string;
  historico?: { de: "cliente" | "belle"; texto: string }[];
};

function instrucoes(): string {
  return `Você é o atendimento do Instagram @bellesoftware, do Belle Software.

Sobre o Belle: sistema de gestão para clínicas de estética em crescimento. Reúne agenda inteligente, gestão financeira, CRM, estoque, orçamentos, planos de tratamento, funil de vendas, BI, WhatsApp automático, Belle Chat com IA, Gestor IA, transcrição de áudio e emissão de nota fiscal. Calcula comissão de profissionais. Oferta: teste grátis por 14 dias, sem cartão e sem compromisso. Link do teste: ${CFG.linkTeste}. WhatsApp do comercial: ${CFG.whatsComercial}.${CFG.contatoSuporte ? ` Suporte para clientes: ${CFG.contatoSuporte}.` : ""}

Sua tarefa: ler um comentário ou uma DM, classificar e escrever a resposta que a Belle mandaria.

Categorias:
- elogio: elogio, emoji, "amei".
- saudacao: oi, tudo bem, bom dia, sem pergunta.
- duvida_produto: pergunta sobre o que o Belle faz ou se tem uma funcionalidade.
- teste_gratis: quer testar, pede o link.
- demonstracao: pede demonstração, apresentação ou contato do comercial.
- preco: preço, plano, valor, desconto, mensalidade.
- suporte: já é cliente e tem dúvida de uso ou erro no sistema.
- reclamacao: crítica, insatisfação, cobrança indevida.
- concorrente: cita outro sistema ou compara.
- parceria: parceria, imprensa, vaga, fornecedor, influenciador.
- spam: golpe, propaganda, ofensa, link suspeito.
- outro: qualquer coisa fora disso ou quando não tiver certeza.

Tom de voz: moderno, profissional, direto e leve. Comercial sem ser agressivo. Português do Brasil.
Regras da resposta:
- Comentário: no máximo 2 frases curtas. DM: no máximo 4 frases.
- Nunca use travessão. No máximo um emoji. Sem jargão de IA, sem promessa exagerada.
- Nunca diga preço nem valores. Para preço, diga que vai chamar na DM (comentário) ou peça o tamanho da clínica, quantos profissionais, e diga que o time comercial vai passar a melhor opção (DM).
- Nunca invente funcionalidade, prazo ou condição que não esteja na lista acima. Se não souber, diga que vai confirmar com o time.
- Na DM, quando a pessoa demonstrar interesse, peça o nome da clínica e o WhatsApp, ou ofereça o teste grátis.
- Reclamação, suporte e concorrente: resposta curta, educada, sem discutir, dizendo que o time vai olhar com atenção.
- Spam: sugestao vazia.
- resumo: uma frase dizendo o que a pessoa quer, para a gestora ler rápido.
- urgente: true para reclamação forte, problema de cliente parado ou risco para a marca.`;
}

const ESQUEMA = {
  type: "object",
  properties: {
    categoria: { type: "string", enum: [...CATEGORIAS] },
    resumo: { type: "string" },
    sugestao: { type: "string" },
    urgente: { type: "boolean" },
  },
  required: ["categoria", "resumo", "sugestao", "urgente"],
  additionalProperties: false,
};

let ia: Anthropic | null = null;

export async function classificar(e: Entrada): Promise<Classificacao> {
  if (!CFG.anthropicKey) return regras(e);
  ia ??= new Anthropic({ apiKey: CFG.anthropicKey });
  const contexto = [
    `Canal: ${e.canal === "dm" ? "DM (mensagem direta)" : "comentário público"}`,
    e.autor ? `Quem escreveu: @${e.autor}` : "",
    e.post_legenda ? `Legenda do post comentado: ${e.post_legenda}` : "",
    e.historico?.length ? "Conversa até aqui:\n" + e.historico.map((h) => `${h.de === "belle" ? "Belle" : "Cliente"}: ${h.texto}`).join("\n") : "",
    `Mensagem nova:\n${e.texto || "(sem texto, só mídia ou figurinha)"}`,
  ].filter(Boolean).join("\n\n");
  try {
    const r = await ia.beta.messages.create({
      model: CFG.modelo,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      system: instrucoes(),
      messages: [{ role: "user", content: contexto }],
    } as any);
    if (r.stop_reason === "refusal") return { ...regras(e), resumo: "A IA não quis responder esta mensagem. Confira você." };
    const txt = r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const j = JSON.parse(txt);
    const categoria = (CATEGORIAS as readonly string[]).includes(j.categoria) ? j.categoria as Categoria : "outro";
    return {
      categoria,
      acao: ACAO[categoria],
      resumo: String(j.resumo || "").slice(0, 300),
      sugestao: categoria === "spam" ? "" : String(j.sugestao || "").replace(/\s*[—–]\s*/g, ", ").slice(0, 1000),
      urgente: !!j.urgente,
      classificado_por: "ia",
    };
  } catch (err) {
    console.error("classificar", err);
    return regras(e);
  }
}

/** Plano B sem IA: separa por palavras-chave e não sugere resposta. */
export function regras(e: Entrada): Classificacao {
  const t = (e.texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tem = (...p: string[]) => p.some((x) => t.includes(x));
  let c: Categoria = "outro";
  if (tem("http", "ganhe", "seguidores gratis", "promo")) c = "spam";
  else if (tem("preco", "valor", "quanto custa", "mensalidade", "plano", "desconto")) c = "preco";
  else if (tem("erro", "nao funciona", "nao consigo", "suporte", "travou", "bug")) c = "suporte";
  else if (tem("pessimo", "horrivel", "reclama", "cancelar", "absurdo", "decepc")) c = "reclamacao";
  else if (tem("teste", "testar", "gratis", "link")) c = "teste_gratis";
  else if (tem("demonstra", "apresenta", "comercial", "vendedor")) c = "demonstracao";
  else if (tem("parceria", "imprensa", "vaga", "influenc", "collab")) c = "parceria";
  else if (tem("tem ", "faz ", "funciona", "integra", "como e")) c = "duvida_produto";
  else if (tem("amei", "otimo", "top", "parabens", "lindo", "incrivel") || /^[\p{Extended_Pictographic}\s!]+$/u.test(e.texto || "")) c = "elogio";
  else if (tem("oi", "ola", "bom dia", "boa tarde", "boa noite", "tudo bem")) c = "saudacao";
  return { categoria: c, acao: ACAO[c], resumo: "", sugestao: "", urgente: c === "reclamacao", classificado_por: "regras" };
}
