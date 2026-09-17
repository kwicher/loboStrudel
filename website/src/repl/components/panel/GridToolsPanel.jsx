// Consolidated Grid-side tool panel: tempo, mutate, filter-sweep and
// euclidean-rhythm snippet helpers, and the visualizer's on/off + "open"
// controls -- all in one column docked to the right of the Grid's own
// track list, inside GridTab.jsx. Previously these were split three ways:
// an inline widget in GridTab's toolbar (tempo), a wrench popover in the
// top app header (filter sweep, euclid, and for a while mutate too), and
// a bare toggle button (visualizer). Moved here per explicit request:
// "Tempo and other mutate should be in the same tool panel and by grid
// not on top of the window" -- and, on a later pass, "Track tools open
// just close to the button - they should open as a proper side panel
// right to the grid panel," which is why this is a plain docked column
// now, not a portal popover (GridTab.jsx renders it directly in a flex
// row next to the track list; no createPortal, no anchor-position math).
import { useEffect, useRef, useState } from 'react';
import cx from '@src/cx.mjs';
import { setVisualizerSetting, useVisualizerSettings } from '../../gridVisualizer.mjs';
import { closeToolsPopup, useToolsPopupOpen } from '../../patternGrid.mjs';
import { FloatingPopup } from './FloatingPopup.jsx';

function insertSnippet(context, snippet) {
  const editor = context.editorRef?.current;
  if (!editor) return;
  editor.insertCode(snippet, editor.getCursorLocation());
}

function ToolField({ label, value, onChange, min, max, width = 'w-14' }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="opacity-60">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={cx(width, 'bg-background text-foreground border border-muted rounded px-1 py-0.5 outline-none focus:border-foreground')}
      />
    </label>
  );
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
// that would do from buttons instead. This is separate from (and, unlike)
// the app-wide bpm box in the top header (Panel.jsx's own TempoControl,
// pre-existing, untouched by any of this) -- that one's a precise typed
// value, this one's a fast nudge/tap you don't have to look away from the
// grid for. cps is a plain mutable number on the scheduler (see
// patternGrid.mjs's header comment), not reactive, so this polls it
// rather than subscribing to anything.
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
        <button onClick={() => nudge(-1)} title="nudge tempo down" className="opacity-60 hover:opacity-100 text-xs px-1">
          -
        </button>
        <span
          className="font-mono text-[11px] w-10 text-center tabular-nums"
          title="cycles per second, live from the scheduler"
        >
          {cps.toFixed(2)}
        </span>
        <button onClick={() => nudge(1)} title="nudge tempo up" className="opacity-60 hover:opacity-100 text-xs px-1">
          +
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

function FilterSweepBuilder({ context }) {
  const [min, setMin] = useState(200);
  const [max, setMax] = useState(4000);
  const [cycles, setCycles] = useState(8);
  const snippet = `.cutoff(sine.range(${min || 0}, ${max || 0}).slow(${cycles || 1}))`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-50">filter sweep</div>
      <div className="flex items-center gap-2 flex-wrap">
        <ToolField label="min" value={min} onChange={setMin} min={20} max={20000} width="w-16" />
        <ToolField label="max" value={max} onChange={setMax} min={20} max={20000} width="w-16" />
        <ToolField label="cycles" value={cycles} onChange={setCycles} min={1} max={64} width="w-12" />
      </div>
      <InsertRow snippet={snippet} onInsert={() => insertSnippet(context, snippet)} />
    </div>
  );
}

// Standard Bjorklund-style Euclidean rhythm distribution -- only used to
// draw the preview grid here, not tied to Strudel's own .euclid()
// implementation, so it only needs to be visually correct.
function euclideanPattern(k, n) {
  k = Math.max(0, Math.min(k, n));
  if (n <= 0) return [];
  if (k <= 0) return Array(n).fill(false);
  if (k >= n) return Array(n).fill(true);
  let a = Array.from({ length: k }, () => [true]);
  let b = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const newA = [];
    for (let i = 0; i < m; i++) newA.push([...a[i], ...b[i]]);
    const remainder = a.length > b.length ? a.slice(m) : b.slice(m);
    a = newA;
    b = remainder;
  }
  return [...a, ...b].flat();
}

