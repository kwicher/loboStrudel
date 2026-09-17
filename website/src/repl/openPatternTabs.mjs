// Which of the user's saved patterns currently have a tab open across the
// top of the editor, and in what order -- session-scoped (mirrors the
// sessionAtom pattern in user_pattern_utils.mjs for $viewingPatternData /
// $activePattern) so a restart starts with a clean, empty tab strip rather
// than reopening every pattern the user ever touched.
import { atom, computed } from 'nanostores';
import { useStore } from '@nanostores/react';
import { parseJSON } from './util.mjs';

const sessionAtom = (name, initial) => {
  const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : {};
  const store = atom(typeof storage[name] !== 'undefined' ? storage[name] : initial);
  store.listen((newValue) => {
    if (typeof newValue === 'undefined') {
      delete storage[name];
    } else {
      storage[name] = newValue;
    }
  });
  return store;
};

const $openTabIdsRaw = sessionAtom('openPatternTabIds', JSON.stringify([]));
const $openTabIds = computed($openTabIdsRaw, (raw) => parseJSON(raw) ?? []);

export const useOpenPatternTabIds = () => useStore($openTabIds);
export const getOpenPatternTabIds = () => $openTabIds.get();

function setOpenTabIds(ids) {
  $openTabIdsRaw.set(JSON.stringify(ids));
}

// Adds id to the open tabs (no-op if already open), always appended at the
// end so newly opened patterns land to the right, like a browser tab.
export function openPatternTab(id) {
  if (id == null) return;
  const ids = getOpenPatternTabIds();
  if (!ids.includes(id)) {
    setOpenTabIds([...ids, id]);
  }
}

// Removes id from the open tabs -- this only closes the tab, it never
// touches the saved pattern itself. Returns the id that should become the
// new viewing pattern if the closed tab was the one being viewed: its
// neighbor (preferring the one to the left), or null if no tabs remain.
// currentViewingId lets callers who are closing a *different* tab than the
// one they're looking at skip that switch entirely.
export function closePatternTab(id, currentViewingId) {
  const ids = getOpenPatternTabIds();
  const idx = ids.indexOf(id);
  if (idx === -1) return currentViewingId;
  const next = [...ids.slice(0, idx), ...ids.slice(idx + 1)];
  setOpenTabIds(next);
  if (currentViewingId !== id) return currentViewingId;
  if (next.length === 0) return null;
  return next[Math.min(idx, next.length - 1)];
}

export function resetOpenPatternTabs() {
  setOpenTabIds([]);
}
