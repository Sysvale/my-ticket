<p align="center"><img src="assets/logo.png" alt="MyTicket — Seus tickets do GLPI, sempre com você." width="320"></p>

# MyTicket

Extensão (Manifest V3) para **Chrome, Edge e Firefox** que acompanha os seus tickets do **GLPI** e avisa por
notificação do sistema quando alguém responde, sem depender de e-mail.

Somente leitura: a extensão nunca cria nem altera nada no GLPI.

## O que faz (v0.1)

- Descobre sozinha os tickets **em aberto** em que você é atribuído, observador ou requerente.
- Você pode acompanhar qualquer outro ticket **pelo número ou link** (popup, ou o atalho
  "+ Acompanhar #N desta aba" quando você está numa página de ticket).
- Notifica quando há: novo acompanhamento de outra pessoa, solução proposta, mudança de
  status, mudança do **Status extra** e ticket novo no seu radar. Cada tipo liga/desliga nas opções.
- Botões na notificação: **Abrir** e **Marcar como lido**.
- Badge no ícone com a quantidade de tickets com novidade; popup com cards (status, prioridade,
  Status extra, entidade, último evento).
- Abrir um ticket do GLPI em qualquer aba marca as novidades dele como lidas.
- **Barra de endereços:** digite `ticket` + espaço + o número (`ticket 148270`), um `#número` ou o link do ticket e
  aperte Enter para abrir o ticket no GLPI (Alt+Enter abre numa aba nova). Se o ticket já está aberto numa aba, ela só
  ganha o foco. Enquanto digita, aparecem sugestões do seu radar por número ou parte do título (sem diferenciar
  acentos), tiradas do cache local: **nenhuma consulta ao GLPI**. Com “Ocultar conteúdo” as sugestões mostram só
  `Ticket #N`. Texto livre só abre se casar com um único ticket; sem o GLPI configurado, abre as Opções.
- **Filtros no popup:** busca por número, título ou entidade (sem diferenciar acentos), atalho
  **Novidades** (só não lidos) e painel **Filtros** com status, papel, entidade, Status extra,
  prioridade e tag. Os filtros combinam entre si e ficam salvos entre uma abertura e outra do popup;
  uma linha "Mostrando X de Y" indica quando há filtro ligado. **Entidade**, **Status extra** e **Tag**
  têm um campo de busca dentro da lista (sem diferenciar acentos), para achar a opção quando são muitas;
  **Tag** aceita **várias escolhas** ao mesmo tempo (aparece o ticket que tiver *qualquer uma* delas, e “Sem tag”
  pode entrar na mistura). Funciona só pelo teclado: ↓/↑ andam pela lista, Enter marca, Esc fecha.
- **Aparência:** em Opções → **Aparência**, tema **Automático** (segue o sistema), **Claro** ou **Escuro**, e o
  interruptor do **efeito neon** (cores vivas e brilho nas tags, botões e cartões, só no tema escuro). Vale na hora, em
  todas as telas, e fica só neste navegador. Padrão: automático e neon desligado.
- **Aviso sonoro:** três sons para escolher (suave, duplo bip, alerta) e volume ajustável, com botão
  **Ouvir**. Toca uma vez por verificação, mesmo com vários tickets; com o som ligado, o som padrão do
  Windows para os avisos da extensão fica desativado, para não tocar dois. Como o service worker do MV3
  não tem áudio, o som toca numa página *offscreen* invisível (permissão `offscreen`).
- **Ver exemplos de notificação** (Opções → Avisar quando…): dispara uma notificação real de cada tipo,
  com dados fictícios, para você ver e ouvir como ficam no seu sistema.
- **Detalhes do ticket:** clicar num card abre uma tela de detalhes no próprio popup (informações, novidades
  detectadas e a conversa buscada ao vivo no GLPI), com o botão **Abrir no GLPI ↗** que leva ao ticket (foca a aba
  se já estiver aberta). Abrir os detalhes conta como ler. Com “Ocultar conteúdo”, nenhum texto é buscado.
- **Chamar a atenção sem depender do banner do Windows:** piscar o Chrome na barra de tarefas e manter o aviso na
  tela até fechar. Se os avisos só aparecem na Central de Notificações (Win + N), veja o Guia de notificações.
