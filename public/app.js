import { ARCADE_CORES, classify, coreFor, extOf, normaliseTitle, SYSTEMS } from '/shared/formats.mjs';
import { listZip, readEntry } from '/shared/zip.mjs';
import * as store from './store.js';
import { openTerminal } from './terminal.js';
import { mountAttract } from './attract.js';

const SYSTEM_NAMES = {
  ...Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.name])),
  doom3: 'Native engine',
};

const state = { catalog: [], instantBytes: 0, top: [], own: [], lists: [], doom3: null };
const root = document.getElementById('app');
const picker = document.getElementById('picker');
let stopAttract = null;

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...children.flat().filter((c) => c != null && c !== false));
  return n;
}

const formatSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1048576 * 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function toast(message, kind = '') {
  const t = el('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 4000);
}

function dialog(title, body, actions) {
  return new Promise((done) => {
    const d = el('dialog', {},
      el('h2', {}, title),
      el('div', { class: 'dialog-body' }, body),
      el('div', { class: 'row-actions' }, actions.map(([label, value, cls]) => el('button', {
        class: cls ?? '',
        onclick() { d.close(); done(value); },
      }, label))));
    d.addEventListener('close', () => { d.remove(); done(null); });
    document.body.append(d);
    d.showModal();
  });
}

// ---------- library ----------

async function refresh() {
  state.own = (await store.all('games')).sort((a, b) => a.title.localeCompare(b.title));
  state.lists = await store.all('lists');
}

const SHAREWARE = {
  id: 'doom-shareware', title: 'Doom (shareware episode)', system: 'doom', core: 'doom', builtIn: true, fileName: 'doom1.wad',
  year: 1993, license: 'id Software shareware licence: free to copy unmodified, never for money',
};
const ref = (g) => (g.builtIn ? `cat:${g.id}` : g.sha256 ? `cat:${g.id}` : `own:${g.id}`);
function fromRef(r) {
  const [kind, id] = [r.slice(0, 3), r.slice(4)];
  if (id === SHAREWARE.id) return SHAREWARE;
  return kind === 'cat' ? state.catalog.find((g) => g.id === id) : state.own.find((g) => g.id === id);
}

function matchOwn(row) {
  const names = [row.title, row.rom].filter(Boolean).map(normaliseTitle);
  return state.own.find((g) => g.linked === row.rank
    || (row.system === 'doom' && g.system === 'doom')
    || (!g.linked && g.system === row.system && (names.includes(normaliseTitle(g.fileName)) || names.includes(normaliseTitle(g.title)))));
}

async function unpackZip(file, bytes, row) {
  const entries = listZip(bytes);
  const stem = file.name.replace(/\.zip$/i, '');
  const files = entries.filter((e) => !['txt', 'nfo', 'diz', 'md5', 'sfv'].includes(extOf(e.name)));
  // A single file inside means a wrapped ROM. Anything else is an arcade set.
  if (files.length === 1 && row?.system !== 'arcade') {
    const inner = await readEntry(bytes, files[0]);
    const c = classify(files[0].name, inner);
    if (c.kind === 'game' || c.kind === 'ask') return { bytes: inner, name: files[0].name.split('/').pop(), c };
  }
  const wad = entries.find((e) => extOf(e.name) === 'wad');
  if (wad) {
    return { bytes: await readEntry(bytes, wad), name: wad.name.split('/').pop(), c: { kind: 'game', system: 'doom' } };
  }
  return { bytes, name: `${stem}.zip`, c: { kind: 'game', system: 'arcade' } };
}

async function askSystem(name, options) {
  return dialog(`Which system is ${name} for?`, 'This file type is used by several systems, and its contents don\'t say which.',
    [...options.map((id) => [SYSTEMS[id].name, id]), ['Cancel', null, 'quiet']]);
}

async function addSave(file, bytes) {
  const games = [...state.own, ...state.catalog.filter((g) => g.system !== 'doom')];
  if (!games.length) { toast(`${file.name}: add a game first. A save state belongs to one game.`, 'bad'); return; }
  const select = el('select', { 'aria-label': 'Game' }, games.map((g) => el('option', { value: ref(g) }, g.title)));
  const ok = await dialog(`Attach ${file.name} to which game?`,
    [el('p', {}, 'Save states only work with the exact game and emulator that made them. An incompatible one can freeze the game until you reload.'), select],
    [['Attach save', true], ['Cancel', null, 'quiet']]);
  if (!ok) return;
  await store.putBytes(`state-${select.value}`, bytes);
  toast(`Attached save state to ${fromRef(select.value).title}`);
}

export async function addFiles(files, row = null) {
  const added = [];
  for (const file of files) {
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      let name = file.name;
      let c = classify(name, bytes);
      if (c.kind === 'save') { await addSave(file, bytes); continue; }
      if (c.kind === 'rejected') { toast(`${name}: ${c.reason}`, 'bad'); continue; }
      if (c.kind === 'archive') ({ bytes, name, c } = await unpackZip(file, bytes, row));
      let system = c.system;
      if (c.kind === 'ask') {
        system = row && c.options.includes(row.system) ? row.system : await askSystem(name, c.options);
        if (!system) continue;
      }
      if (row && SYSTEMS[row.system] && system !== row.system && !(row.system === 'gg' && system === 'sms')) {
        const go = await dialog(`This looks like a ${SYSTEMS[system].name} file`,
          `${row.title} was added to the list as a ${SYSTEMS[row.system].name} game. Keep this file for that row anyway?`,
          [['Keep it', true], ['Cancel', null, 'quiet']]);
        if (!go) continue;
      }
      const id = crypto.randomUUID();
      await store.putBytes(`game-${id}`, bytes);
      const game = {
        id, system, core: coreFor(system), fileName: name, size: bytes.length, added: Date.now(),
        title: row?.title ?? name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), linked: row?.rank ?? null,
      };
      await store.put('games', game);
      added.push(game);
      toast(`Added ${game.title} (${SYSTEM_NAMES[system]})`);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'bad');
    }
  }
  if (added.length) await store.persist();
  await refresh();
  render();
  return added;
}

