// Tracks which patterns are tied to a real file on disk -- opened from
// one, or saved to one -- so PatternTabs.jsx can lock a tab's rename once
// it's linked, per the actual design this replaced: patterns opened from
// disk take the file's name and can't be renamed in-app (renaming would
// just make the tab lie about what file it is); a brand-new or duplicated
// pattern stays freely editable right up until its first save, at which
// point whatever filename was chosen becomes its title and it locks too.
// The link is the source of truth from then on -- that's what keeps the
// two names from drifting apart again instead of just matching once.
//
// Persisted (not session-scoped, unlike openPatternTabs.mjs/patternSet.mjs)
// because "this pattern came from that file" is a fact that should survive
// a restart, same lifetime as the pattern itself -- mirrors the
// localStorage convention in soundPresets.mjs/patternSnapshots.mjs rather
// than the sessionStorage one.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const KEY = 'strudel_pattern_file_links';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

// { [patternId]: absoluteFilePath }
const $links = atom(load());

function persist(next) {
  $links.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best-effort, same as the other localStorage-backed stores here
  }
}

export const useFileLinks = () => useStore($links);
export const getLinkedFilePath = (patternId) => (patternId ? ($links.get()[patternId] ?? null) : null);

export function linkPatternToFile(patternId, path) {
  if (!patternId || !path) return;
  persist({ ...$links.get(), [patternId]: path });
}

export function unlinkPattern(patternId) {
  if (!patternId) return;
  const next = { ...$links.get() };
  delete next[patternId];
  persist(next);
}
