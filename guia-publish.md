# Guia de publicação — MyTicket na Chrome Web Store

Passo a passo para publicar (e atualizar) a extensão. O pacote, a política de privacidade e os textos da loja já estão
prontos neste repositório; falta só o que depende de uma conta Google (marcado com 👤).

## Resumo rápido

1. 👤 Criar conta de desenvolvedor (taxa única de US$ 5) e ativar verificação em duas etapas.
2. `npm test && npm run build:chrome` → gera `dist/my-ticket-<versão>.zip`.
3. Publicar `PRIVACY.md` num endereço público (URL exigida pela loja).
4. Tirar os screenshots (1280×800).
5. Enviar o zip no Developer Dashboard, preencher a ficha (textos abaixo) e **Enviar para revisão**.
6. Aguardar a revisão (de horas a poucos dias; extensões com permissão de host costumam demorar mais).

## 1. Pré-requisitos

- 👤 Conta Google (de preferência uma conta da Sysvale, para a extensão não ficar presa a um e-mail pessoal) com
  **verificação em duas etapas** ativa.
- 👤 Cadastro em <https://chrome.google.com/webstore/devconsole>: aceitar o contrato e pagar a **taxa única de US$ 5**.
  **Se você já tem conta de desenvolvedor** (já aparece o dashboard ao entrar), pule este item e o da taxa.
- 👤 Em **Configurações** (página da conta do publisher), preencher o e-mail de contato e **verificá-lo** (a loja
  bloqueia o envio para revisão sem isso: "Para publicar um item, confirme o e-mail de contato do publisher").
  O Google manda um link/código para o endereço informado (olhe o spam). Se a seção de negociante tiver outro
  e-mail, verifique esse também. Confira que a página mostra "verificado" antes de tentar enviar.
- 👤 Em **Conta**, a loja pergunta se você é **negociante (trader, lei de serviços digitais da UE)**. Se a extensão é
  publicada em nome da Sysvale ou do seu trabalho, escolha **Sou negociante** e informe endereço, telefone e e-mail
  **da empresa** (aparecem publicamente só para usuários da UE). Escolha "Não sou negociante" apenas para projeto
  pessoal sem relação com atividade profissional.
- Decidir a visibilidade (passo 6): **Privada** (só testadores cujos e-mails você cadastra), **Não listada** (só quem
  tem o link) ou **Pública**. Para uso interno da Sysvale, *Não listada* costuma ser a mais prática.
  - Publicar "só para o domínio da empresa" exige conta de **Google Workspace**; uma conta Gmail comum (como
    `sysvalesoftgroup@gmail.com`) não tem essa opção.

## 2. Gerar o pacote

```bash
npm test                 # tudo verde antes de publicar
npm run build:chrome     # → dist/my-ticket-0.1.0.zip
```

O script valida o manifest (versão, nome ≤ 75, descrição ≤ 132, ícones 16/48/128) e empacota **só** `extension/`
(com `manifest.json` na raiz do zip, como a loja exige). Código de teste, `node_modules` e docs não entram.

Confira o conteúdo, se quiser: `unzip -l dist/my-ticket-0.1.0.zip`.

> **Versão:** a loja rejeita um upload com a mesma versão (ou menor) da já publicada. Para cada atualização, aumente
> `version` em `extension/manifest.json` **e** em `package.json` (ex.: `0.1.1`) e gere o zip de novo.

## 3. Política de privacidade (URL pública)

A extensão guarda tokens e lê dados de tickets, então a loja **exige** uma política pública. O texto está em
[`PRIVACY.md`](./PRIVACY.md). Opções para ter uma URL:

- **Repositório público:** `https://github.com/Sysvale/my-ticket/blob/main/PRIVACY.md` (só funciona se o repo for público).
- **Gist público (mais simples com repo privado):** `gh gist create PRIVACY.md --public --desc "MyTicket - Política de Privacidade"` e use a URL `https://gist.github.com/...` impressa. Se atualizar o `PRIVACY.md`, atualize o gist (`gh gist edit <id> PRIVACY.md`).
- **Repositório privado:** ative o GitHub Pages ou hospede o texto no site da Sysvale; a URL precisa abrir **sem login**.
- Um Google Docs/Notion publicado na web também é aceito.

