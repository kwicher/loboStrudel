import useEvent from '@src/useEvent.mjs';
import { useStore } from '@nanostores/react';
import { getAudioContext, soundMap, superdough, analysers, getAnalyzerData } from '@strudel/webaudio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { settingsMap, soundFilterType, useSettings } from '../../../settings.mjs';
import ImportSoundsButton from './ImportSoundsButton.jsx';
import { PanelHeader } from './PanelHeader.jsx';
import { ActionButton } from '../button/action-button.jsx';
import { confirmDialog } from '@src/repl/util.mjs';
import { clearIDB, userSamplesDBConfig } from '@src/repl/idbutils.mjs';
import { prebake } from '@src/repl/prebake.mjs';
import cx from '@src/cx.mjs';
import {
  isFavorite,
  toggleFavorite,
  getFavoriteTags,
  setFavoriteTags,
  favoritesMatchSearch,
  useSoundFavorites,
} from '@src/repl/soundFavorites.mjs';
import {
  savePreset,
  deletePreset,
  useSoundPresets,
  listPresets,
  presetToPatternString,
} from '@src/repl/soundPresets.mjs';
import {
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
  MusicalNoteIcon,
  Square2StackIcon,
  PlayIcon,
  XMarkIcon,
  StarIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  BookmarkIcon,
  TrashIcon,
  FolderIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  ArrowsPointingOutIcon,
  SparklesIcon,
} from '@heroicons/react/16/solid';

const getSamples = (samples) =>
  Array.isArray(samples) ? samples.length : typeof samples === 'object' ? Object.values(samples).length : 1;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parses whatever a slider's "advanced" text field holds into a real value:
