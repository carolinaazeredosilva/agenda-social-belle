-- O servidor (funções ig-webhook e ig-enviar) grava com a chave de serviço; neste projeto ela não recebe acesso sozinha.
grant select, insert, update, delete on public.ig_mensagens to service_role;