Anote a URL: ela vai no campo *Política de privacidade* da aba **Privacidade**.

## 4. Imagens da loja

| Item | Requisito | Origem |
|---|---|---|
| Ícone da loja | 128×128 PNG | `extension/icons/icon128.png` (já pronto) |
| Screenshots | 1280×800 (ou 640×400), PNG/JPG, de 1 a 5 | 👤 você tira (veja abaixo) |
| Tile promocional pequeno | 440×280 PNG/JPG (opcional, recomendado) | derive de `assets/logo.png` (1254×1254) |
| Marquee | 1400×560 (opcional) | opcional |

**Já estão prontas na pasta [`store/`](./store/)** (geradas a partir do e2e com dados fictícios; sem tickets reais):

| Campo na loja | Arquivo |
|---|---|
| Ícone da loja (128×128) | `store/icon-128x128.png` |
| Capturas de tela (1280×800), de 1 a 5 | `store/screenshot-1-1280x800.png` … `screenshot-5-1280x800.png` |
| Bloco promocional pequeno (440×280) | `store/promo-440x280.png` |
| Bloco promocional de letreiro (1400×560) | `store/marquee-1400x560.png` |
| Vídeo promocional (opcional; a loja pede um link do YouTube) | `store/video-promocional.mp4` (1920×1080, ~36 s, sem áudio): envie ao YouTube como **Não listado** e cole o link |

**Vídeo no YouTube:** suba `store/video-promocional.mp4` como **Não listado**, público "não é para crianças", título
`MyTicket: seus tickets do GLPI com notificação, sem depender de e-mail`, miniatura
`store/youtube-thumbnail-1-1280x720.png` (ou a 2; personalizar miniatura exige canal verificado por telefone) e cole o
link no campo de vídeo da listagem. Na descrição, avise que os dados do vídeo são fictícios.

Para refazer as capturas: `npm run e2e` (precisa de Chromium; pode levar uns 8 minutos). O relatório sai em
`docs/e2e/index.html` com destaques vermelhos nos elementos clicados; as imagens da loja foram escolhidas sem eles.

## 5. Enviar o pacote

> ⚠️ **Dados de clientes:** antes de publicar, confira que nenhum nome de cliente real aparece no pacote, nas imagens
> ou no vídeo (`git grep -i <nome>` e `unzip -p dist/*.zip | grep -i <nome>`). Os dados de exemplo do projeto usam só
> nomes fictícios ("Município Alfa/Beta/Gama"). Se já enviou um zip anterior, troque-o em **Pacote → Fazer upload de
> novo pacote** antes de enviar para revisão.

1. Abra o Developer Dashboard → **Novo item** → envie `dist/my-ticket-<versão>.zip`.
2. Se o upload falhar, a mensagem indica o campo do manifest com problema; corrija e gere de novo.

## 6. Preencher a ficha (aba por aba)

### Listagem da loja

- **Nome:** `MyTicket`
- **Resumo (até 132 caracteres):** `Notificações e painel dos seus tickets do GLPI, sem depender de e-mail.`
- **Categoria:** Produtividade (*Productivity*)
- **Idioma:** Português (Brasil)
- **Descrição detalhada** (sugestão):