// JSON first (covers plain numbers, "{...}" objects, arrays, strings), then
// a bare JS expression (covers things like "1/3" or a shorthand object
// without quoted keys), then falls back to a plain float, then the raw
// string itself if nothing else made sense of it. Never throws -- worst
// case the literal text goes through as-is, which is still a valid string
// value for the pattern param it's headed for.
function parseRawValue(text) {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {}
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${trimmed});`)();
  } catch {}
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? trimmed : n;
}

// A dedicated analyser id for the sounds-browser preview, so it never
// collides with whatever ids a pattern's own .scope()/.spectrum() is using.
const PREVIEW_ANALYSER_ID = 'sounds-preview';

// Single source of truth for what belongs in each filter pill, shared by
// the main list and the pill counts so they can never drift apart.
function matchesFilter(filterKey, name, data) {
  if (filterKey === 'favorites') return isFavorite(name);
  if (filterKey === soundFilterType.USER) return !data.prebake;
  if (filterKey === soundFilterType.DRUMS) return data.type === 'sample' && data.tag === 'drum-machines';
  if (filterKey === soundFilterType.SAMPLES) return data.type === 'sample' && data.tag !== 'drum-machines';
  if (filterKey === soundFilterType.SYNTHS) return ['synth', 'soundfont'].includes(data.type);
  if (filterKey === soundFilterType.WAVETABLES) return data.type === 'wavetable';
  return true;
}

const FILTERS = {
  favorites: '★ favorites',
  samples: 'samples',
  drums: 'drum-machines',
  synths: 'synths',
  wavetables: 'wavetables',
  user: 'user',
  importSounds: 'import',
};

function typeIcon(data) {
  if (data?.type === 'sample') return SpeakerWaveIcon;
  if (data?.type === 'wavetable') return Square2StackIcon;
  return MusicalNoteIcon; // synth, soundfont
}

// Works across every sound type: sample banks keep their files in
// data.samples, wavetables in data.tables, soundfonts in data.fonts --
// synths (plain oscillators) have none of these and count as one.
function bankCount(data) {
  if (data?.type === 'sample') return getSamples(data.samples);
  if (data?.type === 'wavetable') return getSamples(data.tables);
  if (data?.type === 'soundfont') return (data.fonts || []).length;
  return 1;
}

// Flattens a bank's raw file list into { n, note, label } rows the popup
// can play individually. Handles both shapes superdough uses: a flat array
// of file URLs (drum hits, wavetables, most sample banks) and an object
// keyed by note (pitched multi-sample instruments).
function fileEntries(source) {
  const fileLabel = (url) => decodeURIComponent(String(url).split(/[\\/]/).pop() || String(url));
  if (Array.isArray(source)) {
    return source.map((url, n) => ({ n, note: undefined, label: fileLabel(url) }));
  }
  const rows = [];
  Object.entries(source || {})
    .filter(([k]) => !k.startsWith('_'))
    .forEach(([note, arr]) => {
      (Array.isArray(arr) ? arr : [arr]).forEach((url, n) => {
        rows.push({ n, note, label: `${note} · ${fileLabel(url)}` });
      });
    });
  return rows;
}

function bankEntries(data) {
  if (data.type === 'sample') return fileEntries(data.samples);
  if (data.type === 'wavetable') return fileEntries(data.tables);
  if (data.type === 'soundfont') return (data.fonts || []).map((f, n) => ({ n, note: undefined, label: String(f) }));
  return []; // synth: nothing to list, just the bank itself
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn('[sounds] clipboard write failed', e);
    return false;
  }
}

function FavoriteStar({ id, className }) {
  useSoundFavorites(); // subscribe so clicking re-renders this star
  const fav = isFavorite(id);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(id);
      }}
      title={fav ? 'remove from favorites' : 'add to favorites'}
      className={cx('shrink-0', className)}
    >
      <StarIcon className={cx('w-3.5 h-3.5', fav ? 'text-[#ffcb6b]' : 'opacity-25 hover:opacity-60')} />
    </button>
  );
}

function CopyButton({ text, className }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyToClipboard(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1100);
        }
      }}
      title={`copy ${text}`}
      className={cx('shrink-0 opacity-40 hover:opacity-90', className)}
    >
      {copied ? <span className="text-[10px] text-[#c3e88d]">copied</span> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
}

// The type icon (speaker for samples, etc.) doubles as a play control:
// click it to preview the sound once, the normal way; keep it held down
// and after a short beat it starts retriggering on an interval -- the same
// "re-fire the sound on a timer" technique the popup's own loop toggle
// uses (there's no native indefinite-loop primitive here) -- until
// released. Clicking anywhere else on the card still opens the full
// preview popup, unchanged.
const HOLD_LOOP_DELAY_MS = 220;
const HOLD_LOOP_INTERVAL_MS = 750;

function SoundCard({ name, data, onOpen, onPlay }) {
  const Icon = typeIcon(data);
  const count = bankCount(data);
  useSoundFavorites();

  const holdTimeoutRef = useRef(null);
  const loopIntervalRef = useRef(null);
  const [looping, setLooping] = useState(false);

  const playOnce = () => onPlay(name, data, {});

  const stopHold = () => {
    clearTimeout(holdTimeoutRef.current);
    clearInterval(loopIntervalRef.current);
    holdTimeoutRef.current = null;
    loopIntervalRef.current = null;
    setLooping(false);
  };
  useEffect(() => stopHold, []);

  const startHold = (e) => {
    e.stopPropagation();
    if (e.button != null && e.button !== 0) return; // left-click / touch only
    playOnce();
    holdTimeoutRef.current = setTimeout(() => {
      setLooping(true);
      loopIntervalRef.current = setInterval(playOnce, HOLD_LOOP_INTERVAL_MS);
    }, HOLD_LOOP_DELAY_MS);
  };
  const endHold = (e) => {
    e?.stopPropagation();
    stopHold();
  };

  return (
    <button
      onClick={onOpen}
      title={`s("${name}")`}
      className={cx(
        'group relative flex flex-col items-start gap-1 px-2.5 py-2 rounded-md border text-left select-none',
        'border-muted hover:border-foreground/40 hover:bg-background/40',
      )}
    >
      {isFavorite(name) && <StarIcon className="w-3 h-3 absolute top-1.5 right-1.5 text-[#ffcb6b]" />}
      <span
        role="button"
        tabIndex={-1}
        title="click: play once · hold: loop"
        onMouseDown={startHold}
        onMouseUp={endHold}
        onMouseLeave={endHold}
        onTouchStart={startHold}
        onTouchEnd={endHold}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'inline-flex rounded p-0.5 -m-0.5 shrink-0',
          looping ? 'opacity-100 text-[#89ddff]' : 'opacity-60 hover:opacity-100',
        )}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-xs font-mono truncate w-full">{name}</span>
      {count > 1 && <span className="text-[10px] opacity-40">{count} sample{count === 1 ? '' : 's'}</span>}
    </button>
  );
}

// A saved sound+parameter preset, rendered in its own grid (toggled via the
// "presets" pill) instead of the regular sound list. Clicking the card
// reopens it in the preview popup pre-loaded with its saved params (so it
// can be tweaked and re-saved); the inline play button previews it
// immediately without opening anything.
function PresetCard({ preset, onOpen, onPlay }) {
  return (
    <div
      onClick={onOpen}
      title={presetToPatternString(preset)}
      className={cx(
        'group relative flex flex-col items-start gap-1 px-2.5 py-2 rounded-md border text-left select-none cursor-pointer',
        'border-muted hover:border-foreground/40 hover:bg-background/40',
      )}
    >
      <BookmarkIcon className="w-4 h-4 shrink-0 opacity-60" />
      <span className="text-xs font-mono truncate w-full">{preset.name}</span>
      <span className="text-[10px] opacity-40 truncate w-full">
        {preset.sound}
        {preset.n ? `:${preset.n}` : ''}
      </span>
      <div className="flex items-center gap-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onPlay(preset)} title="play" className="shrink-0 opacity-50 hover:opacity-100">
          <PlayIcon className="w-3.5 h-3.5" />
        </button>
        <CopyButton text={presetToPatternString(preset)} />
        <button
          onClick={() => deletePreset(preset.id)}
          title="delete preset"
          className="shrink-0 opacity-40 hover:opacity-90 hover:text-red-400"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// Small waveform/spectrum canvas shared by whatever is currently
// previewing inside the popup -- one "universal" visualizer rather than a
// separate one per row, with a mode toggle (waveform vs spectrum).
// Reads from Strudel's own analyser registry (the same one .scope() /
// .spectrum() pattern methods read from) rather than tapping a raw
// AudioNode -- superdough() owns the actual signal graph, we just poll
// whatever it published under PREVIEW_ANALYSER_ID.
//
// `autoScale`, when on, renormalizes each frame to its own peak instead of
// drawing against a fixed -1..1 (waveform) or -100..-10dB (spectrum) range
// -- a quiet sample that only ever nudges the signal a few percent of full
// scale otherwise draws as a near-flat line even though it's perfectly
// audible. Off by default since it trades "how loud is this really" for
// "what does its shape look like", and the two aren't the same question.
function Visualizer({ mode, autoScale }) {
  const canvasRef = useRef();
  const rafRef = useRef();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const analyser = analysers[PREVIEW_ANALYSER_ID];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (analyser) {
        ctx.strokeStyle = '#89ddff';
        ctx.fillStyle = 'rgba(137,221,255,0.5)';
        ctx.lineWidth = 1.5;
        if (mode === 'spectrum') {
          const dataArray = getAnalyzerData('frequency', PREVIEW_ANALYSER_ID); // Float32Array, dB
          const bufferLength = dataArray.length;
          const barWidth = canvas.width / bufferLength;
          let min = -100;
          let max = -10;
          if (autoScale) {
            // Stretch the loudest bin in this frame up to the top of the
            // canvas, keep the noise floor pinned to the bottom.
            let peak = -Infinity;
            for (let i = 0; i < bufferLength; i++) {
              if (dataArray[i] > peak) peak = dataArray[i];
            }
            if (Number.isFinite(peak) && peak > min + 3) {
              max = peak;
            }
          }
          for (let i = 0; i < bufferLength; i++) {
            const norm = Math.max(0, Math.min(1, (dataArray[i] - min) / (max - min)));
            const h = norm * canvas.height;
            ctx.fillRect(i * barWidth, canvas.height - h, Math.max(barWidth - 1, 1), h);
          }
        } else {
          const dataArray = getAnalyzerData('time', PREVIEW_ANALYSER_ID); // Float32Array, roughly -1..1
          const bufferLength = dataArray.length;
          const sliceWidth = canvas.width / bufferLength;
          let scale = 1;
          if (autoScale) {
            // Stretch this frame's peak sample out to the edges of the
            // canvas rather than the theoretical -1..1 full scale, so a
            // quiet sample still fills the view instead of drawing as a
            // near-flat line down the middle.
            let peak = 0;
            for (let i = 0; i < bufferLength; i++) {
              const abs = Math.abs(dataArray[i]);
              if (abs > peak) peak = abs;
            }
            if (peak > 0.001) {
              scale = Math.min(1 / peak, 40);
            }
          }
          let x = 0;
          ctx.beginPath();
          for (let i = 0; i < bufferLength; i++) {
            const y = canvas.height / 2 - Math.max(-1, Math.min(1, dataArray[i] * scale)) * (canvas.height / 2);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = 'rgba(138,145,153,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoScale]);

  return <canvas ref={canvasRef} width={352} height={72} className="w-full rounded border border-muted" />;
}

// A collapsible group of sliders. `badge`, when > 0, renders a small pill
// next to the title showing how many params inside are off their default --
// so a closed group still tells you at a glance whether anything in it is
// touched, without having to open it to check.
function Accordion({ title, defaultOpen = false, badge, onNudge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-muted/60 rounded-md overflow-hidden shrink-0">
      <div className="w-full flex items-center justify-between px-2 py-1.5 bg-background/20">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide opacity-70 hover:opacity-100 grow text-left"
        >
          {title}
          {badge > 0 && (
            <span className="normal-case tracking-normal text-[9px] leading-none px-1.5 py-0.5 rounded-full bg-[#89ddff]/20 text-[#89ddff]">
              {badge}
            </span>
          )}
        </button>
        {onNudge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNudge();
            }}
            title="nudge this group's sliders by a small random amount"
            className="shrink-0 opacity-40 hover:opacity-90 px-1"
          >
            <SparklesIcon className="w-3 h-3" />
          </button>
        )}
        <button onClick={() => setOpen((o) => !o)} className="shrink-0 opacity-70 hover:opacity-100">
          <ChevronDownIcon className={cx('w-3 h-3 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && <div className="p-2 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

// Double-clicking the label or the value resets just this slider to its
// default -- the whole-popup "reset all" button lives above the slider
// stack, not per-slider, so this is the fast single-parameter undo.
// Clicking the value (single click) turns it into a real number input, so
// the slider and the number stay two directions of the same state rather
// than the number being read-only. `presets`, when given, renders a row of
// quick-pick chips under the slider for values worth naming (pan center,
// common cutoffs, etc.) as an alternative to dragging or typing.
function Slider({ label, value, min, max, step, onChange, format, defaultValue, presets }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const reset = () => defaultValue != null && onChange(defaultValue);
  const resettable = defaultValue != null && value !== defaultValue;

  const commitDraft = () => {
    const n = parseFloat(draft);
    if (!Number.isNaN(n)) {
      onChange(Math.min(max, Math.max(min, n)));
    }
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cx('w-11 shrink-0 select-none cursor-pointer', resettable ? 'opacity-90 text-[#89ddff]' : 'opacity-60')}
          title="double-click to reset to default"
          onDoubleClick={reset}
        >
          {label}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full"
          style={{ accentColor: '#89ddff' }}
        />
        {editing ? (
          <input
            autoFocus
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-14 shrink-0 text-right font-mono text-[11px] bg-background/40 border border-muted rounded px-1 outline-none focus:border-foreground/40"
          />
        ) : (
          <span
            className="w-12 shrink-0 text-right font-mono opacity-70 select-none cursor-text"
            title="click to type a value, double-click to reset"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            onDoubleClick={reset}
          >
            {format ? format(value) : value}
          </span>
        )}
      </div>
      {presets && (
        <div className="flex gap-1 pl-[52px]">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => onChange(p.value)}
              className={cx(
                'px-1.5 py-0.5 rounded text-[9px] border',
                value === p.value ? 'border-[#89ddff] text-[#89ddff]' : 'border-muted opacity-45 hover:opacity-90',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One combined "advanced" field per slider group instead of one per slider
// -- it always opens pre-filled with that group's current slider values
// (so it's never a blank box you have to reconstruct from scratch), and
// anything you add beyond those keys rides along as an extra param on top
// of the sliders (e.g. a strudel control this popup doesn't have a slider
// for). Editing it re-syncs in both directions: a numeric value for a key
// that matches a slider moves that slider (and the slider moving again
// hands control back, via `setRawOverride` clearing on drag -- see
// `bindSlider` in the popup); a non-numeric value for a slider key
// overrides it without moving the slider (there's no way to represent
// "{...}" on a range input). Commits on blur; Escape discards the edit.
function tryParseParams(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: {} };
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v };
    return { ok: false, error: 'must be an object, like {"gain":1}' };
  } catch (jsonErr) {
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict"; return (${trimmed});`)();
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v };
      return { ok: false, error: 'must be an object, like {"gain":1}' };
    } catch (jsErr) {
      return { ok: false, error: jsErr.message || jsonErr.message || 'invalid syntax' };
    }
  }
}

