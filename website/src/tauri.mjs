import { invoke, isTauri as isTauriOfficial } from '@tauri-apps/api/core';

export const Invoke = invoke;
// was: window.__TAURI_IPC__ != null -- that's the Tauri v1 flag name and
// never true under v2 (v2 uses window.__TAURI_INTERNALS__ for IPC, and its
// own official isTauri() checks a separate window.isTauri flag it injects
// for exactly this purpose). Use the real v2 API instead of guessing at
// internal globals.
export const isTauri = isTauriOfficial;
