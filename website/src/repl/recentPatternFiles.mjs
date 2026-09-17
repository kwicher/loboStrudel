// Recently-opened/saved native pattern files, for the sidebar's "Recent
// patterns" popup -- most-recent-first, deduped by path, capped so the
// list stays a quick glance rather than a full history. localStorage-
// backed (not session-scoped) for the same reason patternFileLink.mjs and
// patternTitles.mjs are: "these are files I've touched" is a lasting fact
// that should survive a restart, unlike tab-open-state.
//
// This module only tracks paths -- it doesn't read files or know about
// patterns/titles. AppSidebar.jsx calls addRecentFile() after a real
// open/save, and RecentPatternsMenu.jsx is what turns the list into
// pattern tabs (via nativePatternFile.mjs's readPatternFileAt).
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const KEY = 'strudel_recent_pattern_files';
const MAX_ENTRIES = 20;

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// [{ path, openedAt }], most-recent-first.
const $recent = atom(load());

function persist(next) {
  $recent.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best-effort, e.g. private browsing / storage quota
  }
}

export const useRecentFiles = () => useStore($recent);
export const getRecentFiles = () => $recent.get();

// Moves path to the front (or inserts it) and stamps it with now, whether
// it just got opened or just got saved -- both count as "recently used".
export function addRecentFile(path) {
  if (!path) return;
  const rest = $recent.get().filter((e) => e.path !== path);
  persist([{ path, openedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES));
}

// For a file that turned out to be missing/unreadable when the popup
// tried to open it (moved or deleted on disk since it was last touched)
// -- drops it rather than leaving a dead entry the user will just hit
// again.
export function removeRecentFile(path) {
  if (!path) return;
  persist($recent.get().filter((e) => e.path !== path));
}

export function clearRecentFiles() {
  persist([]);
}
