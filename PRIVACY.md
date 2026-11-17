# Política de Privacidade — MyTicket

Última atualização: 12/11/2026

O **MyTicket** é uma extensão de navegador que acompanha os seus tickets do GLPI e avisa quando há novidades.
Esta política explica quais dados a extensão usa e para onde eles vão.

## Resumo

- A extensão **não coleta, não vende e não compartilha** dados com a Sysvale, com o desenvolvedor ou com terceiros.
- Não há servidor próprio, analytics, telemetria, anúncios nem rastreadores.
- Tudo o que a extensão guarda fica **no seu navegador**; a única comunicação de rede é com **o GLPI da sua organização**,
  no endereço que você mesmo configura.

## Dados que a extensão usa

| Dado | Para quê | Onde fica |
|---|---|---|
| URL do GLPI, App-Token e user_token (informados por você) | Autenticar na API do GLPI | `chrome.storage.local`, só neste navegador. Não sincroniza com a conta Google |
| Dados dos seus tickets (número, título, status, prioridade, entidade, acompanhamentos) | Montar o painel e detectar novidades | `chrome.storage.local` (cache local). Com "Ocultar conteúdo" ligado, o texto dos acompanhamentos não é guardado |
| Preferências, tags personalizadas, tickets fixados e acompanhados | Personalização | `chrome.storage.local` |
| Token de sessão temporário do GLPI | Manter a sessão da API | `chrome.storage.session`, some ao fechar o navegador |

Os tokens **não são criptografados em disco** (mesma situação de um arquivo `.env`) e são enviados **somente** ao
host do GLPI configurado.

## Comunicação de rede

- A extensão faz requisições `GET` (somente leitura) à API REST do GLPI configurado, **apenas por `https://`**.
- Não segue redirecionamentos e não contata nenhum outro endereço.
- A extensão nunca cria, altera ou apaga nada no GLPI.

## Permissões e por que são necessárias

- `storage`: guardar configuração e cache localmente.
- `alarms`: agendar a verificação periódica.
- `notifications`: exibir os avisos de novidade.
- `offscreen`: tocar o aviso sonoro (o service worker do Manifest V3 não tem áudio).
- Acesso opcional a sites (`https://*/*`): **solicitado somente para o endereço do GLPI** que você configura, no
  momento em que você salva a conexão. Pode ser revogado a qualquer momento.

## Controle dos seus dados

- Em **Opções → Dados locais → Apagar credenciais e dados locais** a extensão apaga tudo o que guardou e retira a
  permissão de acesso ao site. Remover a extensão do navegador também apaga seus dados locais.
- Para invalidar o token no GLPI, gere outro em Preferências → "Chave de acesso remoto".

## Uso dos dados

Os dados são usados **exclusivamente** para a função descrita (acompanhar e notificar tickets). Não são usados para
publicidade, crédito, perfilamento nem transferidos a terceiros, em conformidade com a Política de Dados de Usuário
dos Serviços da Chrome Web Store (Limited Use).

## Contato

Dúvidas sobre esta política: **eugenio@sysvale.com**.

Mudanças nesta política serão publicadas neste mesmo arquivo, com a data de atualização.
