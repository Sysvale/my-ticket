// Resolve id de usuário -> nome, guardando em `cache` (objeto id -> nome que o chamador mantém).
// Erro de rede aborta (relança); erro HTTP do GLPI (ex.: sem direito de ver o usuário) vira "Usuário #id".
import { GlpiError } from './glpi.js';

export function makeNameResolver({ api, meId, cache }) {
  return async (uid) => {
    if (!uid) return '';
    if (uid === meId) return 'Você';
    if (cache[uid]) return cache[uid];
    try {
      const name = await api.userName(uid);
      if (name) {
        cache[uid] = name;
        return name;
      }
    } catch (e) {
      if (!(e instanceof GlpiError) || e.status === undefined) throw e;
    }
    return `Usuário #${uid}`;
  };
}
