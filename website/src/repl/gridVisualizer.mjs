// Bridges the Grid's running patterns to the visualizer popup.
//
// This used to go through Tauri's cross-window event bus, back when the
// visualizer opened as a separate native OS window (a webview with no
// shared memory with the main one). It's a plain in-window popup now (see
// GridVisualizerPopup.jsx -- "I think we need... something colorfull and
// 3D... visualisation shold not open as a seprate brawser window but as a
// movable popup DIV"), so it's the same JS realm as the Grid: a tiny
// pub/sub is all that's needed, no serialization, no Tauri, and it works
// in the plain web REPL build too, not just the desktop app.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const listeners = new Set();
let hookInstalled = false;

// Reduce a Strudel hap to a small plain object. hap.value can be a
// string (sample name), a number, or an object with note/n/s/gain/etc --
// normalize all of those shapes here so the visualizer never has to know
// about Strudel's internal Hap/Fraction types.
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

// Installs window.__strudelGridVisualizerHook once -- GridTab.jsx's
// combined buffer calls this via `all(x => x.onTrigger(...))` (see
// buildCombinedCode) once per hap trigger, whether or not the popup is
// currently open or anyone is subscribed. Idempotent and safe to call
// from more than one place.
export function ensureVisualizerHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  window.__strudelGridVisualizerHook = (hap) => {
    if (listeners.size === 0) return;
    const payload = sanitizeHap(hap);
    listeners.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error('[gridVisualizer] hap listener threw', e);
      }
    });
  };
}

// Subscribes to sanitized hap payloads; returns an unsubscribe function.
export function subscribeHaps(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Whether the visualizer popup is open. A plain in-memory atom (not
// sessionStorage-backed like patternGrid.mjs's panel toggles) -- there's
// no strong reason for "was the visualizer open" to survive a reload,
// and keeping it simple avoids a second sessionAtom helper here.
const $popupOpen = atom(false);
export const useVisualizerPopupOpen = () => useStore($popupOpen);
export const openVisualizerPopup = () => $popupOpen.set(true);
export const closeVisualizerPopup = () => $popupOpen.set(false);
export const toggleVisualizerPopup = () => $popupOpen.set(!$popupOpen.get());

// Live-customizable visual settings, read by GridVisualizer3D.jsx and
// written by VisualizerControls in GridToolsPanel.jsx -- so nudging, say,
// the bloom slider takes effect on the running scene immediately rather
// than needing the popup reopened.
const DEFAULT_VISUALIZER_SETTINGS = {
  palette: 'spectrum', // 'spectrum' | 'mono' | 'fire'
  intensity: 1, // burst size/particle-count multiplier
  bloom: 1.2, // post-processing bloom strength
};
const $visualizerSettings = atom(DEFAULT_VISUALIZER_SETTINGS);
export const useVisualizerSettings = () => useStore($visualizerSettings);
export const setVisualizerSetting = (key, value) => {
  $visualizerSettings.set({ ...$visualizerSettings.get(), [key]: value });
};