// One combined "advanced" field per slider group instead of one per slider
// -- it always opens pre-filled with that group's current slider values
// (so it's never a blank box you have to reconstruct from scratch), and
// anything you add beyond those keys rides along as an extra param on top
// of the sliders (e.g. a strudel control this popup doesn't have a slider
// for).
//
// Two-way sync: while the box isn't being edited (`draft === null`) it
// always mirrors the live slider values, so dragging a slider updates the
// box text on every render. Editing it back the other way is deliberately
// NOT tied to blur alone -- Enter commits immediately (Shift+Enter for a
// literal newline), matching every other single-purpose field in this
// popup, so typing a value and hitting Enter is enough to move the slider;
// blur commits too, for anyone who just clicks away instead.
//
// "Linting": every keystroke is parsed for real (JSON first, then a bare
// JS expression, so `{gain:1}` without quoted keys still works) rather
// than pattern-matched with a regex, which can't actually tell valid JS
// object syntax from invalid -- a regex permissive enough to accept every
// legal form would also accept plenty of illegal ones. An invalid draft
// shows its parser's own error message in red and is never silently
// discarded on blur -- it stays exactly as typed until it either parses
// (and commits) or the user presses Escape to explicitly throw it away.
function GroupParamsBox({ sliderKeys, values, rawOverrides, setRawOverride, setSliderValue, extras, setExtras }) {
  const [draft, setDraft] = useState(null); // null = not editing, mirrors live values
  const [error, setError] = useState(null);
  const skipNextBlurRef = useRef(false);

  const buildObject = () => {
    const obj = {};
    sliderKeys.forEach((key) => {
      obj[key] = Object.prototype.hasOwnProperty.call(rawOverrides, key) ? parseRawValue(rawOverrides[key]) : values[key];
    });
    Object.assign(obj, extras);
    return obj;
  };

  const displayText = () => {
    try {
      return JSON.stringify(buildObject());
    } catch {
      return '{}';
    }
  };

  const apply = (parsed) => {
    sliderKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        const v = parsed[key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          setSliderValue(key, v);
          setRawOverride(key, null);
        } else {
          setRawOverride(key, JSON.stringify(v));
        }
      } else {
        // key removed from the box -- fall back to the slider's own value
        setRawOverride(key, null);
      }
    });
    const nextExtras = {};
    Object.entries(parsed).forEach(([key, v]) => {
      if (!sliderKeys.includes(key)) nextExtras[key] = v;
    });
    setExtras(nextExtras);
  };

  const commit = () => {
    if (draft == null) return;
    const result = tryParseParams(draft);
    if (!result.ok) {
      setError(result.error);
      return; // keep the invalid text on screen instead of silently discarding it
    }
    apply(result.value);
    setError(null);
    setDraft(null);
  };

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  return (
    <div className="pt-1 mt-1 border-t border-muted/40 flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-40">
        <CodeBracketIcon className="w-3 h-3" />
        advanced
      </div>
      <textarea
        rows={2}
        value={draft ?? displayText()}
        onFocus={() => {
          if (draft == null) setDraft(displayText());
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const result = tryParseParams(e.target.value);
          setError(result.ok ? null : result.error);
        }}
        onBlur={() => {
          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            skipNextBlurRef.current = true;
            cancel();
            e.currentTarget.blur();
          }
        }}
        spellCheck={false}
        placeholder='{"gain":1,"cutoff":20000,...}'
        className={cx(
          'w-full font-mono text-[10px] text-foreground bg-background border rounded px-1.5 py-1 outline-none resize-y',
          error ? 'border-red-400/70 focus:border-red-400' : 'border-muted focus:border-foreground',
        )}
      />
      {error && <div className="text-[9px] text-red-400/90 leading-tight">{error}</div>}
    </div>
  );
}

// Parses text typed as chained pattern-method calls -- ".duck(1).soft(1)" --
// into a flat {duck: 1, soft: 1} params object. This is deliberately NOT a
// real Strudel/JS parser: it only recognizes the one shape that matters
// here, repeated ".name(arg)" calls, via regex, then reuses parseRawValue
// (JSON, then a bare JS expression, then a plain number or string) to
// evaluate each arg. Anything left over after stripping every recognized
// ".name(arg)" call is treated as a syntax error rather than silently
// dropped, which is the "linting" this box needs just as much as the
// per-group advanced boxes do.
function parseChainedModifiers(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: {} };
  const callPattern = /\.([a-zA-Z_$][\w$]*)\(([^()]*)\)/g;
  const value = {};
  let match;
  while ((match = callPattern.exec(trimmed)) !== null) {
    const [, key, argText] = match;
    const parsed = parseRawValue(argText.trim());
    value[key] = parsed === undefined ? argText.trim() : parsed;
  }
  const leftover = trimmed.replace(/\.([a-zA-Z_$][\w$]*)\(([^()]*)\)/g, '').trim();
  if (leftover !== '') {
    return { ok: false, error: `couldn't parse "${leftover.slice(0, 40)}" -- expected .name(value) calls, e.g. .duck(1).soft(1)` };
  }
  return { ok: true, value };
}

// The free-text field at the very bottom of the popup: chained
// ".method(arg)" calls for any pattern param this popup has no dedicated
// control for at all (not even via a GroupParamsBox), typed exactly the way
// they'd be typed into a real pattern. Same commit-on-Enter/blur, same
// "never silently discard an invalid edit" behavior as GroupParamsBox, but
// there's no live value to mirror when not editing -- the committed text
// itself is the source of truth, held by the parent.
function ExtraModifiersBox({ value, onCommit }) {
  const [draft, setDraft] = useState(null); // null = show the committed `value`
  const [error, setError] = useState(null);
  const skipNextBlurRef = useRef(false);

  const commit = () => {
    if (draft == null) return;
    const result = parseChainedModifiers(draft);
    if (!result.ok) {
      setError(result.error);
      return; // keep the invalid text on screen instead of silently discarding it
    }
    onCommit(draft.trim(), result.value);
    setError(null);
    setDraft(null);
  };

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-40">
        <CodeBracketIcon className="w-3 h-3" />
        extra modifiers
      </div>
      <textarea
        rows={2}
        value={draft ?? value}
        onFocus={() => {
          if (draft == null) setDraft(value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const result = parseChainedModifiers(e.target.value);
          setError(result.ok ? null : result.error);
        }}
        onBlur={() => {
          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            skipNextBlurRef.current = true;
            cancel();
            e.currentTarget.blur();
          }
        }}
        spellCheck={false}
        placeholder=".duck(1).soft(1)"
        className={cx(
          'w-full font-mono text-[10px] text-foreground bg-background border rounded px-1.5 py-1 outline-none resize-y',
          error ? 'border-red-400/70 focus:border-red-400' : 'border-muted focus:border-foreground',
        )}
      />
      {error && <div className="text-[9px] text-red-400/90 leading-tight">{error}</div>}
    </div>
  );
}

