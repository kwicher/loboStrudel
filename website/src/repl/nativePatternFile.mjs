// Native (real filesystem) save/open for individual .strudel pattern files,
// as opposed to the existing browser-storage-backed userPattern flow and
// its all-patterns-in-one-JSON export/import (see user_pattern_utils.mjs).
//
// Uses the Tauri v2 plugin JS API (@tauri-apps/plugin-dialog,
// @tauri-apps/plugin-fs) — matches what website/package.json and
// src-tauri/Cargo.toml + capabilities/default.json now declare.
// isTauri() gates every call, so this is a safe no-op in the plain
// browser build (dialog/open just returns null there).
//
// This module only talks to the filesystem and the save/open dialogs --
// it doesn't know about patterns, titles, or which pattern is linked to
// which file. That bookkeeping is patternFileLink.mjs; AppSidebar.jsx is
// what wires the two together (see its openFile/saveFile).
import { isTauri as isTauriRuntime } from '../tauri.mjs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export const isTauri = isTauriRuntime;

const FILTERS = [{ name: 'Strudel Pattern', extensions: ['strudel', 'str'] }];

// Filesystem-safe version of a name for use as a default filename --
// strips characters that are illegal (or just awkward) in a filename on
// any of the platforms Tauri targets, collapses whitespace, and falls
// back to "untitled" for an empty name.
export function sanitizeFileName(name) {
  const cleaned = (name ?? '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'untitled';
}

// The filename a path would show in a tab, with the .strudel/.str
// extension stripped -- used both for a freshly-opened file's title and
// for re-titling a pattern after "save as" picks a new name.
export function basenameNoExt(path) {
  return (path ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.(strudel|str)$/i, '');
}

export async function openPatternFile() {
  if (!isTauri()) return null;
  const selected = await openDialog({ multiple: false, filters: FILTERS });
  if (!selected) return null;
  const code = await readTextFile(selected);
  return { code, path: selected };
}

// Reads a specific, already-known path directly, bypassing the open
// dialog -- what the "Recent patterns" popup uses to reopen files the
// user picked before, possibly several at once. Returns null (rather
// than throwing) if the file is missing or unreadable, e.g. it moved or
// was deleted since it was last opened -- callers use that to drop it
// from the recent list instead of leaving a dead entry.
export async function readPatternFileAt(path) {
  if (!isTauri() || !path) return null;
  try {
    const code = await readTextFile(path);
    return { code, path };
  } catch {
    return null;
  }
}

// path: the file this save should target, i.e. wherever this pattern is
// currently linked to (patternFileLink.mjs) -- pass null for a pattern
// that's never been saved before. Prompts with a save dialog (defaulting
// to defaultName) whenever there's no target yet, or forceDialog is set
// ("save as"); otherwise writes straight to path with no prompt. Returns
// the path actually written to (so the caller can (re)link the pattern to
// it), or null if the user cancelled the dialog.
export async function savePatternFile(code, { path = null, forceDialog = false, defaultName } = {}) {
  if (!isTauri()) return null;
  let target = path;
  if (!target || forceDialog) {
    target = await saveDialog({ filters: FILTERS, defaultPath: target ?? `${sanitizeFileName(defaultName)}.strudel` });
    if (!target) return null;
  }
  await writeTextFile(target, code);
  return target;
}
