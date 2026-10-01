// Manifest do Firefox, gerado a partir do de extension/manifest.json (a fonte única, o que Chrome e Edge carregam).
// Fica fora de extension/ de propósito: o Chrome avisa "'background.scripts' requires manifest version of 2 or lower"
// quando vê as chaves do Firefox no manifest dele, então cada navegador carrega o seu.

// ID obrigatório no MV3 para assinar/distribuir. Depois da primeira assinatura ele não muda mais.
// "none": a extensão não coleta nem envia dados a ninguém além do GLPI que a própria pessoa configura.
export const GECKO = {
  id: 'myticket@sysvale.com',
  strict_min_version: '140.0',
  data_collection_permissions: { required: ['none'] },
};

// Permissões que só existem no Chrome/Edge: o Firefox não tem a página offscreen (o som toca no próprio background).
const CHROME_ONLY_PERMISSIONS = ['offscreen'];

export function toFirefoxManifest(chrome) {
  const worker = chrome.background?.service_worker;
  if (!worker) throw new Error('O manifest base precisa de background.service_worker');
  const m = structuredClone(chrome);
  // O Firefox ignora o service worker e roda os scripts como página de eventos.
  m.background = { scripts: [worker], ...(chrome.background.type ? { type: chrome.background.type } : {}) };
  m.permissions = (m.permissions ?? []).filter((p) => !CHROME_ONLY_PERMISSIONS.includes(p));
  delete m.minimum_chrome_version;
  m.browser_specific_settings = { gecko: structuredClone(GECKO) };
  return m;
}
