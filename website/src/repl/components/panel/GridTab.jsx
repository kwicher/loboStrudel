// The arrangement grid: N tracks (vertical) each an ordered queue of
// pattern sections (horizontal) that auto-advance, all playing at once
// under one shared tempo. This is the whole arrangement surface now --
// it replaced the earlier single-queue "Set mode" entirely (a grid with
// one track is a strict superset of what that did). See patternGrid.mjs
// for the full playback rationale and its scoping limits (one shared
// evaluate buffer, no audio crossfade).
//
// Reordering/moving/copying sections is native HTML5 drag-and-drop
// (draggable + onDragStart/onDragOver/onDrop) -- no new dependency, and
// it's the same mechanism a pattern tab drag onto a track uses, just with
// a different MIME type on the payload so the two don't get confused.
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderOpenIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { useSettings } from '../../../settings.mjs';
import { useViewingPatternData, userPattern } from '../../../user_pattern_utils.mjs';
import { patternTitle } from './PatternTabs.jsx';
import { setTitleOverride, useTitleOverrides } from '../../patternTitles.mjs';
import { openPatternTab } from '../../openPatternTabs.mjs';
import { isTauri as isTauriRuntime, openTrackFile, saveTrackFile } from '../../nativeTrackFile.mjs';
import {
  DEFAULT_GRID_CYCLES,
  addToTrack,
  addToTrackAt,
  addTrack,
  copyEntryToTrack,
  getGridTracks,
  isEntryEnabled,
  moveEntry,
  removeFromTrack,
  removeTrack,
  setTrackEntryCycles,
  toggleEntryEnabled,
  toggleMuteTrack,
  useGridTracks,
} from '../../patternGrid.mjs';

const TAURI = typeof window !== 'undefined' && isTauriRuntime();

const ENTRY_MIME = 'application/x-strudel-grid-entry';
const TAB_MIME = 'application/x-strudel-pattern-id';

// Concatenates every unmuted track's currently-active, *enabled* section
// code into one buffer -- see patternGrid.mjs for why this is how
// "several tracks at once" works with a single shared scheduler. Silence
// when nothing is active so stopping/emptying the grid actually goes
// quiet rather than leaving the last buffer sounding.
function buildCombinedCode(tracks, activeIndexes, userPatterns, visualize) {
  const codes = tracks
    .map((t) => {
      if (t.muted) return null;
      const idx = activeIndexes[t.id];
      if (idx == null) return null;
      const entry = t.entries[idx];
      if (!entry || !isEntryEnabled(entry)) return null;
      return userPatterns[entry.patternId]?.code;
    })
    .filter(Boolean);
  if (codes.length === 0) return 'silence';
  // `all(pianoroll)` is Strudel's own documented way to paint a pianoroll
  // for every currently-running top-level pattern at once (see
  // packages/draw/pianoroll.mjs's own doc comment) -- appended as its
  // *own* top-level line in this ephemeral combined buffer, never written
  // into any track's actual pattern code. That matters: rewriting a
  // pattern's own code string to bolt a method onto the end is exactly
  // the kind of fragile text-mutation this codebase specifically moved
  // away from (see patternTitles.mjs's header comment) -- it can land in
  // the wrong place, or silently do nothing, on any pattern with more
  // than one top-level `$:` block. `all(...)` sidesteps that entirely.
  return visualize ? `${codes.join('\n\n')}\n\nall(pianoroll)` : codes.join('\n\n');
}

// Scans forward from startIndex for the next enabled entry, wrapping once
// if loop is on (and never wrapping if it's off, matching the old
// "reached the end -- loop or stop" behavior exactly, just skipping
// disabled entries along the way). Returns null if every entry is
// disabled, or there's nothing left without wrapping.
function firstEnabledFrom(entries, startIndex, loop) {
  const n = entries.length;
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    const idx = startIndex + i;
    if (idx >= n && !loop) return null;
    const wrapped = ((idx % n) + n) % n;
    if (isEntryEnabled(entries[wrapped])) return wrapped;
  }
  return null;
}

// A thin vertical drop target sitting between (and before/after) entries
// in a track's row -- the actual drag target, rather than computing
// which half of an entry box the cursor is over. The gap after the last
// entry grows to fill the row's remaining width (and is the *only* gap
// when the track is empty), so there's always a generous drop target
// instead of a few-pixel-wide sliver.
function DropGap({ active, grow, onDragOver, onDrop }) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cx('self-stretch rounded shrink-0 transition-colors', grow ? 'flex-1 min-w-2' : 'w-2', active && 'bg-[#89ddff]/70')}
    />
  );
}