let pendingRow = null;
function chooseFiles(row = null) {
  pendingRow = row;
  picker.click();
}
picker.addEventListener('change', () => {
  const files = [...picker.files];
  picker.value = '';
  const row = pendingRow;
  pendingRow = null;
  if (files.length) addFiles(files, row);
});
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});

// ---------- getting catalogue games ----------

async function postFetch(g) {
  const res = await fetch(`/api/fetch/${g.id}`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  g.cached = true;
}

async function ensureDownloaded(g) {
  if (g.cached) return true;
  const accepted = (await store.get('kv', 'mame-terms')) === true;
  if (g.nonCommercial && !accepted) {
    const ok = await dialog('For non-commercial use only',
      `The rights holders let MAME offer ${g.title} and its other free arcade games on the condition that they're used non-commercially.`,
      [['I understand, continue', true], ['Cancel', null, 'quiet']]);
    if (!ok) return false;
    await store.put('kv', true, 'mame-terms');
  }
  if (g.size > state.instantBytes) {
    const ok = await dialog(`Download ${g.title}?`, `${formatSize(g.size)} from ${g.source}. It is checked against its recorded fingerprint before it's kept.`,
      [[`Download ${formatSize(g.size)}`, true], ['Cancel', null, 'quiet']]);
    if (!ok) return false;
  }
  await postFetch(g);
  return true;
}

async function loadBytes(g) {
  if (g.builtIn) return null;
  if (g.sha256) {
    const res = await fetch(`/api/games/${g.id}`);
    if (!res.ok) throw new Error((await res.json()).error);
    return new Uint8Array(await res.arrayBuffer());
  }
  const bytes = await store.getBytes(`game-${g.id}`);
  if (!bytes) throw new Error(`${g.title}'s file is missing from this browser. Add it again.`);
  return bytes;
}

// ---------- player ----------

let player = null;

function closePlayer() {
  if (!player) return;
  player.overlay.remove();
  removeEventListener('message', player.onMessage);
  player = null;
  document.body.classList.remove('playing');
  render();
}

async function saveCurrentState(bytes) {
  await store.putBytes(`state-${player.key}`, bytes);
  player.hasState = true;
  player.loadBtn.disabled = false;
  toast('State saved');
}

async function play(g, queue = null) {
  if (g.system === 'doom3') { launchDoom3(); return; }
  closePlayer();
  const status = el('p', { class: 'player-status' }, `Getting ${g.title} ready`);
  try {
    if (g.sha256 && !(await ensureDownloaded(g))) return;
    let bytes = await loadBytes(g);
    let { fileName } = g;
    if (g.wad) {
      const entries = listZip(bytes);
      const wad = entries.find((e) => e.name.toLowerCase().endsWith(`/${g.wad}`) || e.name.toLowerCase() === g.wad);
      if (!wad) throw new Error(`${g.wad} wasn't found in the download.`);
      bytes = await readEntry(bytes, wad);
      fileName = g.wad;
    }
    const doom = g.system === 'doom';
    const key = ref(g);
    const saved = doom ? null : await store.getBytes(`state-${key}`);
    const doomSaves = {};
    if (doom) {
      for (let slot = 0; slot < 6; slot++) {
        const b = await store.getBytes(`doomsave-${key}-${slot}`);
        if (b) doomSaves[slot] = b;
      }
    }
    const loadBtn = el('button', { disabled: !saved, onclick: async () => {
      const b = await store.getBytes(`state-${key}`);
      frame.contentWindow.postMessage({ type: 'load-state', bytes: b }, '*', [b.buffer]);
      frame.focus();
    } }, 'Load state');
    const frame = el('iframe', {
      src: doom ? '/doom.html' : '/play.html',
      sandbox: 'allow-scripts allow-pointer-lock',
      allow: 'autoplay; fullscreen; gamepad; screen-wake-lock',
      title: `${g.title} game screen`,
    });
    const next = queue && queue.index + 1 < queue.items.length
      ? el('button', { onclick: () => play(fromRef(queue.items[queue.index + 1]), { ...queue, index: queue.index + 1 }) },
        `Next: ${fromRef(queue.items[queue.index + 1])?.title ?? 'missing game'}`)
      : null;
    const overlay = el('section', { class: 'player', 'aria-label': `Playing ${g.title}` },
      el('header', {},
        el('button', { onclick: closePlayer }, 'Back to games'),
        el('h2', {}, g.title),
        doom ? null : el('button', { onclick: () => { frame.contentWindow.postMessage({ type: 'save-state' }, '*'); frame.focus(); } }, 'Save state'),
        doom ? null : loadBtn,
        next),
      g.system === 'arcade' && !g.sha256
        ? el('p', { class: 'player-hint' }, 'Seeing a menu or an error instead of the game? This ROM set doesn\'t match the emulator. Go back and switch emulator in My games.')
        : null,
      el('div', { class: 'stage' }, frame, status));
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow) return;
      const m = e.data;
      if (m.type === 'frame-ready') {
        const transfer = bytes ? [bytes.buffer] : [];
        const msg = { type: 'load', bytes, fileName, core: g.core, title: g.title, saves: doomSaves };
        if (saved) { msg.state = saved; transfer.push(saved.buffer); }
        frame.contentWindow.postMessage(msg, '*', transfer);
      }
      if (m.type === 'started') { status.remove(); frame.focus(); }
      if (m.type === 'state') saveCurrentState(m.bytes);
      if (m.type === 'doom-save') store.putBytes(`doomsave-${key}-${m.slot}`, m.bytes);
      if (m.type === 'error') {
        status.textContent = `${g.title} couldn't start: ${m.message}`;
        status.classList.add('bad');
      }
    };
    player = { overlay, onMessage, key, loadBtn, frame };
    addEventListener('message', onMessage);
    document.body.classList.add('playing');
    document.body.append(overlay);
    if (!g.sha256 && !g.builtIn) store.put('games', { ...g, lastPlayed: Date.now() });
  } catch (err) {
    toast(`${g.title}: ${err.message}`, 'bad');
  }
}

