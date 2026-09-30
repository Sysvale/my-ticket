#!/usr/bin/env bash
# Copia extension/ para uma pasta do Windows (o seletor de pastas do Chrome no Windows
# costuma não enxergar \\wsl.localhost). Rode de novo a cada mudança no código e depois
# clique em "recarregar" no card da extensão em chrome://extensions.
#
# O usuário do Windows é descoberto, nesta ordem, por: MYTICKET_WIN_USER; o cmd.exe (o interop do WSL
# às vezes está desligado e ele não executa); a única pasta de usuário "de verdade" em C:\Users.
#
# Variáveis opcionais:
#   MYTICKET_WIN_USER   usuário do Windows
#   MYTICKET_WIN_DIR    pasta destino em formato WSL (padrão: /mnt/c/Users/<usuário>/MyTicket);
#                       com ela definida o usuário nem precisa ser descoberto
#   MYTICKET_USERS_DIR  onde ficam as pastas de usuário (padrão: /mnt/c/Users)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USERS_DIR="${MYTICKET_USERS_DIR:-/mnt/c/Users}"

detect_win_user() {
  local name dir base
  local -a found=()

  name="$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$name" ] && [ -d "$USERS_DIR/$name" ]; then
    printf '%s' "$name"
    return 0
  fi

  for dir in "$USERS_DIR"/*/; do
    [ -d "$dir" ] || continue
    base="$(basename "$dir")"
    case "$base" in
      "All Users" | "Default" | "Default User" | "Public" | "Todos os Usuários" | "Usuário Padrão" | "defaultuser0" | "WDAGUtilityAccount") continue ;;
    esac
    found+=("$base")
  done
  if [ "${#found[@]}" -eq 1 ]; then
    printf '%s' "${found[0]}"
    return 0
  fi
  return 1
}

if [ -n "${MYTICKET_WIN_DIR:-}" ]; then
  BASE="$MYTICKET_WIN_DIR"
else
  WIN_USER="${MYTICKET_WIN_USER:-$(detect_win_user || true)}"
  [ -n "$WIN_USER" ] || { echo "ERRO: não consegui descobrir o usuário do Windows (defina MYTICKET_WIN_USER)" >&2; exit 1; }
  BASE="$USERS_DIR/$WIN_USER/MyTicket"
fi

DEST="$BASE/extension"
mkdir -p "$DEST"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$ROOT/extension/" "$DEST/"
else
  # sem rsync: esvazia o destino antes, para o que foi removido aqui não ficar na cópia do Windows
  find "$DEST" -mindepth 1 -delete
  cp -a "$ROOT/extension/." "$DEST/"
fi

if command -v wslpath >/dev/null 2>&1; then
  echo "Copiado para: $(wslpath -w "$DEST")"
else
  echo "Copiado para: $DEST"
fi
echo "No Chrome: chrome://extensions → Carregar sem compactação (primeira vez) ou recarregar o card."