```
O MyTicket acompanha os seus tickets do GLPI e avisa por notificação do sistema quando alguém responde, sem depender de e-mail.

• Descobre sozinho os tickets em aberto em que você é atribuído, observador ou requerente.
• Acompanhe qualquer outro ticket pelo número ou link.
• Notifica novo acompanhamento, solução proposta, mudança de status e ticket novo no seu radar.
• Popup com busca, filtros, agrupamento por status/prioridade/etapa e tickets fixados.
• Destaca tickets parados (sem movimentação há muito tempo).
• Barra de endereços: digite "ticket" + número para abrir o ticket.
• Aviso sonoro opcional, temas claro/escuro e tags personalizadas.
• Gráfico de tempo por atribuído, gerado só quando você pede.

PRIVACIDADE E SEGURANÇA
• Somente leitura: nunca cria nem altera nada no GLPI.
• Só se comunica com o GLPI que você configurar, e somente por HTTPS.
• Sem servidor próprio, sem analytics, sem anúncios. Tudo fica no seu navegador.
• Opção "Ocultar conteúdo" nas notificações e botão para apagar todos os dados locais.

Requer uma conta no GLPI com a API REST habilitada (App-Token e user_token pessoal, em Preferências → "Chave de acesso remoto").
```

### URLs da listagem

- **URL oficial:** deixe em branco (exige site verificado no Search Console).
- **URL da página inicial** e **URL de suporte:** inicialmente `https://sysvale.com`.
- 🔁 **Quando o repositório virar público (AGPL):** troque os dois pela URL do repositório
  (`https://github.com/Sysvale/my-ticket` e `.../issues`) e a política de privacidade pelo link do `PRIVACY.md`
  no repositório. Altere na listagem e reenvie para revisão. Lembre de incluir o arquivo `LICENSE` no repositório.

### Privacidade

- **Finalidade única (single purpose):** `Acompanhar tickets do GLPI do usuário e notificá-lo sobre novidades.`
- **Justificativa de cada permissão** (cole exatamente por campo):
  - `storage`: Guarda localmente a conexão com o GLPI, preferências, tags e o cache dos tickets.
  - `alarms`: Agenda a verificação periódica de novidades nos tickets.
  - `notifications`: Exibe o aviso quando há novidade em um ticket.
  - `offscreen`: Toca o aviso sonoro opcional; o service worker do Manifest V3 não tem acesso a áudio.
  - **Permissões de host (opcionais, `https://*/*`):** A extensão não tem site fixo: o GLPI é de cada organização.
    A permissão é solicitada em tempo de execução **apenas para o endereço do GLPI** que o usuário informa nas Opções,
    para consultar a API REST dele (somente leitura). Nenhum outro site é acessado.
- **Código remoto:** *Não, não uso código remoto* (todo o JavaScript está no pacote; sem `eval`, sem scripts externos —
  garantido por `test/invariants.test.js`).
- **Política de privacidade:** a URL do passo 3.
- **Quais dados você coleta** (a loja pede o que a extensão manipula, mesmo que fique só no navegador):
  - ✔ *Informações de identificação pessoal* (nomes de pessoas nos tickets, em cache local).
  - ✔ *Informações de autenticação* (App-Token e user_token informados pelo usuário, guardados localmente).
  - ✔ *Comunicações pessoais* (texto das respostas/conversas dos tickets).
  - ✔ *Conteúdo do site* (títulos e descrições dos tickets).
  - ✘ Saúde, financeiras e de pagamento, local, histórico da Web e atividade do usuário (não coleta; a extensão só
    compara a URL das abas com a do GLPI configurado e descarta o resto).
  - Nenhuma coleta pelo desenvolvedor, nada é transmitido a terceiros.
- Marque as **três certificações**: não vender dados a terceiros; não usar/transferir para fins alheios à função
  principal; não usar/transferir para avaliar crédito ou empréstimos.

### Distribuição

- **Visibilidade:** a extensão é para todos, mas o plano é **começar como Não listada** (só quem tem o link instala),
  testar a instalação real pela loja e depois mudar para **Pública** em Distribuição → Visibilidade e reenviar.
  O ID e o link da extensão não mudam. A mudança pode disparar uma nova revisão (não confirmado): reserve um tempo.
- **Regiões:** todas (ou apenas Brasil).
- **Pago/gratuito:** gratuito.

### Teste (instruções para o revisor)

A extensão só funciona com um GLPI real, e não há GLPI de homologação. Estratégia adotada: **enviar sem credenciais**
(opção C) e, se a revisão devolver por "não foi possível testar", usar a opção A (simulador abaixo).

