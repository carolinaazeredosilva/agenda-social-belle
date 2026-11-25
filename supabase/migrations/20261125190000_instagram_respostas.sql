-- Caixa de entrada do agente de respostas do Instagram (@bellesoftware).
-- Cada linha é um comentário ou uma mensagem (DM) recebida pela Meta, com a
-- classificação e a resposta sugerida pelo agente.
-- Só o servidor (chave de serviço) grava linhas novas; a dona da Agenda lê e atualiza pelo app.

create table if not exists public.ig_mensagens (
  id            text primary key,              -- 'c_<id do comentário>' ou 'd_<mid da mensagem>'
  canal         text not null check (canal in ('comentario', 'dm')),
  ig_id         text not null,                 -- id do comentário ou mid da mensagem na Meta
  conversa      text,                          -- DM: id de quem mandou (IGSID). Comentário: id do post
  autor_id      text,
  autor         text,                          -- @usuário, quando a Meta informa
  texto         text,
  pai_id        text,                          -- comentário: id do comentário respondido, se for resposta
  post_id       text,
  post_link     text,
  post_legenda  text,
  recebido_em   timestamptz not null default now(),

  categoria     text,                          -- elogio, saudacao, duvida_produto, teste_gratis, demonstracao,
                                               -- preco, suporte, reclamacao, concorrente, parceria, spam, outro
  acao          text check (acao in ('auto', 'caixa', 'ignorar')),
  resumo        text,
  sugestao      text,
  urgente       boolean not null default false,
  classificado_por text,                       -- 'ia' ou 'regras'

  status        text not null default 'novo'
                check (status in ('novo', 'sugerido', 'enviado', 'descartado', 'erro')),
  resposta      text,
  resposta_via  text check (resposta_via in ('comentario', 'dm')),
  enviado_em    timestamptz,
  enviado_por   text,                          -- 'agente' ou 'dona'
  erro          text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists ig_mensagens_recebido on public.ig_mensagens (recebido_em desc);
create index if not exists ig_mensagens_status on public.ig_mensagens (status);
create index if not exists ig_mensagens_conversa on public.ig_mensagens (conversa, recebido_em desc);

create or replace function public.ig_mensagens_touch() returns trigger
language plpgsql as $$ begin new.atualizado_em = now(); return new; end $$;

drop trigger if exists ig_mensagens_touch on public.ig_mensagens;
create trigger ig_mensagens_touch before update on public.ig_mensagens
  for each row execute function public.ig_mensagens_touch();

alter table public.ig_mensagens enable row level security;

-- Só a dona (mesmo e-mail do config.js) vê e mexe nas conversas. Leitores da Agenda não veem nada.
drop policy if exists "dona le" on public.ig_mensagens;
create policy "dona le" on public.ig_mensagens for select to authenticated
  using (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com');

drop policy if exists "dona atualiza" on public.ig_mensagens;
create policy "dona atualiza" on public.ig_mensagens for update to authenticated
  using (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com');

revoke all on public.ig_mensagens from anon;
grant select, update on public.ig_mensagens to authenticated;

-- Mensagens novas aparecem na aba Respostas na hora (Realtime do Supabase).
do $$ begin
  alter publication supabase_realtime add table public.ig_mensagens;
exception when duplicate_object then null; when undefined_object then null;
end $$;
