// Runs doom.wasm in the same sandbox as the emulator. The WAD arrives by postMessage.
// With no WAD the engine plays the shareware episode built into it.
const send = (msg, transfer = []) => parent.postMessage(msg, '*', transfer);
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const text = new TextDecoder();

addEventListener('error', (e) => send({ type: 'error', message: e.message }));
addEventListener('unhandledrejection', (e) => send({ type: 'error', message: String(e.reason?.message ?? e.reason) }));

async function start({ bytes, saves = {} }) {
  const wad = bytes ?? null;
  let doom;
  let image;
  let lastError = '';
  const mem = () => doom.memory.buffer;
  const message = (ptr, len) => text.decode(new Uint8Array(mem(), ptr, len));

  const imports = {
    loading: {
      onGameInit(width, height) {
        canvas.width = width;
        canvas.height = height;
        image = ctx.createImageData(width, height);
      },
      wadSizes(countPtr, totalPtr) {
        if (!wad) return;
        const v = new DataView(mem());
        v.setInt32(countPtr, 1, true);
        v.setUint32(totalPtr, wad.length, true);
      },
      readWads(dest, lengthsPtr) {
        new Uint8Array(mem(), dest, wad.length).set(wad);
        new DataView(mem()).setInt32(lengthsPtr, wad.length, true);
      },
    },
    runtimeControl: { timeInMilliseconds: () => BigInt(Math.floor(performance.now())) },
    ui: {
      drawFrame(ptr) {
        // Doom's frame is BGRA and the canvas wants RGBA.
        const src = new Uint8Array(mem(), ptr, image.data.length);
        const out = image.data;
        for (let i = 0; i < out.length; i += 4) {
          out[i] = src[i + 2];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i];
          out[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      },
    },
    gameSaving: {
      sizeOfSaveGame: (slot) => saves[slot]?.length ?? 0,
      readSaveGame(slot, dest) {
        const data = saves[slot];
        if (!data) return 0;
        new Uint8Array(mem(), dest, data.length).set(data);
        return data.length;
      },
      writeSaveGame(slot, src, len) {
        const data = new Uint8Array(mem(), src, len).slice();
        saves[slot] = data;
        send({ type: 'doom-save', slot, bytes: data.slice() });
        return len;
      },
    },
    console: {
      onInfoMessage() {},
      onErrorMessage(ptr, len) { lastError = message(ptr, len); },
    },
  };

  const { instance } = await WebAssembly.instantiateStreaming(fetch(`${location.origin}/vendor/doom/doom.wasm`), imports);
  doom = instance.exports;

  const K = (name) => doom[name].value;
  const SPECIAL = {
    ArrowLeft: K('KEY_LEFTARROW'), ArrowRight: K('KEY_RIGHTARROW'), ArrowUp: K('KEY_UPARROW'), ArrowDown: K('KEY_DOWNARROW'),
    Comma: K('KEY_STRAFE_L'), Period: K('KEY_STRAFE_R'), ControlLeft: K('KEY_FIRE'), ControlRight: K('KEY_FIRE'),
    Space: K('KEY_USE'), ShiftLeft: K('KEY_SHIFT'), ShiftRight: K('KEY_SHIFT'), Tab: K('KEY_TAB'), Escape: K('KEY_ESCAPE'),
    Enter: K('KEY_ENTER'), Backspace: K('KEY_BACKSPACE'), AltLeft: K('KEY_ALT'), AltRight: K('KEY_ALT'),
  };
  const keyFor = (e) => SPECIAL[e.code] ?? (e.key.length === 1 ? e.key.toLowerCase().charCodeAt(0) : null);
  const onKey = (down) => (e) => {
    const k = keyFor(e);
    if (k === null || k > 255) return;
    e.preventDefault();
    if (e.repeat) return;
    if (down) doom.reportKeyDown(k);
    else doom.reportKeyUp(k);
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));

  const fail = (err) => send({ type: 'error', message: lastError || err.message || String(err) });
  try {
    doom.initGame();
  } catch (err) {
    fail(err);
    return;
  }
  send({ type: 'started' });
  const loop = () => {
    try {
      doom.tickGame();
    } catch (err) {
      fail(err);
      return;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

addEventListener('message', (e) => {
  if (e.source === parent && e.data.type === 'load') start(e.data);
});

send({ type: 'frame-ready' });
