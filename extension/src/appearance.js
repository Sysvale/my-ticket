// Aparência: tema (automático, claro ou escuro) e efeito neon. Lógica pura, sem DOM nem chrome.*, testada em Node.
// Fica em chrome.storage.local, na chave `appearance`, escrita só pela aba "Aparência" das Opções.

export const THEMES = ['auto', 'light', 'dark'];
export const DEFAULT_APPEARANCE = Object.freeze({ theme: 'auto', neon: false });

// O que está no storage pode ser lixo (ou nem existir): sempre devolve um objeto novo e válido.
export function normalizeAppearance(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { theme: THEMES.includes(r.theme) ? r.theme : DEFAULT_APPEARANCE.theme, neon: r.neon === true };
}

// Atributos de <html> que o ui.css lê. `theme`: 'light' | 'dark' só quando a pessoa escolheu (null = segue o sistema,
// pelo prefers-color-scheme). `neon`: o brilho só existe no tema escuro, então liga só se o tema em uso for escuro.
export function rootAttributes(appearance, systemPrefersDark) {
  const a = normalizeAppearance(appearance);
  const dark = a.theme === 'dark' || (a.theme === 'auto' && Boolean(systemPrefersDark));
  return { theme: a.theme === 'auto' ? null : a.theme, neon: a.neon && dark };
}