O campo aceita **no máximo 500 caracteres**. Versão curta (414 caracteres; troque o link do vídeo):

```
Requer GLPI próprio da organização (API REST + tokens); não há conta de teste pública. Sem GLPI: Opções → Avisos → "Ver exemplos de notificação" dispara avisos fictícios; Opções → Conexão recusa URL sem https; "Dados locais" apaga tudo. Vídeo com dados fictícios: https://youtu.be/XXXXXXXXXXX
Somente leitura (GET), só HTTPS, sem servidor próprio nem analytics. GLPI de demonstração sob pedido: eugenio@sysvale.com
```

Versão longa (use se algum campo aceitar mais texto; troque `<LINK-DO-VIDEO-NO-YOUTUBE>`):

```
A extensão exige um GLPI próprio de cada organização (sistema de chamados com API REST habilitada, acessado com App-Token e token pessoal de API). Por isso não há uma conta de teste pública: o acesso ao GLPI é privado da organização do usuário e não pode ser compartilhado com terceiros.

O que o revisor pode verificar sem GLPI:
1. Instale a extensão e clique no ícone: o popup pede para configurar a conexão.
2. Abra as Opções (ícone de ajustes no popup). Em "Conexão" há os campos de URL do GLPI e dos tokens. Informar uma URL sem https:// é recusado (somente HTTPS é aceito), e o Chrome pede permissão de acesso apenas ao site informado, no momento de salvar.
3. Em Opções → Avisos → "Ver exemplos de notificação", a extensão dispara notificações de cada tipo com dados fictícios, para ver os avisos e o som.
4. Em Opções → Dados locais, "Apagar credenciais e dados locais" remove tudo o que a extensão guardou.

Funcionamento com um GLPI real (demonstração em vídeo, com dados fictícios): <LINK-DO-VIDEO-NO-YOUTUBE>

Garantias: a extensão é somente leitura (só faz requisições GET) e só se comunica com o GLPI informado pelo usuário, por HTTPS. Não tem servidor próprio, analytics nem código remoto. Todos os dados ficam no navegador do usuário.

Se for necessário, podemos disponibilizar um GLPI de demonstração com dados fictícios: contato eugenio@sysvale.com.
```

**Plano de reserva (opção A):** expor o GLPI simulado do projeto (`scripts/e2e/fake-glpi.mjs`, dados e tokens fictícios)
na internet com HTTPS válido (ex.: Cloudflare Tunnel) e informar URL e tokens nas instruções. A máquina e o túnel
precisam ficar no ar durante toda a revisão. Opção B: GLPI real em servidor próprio com domínio e HTTPS.

**Nunca** entregue ao revisor o GLPI de produção, o de um cliente ou tokens pessoais.

## 7. Enviar para revisão

1. Clique em **Enviar para revisão**. Escolha *publicar automaticamente após a aprovação* ou *manualmente*
   (manual dá controle do momento do lançamento).
2. Acompanhe o status no dashboard e o e-mail da conta. Possíveis resultados:
   - **Aprovada** → vai ao ar (ou fica aguardando seu clique, se escolheu manual).
   - **Rejeitada** → o e-mail diz a política violada; corrija, **aumente a versão** e reenvie.

### Pontos que costumam gerar questionamento nesta extensão

- **Permissão de host ampla (`https://*/*`):** é opcional e justificada acima. Seja explícito na justificativa.
- **Credenciais no armazenamento:** a divulgação em *Privacidade* e o `PRIVACY.md` cobrem isso.
- **Descrição de valor único:** a ficha deve falar só de GLPI/tickets (já está assim); evite palavras-chave soltas.

## 8. Depois de publicada