async function launchDoom3() {
  const res = await fetch('/api/doom3/launch', { method: 'POST' });
  const body = await res.json();
  if (res.ok) toast('Doom III started in its own window');
  else toast(body.error, 'bad');
}

// ---------- shared pieces ----------

function addToListMenu(g) {
  return el('button', { class: 'quiet', onclick: async () => {
    const select = el('select', { 'aria-label': 'List' }, state.lists.map((l) => el('option', { value: l.id }, l.name)));
    const name = el('input', { placeholder: 'New list name', 'aria-label': 'New list name', maxlength: 60 });
    const ok = await dialog(`Add ${g.title} to a list`, [state.lists.length ? select : null, name],
      [['Add to list', true], ['Cancel', null, 'quiet']]);
    if (!ok) return;
    let list = state.lists.find((l) => l.id === select.value && !name.value.trim());
    list ??= { id: crypto.randomUUID(), name: name.value.trim() || 'My list', items: [] };
    list.items.push(ref(g));
    await store.put('lists', list);
    await refresh();
    toast(`Added to ${list.name}`);
  } }, 'Add to list');
}

function gameRow(g) {
  const noteParts = g.sha256
    ? [SYSTEM_NAMES[g.system], g.year, formatSize(g.size), g.license]
    : [SYSTEM_NAMES[g.system], formatSize(g.size), g.fileName];
  const big = g.sha256 && !g.cached && g.size > state.instantBytes;
  return el('li', { class: 'game' },
    el('div', { class: 'game-name' },
      el('strong', {}, g.title),
      el('small', {}, noteParts.filter(Boolean).join(', '))),
    el('div', { class: 'row-actions' },
      g.system === 'arcade' && !g.sha256 ? el('select', {
        'aria-label': `Arcade emulator for ${g.title}`,
        onchange: async (e) => { await store.put('games', { ...g, core: e.target.value }); await refresh(); render(); toast(`${g.title} now uses ${e.target.value}`); },
      }, ARCADE_CORES.map((c) => el('option', { value: c, selected: c === g.core }, c))) : null,
      addToListMenu(g),
      !g.sha256 ? el('button', { class: 'quiet', onclick: async () => {
        const ok = await dialog(`Remove ${g.title}?`, 'This deletes the file and its save state from this browser.', [['Remove', true], ['Cancel', null, 'quiet']]);
        if (!ok) return;
        await store.delBytes(`game-${g.id}`);
        await store.delBytes(`state-own:${g.id}`);
        await store.del('games', g.id);
        await refresh();
        render();
      } }, 'Remove') : null,
      el('button', { class: 'play', onclick: () => play(g) }, big ? `Download ${formatSize(g.size)}` : 'Play')));
}

