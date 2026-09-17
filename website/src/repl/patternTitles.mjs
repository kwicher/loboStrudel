// Pattern display titles, kept entirely separate from the pattern's code.
//
// This replaced an earlier scheme where the title WAS a `// "Title"`
// comment embedded in the code itself, and renaming meant rewriting that
// line in place. That turned out to be destructive in practice: the
// rewrite located "the title comment" with a regex that searched the
// *whole* code for the first `//` or `/* */` it could find, not just the
// first line -- so a pattern with an unrelated comment anywhere in its
// body (very common; that's what comments are for), or a rename fired
// against a not-yet-caught-up editor buffer right after switching tabs
// (e.g. immediately after duplicating), could silently replace real code
// with just the new title line. A title is metadata, not a code edit, so
// it now lives here instead -- renaming, duplicating, opening a file, or
// saving under a new name changes only this map, never the pattern's code.
// If someone wants an actual comment in their code, per the request that
// prompted this, they add one themselves.
//
// Persisted (not session-scoped) since a title is as durable as the
// pattern itself -- same convention as patternFileLink.mjs.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const KEY = 'strudel_pattern_titles';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

// { [patternId]: title }
const $titles = atom(load());

function persist(next) {
  $titles.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best-effort, same as the other localStorage-backed stores here
  }
}

export const useTitleOverrides = () => useStore($titles);
export const getTitleOverride = (patternId) => (patternId ? ($titles.get()[patternId] ?? null) : null);

export function setTitleOverride(patternId, title) {
  if (!patternId) return;
  const clean = (title ?? '').replace(/[\r\n]+/g, ' ').trim();
  const next = { ...$titles.get() };
  if (clean === '') {
    delete next[patternId]; // empty rename clears the override, falls back to the old id/date naming
  } else {
    next[patternId] = clean;
  }
  persist(next);
}

export function clearTitleOverride(patternId) {
  if (!patternId) return;
  const next = { ...$titles.get() };
  delete next[patternId];
  persist(next);
}