- **Guia de notificações** (Opções → “Guia de notificações”): como são os avisos, o que precisa estar ligado
  (com verificação ao vivo) e o que fazer quando não aparecem.
- Ignora as suas próprias respostas (configurável).
- **Pausar a sincronização:** o botão de pausa no alto do popup (ao lado de “Atualizar agora”) para de buscar no GLPI e de
  avisar, sem apagar nada. Enquanto pausado, o alarme é cancelado, nem o “Atualizar agora” busca, o ícone mostra “II” e o
  popup exibe um aviso com **Retomar**. Ao retomar, a extensão busca na hora e avisa o que aconteceu nesse meio-tempo (mais
  de 5 tickets viram um aviso-resumo). Ver os detalhes de um ticket continua funcionando, porque é você pedindo.
- **Tempo por atribuído:** nos detalhes do ticket, **Gerar gráfico de tempo** desenha uma rosca com 100% do tempo do
  ticket (da abertura até a solução, ou até agora se ainda está aberto), dividido por pessoa ou equipe atribuída:
  passagens da mesma pessoa se somam, dois atribuídos ao mesmo tempo dividem em partes iguais, pessoa vale mais que
  equipe e o período sem ninguém aparece como **Sem atribuição / Fila**. **O GLPI só é consultado quando você clica**
  (3 consultas por geração; nada fica guardado e a verificação periódica nunca lê o histórico). Exige o direito
  “Logs” no perfil do GLPI. O GLPI não guarda o papel de quem já saiu do ticket, então esse tempo aparece como **Papel
  desconhecido**, com uma opção para contá-lo como atribuição. Com “Ocultar conteúdo”, os nomes não aparecem.