function titleAction(row) {
  if (row.system === 'doom3') {
    return state.doom3?.ready
      ? el('button', { class: 'play', onclick: launchDoom3 }, 'Play')
      : el('button', { onclick: () => { location.hash = '#/doom3'; } }, 'Set up');
  }
  const own = matchOwn(row);
  if (own) return el('button', { class: 'play', onclick: () => play(own) }, 'Play');
  return el('button', { onclick: () => chooseFiles(row) }, 'Add your copy');
}

// ---------- views ----------

const NAMED = ['Doom', 'Doom III', 'Pac-Man', 'Street Fighter II: The World Warrior', 'Donkey Kong', 'Sonic the Hedgehog 2', 'Streets of Rage 2'];

function homeView() {
  const named = NAMED.map((t) => state.top.find((r) => r.title === t)).filter(Boolean);
  const crt = el('button', { class: 'tube', 'aria-label': 'Open terminal mode', onclick: () => { location.hash = '#/terminal'; } });
  stopAttract = mountAttract(crt);
  const freedoom = state.catalog.find((g) => g.id === 'freedoom');
  const lineup = el('ol', { class: 'lineup' },
    named.map((row) => el('li', {},
      el('span', { class: 'lineup-title' }, row.title),
      el('small', {}, `${SYSTEM_NAMES[row.system]}, ${row.year}`),
      titleAction(row))));
  const shelf = ['gb', 'nes', 'md', 'gba', 'arcade'].map((sys) => shelfFor(sys));
  return [
    el('section', { class: 'hero' },
      el('div', { class: 'cabinet' }, crt, el('p', {}, 'Six games that run in a terminal. Nothing to download.')),
      el('div', { class: 'lineup-panel' },
        el('h2', {}, 'Your line-up'),
        el('p', {}, 'These are still sold or owned by their publishers, so retro-zip plays your own copy. Add the file and it stays in this browser.'),
        lineup,
        el('p', { class: 'aside' }, 'No Doom file? ',
          el('button', { class: 'link', onclick: () => play(SHAREWARE) }, 'Play the shareware episode'),
          ' now (built in, no sound), or ',
          freedoom ? el('button', { class: 'link', onclick: () => play(freedoom) }, 'Freedoom') : null,
          freedoom ? `, a free game for the same engine (${formatSize(freedoom.size)}).` : '.'),
        el('p', { class: 'aside' }, `Shareware episode: ${SHAREWARE.license}.`))),
    el('section', { class: 'free' },
      el('h2', {}, 'Free to play now'),
      el('p', {}, 'Homebrew and arcade games whose authors allow free downloads. Small ones start straight away. Each file is checked against a recorded fingerprint first.'),
      shelf),
  ];
}

