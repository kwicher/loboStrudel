// Vertical/horizontal arrangement grid: several simultaneously-playing
// "tracks" (vertical axis), each an ordered horizontal queue of pattern
// sections (horizontal axis) that plays under one shared tempo. This is
// the whole arrangement surface now -- it replaced the earlier single-
// queue "Set mode" (a grid with one track subsumes it). Session-scoped,
// like openPatternTabs.mjs: an arrangement you're building for *this*
// session, not a saved document.
//
// Playback model, and why it's honest about its limits: Strudel has one
// scheduler (the StrudelMirror instance behind editorRef), not one per
// track, and cps is shared across the whole app -- exactly what was
// asked for. So "several tracks playing at once" is built by concatenating
// every unmuted track's *currently active* section code into one buffer
// and evaluating that as a single program, the same thing multiple
// top-level `$:` blocks in one pattern already do. Each track counts down
// its own section length independently (against the shared cps) and,
// when it elapses, swaps in its next section and re-evaluates the
// combined buffer -- a live hot-swap exactly like hitting Ctrl-Enter, so
// the clock never resets or glitches. Because it's one shared buffer, a
// section's own setcps()/samples() calls will affect the whole mix even
// though only one track "owns" that moment -- there's still no audio
// crossfade between sections, same honest limitation the old Set mode
// had. GridTab.jsx's scheduleEvaluate() coalesces multiple same-tick
// re-evaluates into one (fewer redundant hot-swaps when several tracks
// advance together) but that's a scheduling optimization, not a fix for
// the lack of crossfade itself -- a real fix would need per-track gain
// envelopes, i.e. an actual audio-engine change, not attempted here.
import { atom, computed } from 'nanostores';
import { useStore } from '@nanostores/react';
import { nanoid } from 'nanoid';
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

export const DEFAULT_GRID_CYCLES = 8;

// { tracks: [{ id, name, muted, entries: [{ entryId, patternId, cycles }] }] }
// entryId is a separate id from patternId specifically so the same saved
// pattern can be queued more than once in one track (an A/B/A structure,
// or the same drum loop reappearing later) -- every lookup, removal and
// reorder below is keyed by entryId, never patternId, for that reason.
//
// migrateEntries: a grid built before entryId existed stored entries as
// { id, cycles } (id doubling as the pattern id). Reading those in as-is
// leaves every entry's entryId === undefined, and undefined === undefined
// in JS -- so setTrackEntryCycles/removeFromTrack, which match by
// entryId, would match *every* legacy entry in a track at once. That's
// exactly the "changing cycles in one changes the others" bug: it only
// shows up for entries queued before this fix. Normalizing on every read
// (cheap, and self-healing the very first time the affected session
// touches the store again) closes that off for good, including for data
// already sitting in sessionStorage right now.
function migrateEntries(entries) {
  return (entries ?? []).map((e) =>
    e.entryId ? e : { entryId: nanoid(8), patternId: e.patternId ?? e.id, cycles: e.cycles },
  );
}

const $gridRaw = sessionAtom('patternGrid', JSON.stringify({ tracks: [] }));
const $grid = computed($gridRaw, (raw) => {
  const parsed = parseJSON(raw) ?? { tracks: [] };
  return { tracks: (parsed.tracks ?? []).map((t) => ({ ...t, entries: migrateEntries(t.entries) })) };
});

export const useGridTracks = () => useStore($grid).tracks;
export const getGridTracks = () => $grid.get().tracks;

function setTracks(tracks) {
  $gridRaw.set(JSON.stringify({ tracks }));
}

// Returns the new track's id -- callers that need to immediately add an
// entry to the track they just created (dropping a tab onto empty grid
// space, or importing a .strudeltrack file) need it right away rather
// than re-deriving "whichever track is last" afterward.
export function addTrack(name) {
  const tracks = getGridTracks();
  const id = nanoid(8);
  setTracks([...tracks, { id, name: name || `track ${tracks.length + 1}`, muted: false, entries: [] }]);
  return id;
}

export function removeTrack(trackId) {
  setTracks(getGridTracks().filter((t) => t.id !== trackId));
}

export function renameTrack(trackId, name) {
  setTracks(getGridTracks().map((t) => (t.id === trackId ? { ...t, name } : t)));
}

export function toggleMuteTrack(trackId) {
  setTracks(getGridTracks().map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)));
}

// Always appends a new entry, even if patternId is already queued
// elsewhere in this track -- duplicates are intentional (see the entryId
// note above), so there's no dedup check here on purpose.
export function addToTrack(trackId, patternId, cycles = DEFAULT_GRID_CYCLES) {
  if (!patternId) return;
  setTracks(
    getGridTracks().map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, entries: [...t.entries, { entryId: nanoid(8), patternId, cycles }] };
    }),
  );
}

