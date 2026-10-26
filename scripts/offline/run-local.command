#!/bin/zsh -l
# Double-click on macOS to play the current code locally without npm or Vite.
# Builds a preview with build-preview.mjs and serves it at http://127.0.0.1:5173/.
# Close the Terminal window to stop it.
setopt NULL_GLOB
cd "$(dirname "$0")/../.." || exit 1
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME/.local/bin" \
         "$HOME/.nodenv/shims" "$HOME/.asdf/shims" "$HOME/.local/share/mise/shims" \
         "$HOME"/.nvm/versions/node/*/bin; do
  [ -x "$d/node" ] && export PATH="$d:$PATH"
done
ok_node() { # usable if version >= 22.12
  local v; v=$("$1" -p 'process.versions.node' 2>/dev/null) || return 1
  local maj=${v%%.*} rest=${v#*.}; local min=${rest%%.*}
  (( maj > 22 || (maj == 22 && min >= 12) ))
}
NODE=""
command -v node >/dev/null && ok_node "$(command -v node)" && NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  echo "No system Node found; looking for one bundled with your apps..."
  for n in $(find /Applications "$HOME/Applications" "$HOME/.codex" "$HOME/Library/Application Support" \
               -maxdepth 9 -type f -name node -perm -u+x 2>/dev/null); do
    if ok_node "$n"; then NODE="$n"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "Couldn't find Node 22.12+. Install it from https://nodejs.org and run this again."
  read -k1 "?Press any key to close."; exit 1
fi
echo "Using $NODE ($("$NODE" -v))"
"$NODE" scripts/generate-world.mjs && "$NODE" scripts/hash-runtime-assets.mjs || { read -k1 "?Setup failed. Press any key."; exit 1; }
echo "Building local preview (about 15 seconds)..."
"$NODE" scripts/offline/build-preview.mjs . artifacts/preview >/dev/null || { read -k1 "?Build failed. Press any key."; exit 1; }
echo "Pineapple Siege is at http://127.0.0.1:5173/  (close this window to stop)"
(sleep 1; open "http://127.0.0.1:5173/") &
"$NODE" scripts/offline/serve.mjs artifacts/preview 5173
read -k1 "?Server stopped. Press any key to close."
