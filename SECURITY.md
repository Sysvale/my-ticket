# Segurança

## Como reportar uma vulnerabilidade

Não abra uma issue pública. Escreva para **eugenio@sysvale.com** com o assunto "MyTicket — segurança", descrevendo o
problema, os passos para reproduzir e o impacto que você enxerga. Se o repositório tiver o "Private vulnerability
reporting" do GitHub ligado, pode usá-lo (aba **Security → Report a vulnerability**).

Respondemos em até 5 dias úteis. Depois da correção publicada, o crédito vai para quem reportou, se quiser.

## O que a extensão protege

O MyTicket guarda o endereço do GLPI, o App-Token e o user_token da pessoa. O modelo é este:

- **Só `https://`.** `http://` é recusado nas Opções, no cliente da API e no manifest (a permissão de host é opcional e só
  para `https://*/*`).
- **Um único destino.** Os tokens só são enviados ao GLPI que a pessoa configurou, em cabeçalhos (`App-Token`,
  `Authorization`, `Session-Token`), nunca na URL. O único código que faz requisição é `extension/src/glpi.js`.
- **Sem redirecionamento.** O cliente não segue redirects: o navegador repassaria os cabeçalhos ao novo destino.
- **Somente leitura.** O cliente só faz `GET`.
- **Sem telemetria**, sem analytics, sem código remoto, sem `storage.sync`, sem `console.*`, sem `innerHTML`/`eval`.
  `test/invariants.test.js` quebra se alguém introduzir qualquer um deles.
- **Texto do GLPI nunca vira HTML.** Títulos, respostas e nomes passam por `textContent` (`src/dom.js`).
- **Os tokens não vazam para o resto da extensão.** O teste de ponta a ponta (`npm run e2e`, passo "Os tokens não
  vazam") procura os três tokens no storage, nas notificações, no ícone, nas páginas e nos logs.
- **Apagar tudo** (Opções → Dados locais) remove credenciais, cache, tags e a permissão do site.

## Limites conhecidos (não são vulnerabilidades)

- Os tokens ficam em `chrome.storage.local` **sem criptografia em disco**, como um arquivo `.env`. Quem tem acesso ao
  perfil do navegador (ou a um malware rodando como o seu usuário) consegue lê-los. Use um token de API com o perfil
  de menor privilégio possível e gere outro no GLPI se desconfiar.
- O user_token do GLPI **não é somente leitura**: a extensão só faz `GET`, mas quem obtiver o token faz no GLPI o que o
  seu perfil permite.
- Extensões de terceiros com permissão de depuração, ou o próprio usuário abrindo o DevTools da extensão, enxergam o
  que a extensão enxerga.
- O servidor GLPI é de confiança da pessoa: o que ele devolve é tratado como texto, mas ele pode negar serviço ou
  devolver dados falsos.

## Versões

Só a última versão publicada recebe correções.