function EuclidBuilder({ context }) {
  const [k, setK] = useState(3);
  const [n, setN] = useState(8);
  const [rotation, setRotation] = useState(0);
  const steps = euclideanPattern(k || 0, n || 0);
  const snippet = rotation ? `.euclid(${k || 0}, ${n || 0}, ${rotation})` : `.euclid(${k || 0}, ${n || 0})`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-50">euclidean rhythm</div>
      <div className="flex gap-1 flex-wrap">
        {steps.length === 0 && <span className="text-[10px] opacity-40">set steps &gt; 0</span>}
        {steps.map((hit, i) => (
          <span key={i} className={cx('w-3.5 h-3.5 rounded-sm shrink-0', hit ? 'bg-[#89ddff]' : 'bg-background border border-muted')} />
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ToolField label="pulses" value={k} onChange={setK} min={0} max={32} />
        <ToolField label="steps" value={n} onChange={setN} min={1} max={32} />
        <ToolField label="rotate" value={rotation} onChange={setRotation} min={-32} max={32} />
      </div>
      <InsertRow snippet={snippet} onInsert={() => insertSnippet(context, snippet)} />
    </div>
  );
}

const PALETTES = [
  { value: 'spectrum', label: 'spectrum' },
  { value: 'mono', label: 'mono cyan' },
  { value: 'fire', label: 'fire' },
];

const STYLES = [
  { value: '3d', label: '3D particles' },
  { value: '2d', label: '2D lines (lighter)' },
];

// The visualizer replaced the old inline pianoroll toggle: "feeding"
// controls whether the combined buffer emits hap events at all (cheap to
// leave off when the popup isn't open), "open" opens the movable
// in-window visualizer popup (see GridVisualizerPopup.jsx) -- there's no
// separate native window anymore. Palette/intensity/bloom are read live by
// GridVisualizer3D.jsx (see gridVisualizer.mjs's useVisualizerSettings),
// so nudging a slider here changes the running scene immediately rather
// than needing the popup reopened -- the "maybe something that could be
// partly customized live" part of the request.
function VisualizerControls({ visualizerOn, onToggleVisualizer, onOpenVisualizer }) {
  const settings = useVisualizerSettings();
  const is3d = settings.style !== '2d';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-50">visualizer</div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleVisualizer}
          title={visualizerOn ? 'stop feeding hap data to the visualizer' : 'feed hap data to the visualizer'}
          className={cx(
            'text-[10px] px-2 py-0.5 rounded border border-muted hover:opacity-90',
            visualizerOn ? 'text-[#89ddff] border-[#89ddff]/60' : 'opacity-70',
          )}
        >
          feeding: {visualizerOn ? 'on' : 'off'}
        </button>
        <button
          onClick={onOpenVisualizer}
          title="open the visualizer popup"
          className="text-[10px] px-2 py-0.5 rounded border border-muted opacity-70 hover:opacity-100"
        >
          open
        </button>
      </div>
      <label className="flex items-center gap-2 text-[10px]">
        <span className="opacity-60 w-12 shrink-0">style</span>
        <select
          value={settings.style}
          onChange={(e) => setVisualizerSetting('style', e.target.value)}
          className="flex-1 bg-background text-foreground border border-muted rounded px-1 py-0.5 outline-none"
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[10px]">
        <span className="opacity-60 w-12 shrink-0">palette</span>
        <select
          value={settings.palette}
          onChange={(e) => setVisualizerSetting('palette', e.target.value)}
          className="flex-1 bg-background text-foreground border border-muted rounded px-1 py-0.5 outline-none"
        >
          {PALETTES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[10px]">
        <span className="opacity-60 w-12 shrink-0">{is3d ? 'burst' : 'boost'}</span>
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.1}
          value={settings.intensity}
          onChange={(e) => setVisualizerSetting('intensity', Number(e.target.value))}
          className="flex-1"
        />
      </label>
      {is3d && (
        <>
          <label className="flex items-center gap-2 text-[10px]">
            <span className="opacity-60 w-12 shrink-0">bloom</span>
            <input
              type="range"
              min={0}
              max={2.5}
              step={0.1}
              value={settings.bloom}
              onChange={(e) => setVisualizerSetting('bloom', Number(e.target.value))}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-2 text-[10px]" title="background particle count -- the main cost knob for the 3D style">
            <span className="opacity-60 w-12 shrink-0">spots</span>
            <input
              type="range"
              min={0}
              max={800}
              step={50}
              value={settings.ambientCount}
              onChange={(e) => setVisualizerSetting('ambientCount', Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-8 text-right opacity-50 tabular-nums">{settings.ambientCount}</span>
          </label>
        </>
      )}
    </div>
  );
}

const SIZE = { width: 300, height: 640 };

// Floating popup, not a docked column -- it used to be squeezed into a
// narrow column inside GridTab that needed inner scrolling to see
// everything; per explicit request ("cramped in the corner and require
// scrolling... should also be a floating pop-up DIV") it's now sized
// generously enough that its five sections fit without scrolling on a
// normal-height window, with overflow-auto (from FloatingPopup) as a
// fallback rather than the default. Self-gates on the shared open flag
// (patternGrid.mjs) so GridTab can render it unconditionally -- it
// returns null when closed, same pattern as GridVisualizerPopup.jsx.
export function GridToolsPanel({ context, visualizerOn, onToggleVisualizer, onOpenVisualizer }) {
  const open = useToolsPopupOpen();
  if (!open) return null;
  return (
    <FloatingPopup
      title="grid tools"
      onClose={closeToolsPopup}
      width={SIZE.width}
      height={SIZE.height}
      defaultPosition={() => ({ left: 32, top: Math.max(16, window.innerHeight - SIZE.height - 96) })}
    >
      <div className="flex flex-col gap-3 p-2">
        <TempoControl context={context} />
        <div className="border-t border-muted" />
        <MutateBuilder context={context} />
        <div className="border-t border-muted" />
        <FilterSweepBuilder context={context} />
        <div className="border-t border-muted" />
        <EuclidBuilder context={context} />
        <div className="border-t border-muted" />
        <VisualizerControls visualizerOn={visualizerOn} onToggleVisualizer={onToggleVisualizer} onOpenVisualizer={onOpenVisualizer} />
      </div>
    </FloatingPopup>
  );
}
