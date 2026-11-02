#!/bin/zsh
# Double-click in Finder to start retro-zip.
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null; then
  echo "retro-zip needs Node.js 20 or newer: https://nodejs.org"
  read -k1 "?Press any key to close."
  exit 1
fi
if [[ ! -f vendor/emulatorjs/data/loader.js || ! -f vendor/doom/doom.wasm ]]; then
  [[ -d node_modules/7zip-bin ]] || npm install --no-audit --no-fund || exit 1
  node scripts/fetch-vendor.mjs || { read -k1 "?Setup failed. Press any key to close."; exit 1; }
fi
PORT="${PORT:-8642}"
( sleep 1; open "http://127.0.0.1:$PORT" ) &
exec node server.mjs
