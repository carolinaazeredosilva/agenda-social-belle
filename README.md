# Agenda Social Belle

Agenda de redes sociais da Belle Software, para usar no celular.

- `index.html`: o app (lê a planilha Estratégia Social e guarda status, horários, alarmes e artes).
- `shim.js`: login Google, leitura da planilha e armazenamento no Drive do app.
- `config.js`: ID do cliente Google (preencher).
- `seed.json` e `artmap.json`: dados de partida e mapa das artes (não contêm imagens).
- Importação das artes: abrir `./#importar` no computador.

## Aba Stories (formato desde 13/11/2026)

Uma linha por story. O app lê as colunas pelo nome do cabeçalho (a ordem não importa):
Data, Horário, Sequência, Ordem ("Único" ou "2 de 5"), O que é (Arte, Vídeo, Compartilhar post, Tela de destaque),
Copy, Interação / figurinha, Pilar, Onde postar, Salvar no destaque, Status, Observações.

- Obrigatórias: Data, Copy e Status. Se faltar alguma, o app mostra um aviso em vez de carregar errado.
- Nomes das abas ficam no `config.js` (`ABA_FEED`, `ABA_STORIES`). Renomeou uma aba? Mude só lá.
- Cada story é identificado por data + sequência + ordem. Trocar a linha de lugar na planilha não perde artes nem checks;
  mudar a data, a sequência ou a ordem pelo app (Mudar de dia) leva tudo junto.
- A ligação com o formato antigo (aba `excluir`) é feita uma vez pelo app e fica salva. Depois disso a aba `excluir` pode ser apagada.