// Same as addToTrack, but at a specific position -- used when a pattern
// tab is dropped onto a specific spot in a track's queue rather than
// clicked in via "+ current" (which always appends).
export function addToTrackAt(trackId, patternId, index, cycles = DEFAULT_GRID_CYCLES) {
  if (!patternId) return;
  setTracks(
    getGridTracks().map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      const idx = Math.max(0, Math.min(index, entries.length));
      entries.splice(idx, 0, { entryId: nanoid(8), patternId, cycles });
      return { ...t, entries };
    }),
  );
}

export function removeFromTrack(trackId, entryId) {
  setTracks(
    getGridTracks().map((t) => (t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.entryId !== entryId) } : t)),
  );
}

export function setTrackEntryCycles(trackId, entryId, cycles) {
  setTracks(
    getGridTracks().map((t) =>
      t.id === trackId ? { ...t, entries: t.entries.map((e) => (e.entryId === entryId ? { ...e, cycles } : e)) } : t,
    ),
  );
}

// Whether an entry counts as playable -- an explicit `false` is the only
// thing that disables it, so entries from before this field existed (and
// the common case of never having touched it) default to enabled.
export function isEntryEnabled(entry) {
  return entry?.enabled !== false;
}

export function toggleEntryEnabled(trackId, entryId) {
  setTracks(
    getGridTracks().map((t) =>
      t.id === trackId
        ? { ...t, entries: t.entries.map((e) => (e.entryId === entryId ? { ...e, enabled: !isEntryEnabled(e) } : e)) }
        : t,
    ),
  );
}

// Drag-and-drop reorder/move -- replaces the old move-left/move-right
// buttons entirely. Handles both cases (same track, or a different one)
// through one path: pull the entry out first, then insert it at toIndex,
// adjusting for the fact that pulling it out of its own track shifts
// every index after it back by one.
export function moveEntry(fromTrackId, entryId, toTrackId, toIndex) {
  const tracks = getGridTracks();
  const fromTrack = tracks.find((t) => t.id === fromTrackId);
  const fromIndex = fromTrack?.entries.findIndex((e) => e.entryId === entryId) ?? -1;
  if (!fromTrack || fromIndex === -1) return;
  const entry = fromTrack.entries[fromIndex];
  let adjustedToIndex = toIndex;
  if (fromTrackId === toTrackId && fromIndex < toIndex) adjustedToIndex -= 1;
  setTracks(
    tracks.map((t) => {
      if (t.id === fromTrackId && t.id === toTrackId) {
        const entries = t.entries.filter((e) => e.entryId !== entryId);
        const idx = Math.max(0, Math.min(adjustedToIndex, entries.length));
        entries.splice(idx, 0, entry);
        return { ...t, entries };
      }
      if (t.id === fromTrackId) {
        return { ...t, entries: t.entries.filter((e) => e.entryId !== entryId) };
      }
      if (t.id === toTrackId) {
        const entries = [...t.entries];
        const idx = Math.max(0, Math.min(toIndex, entries.length));
        entries.splice(idx, 0, entry);
        return { ...t, entries };
      }
      return t;
    }),
  );
}

// Ctrl+drag: same as moveEntry but leaves the source track's entry alone
// and inserts a copy (with its own fresh entryId -- see the entryId note
// above for why it can't reuse the original's) into the target instead.
export function copyEntryToTrack(fromTrackId, entryId, toTrackId, toIndex) {
  const tracks = getGridTracks();
  const fromTrack = tracks.find((t) => t.id === fromTrackId);
  const entry = fromTrack?.entries.find((e) => e.entryId === entryId);
  if (!entry) return;
  const copy = { ...entry, entryId: nanoid(8) };
  setTracks(
    tracks.map((t) => {
      if (t.id !== toTrackId) return t;
      const entries = [...t.entries];
      const idx = Math.max(0, Math.min(toIndex, entries.length));
      entries.splice(idx, 0, copy);
      return { ...t, entries };
    }),
  );
}

export function clearGrid() {
  setTracks([]);
}

// Whether the grid is docked open below the code editor. Deliberately its
// own toggle rather than routing through the app's generic panel system
// (activeFooter/isPanelOpen, Panel.jsx) -- that system only offers "narrow
// column on the right" or "fixed 360px strip at the very bottom of the
// whole window", and the grid's per-track rows need real width and height
// or they immediately go into their own internal scroll. This instead
// gets mounted directly in ReplEditor.jsx as a real split of the main
// editor column, sized to roughly half of it.
const $gridPanelOpenRaw = sessionAtom('patternGridPanelOpen', 'false');
const $gridPanelOpen = computed($gridPanelOpenRaw, (raw) => raw === 'true');

export const useGridPanelOpen = () => useStore($gridPanelOpen);
export const openGridPanel = () => $gridPanelOpenRaw.set('true');
export const closeGridPanel = () => $gridPanelOpenRaw.set('false');
export const toggleGridPanel = () => $gridPanelOpenRaw.set($gridPanelOpen.get() ? 'false' : 'true');
