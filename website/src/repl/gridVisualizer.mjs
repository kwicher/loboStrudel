// Bridges the Grid's running patterns to the separate 3D visualizer window.
//
// Two pieces, both safe no-ops outside Tauri (checked via isTauri() from
// ../tauri.mjs so the web REPL build never touches these modules' Tauri
// imports):
//
// 1. ensureVisualizerHook() installs a single global hook,
//    window.__strudelGridVisualizerHook, that GridTab.jsx's combined buffer
//    calls once per hap trigger (see buildCombinedCode's `all(x =>
//    x.onTrigger(...))` line). This function turns a Strudel hap into a
//    small plain object and emits it as a 'grid-hap' Tauri event -- the
//    only channel between the main window and the visualizer window, since
//    two webviews are two separate JS realms with no shared memory.
//
// 2. openVisualizerWindow() opens (or focuses, if already open) the
//    'grid-visualizer' native window, which loads /visualizer -- a bare
//    Astro page (see src/pages/visualizer.astro) that mounts
//    GridVisualizer3D.jsx and listens for the same 'grid-hap' event.
import { isTauri } from '../tauri.mjs';

const HAP_EVENT = 'grid-hap';
const VISUALIZER_LABEL = 'grid-visualizer';

let hookInstalled = false;
let emitFn = null;

// Reduce a Strudel hap to a small, structured-clone-safe plain object.
// hap.value can be a string (sample name), a number, or an object with
// note/n/s/gain/etc -- normalize all of those shapes here so the visualizer
// never has to know about Strudel's internal Hap/Fraction types.
function sanitizeHap(hap) {
  const value = hap?.value;
  if (value == null) return {};
  if (typeof value === 'string') return { s: value };
  if (typeof value === 'number') return { note: value };
  const { note, n, s, gain } = value;
  const out = {};
  if (typeof note === 'number') out.note = note;
  if (typeof n === 'number') out.n = n;
  if (typeof s === 'string') out.s = s;
  if (typeof gain === 'number') out.gain = gain;
  return out;
}

export function ensureVisualizerHook() {
  if (!isTauri() || hookInstalled) return;
  hookInstalled = true;
  window.__strudelGridVisualizerHook = (hap) => {
    if (!emitFn) return; // event module still loading -- drop this hap rather than block audio
    const payload = sanitizeHap(hap);
    emitFn(HAP_EVENT, payload).catch(() => {});
  };
  import('@tauri-apps/api/event')
    .then(({ emit }) => {
      emitFn = emit;
    })
    .catch(() => {});
}

export async function openVisualizerWindow() {
  if (!isTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(VISUALIZER_LABEL);
  if (existing) {
    existing.setFocus().catch(() => {});
    return;
  }
  const win = new WebviewWindow(VISUALIZER_LABEL, {
    url: '/visualizer',
    title: 'Strudel Grid Visualizer',
    width: 900,
    height: 600,
    resizable: true,
  });
  win.once('tauri://error', (e) => {
    console.error('failed to open grid visualizer window', e);
  });
}