- **Publicada (1ª versão, aprovada na revisão):** ID `phbofombfpjafeneiikpjhnhnjedbced`, URL https://chromewebstore.google.com/detail/myticket/phbofombfpjafeneiikpjhnhnjedbced (sem os parâmetros `?authuser`/`hl`: com eles o Brave mostra "Usar no Chrome" em vez de "Usar no Brave"; sem eles, mostra certo. Divulgue sempre a URL limpa). Coloque no README.
- Instale pela loja e teste uma conexão real antes de divulgar.
- **Gerar os pacotes pelo CI (recomendado):** suba a versão em `extension/manifest.json` e `package.json`, faça merge na
  `main` e, nela, `git tag vX.Y.Z && git push origin vX.Y.Z`. O workflow `release.yml` testa, gera os zips e os anexa a uma
  Release do GitHub (com `SHA256SUMS.txt`); baixe de lá o que vai enviar às lojas. Assim o pacote enviado é exatamente o
  que foi testado, e fica registrado.
- **Atualizações (à mão):** aumente a versão (passo 2) → `npm test && npm run build:chrome` → Dashboard → item →
  **Pacote** → *Fazer upload de novo pacote* → revisar a ficha se algo mudou → Enviar para revisão. Usuários recebem a
  atualização automaticamente em algumas horas.
- Se uma versão tiver problema, reenvie a anterior com versão maior, ou despublique em **Status**.

## 9. Abrir o repositório (AGPL)

O repositório atual **não deve ser tornado público como está**: o histórico e os PRs #3 e #4 têm nomes do cliente e há
e-mails pessoais de autores nos commits. Tornar público também expõe as branches e os `refs/pull/*`, que sobrevivem a um
force-push. O caminho seguro é um **repositório novo**, criado a partir da árvore limpa.

1. `npm test && npm run e2e` e, na raiz, `gitleaks dir --config .gitleaks.toml .` (tudo verde, sem achados).
2. Confirme que nada do cliente sobrou: `git grep -n -i -E "<termos do cliente>"` (sem resultado na árvore).
3. Adicione `LICENSE` (texto da AGPL-3.0) e o campo `"license": "AGPL-3.0-only"` no `package.json`.
4. Crie o repositório novo, **vazio**, e envie só a árvore limpa:
   ```bash
   git clone --no-local . ../my-ticket-publico && cd ../my-ticket-publico
   git checkout --orphan limpo && git add -A && git commit -m "MyTicket 0.1.x"   # um commit só, sem histórico
   git remote set-url origin <url-do-repo-novo> && git push origin limpo:main
   ```
   (Para manter o histórico e a autoria, use `git filter-repo` com `--replace-text`, `--replace-message` e `--mailmap`
   num clone novo, e confira com o gitleaks e o `git log -p | grep` antes de publicar. Dá mais trabalho e o risco de sobrar
   algo é maior.)
5. No repositório novo, ligue **Private vulnerability reporting** e o **Secret scanning/Push protection**, se o plano permitir.
6. Troque na ficha da loja (Listagem → URLs) a página inicial, o suporte e a política de privacidade pelas URLs do
   repositório novo e envie uma nova versão para revisão.

## 10. Firefox (addons.mozilla.org)

Mesmo código; só o manifest muda (gerado por `scripts/firefox-manifest.mjs`: `background.scripts`, sem `offscreen`, com o
ID `myticket@sysvale.com` e `data_collection_permissions: none`). A conta é gratuita.

1. `npm test && npm run build:firefox:zip` → `dist/my-ticket-firefox-<versão>.zip`.
2. Valide com a ferramenta da Mozilla: `npm run build:firefox && npx web-ext lint --source-dir dist/firefox`.
   Resultado verificado na 0.1.1: **0 erros e 4 avisos** (`offscreen.createDocument` e
   `notifications.getPermissionLevel`, APIs que o Firefox não tem e que o código só usa quando existem). O CSP é aceito.
3. 👤 https://addons.mozilla.org/developers/ → **Enviar um novo add-on** → **Neste site** (listado) → envie o zip.
   - **"Você usa ferramentas de build, minificação ou ofuscação?"** → **Não**. O zip é o código-fonte (não há etapa de build).
