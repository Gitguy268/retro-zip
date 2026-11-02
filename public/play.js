// Runs inside a sandboxed iframe with no origin and no network access beyond its
// own engine files. The parent hands over the game with postMessage.
const send = (msg, transfer = []) => parent.postMessage(msg, '*', transfer);

// A sandboxed page can't use browser storage, and touching it throws. EmulatorJS
// runs without storage when these are missing.
Object.defineProperty(window, 'localStorage', { value: undefined });
Object.defineProperty(window, 'indexedDB', { value: undefined });

// EmulatorJS looks for a newer version on its CDN. The policy on this page blocks
// that anyway, so answer locally instead of raising a failed-request error.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => (String(input?.url ?? input).startsWith(location.origin) || String(input).startsWith('blob:')
  ? realFetch(input, init)
  : Promise.resolve(new Response('', { status: 404 })));

addEventListener('error', (e) => send({ type: 'error', message: e.message }));
addEventListener('unhandledrejection', (e) => send({ type: 'error', message: String(e.reason?.message ?? e.reason) }));

function stateBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function start({ bytes, fileName, core, title, state }) {
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: core,
    EJS_gameName: title,
    EJS_gameUrl: new File([bytes], fileName),
    EJS_pathtodata: `${location.origin}/vendor/emulatorjs/data/`,
    EJS_startOnLoaded: true,
    EJS_disableDatabases: true,
    EJS_disableLocalStorage: true,
    EJS_color: '#ff4f9a',
    EJS_Buttons: { netplay: false, cacheManager: false, saveState: false, loadState: false, exitEmulation: false },
    EJS_ready() { send({ type: 'ready' }); },
    EJS_onGameStart() {
      if (state) window.EJS_emulator.gameManager.loadState(state);
      focusGame();
      send({ type: 'started' });
    },
  });
  // EmulatorJS shows start failures on its own screen, so pass them up to the app too.
  const watch = setInterval(() => {
    const emu = window.EJS_emulator;
    if (emu?.started) clearInterval(watch);
    if (emu?.failedToStart) {
      clearInterval(watch);
      send({ type: 'error', message: 'the emulator failed to start. The file may be damaged or for a different system.' });
    }
  }, 500);
  const loader = document.createElement('script');
  loader.src = `${location.origin}/vendor/emulatorjs/data/loader.js`;
  document.body.append(loader);
}

// EmulatorJS reads keys from its own element, so focus has to stay there.
const focusGame = () => document.getElementById('game').focus();
addEventListener('focus', focusGame);

addEventListener('message', async (e) => {
  if (e.source !== parent) return;
  const msg = e.data;
  if (msg.type === 'load') start(msg);
  const gm = window.EJS_emulator?.gameManager;
  if (msg.type === 'save-state' && gm) {
    const bytes = stateBytes(await gm.getState());
    send({ type: 'state', bytes }, [bytes.buffer]);
  }
  if (msg.type === 'load-state' && gm) gm.loadState(msg.bytes);
});

send({ type: 'frame-ready' });