function shelfFor(sys) {
  const games = state.catalog.filter((g) => g.system === sys);
  if (!games.length) return null;
  return el('div', { class: 'shelf' }, el('h3', {}, SYSTEM_NAMES[sys]), el('ul', { class: 'games' }, games.map(gameRow)));
}

function libraryView() {
  const q = el('input', { type: 'search', placeholder: 'Search your games', 'aria-label': 'Search your games' });
  const sys = el('select', { 'aria-label': 'Filter by system' },
    el('option', { value: '' }, 'All systems'),
    [...new Set(state.own.map((g) => g.system))].map((s) => el('option', { value: s }, SYSTEM_NAMES[s])));
  const list = el('ul', { class: 'games' });
  const draw = () => {
    const needle = q.value.toLowerCase();
    list.replaceChildren(...state.own
      .filter((g) => (!sys.value || g.system === sys.value) && g.title.toLowerCase().includes(needle))
      .map(gameRow));
  };
  q.addEventListener('input', draw);
  sys.addEventListener('change', draw);
  draw();
  return [el('section', { class: 'page' },
    el('h2', {}, 'My games'),
    el('p', {}, 'Drop game files anywhere on this page. They stay in this browser and are never uploaded.'),
    el('p', { class: 'formats' }, 'Accepted: .nes .sfc .smc .gb .gbc .gba .md .gen .smd .bin .sms .gg .a26 .iso .cue .chd .pbp .wad .zip and more. A .state file attaches to a game. .rvz files (GameCube and Wii) can\'t run in a browser.'),
    el('div', { class: 'row-actions left' }, el('button', { class: 'play', onclick: () => chooseFiles() }, 'Add game files')),
    state.own.length
      ? [el('div', { class: 'filters' }, q, sys), list]
      : el('p', { class: 'empty' }, 'No games yet. Add a file, or play something free from the home page.'))];
}