4. Ficha (os textos são os do passo 6):
   - **Nome:** `MyTicket` · **Resumo (até 250):** `Notificações e painel dos seus tickets do GLPI, sem depender de e-mail.`
   - **Descrição:** a mesma da Chrome Web Store. **Categoria:** *Alerts & Updates* (e, se quiser uma segunda, *Other*).
   - **E-mail e site de suporte:** os mesmos do passo 6. **Política de privacidade:** cole o texto do `PRIVACY.md`.
   - **Licença:** escolha a que vai valer quando o repositório abrir (AGPL-3.0, se constar da lista; senão licença
     personalizada). Enquanto o repositório for privado, *All Rights Reserved* é aceito.
   - **Capturas de tela:** `store/screenshot-*-1280x800.png`. **Ícone:** o do pacote (`icons/icon128.png`).
   - **Notas para o revisor** (cole a versão longa das instruções do passo 6 e acrescente): `O pacote é o código-fonte,
     sem build, minificação nem dependências. Para testar: web-ext run, ou about:debugging → Carregar extensão temporária.`
5. Enviar. A revisão da Mozilla costuma ser mais rápida que a do Chrome e a primeira versão pode ser aprovada
   automaticamente, com revisão manual depois.
6. Depois de aprovada, o link do add-on é `https://addons.mozilla.org/firefox/addon/<slug>/`. Atualizações: suba a versão
   (passo 2), gere o zip de novo e envie em **Enviar nova versão**.

Só para uso próprio, sem listar: escolha **Por conta própria** no passo 3 e a Mozilla devolve um `.xpi` assinado, que o
Firefox comum instala.

No Firefox, o aviso **não tem os botões** "Abrir"/"Marcar como lido" e não fica fixo (limite da API do navegador); está
no README e vale mencionar na descrição se alguém perguntar.

## 11. Microsoft Edge (Partner Center)

O Edge carrega **o mesmo zip do Chrome** (`npm run build:chrome`), sem nenhuma mudança. Conta gratuita.

1. 👤 https://partner.microsoft.com/dashboard/microsoftedge → registre-se como desenvolvedor (pessoa ou empresa).
2. **Criar nova extensão** → envie `dist/my-ticket-<versão>.zip`.
3. **Disponibilidade:** Pública (ou *Oculta*, o equivalente de "não listada", para testar antes) · **Mercados:** todos.
4. **Propriedades:** categoria *Produtividade* · **URL da política de privacidade:** a mesma do Chrome · site e suporte: os mesmos
   do passo 6 · **Esta extensão usa código remoto?** Não.
5. **Listagem (pt-BR):** a mesma descrição (o Edge pede no mínimo 250 caracteres; a do Chrome passa).
   - **Logo da extensão: `store/logo-300x300.png`** (o Edge exige no mínimo 300×300; o ícone de 128 não serve).
   - **Capturas de tela:** `store/screenshot-*-1280x800.png` · **Bloco promocional pequeno:** `store/promo-440x280.png` ·
     **Grande:** `store/marquee-1400x560.png` · **Vídeo:** o link do YouTube.
   - **Termos de pesquisa (até 7):** `glpi`, `tickets`, `chamados`, `notificações`, `helpdesk`, `suporte`, `itsm`.
6. **Notas para certificação** (até 2000 caracteres): cole a versão longa das instruções do passo 6.
7. Enviar para publicação. A revisão leva alguns dias úteis. Atualização: suba a versão, gere o zip e envie em
   **Atualizar** na mesma extensão.

Quem usa Edge (ou Brave, Opera, Vivaldi) também consegue instalar direto da Chrome Web Store; a loja do Edge só
facilita para quem não sabe disso.

## Checklist final

- [ ] `npm test` verde
- [ ] versão aumentada (se não for a primeira publicação) em `manifest.json` e `package.json`
- [ ] `npm run build:chrome` gerou o zip
- [ ] URL pública da política de privacidade funcionando
- [ ] 1–5 screenshots 1280×800 sem dados reais
- [ ] Descrição, finalidade única e justificativas de permissão coladas
- [ ] Instruções de teste com GLPI de homologação
- [ ] E-mail de contato verificado na conta
- [ ] Enviado para revisão
