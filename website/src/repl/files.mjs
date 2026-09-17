import {
  processSampleMap,
  registerSamplesPrefix,
  registerSound,
  onTriggerSample,
  getAudioContext,
  loadBuffer,
} from '@strudel/webaudio';

import {
  BaseDirectory,
  readDir as fsReadDir,
  readFile as fsReadFile,
  writeTextFile as fsWriteTextFile,
  readTextFile as fsReadTextFile,
  exists as fsExists,
} from '@tauri-apps/plugin-fs';
import { open as fsOpenDialog } from '@tauri-apps/plugin-dialog';

// Thin wrappers matching the previous (Tauri v1 global-API) call shape used
// throughout this file, i.e. fn(path, { dir, recursive }) instead of v2's
// fn(path, { baseDir, recursive }), and readBinaryFile -> readFile (v2 rename).
const dirOpt = (opts) => (opts?.dir != null ? { ...opts, baseDir: opts.dir, dir: undefined } : opts);
export const readDir = (path, opts) => fsReadDir(path, dirOpt(opts));
export const readBinaryFile = (path, opts) => fsReadFile(path, dirOpt(opts));
export const writeTextFile = (path, data, opts) => fsWriteTextFile(path, data, dirOpt(opts));
export const readTextFile = (path, opts) => fsReadTextFile(path, dirOpt(opts));
export const exists = (path, opts) => fsExists(path, dirOpt(opts));
export const openDialog = fsOpenDialog;

export { BaseDirectory };
export const dir = BaseDirectory?.Audio; // https://v2.tauri.app/reference/javascript/fs/#basedirectory
const prefix = '~/music/';

async function hasStrudelJson(subpath) {
  return exists(subpath + '/strudel.json', { dir });
}

async function loadStrudelJson(subpath) {
  const contents = await readTextFile(subpath + '/strudel.json', { dir });
  const sampleMap = JSON.parse(contents);
  processSampleMap(sampleMap, (key, bank) => {
    registerSound(key, (t, hapValue, onended) => onTriggerSample(t, hapValue, onended, bank, fileResolver(subpath)), {
      type: 'sample',
      samples: bank,
      fileSystem: true,
      tag: 'local',
    });
  });
}

async function writeStrudelJson(subpath) {
  const children = await readDir(subpath, { dir, recursive: true });
  const name = subpath.split('/').slice(-1)[0];
  const tree = { name, children };

  let samples = {};
  let count = 0;
  walkFileTree(tree, (entry, parent) => {
    if (['wav', 'mp3'].includes(entry.name.split('.').slice(-1)[0])) {
      samples[parent.name] = samples[parent.name] || [];
      count += 1;
      samples[parent.name].push(entry.subpath.slice(1).concat([entry.name]).join('/'));
    }
  });
  const json = JSON.stringify(samples, null, 2);
  const filepath = subpath + '/strudel.json';
  await writeTextFile(filepath, json, { dir });
  console.log(`wrote strudel.json with ${count} samples to ${subpath}!`);
}

registerSamplesPrefix(prefix, async (path) => {
  const subpath = path.replace(prefix, '');
  const hasJson = await hasStrudelJson(subpath);
  if (!hasJson) {
    await writeStrudelJson(subpath);
  }
  return loadStrudelJson(subpath);
});

export const walkFileTree = (node, fn) => {
  if (!Array.isArray(node?.children)) {
    return;
  }
  for (const entry of node.children) {
    entry.subpath = (node.subpath || []).concat([node.name]);
    fn(entry, node);
    if (entry.children) {
      walkFileTree(entry, fn);
    }
  }
};

export const isAudioFile = (filename) =>
  ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac'].includes(filename.split('.').slice(-1)[0]);

function uint8ArrayToDataURL(uint8Array) {
  const blob = new Blob([uint8Array], { type: 'audio/*' });
  const dataURL = URL.createObjectURL(blob);
  return dataURL;
}

const loadCache = {}; // caches local urls to data urls