function topView() {
  const q = el('input', { type: 'search', placeholder: 'Search 500 titles', 'aria-label': 'Search the top 500' });
  const sys = el('select', { 'aria-label': 'Filter by system' },
    el('option', { value: '' }, 'All systems'),
    [...new Set(state.top.map((r) => r.system))].map((s) => el('option', { value: s }, SYSTEM_NAMES[s])));
  const body = el('ol', { class: 'scores' });
  const PAGE = 100;
  let shown = PAGE;
  const more = el('button', { onclick: () => { shown += PAGE; draw(); } }, 'Show 100 more');
  const draw = () => {
    const needle = normaliseTitle(q.value);
    const rows = state.top.filter((r) => (!sys.value || r.system === sys.value) && normaliseTitle(r.title).includes(needle));
    body.replaceChildren(...rows.slice(0, shown).map((r) => el('li', {},
      el('span', { class: 'rank' }, String(r.rank).padStart(3, '0')),
      el('span', { class: 'score-title' }, r.title),
      el('span', { class: 'score-meta' }, `${SYSTEM_NAMES[r.system]}, ${r.year}`),
      titleAction(r))));
    more.hidden = rows.length <= shown;
  };
  q.addEventListener('input', () => { shown = PAGE; draw(); });
  sys.addEventListener('change', () => { shown = PAGE; draw(); });
  draw();
  return [el('section', { class: 'page table' },
    el('h2', {}, 'Top 500'),
    el('p', {}, 'A ranking picked for retro-zip, not an official chart. These games are under copyright, so each row plays your own copy once you add it. Arcade rows need the ROM set that matches the emulator, and you can switch emulator in My games.'),
    el('div', { class: 'filters' }, q, sys),
    body, more)];
}

