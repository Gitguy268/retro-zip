// Decides what a game file is from its extension and its first bytes.
// Used by the browser import, the download verifier and the tests.

export const SYSTEMS = {
  nes: { name: 'NES', core: 'fceumm', exts: ['nes', 'fds', 'unf'] },
  snes: { name: 'Super NES', core: 'snes9x', exts: ['sfc', 'smc', 'swc', 'fig'] },
  gb: { name: 'Game Boy', core: 'gambatte', exts: ['gb', 'gbc'] },
  gba: { name: 'Game Boy Advance', core: 'mgba', exts: ['gba', 'agb'] },
  md: { name: 'Mega Drive', core: 'genesis_plus_gx', exts: ['md', 'gen', 'smd', 'sgd'] },
  sms: { name: 'Master System', core: 'smsplus', exts: ['sms'] },
  gg: { name: 'Game Gear', core: 'genesis_plus_gx', exts: ['gg'] },
  a2600: { name: 'Atari 2600', core: 'stella2014', exts: ['a26'] },
  a7800: { name: 'Atari 7800', core: 'prosystem', exts: ['a78'] },
  lynx: { name: 'Atari Lynx', core: 'handy', exts: ['lnx'] },
  pce: { name: 'PC Engine', core: 'mednafen_pce', exts: ['pce', 'sgx'] },
  coleco: { name: 'ColecoVision', core: 'gearcoleco', exts: ['col'] },
  ngp: { name: 'Neo Geo Pocket', core: 'mednafen_ngp', exts: ['ngp', 'ngc'] },
  ws: { name: 'WonderSwan', core: 'mednafen_wswan', exts: ['ws', 'wsc'] },
  s32x: { name: 'Sega 32X', core: 'picodrive', exts: ['32x'] },
  arcade: { name: 'Arcade', core: 'fbneo', exts: [] },
  psx: { name: 'PlayStation', core: 'pcsx_rearmed', exts: ['pbp', 'cue', 'ccd', 'toc'] },
  segacd: { name: 'Sega CD', core: 'genesis_plus_gx', exts: [] },
  doom: { name: 'Doom', core: 'doom', exts: ['wad'] },
};

export const ARCADE_CORES = ['fbneo', 'mame2003_plus'];
const DISC_EXTS = ['iso', 'chd', 'img'];
const REJECTED = {
  rvz: 'RVZ files are GameCube and Wii discs. No emulator for those runs at a playable speed in a browser.',
  gcm: 'GCM files are GameCube discs. No emulator for those runs at a playable speed in a browser.',
  wbfs: 'WBFS files are Wii discs. No emulator for those runs at a playable speed in a browser.',
  exe: 'Programs can\'t be added. Only game files are accepted.',
  app: 'Programs can\'t be added. Only game files are accepted.',
  cso: 'CSO files are PSP discs, which retro-zip does not run.',
};

const ascii = (b, at, s) => {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};
const bytesAt = (b, at, arr) => b.length >= at + arr.length && arr.every((v, i) => b[at + i] === v);

// Returns the system a file's own header proves, or null when it has no signature.
export function sniff(b) {
  if (ascii(b, 0, 'NES\x1a') || ascii(b, 0, 'FDS\x1a')) return 'nes';
  if (bytesAt(b, 0x104, [0xce, 0xed, 0x66, 0x66])) return 'gb';
  if (bytesAt(b, 4, [0x24, 0xff, 0xae, 0x51]) && b[0xb2] === 0x96) return 'gba';
  if (ascii(b, 0x100, 'SEGA')) return 'md';
  for (const at of [0x7ff0, 0x3ff0, 0x1ff0]) if (ascii(b, at, 'TMR SEGA')) return 'sms';
  if (ascii(b, 0, 'IWAD') || ascii(b, 0, 'PWAD')) return 'doom';
  if (ascii(b, 0, '\0PBP')) return 'psx';
  if (ascii(b, 1, 'ATARI7800')) return 'a7800';
  if (ascii(b, 0, 'LYNX')) return 'lynx';
  return null;
}

export const isZip = (b) => ascii(b, 0, 'PK\x03\x04') || ascii(b, 0, 'PK\x05\x06');
export const isChd = (b) => ascii(b, 0, 'MComprHD');
const isIso = (b) => ascii(b, 0x8001, 'CD001') || ascii(b, 0x9319, 'CD001');

export const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
};

export const coreFor = (system) => SYSTEMS[system]?.core;

// kind: game | save | archive | ask | rejected. `ask` means the file is valid but
// only the player can say which system it belongs to.
export function classify(name, bytes) {
  const ext = extOf(name);
  if (ext === 'state') return { kind: 'save' };
  if (Object.hasOwn(REJECTED, ext) && REJECTED[ext]) return { kind: 'rejected', reason: REJECTED[ext] };
  if (ascii(bytes, 0, 'RVZ\x01') || ascii(bytes, 0, 'WIA\x01')) return { kind: 'rejected', reason: REJECTED.rvz };
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return { kind: 'rejected', reason: REJECTED.exe };
  if (ext === 'zip' || isZip(bytes)) return { kind: 'archive' };

  const sniffed = sniff(bytes);
  if (sniffed) return { kind: 'game', system: sniffed };
  if (ext === 'gg') return { kind: 'game', system: 'gg' };
  for (const [id, s] of Object.entries(SYSTEMS)) {
    if (s.exts.includes(ext) && ext !== 'wad') return { kind: 'game', system: id };
  }
  if (DISC_EXTS.includes(ext) || isChd(bytes) || isIso(bytes)) {
    return { kind: 'ask', options: ['psx', 'segacd'] };
  }
  if (ext === 'bin' || ext === 'rom') return { kind: 'ask', options: ['md', 'a2600', 'psx', 'segacd', 'gba', 'sms'] };
  return { kind: 'rejected', reason: `.${ext || 'unknown'} files aren't a game format retro-zip can play.` };
}

// Used for catalogue downloads: the bytes must match what the catalogue promised.
export function matchesDeclared(entry, bytes) {
  if (entry.format === 'zip') return isZip(bytes);
  const sniffed = sniff(bytes);
  if (entry.system === 'gb' || entry.system === 'gba' || entry.system === 'nes' || entry.system === 'md') {
    return sniffed === entry.system;
  }
  return sniffed === null || sniffed === entry.system;
}

export const normaliseTitle = (s) => String(s).toLowerCase()
  .replace(/\.[a-z0-9]{1,4}$/, '')
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/\b(the|ii)\b/g, (w) => (w === 'ii' ? '2' : ' '))
  .replace(/[^a-z0-9]+/g, '');