const MAX_CUTOFF = 20000;
const MAX_CRUSH = 16; // bit depth -- higher is cleaner, so "off" sits at the max end like MAX_CUTOFF

// One place for every preview slider's resting value, shared by each
// useState initializer and the "reset all" button so they can't drift.
const SLIDER_DEFAULTS = {
  gain: 1,
  cutoff: MAX_CUTOFF,
  speed: 1,
  pan: 0.5,
  attack: 0.005,
  decay: 0,
  sustain: 1,
  release: 0.5,
  room: 0,
  delay: 0,
  crush: MAX_CRUSH,
  shape: 0,
  vib: 0,
  vibmod: 0.5,
  tremolo: 0,
  tremolodepth: 0.5,
  fm: 0,
  fmh: 1,
};

// Which sliders belong to which accordion group -- shared by the group
// headers' badge counts and each group's GroupParamsBox (so a param can't
// end up claimed by two boxes, or by none).
const SLIDER_GROUPS = {
  levels: ['gain', 'cutoff', 'speed', 'pan'],
  envelope: ['attack', 'decay', 'sustain', 'release'],
  fx: ['room', 'delay', 'crush', 'shape'],
  lfo: ['vib', 'vibmod', 'tremolo', 'tremolodepth'],
  fm: ['fm', 'fmh'],
};

// Real min/max for each slider (mirrors the actual <Slider> props below) --
// needed so "nudge" can stay inside the same bounds a drag would, instead
// of wandering off into silent or absurd territory.
const SLIDER_RANGES = {
  gain: [0, 2],
  cutoff: [200, MAX_CUTOFF],
  speed: [0.25, 2],
  pan: [0, 1],
  attack: [0, 1],
  decay: [0, 1],
  sustain: [0, 1],
  release: [0.05, 2],
  room: [0, 1],
  delay: [0, 1],
  crush: [1, MAX_CRUSH],
  shape: [0, 1],
  vib: [0, 20],
  vibmod: [0, 2],
  tremolo: [0, 20],
  tremolodepth: [0, 1],
  fm: [0, 20],
  fmh: [0.5, 8],
};
// How far a nudge can move a value, as a fraction of that slider's full
// range -- "ordered chaos" per the generative-music research (MusicRadar):
// enough to actually be heard, not so much it stops sounding like the same
// sound. cutoff/crush get their own smaller fraction since their ranges are
// huge and a straight 10% of 19800Hz would wreck the filter.
const NUDGE_FRACTION = 0.1;
const NUDGE_FRACTION_WIDE = { cutoff: 0.03, crush: 0.2 };
function nudgedValue(key, value) {
  const [min, max] = SLIDER_RANGES[key] ?? [0, 1];
  const span = max - min;
  const fraction = NUDGE_FRACTION_WIDE[key] ?? NUDGE_FRACTION;
  const delta = (Math.random() * 2 - 1) * span * fraction;
  return Math.min(max, Math.max(min, value + delta));
}

