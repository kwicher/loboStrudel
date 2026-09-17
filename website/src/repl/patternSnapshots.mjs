// Per-pattern "take" history: every time a pattern is evaluated (Ctrl/Alt-
// Enter, the update button, a vim/helix :w, ...) a timestamped snapshot of
// its full code is recorded here, so a bad edit or a wrong direction never
// has to mean the previous good version is gone. Deliberately backed by
// localStorage (like soundPresets.mjs), not sessionStorage -- a take from
// yesterday should still be there today.
//
// Extended per the SHARP research on version control for live coding
// (Manesh et al., C&C 2024): plain auto-history wasn't enough -- people
// also wanted a way to pin a take so it survives trimming, and a way to
// fork a past take into its own pattern to audition it without it silently
// overwriting what's currently live. See PatternTabs.jsx for the fork/pin
// UI built on top of this.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const STORAGE_KEY = 'strudel_pattern_snapshots';
// Keep this bounded per pattern -- live coding sessions evaluate constantly,
// and nobody needs 500 near-identical takes, just enough to step back a
// reasonable way. Pinned takes are exempt: they only ever leave the list if
// unpinned first.
const MAX_UNPINNED_PER_PATTERN = 25;

function load() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[patternSnapshots] failed to load', e);
    return {};
  }
}

// { [patternId]: [{ ts, code, pinned? }, ...] } -- newest last.
export const $snapshots = atom(load());

function persist(next) {
  $snapshots.set(next);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[patternSnapshots] failed to save', e);
    }
  }
}

// Drops the oldest UNPINNED entries once there are more than
// MAX_UNPINNED_PER_PATTERN of them, preserving relative order and never
// touching pinned ones.
function trim(list) {
  const unpinnedCount = list.filter((s) => !s.pinned).length;
  if (unpinnedCount <= MAX_UNPINNED_PER_PATTERN) return list;
  let toDrop = unpinnedCount - MAX_UNPINNED_PER_PATTERN;
  return list.filter((s) => {
    if (s.pinned || toDrop <= 0) return true;
    toDrop -= 1;
    return false;
  });
}

// Records a take, skipping it if it's identical to the most recent one on
// file (evaluating the same unchanged code repeatedly shouldn't spam the
// history) or the pattern has no id yet (example patterns before they fork
// into a real user pattern, code === default, etc).
export function addSnapshot(id, code) {
  if (!id || typeof code !== 'string') return;
  const current = $snapshots.get();
  const existing = current[id] || [];
  const last = existing[existing.length - 1];
  if (last && last.code === code) return;
  const next = trim([...existing, { ts: Date.now(), code }]);
  persist({ ...current, [id]: next });
}

export function getSnapshots(id) {
  return id ? $snapshots.get()[id] || [] : [];
}

export function useSnapshots(id) {
  const all = useStore($snapshots);
  return id ? all[id] || [] : [];
}

export function clearSnapshots(id) {
  const current = { ...$snapshots.get() };
  delete current[id];
  persist(current);
}

// Toggles whether a specific take is pinned (exempt from trimming). No-op
// if the take no longer exists.
export function togglePinSnapshot(id, ts) {
  const current = $snapshots.get();
  const existing = current[id] || [];
  const next = existing.map((s) => (s.ts === ts ? { ...s, pinned: !s.pinned } : s));
  persist({ ...current, [id]: next });
}
