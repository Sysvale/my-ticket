// Avisos sonoros: catálogo e normalização (puro; quem toca é a página offscreen, ou o próprio background no Firefox).

export const SOUNDS = {
  chime: { label: 'Suave (duas notas)', file: 'sounds/chime.wav' },
  double: { label: 'Duplo bip', file: 'sounds/double.wav' },
  alert: { label: 'Alerta (mais firme)', file: 'sounds/alert.wav' },
};

export const DEFAULT_SOUND = 'chime';

export const normalizeSound = (name) => (Object.hasOwn(SOUNDS, name) ? name : DEFAULT_SOUND);

export const clampVolume = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

export const soundFile = (name) => SOUNDS[normalizeSound(name)].file;

// Toca o arquivo do som. `url` resolve o caminho dentro da extensão (chrome.runtime.getURL). O som é opcional:
// uma falha ao tocar (ex.: o navegador bloqueou o áudio) nunca deve gerar erro.
export function playFile(name, volume, { url, AudioImpl = globalThis.Audio }) {
  const audio = new AudioImpl(url(soundFile(name)));
  audio.volume = clampVolume(volume);
  return Promise.resolve(audio.play()).catch(() => {});
}

// Config de som vinda do storage ou de uma mensagem: aceita lixo e devolve valores válidos.
export function normalizeSoundConfig(s) {
  return {
    enabled: Boolean(s?.enabled),
    name: normalizeSound(s?.name),
    volume: clampVolume(s?.volume ?? 0.6),
  };
}
