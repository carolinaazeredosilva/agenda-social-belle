-- Liga e desliga o "Responder sozinho" do agente do Instagram. Uma linha só (id = 1).
create table if not exists public.ig_config (
  id            int primary key default 1 check (id = 1),
  auto          boolean not null default false,  -- responde sozinho os assuntos simples
  atualizado_em timestamptz not null default now()
);
insert into public.ig_config (id) values (1) on conflict (id) do nothing;

alter table public.ig_config enable row level security;
drop policy if exists "dona le" on public.ig_config;
create policy "dona le" on public.ig_config for select to authenticated
  using (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com');
drop policy if exists "dona muda" on public.ig_config;
create policy "dona muda" on public.ig_config for update to authenticated
  using (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'carolinaazeredosilva@gmail.com');
revoke all on public.ig_config from anon;
grant select, update on public.ig_config to authenticated;
grant select, insert, update on public.ig_config to service_role;
