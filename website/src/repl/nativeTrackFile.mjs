// Native (real filesystem) save/open for a whole Grid *track* as one file
// -- a track's ordered queue of patterns, bundled together, as opposed to
// nativePatternFile.mjs which is one pattern per file. The format is
// plain JSON: { version, name, entries: [{ title, cycles, code }] }, in
// queue order. Deliberately just data, no ids -- opening a track file
// always creates fresh patterns (and a fresh track) rather than trying to
// reconcile against whatever ids happen to already exist locally, which
// is what makes "share this file with someone else, or reopen it after
// deleting the original patterns" work correctly.
//
// Same isTauri()-gated, plugin-dialog/plugin-fs shape as
// nativePatternFile.mjs -- see that file's header comment for why.
import { isTauri as isTauriRuntime } from '../tauri.mjs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sanitizeFileName } from './nativePatternFile.mjs';

export const isTauri = isTauriRuntime;

const FILTERS = [{ name: 'Strudel Track', extensions: ['strudeltrack'] }];

// trackData: { version: 1, name, entries: [{ title, cycles, code }] }.
// Always prompts (there's no "linked path" bookkeeping for tracks, unlike
// patterns -- a track file is a one-shot export/import, not something
// that stays tied to the live track afterward).
export async function saveTrackFile(trackData, defaultName) {
  if (!isTauri()) return null;
  const target = await saveDialog({
    filters: FILTERS,
    defaultPath: `${sanitizeFileName(defaultName)}.strudeltrack`,
  });
  if (!target) return null;
  await writeTextFile(target, JSON.stringify(trackData, null, 2));
  return target;
}

// Returns { data, path } where data is the parsed { name, entries }
// object, or null if cancelled or the file isn't valid JSON (e.g.
// someone picked the wrong file) -- callers treat a null the same as a
// cancelled dialog rather than throwing into the UI.
export async function openTrackFile() {
  if (!isTauri()) return null;
  const selected = await openDialog({ multiple: false, filters: FILTERS });
  if (!selected) return null;
  try {
    const raw = await readTextFile(selected);
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.entries)) return null;
    return { data, path: selected };
  } catch {
    return null;
  }
}