function listsView() {
  const name = el('input', { placeholder: 'List name', 'aria-label': 'List name', maxlength: 60 });
  const create = async () => {
    if (!name.value.trim()) return;
    await store.put('lists', { id: crypto.randomUUID(), name: name.value.trim(), items: [] });
    await refresh();
    render();
  };
  return [el('section', { class: 'page' },
    el('h2', {}, 'Lists'),
    el('p', {}, 'Line up games and play through them in order. Use Add to list on any game.'),
    el('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); create(); } }, name, el('button', {}, 'Create list')),
    state.lists.length ? state.lists.map(listBlock) : el('p', { class: 'empty' }, 'No lists yet. Name one above to start.'))];
}

function listBlock(list) {
  const save = async () => { await store.put('lists', list); await refresh(); render(); };
  const items = list.items.map((r, i) => {
    const g = fromRef(r);
    const swap = (j) => { [list.items[i], list.items[j]] = [list.items[j], list.items[i]]; save(); };
    return el('li', { class: 'game' },
      el('div', { class: 'game-name' },
        el('strong', {}, g?.title ?? 'Missing game'),
        el('small', {}, g ? SYSTEM_NAMES[g.system] : 'This game was removed')),
      el('div', { class: 'row-actions' },
        el('button', { class: 'quiet', disabled: i === 0, 'aria-label': `Move ${g?.title ?? 'game'} up`, onclick: () => swap(i - 1) }, 'Up'),
        el('button', { class: 'quiet', disabled: i === list.items.length - 1, 'aria-label': `Move ${g?.title ?? 'game'} down`, onclick: () => swap(i + 1) }, 'Down'),
        el('button', { class: 'quiet', onclick: () => { list.items.splice(i, 1); save(); } }, 'Remove'),
        g ? el('button', { onclick: () => play(g, { items: list.items, index: i }) }, 'Play') : null));
  });
  const first = list.items.findIndex(fromRef);
  return el('div', { class: 'shelf' },
    el('div', { class: 'list-head' },
      el('h3', {}, list.name),
      el('div', { class: 'row-actions' },
        first >= 0 ? el('button', { class: 'play', onclick: () => play(fromRef(list.items[first]), { items: list.items, index: first }) }, 'Play list') : null,
        el('button', { class: 'quiet', onclick: async () => { await store.del('lists', list.id); await refresh(); render(); } }, 'Delete list'))),
    items.length ? el('ol', { class: 'games' }, items) : el('p', { class: 'empty' }, 'Nothing in this list yet.'));
}

function doom3View() {
  const s = state.doom3 ?? {};
  const path = el('input', { placeholder: '/Users/you/Games/Doom 3', 'aria-label': 'Doom 3 folder', value: s.data ?? '' });
  return [el('section', { class: 'page' },
    el('h2', {}, 'Doom III'),
    el('p', {}, 'Doom III is too heavy for a browser, so retro-zip starts it as a Mac app using dhewm3, an open-source engine, and your own game files.'),
    el('ol', { class: 'steps' },
      el('li', { class: s.engine ? 'done' : '' }, s.engine ? 'The engine is built.' : 'Build the engine once. In a terminal, in the retro-zip folder, run scripts/build-dhewm3.sh'),
      el('li', { class: s.data ? 'done' : '' }, s.data ? `Game files found in ${s.data}` : 'Point retro-zip at the folder that contains "base" with pak000.pk4 to pak008.pk4, from your Steam or GOG copy.')),
    el('form', { class: 'filters', onsubmit: async (e) => {
      e.preventDefault();
      const res = await fetch('/api/doom3/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.value.trim() }) });
      const body = await res.json();
      if (!res.ok) { toast(body.error, 'bad'); return; }
      state.doom3 = body;
      render();
    } }, path, el('button', {}, 'Use this folder')),
    el('div', { class: 'row-actions left' }, el('button', { class: 'play', disabled: !s.ready, onclick: launchDoom3 }, 'Start Doom III')))];
}

const VIEWS = { '': homeView, games: libraryView, top: topView, lists: listsView, doom3: doom3View };

function render() {
  if (player) return;
  stopAttract?.();
  stopAttract = null;
  const route = location.hash.replace(/^#\/?/, '');
  if (route === 'terminal') {
    document.body.classList.add('terminal-mode');
    root.replaceChildren();
    openTerminal(root, () => { location.hash = '#/'; });
    return;
  }
  document.body.classList.remove('terminal-mode');
  const view = VIEWS[route] ?? homeView;
  const navItems = [['#/', 'Play', ''], ['#/games', 'My games', 'games'], ['#/lists', 'Lists', 'lists'], ['#/top', 'Top 500', 'top']];
  root.replaceChildren(
    el('header', { class: 'marquee' },
      el('a', { class: 'wordmark', href: '#/', 'aria-label': 'retro-zip home' }, 'RETRO-ZIP'),
      el('nav', { 'aria-label': 'Main' },
        navItems.map(([href, label, r]) => el('a', { href, 'aria-current': route === r ? 'page' : null }, label)),
        el('a', { class: 'mode', href: '#/terminal' }, 'Terminal mode'))),
    el('main', {}, view()),
    el('footer', {}, 'retro-zip is free software under the GPL-3.0. It is not affiliated with any game publisher.'));
}

addEventListener('hashchange', () => { closePlayer(); render(); });

async function boot() {
  const [cat, top, doom3] = await Promise.all([
    fetch('/api/catalog').then((r) => r.json()),
    fetch('/data/top500.json').then((r) => r.json()),
    fetch('/api/doom3').then((r) => r.json()),
  ]);
  state.catalog = cat.games;
  state.instantBytes = cat.instantBytes;
  state.top = top;
  state.doom3 = doom3;
  await refresh();
  render();
}

boot().catch((err) => {
  root.replaceChildren(el('section', { class: 'page' }, el('h2', {}, 'retro-zip could not start'), el('p', {}, err.message)));
});
