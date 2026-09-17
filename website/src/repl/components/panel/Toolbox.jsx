// Small snippet-insertion helpers for techniques every arrangement/
// generative-music guide leans on but that are easy to forget the exact
// Strudel syntax for: a filter-sweep automation macro (the "gradually
// opening/closing a low-pass filter" technique nearly every electronic-
// music arrangement guide uses to make a static loop feel like it's going
// somewhere) and a Euclidean-rhythm step-grid (`.euclid(k, n)` already
// exists in Strudel -- the barrier is remembering which (k, n) sounds like
// what, not the syntax itself). Both just insert a code snippet at the
// cursor via StrudelMirror's own insertCode()/getCursorLocation() API --
// nothing here runs any code itself, it only writes text.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WrenchScrewdriverIcon, XMarkIcon } from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';

// Standard Bjorklund-style Euclidean rhythm distribution -- only used to
// draw the preview grid here, not tied to Strudel's own .euclid()
// implementation, so it only needs to be visually correct, not identical
// bit-for-bit to the runtime.
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

// A curated set of small randomized transformations -- same spirit as
// the two builders above, but for chaos rather than a specific
// technique: roll one, see it, insert it at the cursor. Deliberately
// insert-at-cursor rather than auto-appending to the whole pattern --
// appending blindly to the end of arbitrary code is exactly the kind of
// fragile text-mutation this codebase moved away from (see
// patternTitles.mjs's header comment for the bug that caused that), and
// it would land in the wrong place, or do nothing useful, on any pattern
// with more than one top-level `$:` block. This puts the same choice a
// manual edit would require in your hands, just with the boilerplate
// (and the randomized numbers) written for you.
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

export function Toolbox({ context }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);

  // The header row this button lives in (MainMenu, Panel.jsx) is
  // `overflow-hidden h-10` so it can't wrap/scroll on narrow windows --
  // which also silently clips any absolutely-positioned child dropdown
  // to zero visible height. That's why this looked like "does not work":
  // the popover WAS opening, just invisible. Portal it to document.body
  // and position it from the button's own screen rect instead, the same
  // pattern already used for the doc-search modal (Search.tsx).
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
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
      if (e.target.closest?.('[data-toolbox-popover]')) return;
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
        title="toolbox: filter sweep, euclidean rhythm, and mutate snippet helpers"
        className="px-2 hover:opacity-50"
      >
        <WrenchScrewdriverIcon className="w-4 h-4" />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            data-toolbox-popover
            style={{ position: 'fixed', top: coords.top, right: coords.right }}
            className="w-64 flex flex-col gap-3 bg-lineHighlight border border-muted rounded shadow-lg z-[200] p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Toolbox</span>
              <button onClick={() => setOpen(false)} title="close">
                <XMarkIcon className="w-3.5 h-3.5 opacity-50 hover:opacity-100" />
              </button>
            </div>
            <div className="text-[9px] opacity-50 -mt-2 leading-tight">
              inserts a code snippet at your cursor -- edit the numbers afterward like any other code
            </div>
            <FilterSweepBuilder context={context} />
            <div className="border-t border-muted" />
            <EuclidBuilder context={context} />
            <div className="border-t border-muted" />
            <MutateBuilder context={context} />
          </div>,
          document.body,
        )}
    </div>
  );
}
