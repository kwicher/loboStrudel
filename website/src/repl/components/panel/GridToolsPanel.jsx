// Consolidated Grid-side tool panel: tempo control, mutate snippets, and
// the 3D visualizer's on/off + "open window" controls, all in one popover
// anchored to a button in the Grid's own toolbar -- previously these were
// split between an inline widget in GridTab.jsx (tempo), the top-of-window
// Toolbox popover (mutate), and a plain toggle button (pianoroll). Moved
// here per explicit request: "Tempo and other mutate should be in the same
// tool panel and by grid not on top of the window."
//
// Same portal-popover technique as Toolbox.jsx/RecentPatternsMenu.jsx --
// see Toolbox.jsx's header comment for why a portal is needed (the header
// row this kind of button used to live in clips overflow to zero height).
// This panel is anchored to the Grid's own toolbar row instead, but the
// clipping risk is the same for any button inside a scrollable/overflow
// container, so it keeps the same defensive pattern.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdjustmentsHorizontalIcon, MinusIcon, PlusIcon, XMarkIcon } from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { isTauri as isTauriRuntime } from '../../../tauri.mjs';
import { openVisualizerWindow } from '../../gridVisualizer.mjs';

const TAURI = typeof window !== 'undefined' && isTauriRuntime();

function insertSnippet(context, snippet) {
  const editor = context.editorRef?.current;
  if (!editor) return;
  editor.insertCode(snippet, editor.getCursorLocation());
}

function InsertRow({ snippet, onInsert }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <code className="text-[10px] font-mono opacity-60 truncate">{snippet}</code>
      <button
        onClick={onInsert}
        className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-muted hover:opacity-70"
        title="insert at cursor"
      >
        insert
      </button>
    </div>
  );
}

// Live tempo control: nudge cps up/down in small fixed steps, or tap out a
// beat to set it directly -- editing cps by retyping `setcps(...)` in the
// code mid-performance breaks flow, so this calls the same repl.setCps()
// that would do from buttons instead. cps is a plain mutable number on the
// scheduler (see patternGrid.mjs's header comment), not reactive, so this
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

  // Averages the gaps between however many recent taps still count as "the
  // same tapping" (a pause longer than TAP_RESET_MS starts over, rather
  // than one stray late tap dragging a whole new average off). The
  // beats-per-cycle assumption below is the one place this has to guess.
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
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-50">tempo</div>
      <div className="flex items-center gap-1.5">
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
    </div>
  );
}

// Same curated set of small randomized transformations as before (moved
// verbatim from Toolbox.jsx) -- roll one, see it, insert it at the cursor.
// Insert-at-cursor rather than auto-appending to the whole pattern, for the
// same non-destructive-editing reason documented throughout this codebase
// (see patternTitles.mjs's header comment): appending blindly to the end
// of arbitrary code can land in the wrong place, or do nothing useful, on
// any pattern with more than one top-level `$:` block.
const MUTATIONS = [
  () => `.degradeBy(${(0.1 + Math.random() * 0.3).toFixed(2)})`,
  () => `.sometimesBy(${(0.2 + Math.random() * 0.3).toFixed(2)}, x => x.rev())`,
  () => `.ply(${2 + Math.floor(Math.random() * 3)})`,
  () => `.fast(${(1.25 + Math.random() * 0.75).toFixed(2)})`,
  () => `.slow(${(1.25 + Math.random() * 0.75).toFixed(2)})`,
  () => `.jux(rev)`,
  () => `.chop(${2 + Math.floor(Math.random() * 6)})`,
  () => `.often(x => x.ply(2))`,
  () => `.rarely(x => x.chop(4))`,
  () => `.iter(${2 + Math.floor(Math.random() * 3)})`,
  () => `.linger(${(0.125 * (1 + Math.floor(Math.random() * 4))).toFixed(3)})`,
];

function MutateBuilder({ context }) {
  const [snippet, setSnippet] = useState(() => MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)]());
  const reroll = () => setSnippet(MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)]());
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide opacity-50">mutate</div>
        <button onClick={reroll} title="roll a different one" className="text-[10px] opacity-60 hover:opacity-100">
          reroll
        </button>
      </div>
      <InsertRow snippet={snippet} onInsert={() => insertSnippet(context, snippet)} />
    </div>
  );
}

// The 3D visualizer replaced the old inline pianoroll toggle: "feeding"
// controls whether the combined buffer emits hap events at all (cheap to
// leave off when the window isn't open), "open window" opens/focuses the
// separate native window that actually renders them. Desktop-only --
// there's no second native window to open in the plain web REPL build.
function VisualizerControls({ visualizerOn, onToggleVisualizer }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-50">3d visualizer</div>
      {TAURI ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleVisualizer}
            title={visualizerOn ? 'stop feeding hap data to the visualizer window' : 'feed hap data to the visualizer window'}
            className={cx(
              'text-[10px] px-2 py-0.5 rounded border border-muted hover:opacity-90',
              visualizerOn ? 'text-[#89ddff] border-[#89ddff]/60' : 'opacity-70',
            )}
          >
            feeding: {visualizerOn ? 'on' : 'off'}
          </button>
          <button
            onClick={openVisualizerWindow}
            title="open (or focus) the 3D visualizer window"
            className="text-[10px] px-2 py-0.5 rounded border border-muted opacity-70 hover:opacity-100"
          >
            open window
          </button>
        </div>
      ) : (
        <div className="text-[10px] opacity-40">desktop app only</div>
      )}
    </div>
  );
}

export function GridToolsPanel({ context, visualizerOn, onToggleVisualizer }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 4, left: rect.left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClickOutside = (e) => {
      if (buttonRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-grid-tools-popover]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title="grid tools: tempo, mutate snippets, and the 3D visualizer"
        className={cx('flex items-center gap-1 px-1.5 hover:opacity-70', open && 'opacity-100')}
      >
        <AdjustmentsHorizontalIcon className="w-4 h-4" />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            data-grid-tools-popover
            style={{ position: 'fixed', top: coords.top, left: coords.left }}
            className="w-64 flex flex-col gap-3 bg-lineHighlight border border-muted rounded shadow-lg z-[200] p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Grid tools</span>
              <button onClick={() => setOpen(false)} title="close">
                <XMarkIcon className="w-3.5 h-3.5 opacity-50 hover:opacity-100" />
              </button>
            </div>
            <TempoControl context={context} />
            <div className="border-t border-muted" />
            <MutateBuilder context={context} />
            <div className="border-t border-muted" />
            <VisualizerControls visualizerOn={visualizerOn} onToggleVisualizer={onToggleVisualizer} />
          </div>,
          document.body,
        )}
    </div>
  );
}