// Live tempo control: nudge cps up/down in small fixed steps, or tap out
// a beat to set it directly -- editing cps by retyping `setcps(...)` in
// the code mid-performance breaks flow, so this calls the same
// repl.setCps() that would do from buttons instead. cps is a plain
// mutable number on the scheduler (see patternGrid.mjs's header comment,
// same reasoning as armTrack's duration calc), not reactive, so this
// polls it rather than subscribing to anything -- cheap, and picks up
// tempo changes made from code too (e.g. a `setcps()` inside a pattern).
const BEATS_PER_CYCLE = 4;
const CPS_NUDGE_STEP = 0.01;
const TAP_RESET_MS = 2000;
const TAP_HISTORY = 6;

function TempoControl({ context }) {
  const [cps, setCpsDisplay] = useState(0.5);
  const tapTimesRef = useRef([]);

  useEffect(() => {
    const id = setInterval(() => {
      const live = context.editorRef?.current?.repl?.scheduler?.cps;
      if (live != null) setCpsDisplay(live);
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCps = (next) => {
    const clamped = Math.max(0.05, Math.min(10, next));
    context.editorRef?.current?.repl?.setCps(clamped);
    setCpsDisplay(clamped);
  };

  const nudge = (dir) => applyCps(cps + dir * CPS_NUDGE_STEP);

  // Averages the gaps between however many recent taps still count as
  // "the same tapping" (a pause longer than TAP_RESET_MS starts over,
  // rather than one stray late tap dragging a whole new average off).
  // The beats-per-cycle assumption below is the one place this has to
  // guess -- see this component's own header comment.
  const tap = () => {
    const now = performance.now();
    const recent = tapTimesRef.current.filter((t) => now - t < TAP_RESET_MS);
    recent.push(now);
    tapTimesRef.current = recent.slice(-TAP_HISTORY);
    if (tapTimesRef.current.length < 2) return;
    const gaps = tapTimesRef.current.slice(1).map((t, i) => t - tapTimesRef.current[i]);
    const avgMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    applyCps(1000 / avgMs / BEATS_PER_CYCLE);
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={() => nudge(-1)} title="nudge tempo down" className="opacity-60 hover:opacity-100">
        <MinusIcon className="w-3 h-3" />
      </button>
      <span
        className="font-mono text-[11px] w-10 text-center tabular-nums"
        title="cycles per second, live from the scheduler"
      >
        {cps.toFixed(2)}
      </span>
      <button onClick={() => nudge(1)} title="nudge tempo up" className="opacity-60 hover:opacity-100">
        <PlusIcon className="w-3 h-3" />
      </button>
      <button
        onClick={tap}
        title={`tap the beat a few times to set tempo (assumes ${BEATS_PER_CYCLE} beats per cycle -- won't be exactly right for every pattern, check the readout)`}
        className="text-[10px] px-1.5 py-0.5 rounded border border-muted opacity-70 hover:opacity-100"
      >
        tap
      </button>
    </div>
  );
}

export function GridTab({ context }) {
  const { userPatterns } = useSettings();
  // Subscribed purely so this re-renders when a title changes elsewhere.
  useTitleOverrides();
  const tracks = useGridTracks();
  const viewingPatternData = useViewingPatternData();
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [activeIndexes, setActiveIndexes] = useState({});
  // Per-track { durationMs, animKey } for the currently-armed section --
  // drives the CSS progress line below. animKey changes on every arm
  // (including re-arming the same index on loop) so the line's element
  // remounts and its CSS animation restarts from 0 instead of continuing
  // a stale one.
  const [sectionAnim, setSectionAnim] = useState({});
  // { trackId, index } of the drop gap currently under the cursor, or
  // null -- purely visual (which gap highlights), the actual drop target
  // is always read straight off the event in onDrop, not this state.
  const [dropTarget, setDropTarget] = useState(null);
  // Whether a pattern tab is currently being dragged over the "drop here
  // to start a new track" zone (the empty-state placeholder, and the
  // strip below the track list once there's at least one track).
  const [newTrackDropActive, setNewTrackDropActive] = useState(false);

  // Mutable mirrors so the independent per-track timers always see the
  // latest state instead of whatever was captured when they were armed.
  const activeIndexesRef = useRef({});
  const timersRef = useRef({});
  const loopRef = useRef(loop);
  loopRef.current = loop;
  // Whether to paint a pianoroll for the running sections (item 3: see
  // buildCombinedCode's comment for why this is appended as a separate
  // top-level line rather than mutating any pattern's own code). Mirrored
  // into a ref for the same reason loop is -- armed timers' closures read
  // the ref, not the state, so a toggle takes effect immediately rather
  // than only once the in-flight timer happens to fire.
  const [visualize, setVisualize] = useState(false);
  const visualizeRef = useRef(visualize);
  // Coalesces same-tick evaluateCombined() calls into one -- if several
  // tracks advance (or a mute/enable/visualize toggle lands) in the same
  // JS tick, this collapses them into a single re-evaluate instead of
  // firing one hot-swap per change back-to-back. This is the one part of
  // "sections glitch when they swap" that's safely fixable without a
  // real audio-engine change -- it does NOT add actual audio crossfade
  // between sections (that needs per-track gain envelopes, well beyond
  // this session's scope); see patternGrid.mjs's header comment for the
  // limitation this doesn't touch.
  const evaluatePendingRef = useRef(false);

  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    },
    [],
  );

  const evaluateCombined = async () => {
    const code = buildCombinedCode(getGridTracks(), activeIndexesRef.current, userPatterns, visualizeRef.current);
    const editor = context.editorRef?.current;
    if (!editor) return;
    editor.setCode(code);
    await editor.evaluate();
  };

  const scheduleEvaluate = () => {
    if (evaluatePendingRef.current) return;
    evaluatePendingRef.current = true;
    Promise.resolve().then(() => {
      evaluatePendingRef.current = false;
      evaluateCombined();
    });
  };

  const clearTrackTimer = (trackId) => {
    if (timersRef.current[trackId]) {
      clearTimeout(timersRef.current[trackId]);
      delete timersRef.current[trackId];
    }
  };

  const stopGrid = () => {
    Object.keys(timersRef.current).forEach(clearTrackTimer);
    activeIndexesRef.current = {};
    setActiveIndexes({});
    setSectionAnim({});
    setPlaying(false);
  };

  // Arms this one track's advance timer. Independent of every other
  // track -- each runs its own countdown against the *current* shared
  // cps, so tracks with different section lengths naturally drift in and
  // out of phase with each other, which is the point (polyrhythmic
  // sections, not a locked grid). Also records the duration for the
  // progress-line animation.
  const armTrack = (trackId, index) => {
    const track = getGridTracks().find((t) => t.id === trackId);
    if (!track) return;
    const entry = track.entries[index];
    if (!entry) return;
    const cps = context.editorRef?.current?.repl?.scheduler?.cps || 0.5;
    const durationMs = Math.max(500, (entry.cycles / cps) * 1000);
    clearTrackTimer(trackId);
    timersRef.current[trackId] = setTimeout(() => advanceTrack(trackId, index), durationMs);
    setSectionAnim((prev) => ({ ...prev, [trackId]: { durationMs, animKey: `${Date.now()}-${Math.random()}` } }));
  };

  const advanceTrack = (trackId, fromIndex) => {
    const track = getGridTracks().find((t) => t.id === trackId);
    if (!track) return;
    const next = firstEnabledFrom(track.entries, fromIndex + 1, loopRef.current);
    activeIndexesRef.current = { ...activeIndexesRef.current, [trackId]: next };
    setActiveIndexes(activeIndexesRef.current);
    scheduleEvaluate();
    if (next != null) {
      armTrack(trackId, next);
    } else {
      setSectionAnim((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
    }
  };

  const playGrid = () => {
    const tracksNow = getGridTracks();
    const starting = {};
    tracksNow.forEach((t) => {
      const first = firstEnabledFrom(t.entries, 0, loopRef.current);
      if (first != null) starting[t.id] = first;
    });
    activeIndexesRef.current = starting;
    setActiveIndexes(starting);
    setPlaying(true);
    evaluateCombined();
    tracksNow.forEach((t) => {
      if (starting[t.id] != null) armTrack(t.id, starting[t.id]);
    });
  };

  // Toggling mute doesn't touch the timeline (tracks keep advancing on
  // their own schedule even while muted, like a DAW mute button) -- it
  // just needs the combined buffer re-evaluated so the change is heard
  // immediately instead of waiting for the next section swap.
  const onToggleMute = (trackId) => {
    toggleMuteTrack(trackId);
    if (playing) scheduleEvaluate();
  };

  // Same idea for an individual entry's enabled state -- if it's the one
  // currently sounding, the mix should update right away rather than
  // waiting for the next natural advance.
  const onToggleEntryEnabled = (trackId, entryId) => {
    toggleEntryEnabled(trackId, entryId);
    if (playing) scheduleEvaluate();
  };

  // Sets both the ref (read by evaluateCombined/scheduleEvaluate right
  // away) and the state (for the button's own re-render) -- state alone
  // wouldn't be visible to this same click's scheduleEvaluate() call,
  // since React doesn't commit it until after this handler returns.
  const onToggleVisualize = () => {
    const next = !visualizeRef.current;
    visualizeRef.current = next;
    setVisualize(next);
    if (playing) scheduleEvaluate();
  };

  const addCurrentTo = (trackId) => {
    if (viewingPatternData?.id) addToTrack(trackId, viewingPatternData.id);
  };

  // Bundles a track's queue -- every entry's title, cycle count, and
  // *current* pattern code -- into one .strudeltrack file, in order.
  // Always prompts for a location (see nativeTrackFile.mjs); there's no
  // ongoing link back to this track the way patternFileLink.mjs links a
  // single pattern to its file, since a track is several patterns bundled
  // together, not one.
  const saveTrack = async (track) => {
    const entries = track.entries.map((e) => {
      const pattern = userPatterns[e.patternId];
      return { title: pattern ? patternTitle(pattern) : 'untitled', cycles: e.cycles, code: pattern?.code ?? '' };
    });
    await saveTrackFile({ version: 1, name: track.name, entries }, track.name);
  };

  // The inverse: reads a .strudeltrack file and rebuilds it as a brand
  // new track plus a brand new (saved) pattern for every entry, each
  // opened as its own tab -- exactly what "the patterns are loaded as
  // tabs" asks for, plus reconstructing the track itself so the whole
  // arrangement comes back, not just its patterns. Always creates new
  // patterns rather than trying to match up against existing ones, same
  // reasoning as in nativeTrackFile.mjs's header comment. Only the first
  // entry's pattern becomes the visible/active tab, same convention as
  // "Recent patterns"'s multi-open.
  const openTrackFromFile = async () => {
    const result = await openTrackFile();
    if (!result) return;
    const { data } = result;
    const newTrackId = addTrack(data.name);
    let firstOpened = null;
    data.entries.forEach((entry) => {
      const { data: fresh } = userPattern.create();
      const updated = userPattern.update(fresh.id, { ...fresh, code: entry.code ?? '' });
      setTitleOverride(updated.id, entry.title || 'untitled');
      addToTrack(newTrackId, updated.id, entry.cycles || DEFAULT_GRID_CYCLES);
      openPatternTab(updated.id);
      if (!firstOpened) firstOpened = updated;
    });
    if (firstOpened) context.handleUpdate(firstOpened.data);
  };

  // Editing the queue (reordering/moving/copying/inserting) while the
  // grid is playing would leave activeIndexes pointing at the wrong
  // *positions* -- they're index-based, and a drag can shift every index
  // after it. Rather than silently playing the wrong section, or trying
  // to re-derive "the same entries, new positions" for every timer that's
  // already armed, this just stops the grid first. Hit play again once
  // you're done rearranging.
  const stopIfPlaying = () => {
    if (playing) stopGrid();
  };

  const onGapDragOver = (e, trackId, index) => {
    e.preventDefault();
    const isTabDrag = e.dataTransfer.types.includes(TAB_MIME);
    e.dataTransfer.dropEffect = isTabDrag ? 'copy' : e.ctrlKey || e.metaKey ? 'copy' : 'move';
    setDropTarget({ trackId, index });
  };

  // The thin drop gaps between entries are easy to miss -- an entry box is
  // ~100px wide and the gap next to it is 8px, so most natural drag
  // gestures hover over an entry, not the sliver next to it, and a drop
  // there used to just silently fail (entries had no drop handler of
  // their own). This makes each entry box a drop target too: whichever
  // half of it the cursor is over decides "insert before" or "insert
  // after," so there's no dead zone left across the whole row -- the
  // adjacent DropGap still lights up to show where it'll land, even
  // though the event actually fired on the entry.
  const indexForEntryHalf = (e, i) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX - rect.left < rect.width / 2 ? i : i + 1;
  };

  const onGapDrop = (e, trackId, index) => {
    e.preventDefault();
    setDropTarget(null);
    const tabPatternId = e.dataTransfer.getData(TAB_MIME);
    if (tabPatternId) {
      addToTrackAt(trackId, tabPatternId, index);
      return;
    }
    const raw = e.dataTransfer.getData(ENTRY_MIME);
    if (!raw) return;
    const { fromTrackId, entryId } = JSON.parse(raw);
    stopIfPlaying();
    if (e.ctrlKey || e.metaKey) {
      copyEntryToTrack(fromTrackId, entryId, trackId, index);
    } else {
      moveEntry(fromTrackId, entryId, trackId, index);
    }
  };

  // Dropping a pattern tab onto the grid where there's no track under the
  // cursor at all -- previously a silent no-op ("drag a tab to the grid
  // without a track, nothing happens"). Only reacts to a tab drag
  // (ENTRY_MIME drags are always dropped onto an existing track or one of
  // its gaps, never here) so an in-progress entry reorder doesn't
  // accidentally spawn a new track if it strays outside every track row.
  const onNewTrackDragOver = (e) => {
    if (!e.dataTransfer.types.includes(TAB_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setNewTrackDropActive(true);
  };

  const onNewTrackDragLeave = () => setNewTrackDropActive(false);

  const onNewTrackDrop = (e) => {
    const patternId = e.dataTransfer.getData(TAB_MIME);
    setNewTrackDropActive(false);
    if (!patternId) return;
    e.preventDefault();
    const newTrackId = addTrack();
    addToTrackAt(newTrackId, patternId, 0);
  };

  return (
    <div className="p-2 flex flex-col gap-3 text-sm h-full overflow-auto" onDragLeave={() => setDropTarget(null)}>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={playing ? stopGrid : playGrid}
          disabled={tracks.every((t) => t.entries.length === 0)}
          title={playing ? 'stop grid' : 'play grid'}
          className="disabled:opacity-30"
        >
          {playing ? <StopIcon className="w-5 h-5 text-red-400" /> : <PlayIcon className="w-5 h-5" />}
        </button>
        <button
          onClick={() => setLoop((v) => !v)}
          title="loop each track's queue independently once it reaches the end"
          className={cx(loop ? 'text-[#89ddff]' : 'opacity-40 hover:opacity-80')}
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
        <span className="text-xs uppercase tracking-wide opacity-50">grid</span>
        <TempoControl context={context} />
        <button
          onClick={onToggleVisualize}
          title={visualize ? 'stop painting a pianoroll for the running sections' : 'paint a pianoroll for the running sections'}
          className={cx(visualize ? 'text-[#89ddff]' : 'opacity-40 hover:opacity-80')}
        >
          {visualize ? <EyeIcon className="w-4 h-4" /> : <EyeSlashIcon className="w-4 h-4" />}
        </button>
        {TAURI && (
          <button
            onClick={openTrackFromFile}
            title="open a .strudeltrack file -- rebuilds the track and loads its patterns as tabs"
            className="ml-auto flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
          >
            <FolderOpenIcon className="w-3.5 h-3.5" /> open track
          </button>
        )}
        <button
          onClick={() => addTrack()}
          title="add a track"
          className={cx('flex items-center gap-1 text-xs opacity-70 hover:opacity-100', !TAURI && 'ml-auto')}
        >
          <PlusIcon className="w-3.5 h-3.5" /> add track
        </button>
      </div>
      <div className="text-[11px] opacity-50 -mt-2 leading-snug shrink-0">
        drag a section to reorder it, drag it onto another track to move it (hold Ctrl/Cmd to copy instead), or drag a pattern tab
        straight onto a track to queue it there -- or onto empty grid space to start a brand new track with it. "+ current" still
        adds whatever pattern tab you're viewing to the end. The small speaker icon on a section toggles it on/off without removing
        it.
      </div>

      {tracks.length === 0 && (
        <div
          onDragOver={onNewTrackDragOver}
          onDragLeave={onNewTrackDragLeave}
          onDrop={onNewTrackDrop}
          className={cx(
            'text-xs border border-dashed rounded p-3 transition-colors',
            newTrackDropActive ? 'border-[#89ddff] bg-[#89ddff]/10 opacity-100' : 'border-muted opacity-40',
          )}
        >
          no tracks yet -- "add track" to start, drag a pattern tab here to create one, or "open track" to load a saved one.
        </div>
      )}

      {tracks.map((track) => {
        const idx = activeIndexes[track.id];
        const anim = sectionAnim[track.id];
        return (
          <div key={track.id} className="flex flex-col gap-1.5 border border-muted rounded p-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggleMute(track.id)}
                title={track.muted ? 'unmute' : 'mute'}
                className={cx(track.muted ? 'text-red-400' : 'opacity-60 hover:opacity-100')}
              >
                {track.muted ? <SpeakerXMarkIcon className="w-3.5 h-3.5" /> : <SpeakerWaveIcon className="w-3.5 h-3.5" />}
              </button>
              <span className="text-xs font-semibold truncate">{track.name}</span>
              <button
                onClick={() => addCurrentTo(track.id)}
                title="add the pattern you're viewing to this track's queue"
                className="flex items-center gap-0.5 text-[10px] opacity-60 hover:opacity-100"
              >
                <PlusIcon className="w-3 h-3" /> current
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                {TAURI && (
                  <button
                    onClick={() => saveTrack(track)}
                    title="save this track as a file -- its patterns, in order, bundled into one file"
                    disabled={track.entries.length === 0}
                    className="opacity-40 hover:opacity-90 disabled:opacity-15 disabled:hover:opacity-15"
                  >
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => removeTrack(track.id)} title="remove track" className="opacity-40 hover:opacity-90">
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-stretch overflow-x-auto gap-0 pl-1 min-h-[52px]">
              <DropGap
                active={dropTarget?.trackId === track.id && dropTarget.index === 0}
                grow={track.entries.length === 0}
                onDragOver={(e) => onGapDragOver(e, track.id, 0)}
                onDrop={(e) => onGapDrop(e, track.id, 0)}
              />
              {track.entries.map((entry, i) => {
                const pattern = userPatterns[entry.patternId];
                const isActive = playing && i === idx;
                const enabled = isEntryEnabled(entry);
                return (
                  <div key={entry.entryId} className="flex items-stretch">
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(ENTRY_MIME, JSON.stringify({ fromTrackId: track.id, entryId: entry.entryId }));
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onDragOver={(e) => onGapDragOver(e, track.id, indexForEntryHalf(e, i))}
                      onDrop={(e) => onGapDrop(e, track.id, indexForEntryHalf(e, i))}
                      title={enabled ? undefined : 'disabled -- skipped during playback'}
                      className={cx(
                        'relative overflow-hidden flex flex-col gap-1 px-2 py-1 rounded border text-[10px] shrink-0 min-w-[100px] cursor-grab active:cursor-grabbing',
                        isActive ? 'border-[#89ddff] bg-[#89ddff]/10' : 'border-muted',
                        !enabled && 'opacity-40',
                      )}
                    >
                      {isActive && anim && (
                        <span
                          key={anim.animKey}
                          className="grid-progress-line"
                          style={{ animationDuration: `${anim.durationMs}ms` }}
                        />
                      )}
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-mono">
                          {i + 1}. {pattern ? patternTitle(pattern) : '(deleted)'}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => onToggleEntryEnabled(track.id, entry.entryId)}
                            title={enabled ? 'disable (skip during playback)' : 'enable'}
                            className="opacity-50 hover:opacity-90"
                          >
                            {enabled ? <SpeakerWaveIcon className="w-3 h-3" /> : <SpeakerXMarkIcon className="w-3 h-3 text-red-400" />}
                          </button>
                          <button
                            onClick={() => removeFromTrack(track.id, entry.entryId)}
                            title="remove from queue"
                            className="opacity-40 hover:opacity-90"
                          >
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <label className="flex items-center gap-1 opacity-70">
                        <input
                          type="number"
                          min={1}
                          max={256}
                          value={entry.cycles}
                          onChange={(e) =>
                            setTrackEntryCycles(track.id, entry.entryId, Math.max(1, parseInt(e.target.value) || 1))
                          }
                          className="w-9 bg-background border border-muted rounded px-1"
                        />
                        cyc
                      </label>
                    </div>
                    <DropGap
                      active={dropTarget?.trackId === track.id && dropTarget.index === i + 1}
                      grow={i === track.entries.length - 1}
                      onDragOver={(e) => onGapDragOver(e, track.id, i + 1)}
                      onDrop={(e) => onGapDrop(e, track.id, i + 1)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {tracks.length > 0 && (
        <div
          onDragOver={onNewTrackDragOver}
          onDragLeave={onNewTrackDragLeave}
          onDrop={onNewTrackDrop}
          className={cx(
            'text-[10px] border border-dashed rounded py-2 text-center shrink-0 transition-colors',
            newTrackDropActive ? 'border-[#89ddff] bg-[#89ddff]/10 opacity-100' : 'border-muted opacity-30 hover:opacity-60',
          )}
        >
          drag a pattern tab here to start a new track
        </div>
      )}
    </div>
  );
}
