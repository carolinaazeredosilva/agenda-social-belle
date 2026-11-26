// Peças comuns do agente de respostas do Instagram: Meta (Graph API), banco e a IA que classifica e sugere.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BASE, modelo } from "./base.ts";

const env = (k: string, padrao = "") => (Deno.env.get(k) ?? padrao).trim();

export const CFG = {
  token: env("IG_RESPOSTAS_TOKEN"),
  igUserId: env("IG_USER_ID"),
  appSecret: env("META_APP_SECRET"),
  verifyToken: env("IG_VERIFY_TOKEN", "belle-agente-instagram"),
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

/** @usuário e primeiro nome de quem mandou a DM (IGSID), quando a Meta informa. */
export async function nomeDe(igsid: string): Promise<{ usuario?: string; primeiro?: string }> {
  try {
    const p = await pagina();
    const r = await meta("GET", igsid, { fields: "username,name" }, p.token);
    const primeiro = String(r.name || "").trim().split(/\s+/)[0] || undefined;
    return { usuario: r.username || r.name, primeiro };
  } catch {
    return {};
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
  "preco", "demonstracao", "concorrente", "duvida_produto", "teste_gratis", "acesso_teste",
  "suporte", "financeiro", "vagas", "parceria", "eventos", "fora_escopo", "reclamacao",
  "saudacao", "elogio", "spam", "outro",
] as const;
type Categoria = typeof CATEGORIAS[number];

// O que sai sozinho quando o "Responder sozinho" está ligado na aba Respostas, e o que espera a Kaká.
const ACAO: Record<Categoria, "auto" | "caixa" | "ignorar"> = {
  saudacao: "auto", elogio: "auto", teste_gratis: "auto", duvida_produto: "auto", preco: "auto",
  demonstracao: "auto", vagas: "auto", fora_escopo: "auto",
  concorrente: "caixa", acesso_teste: "caixa", suporte: "caixa", financeiro: "caixa", parceria: "caixa",
  eventos: "caixa", reclamacao: "caixa", outro: "caixa",
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
  nome?: string; // primeiro nome, quando a Meta informa
};

function instrucoes(): string {
  return `Você é a assistente virtual do Instagram @bellesoftware, do Belle Software. Siga a base abaixo à risca.

${BASE}

Sua tarefa agora: ler um comentário público ou uma DM, classificar e escrever a próxima resposta da Belle, seguindo os fluxos da seção 5 e as respostas modelo.

Categorias (campo categoria):
- preco: preço, valor, mensalidade, quanto custa, valor depois do teste (fluxo 5.1).
- demonstracao: quer contratar, conhecer, apresentação, mais informações (5.2).
- concorrente: vem de outro sistema ou compara com um (5.2, variação de troca).
- duvida_produto: pergunta se o Belle faz algo ou serve para um tipo de clínica (5.3).
- teste_gratis: quer testar, pede o link do teste (5.4).
- acesso_teste: já se cadastrou e não consegue acessar, código inválido (5.4).
- suporte: já é cliente e tem dúvida de uso ou erro no sistema (5.5).
- financeiro: cliente com assunto de pagamento, boleto, cobrança (5.5).
- vagas: quer trabalhar na Belle, currículo (5.6).
- parceria: proposta de parceria, fornecedor, agência, imprensa, influenciador (5.7).
- eventos: feira, estande, ingresso, cortesia (5.8).
- fora_escopo: achou que a Belle é uma clínica, quer agendar procedimento (5.9).
- reclamacao: insatisfação, tom irritado, cancelamento (seção 7).
- saudacao: só "oi", "bom dia", resposta a story sem pergunta (5.10).
- elogio: elogio, emoji, "amei".
- spam: golpe, propaganda, ofensa, link suspeito.
- outro: qualquer outra coisa.

Regras da resposta (campo sugestao):
- DM: siga o fluxo e a resposta modelo da intenção, adaptando à mensagem. Use os links com UTM da base.
- Comentário público: no máximo 2 frases curtas, sem links longos e sem dados de contato pessoais. Para assunto comercial ou de cliente, diga que vai chamar no Direct.
- Use o primeiro nome da pessoa só se ele vier no contexto. Se não vier, comece com "Oi!".
- Nunca use travessão. No máximo um emoji. Nunca cite valores.
- Nunca afirme o que está marcado como [A CONFIRMAR]. Nesses casos use a mensagem de transferência da seção 7, sem o trecho entre colchetes.
- Spam: sugestao vazia.
- resumo: uma frase dizendo o que a pessoa quer, para a gestora ler rápido.
- urgente: true para reclamação forte, cliente com sistema parado ou risco para a marca.`;
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
    e.nome ? `Primeiro nome: ${e.nome}` : "",
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

/** Sem IA: separa por palavras-chave e sugere a resposta modelo da Base conversacional. */
export function regras(e: Entrada): Classificacao {
  const t = " " + (e.texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
  const tem = (...p: string[]) => p.some((x) => t.includes(x));
  let c: Categoria = "outro";
  if (tem("seguidores gratis", "ganhe dinheiro", "renda extra", "clique no link", "promocao imperdivel")) c = "spam";
  else if (tem("pessimo", "horrivel", "absurdo", "decepc", "reclama", "quero cancelar", "cancelamento", "vergonha")) c = "reclamacao";
  else if (tem("nao consigo acessar", "nao consigo entrar", "codigo", "cadastro nao", "nao recebi o e-mail", "nao recebi o email", "acesso")) c = "acesso_teste";
  else if (tem("boleto", "cobranca", "pagamento", "fatura", "nota fiscal da mensalidade", "financeiro da minha")) c = "financeiro";
  else if (tem("preco", "valor", "quanto custa", "mensalidade", "quanto e", "quanto fica", "desconto", "investimento")) c = "preco";
  else if (tem("erro", "nao funciona", "travou", "bug", "suporte", "sou cliente", "ja uso o belle")) c = "suporte";
  else if (tem("vaga", "curriculo", "trabalhar com voces", "trabalhar na", "contratando")) c = "vagas";
  else if (tem("parceria", "proposta", "fornecedor", "agencia", "imprensa", "influenc", "collab", "storymaker", "fotografia")) c = "parceria";
  else if (tem("feira", "estande", "stand", "ingresso", "cortesia", "evento")) c = "eventos";
  else if (tem("endereco de voces", "totalpass", "gympass", "agendar procedimento", "fazer procedimento", "atende convenio")) c = "fora_escopo";
  else if (tem("trinks", "simples agenda", "clinicorp", "outro sistema", "trocar de sistema", "migrar")) c = "concorrente";
  else if (tem("teste", "testar", "gratis", "14 dias")) c = "teste_gratis";
  else if (tem("contratar", "conhecer", "apresentacao", "demonstra", "mais informac", "informacoes", "como faco para ter", "comercial", "vendedor")) c = "demonstracao";
  else if (tem("serve para", "da para", "tem integra", "integra", "funciona", " tem ", "faz ", "como e", "?")) c = "duvida_produto";
  else if (tem("amei", "otimo", "top", "parabens", "lindo", "incrivel", "maravilh") || /^[\p{Extended_Pictographic}\s!]+$/u.test(e.texto || "")) c = "elogio";
  else if (tem(" oi ", "ola", "bom dia", "boa tarde", "boa noite", "tudo bem")) c = "saudacao";
  return {
    categoria: c, acao: ACAO[c], resumo: "",
    sugestao: c === "spam" ? "" : modelo(c, e.canal, e.nome),
    urgente: c === "reclamacao", classificado_por: "regras",
  };
}
