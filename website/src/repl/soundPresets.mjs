// Saved sound+parameter presets from the Sounds-browser preview popup --
// deliberately separate from soundFavorites.mjs (which favorites a bare
// sample/bank name with tags) since a preset also carries the full set of
// preview sliders (gain, cutoff, envelope, lfo, fx...), not just a name.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const STORAGE_KEY = 'strudel_sound_presets';

function load() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[soundPresets] failed to load', e);
    return {};
  }
}

// { [id]: { id, name, sound, n, note, params: {...}, createdAt } }
export const $soundPresets = atom(load());

function persist(next) {
  $soundPresets.set(next);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[soundPresets] failed to save', e);
    }
  }
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// params: only the sliders the user actually touched (callers already omit
// anything still at its default), so a preset never freezes in values the
// user never set.
export function savePreset({ name, sound, n, note, params }) {
  const id = makeId();
  const current = { ...$soundPresets.get() };
  current[id] = { id, name: name?.trim() || sound, sound, n, note, params: { ...params }, createdAt: Date.now() };
  persist(current);
  return id;
}

export function deletePreset(id) {
  const current = { ...$soundPresets.get() };
  delete current[id];
  persist(current);
}

export function renamePreset(id, name) {
  const current = { ...$soundPresets.get() };
  if (current[id]) {
    current[id] = { ...current[id], name: name?.trim() || current[id].name };
    persist(current);
  }
}

export function listPresets() {
  return Object.values($soundPresets.get()).sort((a, b) => b.createdAt - a.createdAt);
}

export function useSoundPresets() {
  return useStore($soundPresets);
}

// The order params render in when chained into a pattern string, chosen to
// read naturally (sound identity, then envelope, then fx, then lfo). Keys
// here are the *real* Strudel pattern method names (verified against
// packages/core/controls.mjs), so the string this builds is directly
// pasteable, not an approximation.
const PARAM_ORDER = [
  'gain',
  'cutoff',
  'speed',
  'pan',
  'attack',
  'decay',
  'sustain',
  'release',
  'room',
  'delay',
  'crush',
  'shape',
  'vib',
  'vibmod',
  'tremolo',
  'tremolodepth',
];

// A param's value can now come from the preview popup's "advanced" raw
// field instead of a slider, so it might be a plain number, a string, or a
// whole object (e.g. .pan({...})) -- render each kind the way it would
// actually need to be typed into a pattern, not just interpolated as-is
// (which would print a bare number fine but a string without quotes and an
// object as "[object Object]").
function renderArg(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function presetToPatternString(preset) {
  const { sound, n, note, params = {} } = preset;
  let str = note ? `note("${note}").s("${sound}")` : `s("${sound}${n ? ':' + n : ''}")`;
  const seen = new Set();
  PARAM_ORDER.forEach((key) => {
    seen.add(key);
    const value = params[key];
    if (value != null) {
      str += `.${key}(${renderArg(value)})`;
    }
  });
  // Anything left is either internal bookkeeping (__raw / __extra, which
  // start with "__" and are never real pattern params) or a param typed
  // into a GroupParamsBox that this popup has no slider for -- append those
  // too so the copied pattern string carries them, not just the sliders.
  Object.entries(params).forEach(([key, value]) => {
    if (seen.has(key) || key.startsWith('__') || value == null) return;
    str += `.${key}(${renderArg(value)})`;
  });
  return str;
}