// The universal preview popup: opens for every sound (single or
// multi-sample), lets you browse and play each individual sample inside a
// bank, audition them through gain/filter/speed sliders and a shared
// waveform/spectrum visualizer, favorite individual samples with tags, and
// copy the bank name to paste into a pattern.
function SoundPreviewPopup({ name, data, initialParams, initialTarget, onPlay, onClose }) {
  const entries = useMemo(() => bankEntries(data), [data]);
  const init = (key) => initialParams?.[key] ?? SLIDER_DEFAULTS[key];
  const [vizMode, setVizMode] = useState('wave');
  const [autoScale, setAutoScale] = useState(false);
  const [gain, setGain] = useState(init('gain'));
  const [cutoff, setCutoff] = useState(init('cutoff'));
  const [speed, setSpeed] = useState(init('speed'));
  const [pan, setPan] = useState(init('pan'));
  const [attack, setAttack] = useState(init('attack'));
  const [decay, setDecay] = useState(init('decay'));
  const [sustain, setSustain] = useState(init('sustain'));
  const [release, setRelease] = useState(init('release'));
  const [room, setRoom] = useState(init('room'));
  const [delay, setDelay] = useState(init('delay'));
  const [crush, setCrush] = useState(init('crush'));
  const [shape, setShape] = useState(init('shape'));
  const [vib, setVib] = useState(init('vib'));
  const [vibmod, setVibmod] = useState(init('vibmod'));
  const [tremolo, setTremolo] = useState(init('tremolo'));
  const [tremolodepth, setTremolodepth] = useState(init('tremolodepth'));
  const [fm, setFm] = useState(init('fm'));
  const [fmh, setFmh] = useState(init('fmh'));
  const [playingId, setPlayingId] = useState(null);
  const [loop, setLoop] = useState(false);
  // Per-param "advanced" text overrides (see the Slider component's raw
  // field) -- a dict rather than one useState per slider so adding another
  // param never means adding another hook. Absent/undefined means "use the
  // slider's own numeric value", which is the common case.
  const [rawOverrides, setRawOverrides] = useState(() => ({ ...(initialParams?.__raw ?? {}) }));
  const setRawOverride = (key, text) => {
    setRawOverrides((prev) => {
      const next = { ...prev };
      if (text == null || text.trim() === '') delete next[key];
      else next[key] = text;
      return next;
    });
  };
  // Extra params typed into a group's GroupParamsBox that don't match any
  // slider in that group (e.g. a strudel control this popup has no slider
  // for) -- keyed by group so two boxes can't clobber each other's extras.
  const [groupExtras, setGroupExtras] = useState(() => {
    const seed = initialParams?.__extra ?? {};
    return Object.fromEntries(Object.keys(SLIDER_GROUPS).map((g) => [g, { ...(seed[g] ?? {}) }]));
  });
  const setGroupExtra = (groupKey, next) => setGroupExtras((prev) => ({ ...prev, [groupKey]: next }));
  const extraParams = () => Object.assign({}, ...Object.values(groupExtras));
  // The bottom-of-popup ".duck(1).soft(1)"-style free text -- separate from
  // groupExtras since it isn't scoped to any one slider group. extraMods is
  // the parsed object (kept alongside the raw text so it doesn't need
  // reparsing on every play/save), extraModsText is what's shown/re-seeded.
  const [extraModsText, setExtraModsText] = useState(initialParams?.__extraModsText ?? '');
  const [extraMods, setExtraMods] = useState(() => {
    const seeded = parseChainedModifiers(initialParams?.__extraModsText ?? '');
    return seeded.ok ? seeded.value : {};
  });
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [tagsInput, setTagsInput] = useState(() => getFavoriteTags(name).join(', '));
  const timeoutRef = useRef();
  const loopIntervalRef = useRef(null);
  // Remembers what to re-trigger when looping: defaults to the bank itself
  // (or its first entry, for a multi-sample bank) until the user plays a
  // specific row.
  const lastPlayRef = useRef(
    initialTarget ?? { n: 0, note: undefined, id: entries.length > 1 ? `${name}:0` : name },
  );
  useSoundFavorites();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Every slider that's still at its default is left out entirely, both for
  // playback (so an untouched sound plays exactly like before any of this
  // popup existed) and for saved presets (so a preset only remembers what
  // you actually changed).
  const activeParams = () => ({
    gain: gain !== SLIDER_DEFAULTS.gain ? gain : undefined,
    cutoff: cutoff < MAX_CUTOFF ? cutoff : undefined,
    speed: speed !== SLIDER_DEFAULTS.speed ? speed : undefined,
    pan: pan !== SLIDER_DEFAULTS.pan ? pan : undefined,
    // attack is always sent (even at its default) because superdough's
    // getADSRValues() picks a different implicit sustain default depending
    // on whether attack was provided at all -- omitting it here would
    // silently swap "full sustain" for "cut off almost immediately" on
    // every sound that hasn't had its envelope touched. decay/sustain
    // below are safe to omit since they're genuinely new controls with no
    // such fallback interaction.
    attack,
    decay: decay > 0 ? decay : undefined,
    sustain: sustain !== SLIDER_DEFAULTS.sustain ? sustain : undefined,
    release: release !== SLIDER_DEFAULTS.release ? release : undefined,
    room: room > 0 ? room : undefined,
    delay: delay > 0 ? delay : undefined,
    crush: crush < MAX_CRUSH ? crush : undefined,
    shape: shape > 0 ? shape : undefined,
    vib: vib > 0 ? vib : undefined,
    vibmod: vib > 0 ? vibmod : undefined,
    tremolo: tremolo > 0 ? tremolo : undefined,
    tremolodepth: tremolo > 0 ? tremolodepth : undefined,
    fm: fm > 0 ? fm : undefined,
    fmh: fm > 0 ? fmh : undefined,
  });

  // Raw "advanced" overrides win over the slider-derived value for whichever
  // params have one set -- this is what lets a param go out as a quoted
  // string or a "{...}" object instead of a plain number, and it applies on
  // top of activeParams() rather than replacing it so an override on one
  // param never disturbs the others.
  const withRawOverrides = (params) => {
    const out = { ...params };
    Object.entries(rawOverrides).forEach(([key, text]) => {
      const parsed = parseRawValue(text);
      if (parsed !== undefined) out[key] = parsed;
    });
    return out;
  };

  const play = async (n, note, id) => {
    lastPlayRef.current = { n, note, id };
    setPlayingId(id);
    await onPlay(name, data, { n, note, ...withRawOverrides(activeParams()), ...extraParams(), ...extraMods });
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setPlayingId(null);
    }, Math.max(950, (attack + release) * 1000 + 400));
  };

  // Always call the loop through this ref rather than closing over `play`
  // directly -- it's re-pointed at the freshest `play` on every render, so
  // the running interval always plays the current sliders and the current
  // lastPlayRef target without needing to be torn down and restarted (that
  // restart was the bug: it fired one extra, immediate play of the new
  // target racing the click's own play, and the two overlapping made a
  // retarget sound like the loop "only plays the original" sample).
  const playRef = useRef(play);
  playRef.current = play;

  // Loop toggle: re-triggers whatever was last played (or the bank itself,
  // if nothing has been played yet) on an interval sized to its envelope,
  // reading the target fresh on every tick so clicking a different row's
  // play button while looping retargets it there on the very next tick.
  useEffect(() => {
    clearInterval(loopIntervalRef.current);
    loopIntervalRef.current = null;
    if (!loop) {
      return;
    }
    const tick = () => {
      const target = lastPlayRef.current;
      playRef.current(target.n, target.note, target.id);
    };
    tick();
    const intervalMs = Math.max(350, (attack + release) * 1000 + 250);
    loopIntervalRef.current = setInterval(tick, intervalMs);
    return () => clearInterval(loopIntervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  // One list drives both "reset all" and the dirty-check, so a slider added
  // to one can't be forgotten in the other.
  const sliderState = {
    gain: [gain, setGain],
    cutoff: [cutoff, setCutoff],
    speed: [speed, setSpeed],
    pan: [pan, setPan],
    attack: [attack, setAttack],
    decay: [decay, setDecay],
    sustain: [sustain, setSustain],
    release: [release, setRelease],
    room: [room, setRoom],
    delay: [delay, setDelay],
    crush: [crush, setCrush],
    shape: [shape, setShape],
    vib: [vib, setVib],
    vibmod: [vibmod, setVibmod],
    tremolo: [tremolo, setTremolo],
    tremolodepth: [tremolodepth, setTremolodepth],
    fm: [fm, setFm],
    fmh: [fmh, setFmh],
  };
  const resetAllSliders = () => {
    Object.entries(sliderState).forEach(([key, [, setValue]]) => setValue(SLIDER_DEFAULTS[key]));
    setRawOverrides({});
    setGroupExtras(Object.fromEntries(Object.keys(SLIDER_GROUPS).map((g) => [g, {}])));
    setExtraModsText('');
    setExtraMods({});
  };
  const slidersAtDefault =
    Object.entries(sliderState).every(([key, [value]]) => value === SLIDER_DEFAULTS[key]) &&
    Object.keys(rawOverrides).length === 0 &&
    Object.values(groupExtras).every((e) => Object.keys(e).length === 0) &&
    extraModsText.trim() === '';

  // Wraps a slider's own setter so dragging or typing a number into it hands
  // control back from any raw override -- see the Slider component's doc
  // comment for why that's the intended two-way behavior rather than the
  // slider and the raw field fighting over the value.
  const bindSlider = (key, setValue) => (v) => {
    setValue(v);
    setRawOverride(key, null);
  };

  // "Ordered chaos" nudge: bumps every slider in one accordion group by a
  // small bounded random amount (see NUDGE_FRACTION), clearing any raw
  // override on that key the same way a manual drag would. Meant for
  // "this is close but a bit lifeless" -- a controlled push, not a reroll.
  const nudgeGroup = (groupKey) => {
    SLIDER_GROUPS[groupKey].forEach((key) => {
      const [value, setValue] = sliderState[key];
      bindSlider(key, setValue)(nudgedValue(key, value));
    });
  };

  // How many params inside a given accordion group are actually touched
  // (slider off default, carrying a raw override, or an extra param typed
  // into that group's box) -- drives each group header's badge count so a
  // collapsed group still shows whether it's dirty.
  const groupBadge = (groupKey) => {
    const keys = SLIDER_GROUPS[groupKey];
    const touched = keys.filter((key) => sliderState[key][0] !== SLIDER_DEFAULTS[key] || rawOverrides[key] != null).length;
    return touched + Object.keys(groupExtras[groupKey] ?? {}).length;
  };

  const savePresetNow = () => {
    const target = lastPlayRef.current;
    // activeParams() always includes attack (needed at play time to keep
    // the envelope's implicit sustain right -- see the comment there); a
    // saved preset doesn't need that same always-on guarantee, so drop it
    // back out when it's still at the default to keep the preset (and its
    // generated pattern string) to only what was actually changed.
    const params = withRawOverrides(activeParams());
    if (attack === SLIDER_DEFAULTS.attack) {
      params.attack = undefined;
    }
    Object.assign(params, extraParams());
    Object.assign(params, extraMods);
    // Stash the raw text (not just its parsed value) under non-param keys so
    // reopening this preset can re-seed the advanced boxes with what was
    // actually typed, not just the value it evaluated to.
    if (Object.keys(rawOverrides).length) {
      params.__raw = { ...rawOverrides };
    }
    const nonEmptyExtras = Object.fromEntries(Object.entries(groupExtras).filter(([, v]) => Object.keys(v).length));
    if (Object.keys(nonEmptyExtras).length) {
      params.__extra = nonEmptyExtras;
    }
    if (extraModsText.trim()) {
      params.__extraModsText = extraModsText.trim();
    }
    savePreset({
      name: presetName,
      sound: name,
      n: target?.n ?? 0,
      note: target?.note,
      params,
    });
    setSavingPreset(false);
    setPresetName('');
  };

  const commitTags = () => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) {
      setFavoriteTags(name, tags);
      if (!isFavorite(name)) toggleFavorite(name);
    } else if (isFavorite(name)) {
      setFavoriteTags(name, []);
    }
  };

  // Closing only ever happens through an explicit action -- the X button or
  // Escape (below). There is deliberately no click-to-close on the backdrop
  // at all anymore: a slider drag that ends outside the dialog's edge (this
  // webview doesn't reliably keep pointer capture on the thumb) used to
  // read as a backdrop click and close the whole popup mid-adjustment, and
  // even guarding by comparing mousedown/click targets still let a plain
  // outside click close it, which wasn't wanted either.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-label={`${name} preview`}
    >
      <div
        className="w-[420px] max-h-[82vh] flex flex-col bg-lineHighlight border border-muted rounded-lg overflow-hidden shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 h-10 border-b border-muted shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FavoriteStar id={name} />
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
            <span className="text-xs opacity-40 shrink-0">{entries.length > 1 ? `${entries.length} samples` : data.type}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                setPresetName(name);
                setSavingPreset(true);
              }}
              title="save this sound with its current slider settings as a preset"
              className="p-1 opacity-60 hover:opacity-100"
              aria-label="Save as preset"
            >
              <BookmarkIcon className="w-3.5 h-3.5" />
            </button>
            <CopyButton text={`"${name}"`} />
            <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100" aria-label="Close">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {savingPreset && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-muted shrink-0 bg-background/30">
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePresetNow();
                if (e.key === 'Escape') setSavingPreset(false);
              }}
              placeholder="preset name"
              className="w-full bg-background/40 border border-muted rounded px-2 py-1 text-[11px] outline-none focus:border-foreground/40"
            />
            <button
              onClick={savePresetNow}
              className="shrink-0 px-2 py-1 rounded text-[11px] border border-[#89ddff] text-[#89ddff] hover:bg-[#89ddff]/10"
            >
              save
            </button>
            <button onClick={() => setSavingPreset(false)} className="shrink-0 p-1 opacity-60 hover:opacity-100" aria-label="Cancel">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0 flex flex-col">
        <div className="p-3 flex flex-col gap-3 border-b border-muted">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {['wave', 'spectrum'].map((m) => (
                <button
                  key={m}
                  onClick={() => setVizMode(m)}
                  className={cx(
                    'px-2 py-0.5 rounded-full text-[10px] border',
                    vizMode === m ? 'border-foreground bg-foreground/10' : 'border-muted opacity-50 hover:opacity-90',
                  )}
                >
                  {m}
                </button>
              ))}
              <button
                onClick={() => setLoop((l) => !l)}
                title={loop ? 'stop looping' : 'loop preview'}
                className={cx(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border',
                  loop ? 'border-[#89ddff] bg-[#89ddff]/10 text-[#89ddff]' : 'border-muted opacity-50 hover:opacity-90',
                )}
              >
                <ArrowPathIcon className="w-3 h-3" />
                loop
              </button>
              <button
                onClick={() => setAutoScale((s) => !s)}
                title={autoScale ? 'showing normalized to this frame\'s peak -- click for true scale' : 'quiet samples can look flat -- click to scale the display to 100%'}
                className={cx(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border',
                  autoScale ? 'border-[#89ddff] bg-[#89ddff]/10 text-[#89ddff]' : 'border-muted opacity-50 hover:opacity-90',
                )}
              >
                <ArrowsPointingOutIcon className="w-3 h-3" />
                100%
              </button>
            </div>
            <div className="flex items-center gap-2">
              {entries.length <= 1 && (
                <button
                  onClick={() => play(0, undefined, name)}
                  className="flex items-center gap-1 text-[11px] opacity-80 hover:opacity-100"
                >
                  <PlayIcon className={cx('w-3.5 h-3.5', playingId === name && 'text-[#89ddff]')} />
                  preview
                </button>
              )}
              <button
                onClick={resetAllSliders}
                disabled={slidersAtDefault}
                title="reset all sliders to default"
                className={cx(
                  'flex items-center gap-1 text-[11px]',
                  slidersAtDefault ? 'opacity-30 cursor-default' : 'opacity-80 hover:opacity-100 text-[#89ddff]',
                )}
              >
                <ArrowUturnLeftIcon className="w-3 h-3" />
                reset
              </button>
            </div>
          </div>
          <Visualizer mode={vizMode} autoScale={autoScale} />

          <Accordion title="levels" defaultOpen badge={groupBadge('levels')} onNudge={() => nudgeGroup('levels')}>
            <Slider
              label="gain"
              value={gain}
              min={0}
              max={2}
              step={0.05}
              onChange={bindSlider('gain', setGain)}
              format={(v) => v.toFixed(2)}
              defaultValue={SLIDER_DEFAULTS.gain}
            />
            <Slider
              label="lpf"
              value={cutoff}
              min={200}
              max={MAX_CUTOFF}
              step={100}
              onChange={bindSlider('cutoff', setCutoff)}
              format={(v) => (v >= MAX_CUTOFF ? 'off' : `${Math.round(v)}Hz`)}
              defaultValue={SLIDER_DEFAULTS.cutoff}
              presets={[
                { label: 'off', value: MAX_CUTOFF },
                { label: '400', value: 400 },
                { label: '1.2k', value: 1200 },
                { label: '4k', value: 4000 },
              ]}
            />
            <Slider
              label="speed"
              value={speed}
              min={0.25}
              max={2}
              step={0.05}
              onChange={bindSlider('speed', setSpeed)}
              format={(v) => `${v.toFixed(2)}x`}
              defaultValue={SLIDER_DEFAULTS.speed}
              presets={[
                { label: '0.5x', value: 0.5 },
                { label: '1x', value: 1 },
                { label: '2x', value: 2 },
              ]}
            />
            <Slider
              label="pan"
              value={pan}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('pan', setPan)}
              format={(v) =>
                Math.abs(v - 0.5) < 0.03 ? 'C' : v < 0.5 ? `L${Math.round((0.5 - v) * 200)}` : `R${Math.round((v - 0.5) * 200)}`
              }
              defaultValue={SLIDER_DEFAULTS.pan}
              presets={[
                { label: 'L', value: 0 },
                { label: 'C', value: 0.5 },
                { label: 'R', value: 1 },
              ]}
            />
            <GroupParamsBox
              sliderKeys={SLIDER_GROUPS.levels}
              values={{ gain, cutoff, speed, pan }}
              rawOverrides={rawOverrides}
              setRawOverride={setRawOverride}
              setSliderValue={(key, v) => sliderState[key][1](v)}
              extras={groupExtras.levels}
              setExtras={(next) => setGroupExtra('levels', next)}
            />
          </Accordion>

          <Accordion title="envelope" badge={groupBadge('envelope')} onNudge={() => nudgeGroup('envelope')}>
            <Slider
              label="attack"
              value={attack}
              min={0}
              max={1}
              step={0.01}
              onChange={bindSlider('attack', setAttack)}
              format={(v) => `${Math.round(v * 1000)}ms`}
              defaultValue={SLIDER_DEFAULTS.attack}
            />
            <Slider
              label="decay"
              value={decay}
              min={0}
              max={1}
              step={0.01}
              onChange={bindSlider('decay', setDecay)}
              format={(v) => (v <= 0 ? 'off' : `${Math.round(v * 1000)}ms`)}
              defaultValue={SLIDER_DEFAULTS.decay}
            />
            <Slider
              label="sustain"
              value={sustain}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('sustain', setSustain)}
              format={(v) => v.toFixed(2)}
              defaultValue={SLIDER_DEFAULTS.sustain}
            />
            <Slider
              label="release"
              value={release}
              min={0.05}
              max={2}
              step={0.05}
              onChange={bindSlider('release', setRelease)}
              format={(v) => `${v.toFixed(2)}s`}
              defaultValue={SLIDER_DEFAULTS.release}
            />
            <GroupParamsBox
              sliderKeys={SLIDER_GROUPS.envelope}
              values={{ attack, decay, sustain, release }}
              rawOverrides={rawOverrides}
              setRawOverride={setRawOverride}
              setSliderValue={(key, v) => sliderState[key][1](v)}
              extras={groupExtras.envelope}
              setExtras={(next) => setGroupExtra('envelope', next)}
            />
          </Accordion>

          <Accordion title="fx" badge={groupBadge('fx')} onNudge={() => nudgeGroup('fx')}>
            <Slider
              label="room"
              value={room}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('room', setRoom)}
              format={(v) => (v <= 0 ? 'off' : v.toFixed(2))}
              defaultValue={SLIDER_DEFAULTS.room}
              presets={[
                { label: 'off', value: 0 },
                { label: 'small', value: 0.25 },
                { label: 'hall', value: 0.7 },
              ]}
            />
            <Slider
              label="delay"
              value={delay}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('delay', setDelay)}
              format={(v) => (v <= 0 ? 'off' : v.toFixed(2))}
              defaultValue={SLIDER_DEFAULTS.delay}
            />
            <Slider
              label="crush"
              value={crush}
              min={1}
              max={MAX_CRUSH}
              step={1}
              onChange={bindSlider('crush', setCrush)}
              format={(v) => (v >= MAX_CRUSH ? 'off' : `${v}bit`)}
              defaultValue={SLIDER_DEFAULTS.crush}
            />
            <Slider
              label="shape"
              value={shape}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('shape', setShape)}
              format={(v) => (v <= 0 ? 'off' : v.toFixed(2))}
              defaultValue={SLIDER_DEFAULTS.shape}
            />
            <GroupParamsBox
              sliderKeys={SLIDER_GROUPS.fx}
              values={{ room, delay, crush, shape }}
              rawOverrides={rawOverrides}
              setRawOverride={setRawOverride}
              setSliderValue={(key, v) => sliderState[key][1](v)}
              extras={groupExtras.fx}
              setExtras={(next) => setGroupExtra('fx', next)}
            />
          </Accordion>

          <Accordion title="lfo" badge={groupBadge('lfo')} onNudge={() => nudgeGroup('lfo')}>
            <Slider
              label="vib rate"
              value={vib}
              min={0}
              max={20}
              step={0.5}
              onChange={bindSlider('vib', setVib)}
              format={(v) => (v <= 0 ? 'off' : `${v.toFixed(1)}Hz`)}
              defaultValue={SLIDER_DEFAULTS.vib}
            />
            <Slider
              label="vib depth"
              value={vibmod}
              min={0}
              max={2}
              step={0.05}
              onChange={bindSlider('vibmod', setVibmod)}
              format={(v) => v.toFixed(2)}
              defaultValue={SLIDER_DEFAULTS.vibmod}
            />
            <Slider
              label="trem rate"
              value={tremolo}
              min={0}
              max={20}
              step={0.5}
              onChange={bindSlider('tremolo', setTremolo)}
              format={(v) => (v <= 0 ? 'off' : `${v.toFixed(1)}Hz`)}
              defaultValue={SLIDER_DEFAULTS.tremolo}
            />
            <Slider
              label="trem depth"
              value={tremolodepth}
              min={0}
              max={1}
              step={0.05}
              onChange={bindSlider('tremolodepth', setTremolodepth)}
              format={(v) => v.toFixed(2)}
              defaultValue={SLIDER_DEFAULTS.tremolodepth}
            />
            <GroupParamsBox
              sliderKeys={SLIDER_GROUPS.lfo}
              values={{ vib, vibmod, tremolo, tremolodepth }}
              rawOverrides={rawOverrides}
              setRawOverride={setRawOverride}
              setSliderValue={(key, v) => sliderState[key][1](v)}
              extras={groupExtras.lfo}
              setExtras={(next) => setGroupExtra('lfo', next)}
            />
          </Accordion>

          <Accordion title="fm" badge={groupBadge('fm')} onNudge={() => nudgeGroup('fm')}>
            <Slider
              label="fm"
              value={fm}
              min={0}
              max={20}
              step={0.5}
              onChange={bindSlider('fm', setFm)}
              format={(v) => (v <= 0 ? 'off' : v.toFixed(1))}
              defaultValue={SLIDER_DEFAULTS.fm}
            />
            <Slider
              label="fmh"
              value={fmh}
              min={0.5}
              max={8}
              step={0.1}
              onChange={bindSlider('fmh', setFmh)}
              format={(v) => v.toFixed(2)}
              defaultValue={SLIDER_DEFAULTS.fmh}
            />
            <GroupParamsBox
              sliderKeys={SLIDER_GROUPS.fm}
              values={{ fm, fmh }}
              rawOverrides={rawOverrides}
              setRawOverride={setRawOverride}
              setSliderValue={(key, v) => sliderState[key][1](v)}
              extras={groupExtras.fm}
              setExtras={(next) => setGroupExtra('fm', next)}
            />
          </Accordion>

          <div className="flex items-center gap-2">
            <span className="text-[11px] w-10 shrink-0 opacity-60">tags</span>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={commitTags}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="comma, separated, tags"
              className="w-full bg-background/40 border border-muted rounded px-2 py-1 text-[11px] outline-none focus:border-foreground/40"
            />
          </div>

          <ExtraModifiersBox
            value={extraModsText}
            onCommit={(text, parsed) => {
              setExtraModsText(text);
              setExtraMods(parsed);
            }}
          />
        </div>

        {entries.length > 1 && (
          // Capped to roughly 5-6 rows with its own scrollbar -- a bank
          // with dozens of samples otherwise makes the *whole* popup one
          // long scroll instead of just this list needing one.
          <div className="p-1 shrink-0 max-h-[204px] overflow-y-auto">
            {entries.map((e) => {
              const id = `${name}:${e.n}${e.note ? ':' + e.note : ''}`;
              return (
                <div
                  key={id}
                  className={cx(
                    'flex items-center gap-2 px-2 py-1.5 rounded hover:bg-background/40',
                    playingId === id && 'bg-background/60',
                  )}
                >
                  <button onClick={() => play(e.n, e.note, id)} title="play" className="shrink-0 p-0.5 opacity-60 hover:opacity-100">
                    <PlayIcon className={cx('w-3.5 h-3.5', playingId === id && 'text-[#89ddff]')} />
                  </button>
                  <span className="text-xs font-mono truncate flex-1">{e.label}</span>
                  <FavoriteStar id={id} />
                  <CopyButton text={`"${name}:${e.n}"`} />
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export function SoundsTab() {
  const sounds = useStore(soundMap);

  const { soundsFilter } = useSettings();
  const [search, setSearch] = useState('');
  const [openBank, setOpenBank] = useState(null); // { name, data, initialParams?, initialTarget? } | null
  const [showPresets, setShowPresets] = useState(false);
  const { BASE_URL } = import.meta.env;
  const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  useSoundFavorites();
  useSoundPresets();
  const presets = listPresets();

  const soundEntries = useMemo(() => {
    if (!sounds) {
      return [];
    }

    const base = Object.entries(sounds)
      .filter(([key]) => !key.startsWith('_'))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([name]) => name.toLowerCase().includes(search.toLowerCase()) || favoritesMatchSearch(name, search));

    if (soundsFilter === 'importSounds') {
      //TODO: tidy this up, it does not need to be saved in settings
      return [];
    }
    if (!soundsFilter || soundsFilter === soundFilterType.ALL) {
      return base;
    }
    return base.filter(([name, { data }]) => matchesFilter(soundsFilter, name, data));
  }, [sounds, soundsFilter, search]);

  // How many sounds fall into each pill -- shown on the pill itself so the
  // effect of a filter is visible before (and after) you click it, not just
  // in the "N loaded" count.
  const filterCounts = useMemo(() => {
    if (!sounds) {
      return {};
    }
    const base = Object.entries(sounds).filter(([key]) => !key.startsWith('_'));
    const counts = {};
    Object.keys(FILTERS).forEach((key) => {
      if (key === 'importSounds') {
        return;
      }
      counts[key] = base.filter(([name, { data }]) => matchesFilter(key, name, data)).length;
    });
    return counts;
  }, [sounds]);

  // opts: { n, note, gain, cutoff, speed, pan, attack, decay, sustain, release,
  //         room, delay, crush, shape, vib, vibmod, tremolo, tremolodepth } -- all optional.
  // Goes through the real superdough() playback engine (the same one every
  // pattern plays through) rather than a sound's raw low-level trigger, so
  // gain/cutoff/pan/room/delay/crush/shape/tremolo actually apply -- those
  // are only ever handled by superdough()'s own fx chain, never by the
  // per-sample/synth triggers.
  // Params not meant to reach superdough itself -- n/note are pulled out
  // and placed explicitly below, and __raw/__extra are the preset store's
  // own bookkeeping (see soundPresets.mjs), never real pattern params.
  const NON_PARAM_KEYS = new Set(['n', 'note', '__raw', '__extra']);
  const triggerSound = async (name, data, opts = {}) => {
    const { n = 0, note } = opts;
    const ctx = getAudioContext();
    const params = {
      note: note ?? (['synth', 'soundfont'].includes(data.type) ? 'a3' : undefined),
      s: name,
      n,
      clip: 1,
      release: opts.release ?? 0.5,
      sustain: 1,
      duration: 0.5,
      analyze: PREVIEW_ANALYSER_ID,
      fft: 5,
    };
    // Forward every other param the caller gave us as-is -- this is what
    // lets a GroupParamsBox's extra keys (a strudel control the preview has
    // no slider for) actually reach playback, not just a saved preset's
    // pattern string.
    Object.entries(opts).forEach(([key, value]) => {
      if (NON_PARAM_KEYS.has(key) || value == null) return;
      params[key] = value;
    });
    let errMsg;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const time = ctx.currentTime + 0.05;
        await superdough(params, time, 0.5);
        return;
      } catch (err) {
        errMsg = err;
      }
      if (attempt == 9) {
        console.warn('Failed to trigger sound after 10 attempts' + (errMsg ? `: ${errMsg}` : ''));
      } else {
        await wait(200);
      }
    }
  };

  // Plays a saved preset with its stored params -- silently no-ops if its
  // base sound isn't currently loaded (e.g. a user sample that was removed).
  const playPreset = async (preset) => {
    const entry = sounds?.[preset.sound];
    if (!entry) {
      return;
    }
    await triggerSound(preset.sound, entry.data, { n: preset.n, note: preset.note, ...preset.params });
  };

  // Reopens the preview popup pre-loaded with a preset's saved sliders, so
  // it can keep being tweaked (and re-saved) rather than only replayed.
  const editPreset = (preset) => {
    const entry = sounds?.[preset.sound];
    if (!entry) {
      return;
    }
    setOpenBank({
      name: preset.sound,
      data: entry.data,
      initialParams: preset.params,
      initialTarget: { n: preset.n, note: preset.note, id: preset.n ? `${preset.sound}:${preset.n}` : preset.sound },
    });
  };

  return (
    <div id="sounds-tab" className="flex flex-col w-full h-full text-foreground">
      <PanelHeader title="Sounds" subtitle={`${soundEntries.length} loaded`}>
        {soundsFilter === soundFilterType.USER && soundEntries.length > 0 && (
          <ActionButton
            label="delete-all"
            onClick={async () => {
              try {
                const confirmed = await confirmDialog('Delete all imported user samples?');
                if (confirmed) {
                  clearIDB(userSamplesDBConfig.dbName);
                  soundMap.set({});
                  await prebake();
                }
              } catch (e) {
                console.error(e);
              }
            }}
          />
        )}
      </PanelHeader>

      <div className="px-2 pt-2 flex items-center gap-1 rounded bg-background/40 border border-muted mx-2">
        <MagnifyingGlassIcon className="w-3.5 h-3.5 opacity-50 shrink-0 ml-1" />
        <input
          className="w-full bg-transparent text-sm outline-none py-1.5"
          placeholder="Search sounds or tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 px-2 py-2">
        {Object.entries(FILTERS).map(([key, label]) => {
          const active = soundsFilter === key;
          return (
            <button
              key={key}
              onClick={() => settingsMap.setKey('soundsFilter', active ? soundFilterType.ALL : key)}
              title={active ? 'click to clear this filter' : undefined}
              className={cx(
                'px-2.5 py-1 rounded-full text-xs border whitespace-nowrap',
                active ? 'border-foreground bg-foreground/10 text-foreground' : 'border-muted opacity-60 hover:opacity-100',
              )}
            >
              {label}
              {filterCounts[key] != null && <span className="opacity-50"> · {filterCounts[key]}</span>}
            </button>
          );
        })}
        <button
          onClick={() => setShowPresets((v) => !v)}
          title={showPresets ? 'back to sounds' : 'saved presets'}
          className={cx(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border whitespace-nowrap',
            showPresets ? 'border-foreground bg-foreground/10 text-foreground' : 'border-muted opacity-60 hover:opacity-100',
          )}
        >
          <FolderIcon className="w-3 h-3" />
          presets
          <span className="opacity-50"> · {presets.length}</span>
        </button>
      </div>

      <div className="min-h-0 max-h-full grow overflow-auto p-2">
        {showPresets ? (
          <>
            {presets.length > 0 && (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {presets.map((preset) => (
                  <PresetCard key={preset.id} preset={preset} onOpen={() => editPreset(preset)} onPlay={playPreset} />
                ))}
              </div>
            )}
            {!presets.length && (
              <div className="text-sm opacity-50 px-1 py-2">
                No saved presets yet — open a sound, tweak its sliders, then hit the bookmark button to save one.
              </div>
            )}
          </>
        ) : (
          <>
            {soundEntries.length > 0 && (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {soundEntries.map(([name, { data }]) => (
                  <SoundCard key={name} name={name} data={data} onOpen={() => setOpenBank({ name, data })} onPlay={triggerSound} />
                ))}
              </div>
            )}
          </>
        )}
        {!showPresets && !soundEntries.length && soundsFilter === 'importSounds' ? (
          <div className="prose dark:prose-invert min-w-full text-sm px-1">
            <ImportSoundsButton onComplete={() => settingsMap.setKey('soundsFilter', 'user')} />
            <p>
              To import sounds into strudel, they must be contained{' '}
              <a href={`${baseNoTrailing}/learn/samples/#from-disk-via-import-sounds-folder`} target="_blank">
                within a folder or subfolder
              </a>
              . The best way to do this is to upload a “samples” folder containing subfolders of individual sounds or
              soundbanks (see diagram below).{' '}
            </p>
            <pre className="bg-background" key={'sample-diagram'}>
              {`└─ samples <-- import this folder
   ├─ swoop
   │  ├─ swoopshort.wav
   │  ├─ swooplong.wav
   │  └─ swooptight.wav
   └─ smash
      ├─ smashhigh.wav
      ├─ smashlow.wav
      └─ smashmiddle.wav`}
            </pre>
            <p>
              The name of a subfolder corresponds to the sound name under the “user” tab. Multiple samples within a
              subfolder are all labelled with the same name, but can be accessed using “.n( )” - remember sounds are
              zero-indexed and in alphabetical order!
            </p>
            <p>
              For more information, and other ways to use your own sounds in strudel,{' '}
              <a href={`${baseNoTrailing}/learn/samples/#from-disk-via-import-sounds-folder`} target="_blank">
                check out the docs
              </a>
              !
            </p>
            <h3>Preview Sounds</h3>
            <pre className="bg-background" key={'sample-preview'}>
              n("0 1 2 3 4 5").s("sample-name")
            </pre>
            <p>
              Paste the line above into the main editor to hear the uploaded folder. Remember to use the name of your
              sample as it appears under the "user" tab.
            </p>
          </div>
        ) : (
          ''
        )}
        {!showPresets && !soundEntries.length && soundsFilter !== 'importSounds' ? (
          <div className="text-sm opacity-50 px-1 py-2">{search == '' ? 'No sounds loaded' : 'No sounds found'}</div>
        ) : (
          ''
        )}
      </div>

      {openBank && (
        <SoundPreviewPopup
          name={openBank.name}
          data={openBank.data}
          initialParams={openBank.initialParams}
          initialTarget={openBank.initialTarget}
          onPlay={triggerSound}
          onClose={() => setOpenBank(null)}
        />
      )}
    </div>
  );
}