- **Tags personalizadas:** o botão **Tags** em cada card (e nos detalhes) marca **etapas** (só uma por ticket, com
  “desde quando”: *Em andamento*, *PR em review*, *Em homologação/suporte*, *Aguardando retorno*) e **etiquetas**
  (várias: *Cliente avisado*), e dá para criar as suas ali mesmo. Aparecem como chips no card, entram no filtro “Tag”
  (várias de uma vez e também “Sem tag”) e na busca pelo nome. Em Opções → aba **Tags** dá para renomear, recolorir (uma cor da paleta ou **qualquer hexadecimal** `#rrggbb`, digitado ou pelo seletor de cores; o texto é clareado/escurecido sozinho para continuar legível nos temas claro e escuro, e um hexadecimal inválido é recusado com aviso), mudar o tipo,
  reordenar, apagar, restaurar os padrões e **exportar/importar** um arquivo JSON. Ficam **só neste navegador**
  (`chrome.storage.local`): não vão ao GLPI, não sincronizam com a conta Google e ninguém mais as vê. Veja
  [quando elas podem ser perdidas](#quando-as-tags-podem-ser-perdidas).
- Privacidade: só `https://`, opção de **ocultar o conteúdo** das notificações e botão para
  **apagar credenciais e dados locais** (veja [Proteções embutidas](#proteções-embutidas)).

## Instalar (uso pessoal, sem Web Store)

1. Chrome → `chrome://extensions` → ligue **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha a pasta `extension/`.
   Com o **Chrome do Windows e o projeto no WSL**, carregue a cópia feita por
   `npm run sync:win` (veja [Sincronizar com o Chrome do Windows](#sincronizar-com-o-chrome-do-windows-wsl)).
3. Abra as **Opções** da extensão (aba **Conexão**), informe a URL, o App-Token e o user_token
   (ou use **Importar de um arquivo .env**), clique em **Testar conexão** e em **Salvar**.

### Navegadores

**Chrome e Edge** carregam `extension/` como está (o Edge é Chromium: `edge://extensions`, mesmo passo a passo).

**Firefox (versão 140 ou mais nova)** carrega uma cópia gerada, porque o manifest dele é diferente: o Firefox não tem service
worker nem a página *offscreen*, e as chaves próprias dele fazem o Chrome avisar “`background.scripts` requires manifest
version of 2 or lower”. Por isso o manifest do Firefox é **gerado** a partir do de `extension/` e `extension/` não leva nada dele.

```bash
npm run build:firefox                                   # gera dist/firefox
npm run build:firefox -- --out /mnt/c/Users/<usuário>/MyTicket/extension-firefox   # WSL: direto no disco do Windows
```

Depois, no Firefox: `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária…** → o `manifest.json` da pasta
gerada. Abra as Opções e salve a conexão: o Firefox pede a permissão de acesso ao site do GLPI; se não pedir, conceda em
`about:addons` → MyTicket → **Permissões**. Rode `build:firefox` de novo a cada mudança no código e recarregue o add-on.

- O que o gerador muda (`scripts/firefox-manifest.mjs`): `background.scripts` no lugar de `service_worker`, sem a permissão
  `offscreen` e sem `minimum_chrome_version`, e com `browser_specific_settings.gecko` (ID `myticket@sysvale.com`, obrigatório
  no MV3 para assinar). Ele recusa apagar uma pasta que não seja uma saída anterior.
- Uma extensão temporária **some quando o Firefox fecha**. Para ficar instalada é preciso assiná-la ou usar o Firefox
  Developer Edition, Nightly ou ESR com `xpinstall.signatures.required` desligado em `about:config`. O Firefox comum recusa
  extensão sem assinatura.
- O que muda no Firefox, porque a API de avisos dele só aceita título e texto: o aviso **não tem os botões**
  “Abrir” e “Marcar como lido” (clicar nele abre o ticket e já marca como lido), **não fica fixo na tela**, **não
  silencia** o som padrão do sistema (com o som da extensão ligado podem tocar os dois) e a entidade vem numa segunda
  linha do texto. O aviso sonoro toca direto no background, e o Guia não consegue verificar se as notificações estão
  permitidas (mostra “Não foi possível verificar”).
- Verificado com o `web-ext lint` da Mozilla (0 erros; os avisos que sobram são APIs que o código só usa quando existem) e
  por testes que simulam o Firefox (`test/background-firefox.test.js`, `test/firefox-build.test.js`). O e2e roda só no Chromium.

## Sincronizar com o Chrome do Windows (WSL)

O projeto pode viver no WSL, mas o Chrome roda no Windows e o
seletor de pastas dele costuma **não enxergar `\\wsl.localhost`**. A solução é manter uma cópia de
`extension/` no disco do Windows e carregar essa cópia.

```bash
npm run sync:win      # ou: bash scripts/sync-windows.sh
```

O script copia `extension/` para `C:\Users\<usuário do Windows>\MyTicket\extension` (o usuário é
detectado via `cmd.exe` ou, se ele não rodar, pela pasta `C:\Users` quando só há um usuário) e imprime
o caminho no formato Windows, por exemplo `C:\Users\<usuário>\MyTicket\extension`.

**Primeira vez:** `chrome://extensions` → **Carregar sem compactação** → cole o caminho impresso pelo
script na barra de endereço do seletor.

**A cada mudança no código** (a cópia não é automática):

1. No WSL: `npm run sync:win`
2. No Chrome: `chrome://extensions` → botão de **recarregar** no card do MyTicket.

As opções e os tokens ficam salvos no perfil do Chrome e sobrevivem ao recarregar. Se a extensão
sumir da lista, é só carregar a mesma pasta de novo.

Variáveis opcionais do script:

| Variável | Para quê | Padrão |
|---|---|---|
| `MYTICKET_WIN_USER` | usuário do Windows | `cmd.exe`, ou a única pasta de usuário em `C:\Users` |
| `MYTICKET_WIN_DIR` | pasta destino, em formato WSL (a cópia vai para `<pasta>/extension`) | `/mnt/c/Users/<usuário>/MyTicket` |

Dica: se o `.env` com os tokens também está no WSL, o seletor de arquivos pode não achá-lo. Nesse
caso cole os dois tokens direto nas Opções, ou copie o `.env` por um instante para o Windows,
importe e apague a cópia (ele contém tokens).
   O Chrome vai pedir permissão de acesso **só ao site do GLPI**.

## Opções em abas

| Aba | O que tem | Salvar |
|---|---|---|
| **Conexão** | URL e tokens do GLPI, o que acompanhar, intervalo e campo do Status extra | barra **Salvar** no pé da janela |
| **Avisos** | quando avisar, som, chamar a atenção, ocultar conteúdo | barra **Salvar** no pé da janela |
| **Aparência** | tema (automático, claro ou escuro) e o interruptor do efeito neon | na hora (sem barra) |
| **Tags** | criar, renomear, recolorir, reordenar, apagar, exportar/importar | na hora (sem barra) |
| **Dados locais** | apagar credenciais e dados, e o aviso de quando as tags se perdem | na hora (sem barra) |

O endereço guarda a aba (`options.html#tags` abre direto a aba Tags; é o que o “Gerenciar tags…” do popup usa), as setas
do teclado andam entre as abas, e se o **Salvar** falhar (ex.: URL vazia) a página volta para a aba **Conexão** e leva o
foco ao campo.

## Autenticação e onde ficam os tokens

- Usa a API REST legada do GLPI (`/apirest.php`) com **App-Token** + **user_token** pessoal
  (GLPI → Preferências → "Chave de acesso remoto"). A senha do GLPI nunca passa pela extensão.
- Os tokens ficam em `chrome.storage.local` do seu perfil do Chrome: não sincronizam com a conta
  Google, nenhum site ou outra extensão os lê, e só são enviados ao host do GLPI configurado.
- **Não são criptografados em disco** (mesma situação de um `.env`). O `session_token` temporário
  fica em `chrome.storage.session` e some ao fechar o navegador.
- O GLPI tem **um** user_token por pessoa. Regenerá-lo invalida tudo que o usa (esta extensão e
  os scripts que leem o `.env`).
- O token **não é somente leitura**: a extensão só faz `GET` (o cliente da API não tem outro
  método), mas quem obtiver o token pode fazer no GLPI o que o seu perfil permite.

### Proteções embutidas

- **Somente `https://`.** `http://` é recusado nas Opções (Testar e Salvar), o manifest só pede
  permissão opcional para `https://*/*` e o cliente da API se recusa a iniciar com URL sem https,
  sem enviar nenhuma requisição. Um endereço sem esquema (`glpi.exemplo.com`) vira `https://`.
- **Ocultar conteúdo** (Opções → Privacidade). Com a opção ligada, a notificação mostra só
  `Ticket #123` e "Fulano respondeu" (sem título, texto nem entidade), e o texto de acompanhamentos e
  soluções deixa de ser guardado no navegador; o que já estava no cache é apagado. O título dos
  tickets continua visível no painel do popup. Desligada por padrão.
- **Apagar credenciais e dados locais** (Opções → Dados locais). Apaga URL, tokens, preferências,
  tickets acompanhados, **tags personalizadas e marcações**, cache e notificações, e retira a permissão de acesso ao site
  do GLPI.
  Não altera nada no GLPI e **não invalida o token**: para isso, gere outro em Preferências →
  "Chave de acesso remoto".
- **Sem redirecionamentos.** O cliente nunca segue um redirect do GLPI (o navegador repassaria `App-Token` e
  `Session-Token` ao novo destino, até a um `http://`): avisa "o GLPI redirecionou o pedido" e pede para
  corrigir a URL. Cada requisição tem limite de 20 s, contando a leitura da resposta.
- Sem `console.*`, sem analytics, sem dependências de terceiros e um único ponto de rede
  (`src/glpi.js`), sempre para a URL do GLPI configurada. A raiz do projeto e a extensão não têm dependência nenhuma:
  o ESLint, só de desenvolvimento, fica isolado em `tools/lint/` e nunca vai para o Chrome.
- **Essas garantias são verificadas, não só prometidas:** `test/invariants.test.js` (roda no `npm test` e no CI) falha
  se aparecer `console.*`, `innerHTML`/`eval`, rede fora de `src/glpi.js`, `storage.sync`, URL `http://`, script inline ou
  recurso remoto no HTML/CSS, ou uma permissão nova no `manifest.json`.

## Quando as tags podem ser perdidas

As tags ficam no armazenamento local deste navegador. **Sobrevivem** a fechar e reabrir o Chrome, a reiniciar o
computador e a recarregar a extensão (testado num Chromium real). **Se perdem** quando:

- você clica em **Apagar credenciais e dados locais** (Opções → Dados locais);
- você **remove a extensão** do Chrome, mesmo que a adicione de novo;
- você carrega a extensão de **outra pasta**: o Chrome cria outro ID, com o armazenamento vazio (testado). O
  `npm run sync:win` copia sempre para a mesma pasta, então o ID não muda;
- você apaga ou redefine o **perfil do Chrome**, ou usa outro perfil, navegador ou computador (não há sincronização);
- você **troca a conta ou o GLPI** nas Opções: as marcações (e os tickets acompanhados) são descartados, porque os
  números de ticket deixam de valer; as tags que você criou ficam;
- o ticket sai do seu radar e passa **mais de 60 dias** sem voltar: a marcação dele é limpa sozinha;
- você usa o “Limpar dados de navegação” do Chrome: **não foi testado** se isso apaga dados de extensões.

Esses mesmos avisos aparecem nas Opções, junto do botão que apaga tudo. Para se proteger, use **Exportar tags (JSON)**
e guarde o arquivo; **Importar** devolve as tags (substituindo as atuais).

## Como funciona

- `chrome.alarms` acorda o service worker (no Firefox, a página de eventos) a cada N minutos (1, 2, 5 ou 10).
- Um `search/Ticket` por papel (campos 5, 66 e 4 = seu id, status "não resolvido") mais um por
  lote de tickets manuais. O `date_mod` do search decide quais tickets precisam ser relidos.
- Só os tickets alterados chamam `Ticket/:id`, `ITILFollowup` e `ITILSolution`. O histórico (`Ticket/:id?with_logs=true`, `Ticket_User`, `Group_Ticket`) só é lido no clique de “Gerar gráfico de tempo”. Uma varredura
  completa roda a cada 15 min como rede de segurança.
- A primeira vez que um ticket é visto é um baseline silencioso (não avisa o histórico).
- O Status extra (plugin Fields, search option `90001`) vem do próprio search e é comparado a
  cada rodada, porque pode mudar sem alterar o `date_mod` do ticket.
- Tickets resolvidos ficam visíveis por 2 dias em "Encerrados". Vale também para os acompanhados pelo número: depois
  de 2 dias encerrados, deixam de ser acompanhados. Encerrados só são relidos se o `date_mod` mudar (ex.: reabertos).
- Se o GLPI der erro (HTTP 500) ao ler **um** ticket, só ele fica de fora: aparece com o chip "erro ao ler", o rodapé do
  popup e o Guia avisam, e os outros tickets seguem sendo avisados. Falha de rede, de token ou do servidor inteiro
  continua sendo erro da verificação toda.
- Trocar a URL ou o token descarta o cache se a conta (ou o GLPI) for outra; regerar o token da mesma conta mantém tudo.

## Estrutura

```
extension/
  manifest.json      MV3; permissões: alarms, notifications, offscreen, storage (+ host opcional)
  background.js      service worker (Chrome/Edge) ou página de eventos (Firefox): alarme, polling, notificações, badge
  popup.*            painel de tickets
  options.*          credenciais e preferências
  options-tabs.js    abas das Opções (Conexão, Avisos, Aparência, Tags, Dados locais; o # do endereço escolhe a aba)
  options-appearance.js aba "Aparência" das Opções (tema e neon, salvos na hora)
  appearance-boot.js aplica o tema e o neon em <html> (popup, Opções e Guia) e acompanha a mudança na hora
  options-tags.js    aba "Tags" das Opções (gerenciar, cor em hexadecimal, exportar/importar)
  src/glpi.js        cliente da API (sessão, retry em 401, search)
  src/poller.js      lógica de detecção (pura, testável)
  src/format.js      helpers (HTML → texto, parse de URL/.env, datas)
  offscreen.*        página invisível que toca o aviso sonoro
  sounds/            avisos sonoros (.wav), gerados por scripts/make-sounds.py
  guide.*            Guia de notificações (verificação ao vivo, exemplos, passo a passo)
  src/filters.js     filtros do popup (lógica pura)
  src/omnibox.js     sugestões e leitura do que se digita na barra de endereços (lógica pura)
  src/timeshare.js   tempo por atribuído / rosca (lógica pura: log do GLPI → fatias que somam 100%)
  src/picker.js      seletor com busca e seleção múltipla do painel de filtros (lógica pura)
  src/picker-ui.js   o DOM desse seletor (botão, busca, lista, teclado e ARIA)
  src/details.js     detalhes ao vivo de um ticket (tela aberta do popup)
  src/diagnostics.js verificações do Guia
  src/attention.js   piscar na barra de tarefas / aviso fixo
  src/sounds.js      catálogo e validação dos sons
  src/samples.js     notificações de exemplo (dados fictícios)
  src/appearance.js  tema e neon (lógica pura: valores válidos e o que vai em <html>)
  src/toast.js       aviso rápido (toast) no canto da tela: retorno do “Salvar” nas Opções
  src/tags.js        tags personalizadas (lógica pura: padrões, etapa única, limites, exportar/importar)
  src/color.js       cor das tags: valida #rrggbb e ajusta o contraste por tema (lógica pura)
  src/tabs.js        abas das Opções (lógica pura: qual aba abrir, teclado)
  src/compat.js      diferenças entre Chrome/Edge e Firefox (detecção e opções de aviso que o Firefox aceita)
  src/dom.js         h(): monta DOM só com textContent (nada vai por innerHTML)
  src/store.js       chrome.storage (config / user / state / ui / session)
test/                node --test (API do GLPI simulada)
scripts/make-icons.py  gera os ícones e o banner a partir de assets/logo.png (Pillow)
scripts/sync-windows.sh  copia extension/ para o disco do Windows
scripts/build-firefox.mjs  gera a pasta do Firefox (cópia de extension/ com o manifest dele)
scripts/firefox-manifest.mjs  o manifest do Firefox, a partir do de extension/ (puro, testado)
scripts/coverage-summary.mjs  resume o lcov em markdown (comentário do PR e resumo do job)
.github/workflows/tests.yml   CI: testes unitários com coverage em todo PR
.github/workflows/seguranca.yml   CI: varredura de segredos (gitleaks) no histórico inteiro
.gitleaks.toml     regras da varredura de segredos (padrão do gitleaks + token do GLPI)
eslint.config.mjs  configuração do ESLint (recomendadas + correção e segurança)
tools/lint/        o ESLint isolado (package.json + lockfile): a única árvore de dependências, só de desenvolvimento
assets/logo.png    logo original (1254x1254)
```

## Desenvolvimento

```bash
npm test          # 213 testes, sem dependências (Node >= 20)
npm run test:coverage   # os mesmos testes com coverage (Node >= 22.5); escreve coverage/lcov.info
npm run lint:install    # uma vez: instala o ESLint em tools/lint/ (78 pacotes, sem scripts de instalação)
npm run lint            # ESLint (precisa do lint:install; Node >= 20.19)
npm run icons     # regenera extension/icons/*.png e extension/logo.png a partir de assets/logo.png
python3 scripts/make-sounds.py   # regenera extension/sounds/*.wav
npm run sync:win  # copia extension/ para o disco do Windows (WSL → Chrome do Windows)
npm run build:firefox   # gera dist/firefox, a pasta que o Firefox carrega (--out <pasta> escolhe outra)
npm run e2e       # teste visual ponta a ponta (Chromium + GLPI simulado) → docs/e2e/index.html
```

Depois de editar, rode `npm run sync:win` (se o Chrome for o do Windows) e clique em recarregar
o card da extensão em `chrome://extensions`.

## Integração contínua

Todo pull request roda os testes unitários no GitHub Actions (`.github/workflows/tests.yml`): ao abrir, ao reabrir
e a cada push no branch do PR. São três jobs, e qualquer falha reprova o PR:

- **Unitários + coverage (Node 24):** publica o coverage em **um comentário** do PR (atualizado a cada execução) e no
  resumo do job, e guarda o `lcov.info` como artefato por 14 dias. Não há limite mínimo de coverage: ele só informa.
- **Lint (ESLint, Node 24):** `npm run lint:install` (pelo lockfile, sem scripts de instalação) e `npm run lint`. Regras
  recomendadas mais correção e segurança (`eqeqeq`, `no-var`, `prefer-const`, `no-eval`, `no-implied-eval`, `no-new-func`,
  `no-throw-literal`, e `no-script-url` só na extensão). O ESLint 10 pede Node >= 20.19, por isso o lint não roda no job do
  Node 20.
- **Node 20 (versão mínima):** só `npm test`. É o que garante o "Node >= 20" declarado acima; as versões do meio não
  entram, porque passando na mínima e na atual não há o que elas acrescentem.

- O coverage nativo do Node só conta os arquivos que algum teste carrega. A camada de interface (`popup.js`,
  `options*.js`, `guide.js`, `offscreen.js`, `src/toast.js`) não aparece no percentual; o comentário lista esses
  arquivos pelo nome. Ela é exercitada pelo e2e, que precisa de Chromium e não roda no CI.
- As actions estão fixadas pelo SHA do commit (a versão vai em comentário). O Dependabot
  (`.github/dependabot.yml`) abre uma PR por semana com as atualizações, trocando o SHA e o comentário juntos, e
  o mesmo para o ESLint de `tools/lint/`.

**Varredura de segredos** (`.github/workflows/seguranca.yml`, job **Segredos (gitleaks)**): em todo PR e em todo push na
`main`, o gitleaks procura tokens no **histórico inteiro** do git, e não só no que o PR muda, porque um token apagado num
commit seguinte continua no histórico. Além das regras padrão (chaves de nuvem, tokens do GitHub, chaves privadas), há uma
regra do GLPI em `.gitleaks.toml`: App-Token e user_token são 40 caracteres sem prefixo e nenhuma regra padrão os
reconhece. O valor achado nunca aparece no log (`--redact`). O GitHub Advanced Security não está habilitado neste
repositório, então não há secret scanning nem CodeQL nativos. O binário é baixado numa versão fixa e conferido contra um
SHA-256 fixado no workflow; o Dependabot não acompanha essa versão, então atualize versão e SHA-256 juntos.

## Teste visual ponta a ponta

`npm run e2e` carrega a extensão de verdade num Chromium (o do Playwright) e a faz conversar com um **GLPI
simulado** (`scripts/e2e/fake-glpi.mjs`, HTTPS local, dados fictícios). Ele percorre o uso real: primeira
verificação, chegada de novidades, notificações criadas, busca e filtros, tela de detalhes com a conversa, botão
“Abrir no GLPI”, privacidade, Guia, um ticket com erro no GLPI, redirecionamento, gravações simultâneas, a pausa, as tags (popup, Opções, exportar/importar e apagar) e o “Salvar”
as Opções (aviso, erro e reabrir a página). Gera `docs/e2e/index.html`: uma captura por passo, o elemento clicado
destacado em vermelho e as verificações feitas. Sai com código 1 se algo falhar.

- Requer Node >= 22 (WebSocket global), `openssl` e um Chromium (`CHROME_BIN`, ou o do Playwright em
  `~/.cache/ms-playwright`).
- `E2E_OUT` muda a pasta do relatório; `E2E_COPY_TO` copia o `index.html` para outra pasta (ex.: no Windows).
- O banner do Windows é desenhado pelo sistema e não aparece nas capturas; o relatório mostra os textos que o
  Chrome recebeu. O piscar da barra de tarefas também só se confirma no Windows.

## Suposições a confirmar no seu GLPI

Estas dependem da instância e aparecem na resposta de **Testar conexão**:

- Search options de Ticket `4` (requerente), `5` (técnico), `66` (observador), `12` (status)
  e `19` (última atualização), e o valor de status `notold`.
- `90001` como search option do Status extra (valor da instância original; ajustável em Opções → Avançado).
- Subitens `Ticket/:id/ITILFollowup` e `Ticket/:id/ITILSolution` (GLPI 10+). Em GLPI mais
  antigo, soluções são ignoradas em silêncio.
- Até 200 tickets por papel por rodada.

## Roadmap

- v0.2: lista de foco e estados pessoais ("trabalhando", "aguardando cliente"), notas, snooze,
  side panel, horário silencioso, senha-mestre opcional para os tokens.
- v0.3: SLA/contagem regressiva, linha do tempo do ticket, `#123` vira link com hover card.
- Depois: integração com Trelássio/PRs e ações de escrita (com confirmação).