// NEW: like resolveFileURL, but for an absolute path (no BaseDirectory scope).
// Used for folders picked via the native dialog, which can live anywhere
// the fs allowlist scope permits (see src-tauri/tauri.conf.json -> fs.scope;
// currently "$HOME/**", so anywhere under the user's home directory).
export async function resolveAbsoluteFileURL(absPath) {
  if (loadCache[absPath]) {
    return loadCache[absPath];
  }
  loadCache[absPath] = (async () => {
    const contents = await readBinaryFile(absPath); // no `dir` -> treated as absolute path
    return uint8ArrayToDataURL(contents);
  })();
  return loadCache[absPath];
}

export async function resolveFileURL(url) {
  if (loadCache[url]) {
    return loadCache[url];
  }
  loadCache[url] = (async () => {
    const contents = await readBinaryFile(url, { dir });
    return uint8ArrayToDataURL(contents);
  })();
  return loadCache[url];
}

const fileResolver = (subpath) => (url) => resolveFileURL(subpath.endsWith('/') ? subpath + url : subpath + '/' + url);
const absoluteFileResolver = (subpath) => (url) =>
  resolveAbsoluteFileURL(subpath.endsWith('/') ? subpath + url : subpath + '/' + url);

export async function playFile(path) {
  const url = await resolveFileURL(path);
  const ac = getAudioContext();
  const bufferSource = ac.createBufferSource();
  bufferSource.buffer = await loadBuffer(url, ac);
  bufferSource.connect(ac.destination);
  bufferSource.start(ac.currentTime);
}

// NEW: play a file given its absolute path (for browsed, non-~/music folders).
export async function playAbsoluteFile(absPath) {
  const url = await resolveAbsoluteFileURL(absPath);
  const ac = getAudioContext();
  const bufferSource = ac.createBufferSource();
  bufferSource.buffer = await loadBuffer(url, ac);
  bufferSource.connect(ac.destination);
  bufferSource.start(ac.currentTime);
}

// NEW: open a native folder picker, not limited to ~/music.
// Returns the chosen absolute path, or null if cancelled.
export async function pickFolder() {
  if (!openDialog) return null; // not running in Tauri
  const selected = await openDialog({ directory: true, multiple: false });
  return selected || null;
}

// NEW: recursively list a folder given an absolute path (no BaseDirectory).
export async function readAbsoluteDir(absPath) {
  return readDir(absPath, { recursive: true });
}

// NEW: register every subfolder of an arbitrarily-picked absolute folder as
// a sample bank, the same way writeStrudelJson/loadStrudelJson do for
// ~/music, but working from an absolute path and without touching disk
// (no strudel.json is written into folders you don't own/expect writes in).
// Bank name = subfolder name, exactly like the existing ~/music behavior,
// so `n("0 1 2").s("<subfolder-name>")` works immediately after browsing.
export async function registerAbsoluteFolder(absPath) {
  const children = await readAbsoluteDir(absPath);
  const rootName = absPath.split(/[\\/]/).filter(Boolean).slice(-1)[0] || 'local';
  const tree = { name: rootName, children };

  const samples = {}; // bankName -> [absolute file paths]
  walkFileTree(tree, (entry, parent) => {
    if (isAudioFile(entry.name)) {
      const bank = parent.name;
      const fullSubpath = entry.subpath.slice(1).concat([entry.name]).join('/');
      const fileAbsPath = `${absPath}/${fullSubpath}`;
      samples[bank] = samples[bank] || [];
      samples[bank].push(fileAbsPath);
    }
  });

  let count = 0;
  Object.entries(samples).forEach(([bank, files]) => {
    count += files.length;
    // files are already absolute paths here, so the resolver is the identity
    // (resolveAbsoluteFileURL handles the actual read).
    registerSound(
      bank,
      (t, hapValue, onended) =>
        onTriggerSample(t, hapValue, onended, files.map((f) => f.split('/').pop()), absoluteFileResolver(absPath)),
      { type: 'sample', samples: files, fileSystem: true, tag: 'local-browsed' },
    );
  });
  console.log(`registered ${count} samples from ${Object.keys(samples).length} banks in ${absPath}`);
  return { rootName, bankCount: Object.keys(samples).length, sampleCount: count, tree };
}
