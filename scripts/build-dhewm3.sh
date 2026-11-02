#!/bin/zsh
# Builds the dhewm3 engine for Doom III into vendor/dhewm3. Needs Xcode's command
# line tools, CMake and Homebrew. Doom 3 game files are not included.
set -euo pipefail
cd "${0:A:h}/.."
TAG=1.5.5
SRC=vendor/_dhewm3-src
OUT=vendor/dhewm3

free_mb=$(df -m . | awk 'NR==2 {print $4}')
if (( free_mb < 1024 )); then
  echo "Building needs about 1 GB free; this disk has ${free_mb} MB." >&2
  exit 1
fi

brew list sdl2 >/dev/null 2>&1 || brew install sdl2
brew list openal-soft >/dev/null 2>&1 || brew install openal-soft

rm -rf "$SRC"
git clone --depth 1 --branch "$TAG" https://github.com/dhewm/dhewm3.git "$SRC"
cmake -S "$SRC/neo" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DDEDICATED=OFF \
  -DOPENAL_INCLUDE_DIR="$(brew --prefix openal-soft)/include" \
  -DOPENAL_LIBRARY="$(brew --prefix openal-soft)/lib/libopenal.dylib"
cmake --build "$SRC/build" -j4
mkdir -p "$OUT"
cp -R "$SRC"/build/dhewm3.app "$OUT"/
# The engine looks for its game libraries next to its own binary.
cp "$SRC"/build/*.dylib "$OUT"/dhewm3.app/Contents/MacOS/
rm -rf "$SRC"
echo "Built. Open retro-zip's Doom III page to choose your game folder."
