// Toca o aviso sonoro. Duas entradas:
//  - parâmetros na URL: o background cria a página já pedindo o som (evita perder a mensagem
//    enquanto o script ainda carrega);
//  - mensagem { target: 'offscreen', type: 'play', sound, volume }: página já existente.
import { playFile } from './src/sounds.js';

const play = (sound, volume) => playFile(sound, volume, { url: (p) => chrome.runtime.getURL(p) });

const params = new URLSearchParams(location.search);
if (params.has('sound')) play(params.get('sound'), params.get('volume'));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === 'offscreen' && msg.type === 'play') play(msg.sound, msg.volume);
});
