import { Bars3Icon, ExclamationTriangleIcon, PlayIcon, StopIcon } from '@heroicons/react/16/solid';
import { useEffect, useRef, useState } from 'react';
import { setInterval, clearInterval } from 'worker-timers';
import { toggleShortcuts } from '../../shortcutsOverlay.mjs';
import { LevelMeter } from './LevelMeter';
import cx from '@src/cx.mjs';
import { StrudelIcon } from '@src/repl/components/icons/StrudelIcon';
import { useSettings, setIsZen, setIsPanelOpened } from '../../../settings.mjs';
import { useGridPlaying } from '../../patternGrid.mjs';
import '../../Repl.css';
import { useLogger } from '../useLogger';
import { ConsoleTab } from './ConsoleTab';
import ExportTab from './ExportTab';
import { FilesTab } from './FilesTab';
import { Reference } from './Reference';
import { SettingsTab } from './SettingsTab';
import { SoundsTab } from './SoundsTab';
import { WelcomeTab } from './WelcomeTab';
import { isTauri } from '@src/tauri.mjs';

const TAURI = typeof window !== 'undefined' && isTauri();

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export function LogoButton({ context, isEmbedded }) {
  const { started } = context;
  const { isZen, isCSSAnimationDisabled, fontFamily } = useSettings();
  return (
    <div
      className={cx(
        'mt-[1px]',
        started && !isCSSAnimationDisabled && 'animate-spin',
        'cursor-pointer text-blue-500',
        isZen && 'fixed top-2 right-4',
      )}
      onClick={() => {
        if (!isEmbedded) {
          setIsZen(!isZen);
        }
      }}
    >
      <span className="block text-foreground rotate-90">
        <StrudelIcon className="w-5 h-5 fill-foreground" />
      </span>
    </div>
  );
}

export function MainPanel({ context, isEmbedded = false, className }) {
  const { isZen, isButtonRowHidden, fontFamily } = useSettings();
  let loc = window.location;
  let ver = 'unofficial';
  let hot = false;
  let b = loc.hostname.match(/^(.+)\.(strudel)/);
  if (/(strudel.cc$)/.test(loc.hostname)) {
    // if there's no text before 'strudel', it's warm, otherwise use the text before strudel
    ver = b ? b[1] : 'warm';
  } else {
    // match both versions of localhost
    if (/(localhost)|(127.0.0.1)/.test(loc.hostname)) ver = 'dev';
  }
  let pr = ver.match(/pr-([0-9]+)/);
  if (pr) {
    pr = pr[1];
    ver = `hot: ${pr}`;
    hot = true;
    pr = `https://codeberg.org/uzu/strudel/pulls/${pr}`;
  }

  return (
    <nav
      id="header"
      className={cx(
        'flex-none text-black z-[100] text-sm select-none min-h-10 max-h-10',
        !isZen && !isEmbedded && 'border-b border-muted bg-lineHighlight',
        isZen ? 'h-12 w-8 fixed top-0 left-0' : '',
        'flex items-center',
        className,
      )}
      style={{ fontFamily }}
    >
      <div className={cx('flex w-full justify-between')}>
        <div className="px-3 py-1 flex space-x-2 select-none">
          <h1
            onClick={() => {
              if (isEmbedded) window.open(window.location.href.replace('embed', ''));
            }}
            className={cx(
              isEmbedded ? 'text-l cursor-pointer' : 'text-xl',
              'text-foreground font-bold flex space-x-2 items-center',
            )}
          >
            <LogoButton context={context} isEmbedded={isEmbedded} />
            {!isZen && (
              <div className="space-x-2 flex items-baseline">
                <span className="hidden sm:block">strudel</span>
                <span className="text-sm font-medium hidden sm:block">REPL</span>
                {!hot ? (
                  <span className="text-sm font-medium hidden sm:block">({ver})</span>
                ) : (
                  <a className="hover:opacity-50" href={pr} target="_blank">
                    <span className="text-sm font-medium hidden sm:block">({ver})</span>
                  </a>
                )}
              </div>
            )}
          </h1>
        </div>
        {!isZen && (
          <div className="flex grow justify-end">
            {!isButtonRowHidden && <MainMenu isEmbedded={isEmbedded} context={context} />}
            <PanelToggle isEmbedded={isEmbedded} isZen={isZen} />
          </div>
        )}
      </div>
    </nav>
  );
}

export function Footer({ context, isEmbedded = false }) {
  return (
    <div className="border-t border-muted bg-lineHighlight block lg:hidden">
      <MainMenu context={context} isEmbedded={isEmbedded} />
    </div>
  );
}

// Tempo has no on-screen control anywhere else -- it's otherwise only
// reachable by finding/typing a setcps()/setcpm() line in the pattern
// itself. scheduler.cps is a plain mutable number, not reactive (no
// nanostore, no change event), so this polls it on an interval rather than
// subscribing -- cheap, and tempo doesn't change fast enough to need
// per-frame polling. Displayed as bpm (cps * 60) since that's the more
// familiar unit; converted back to cps on commit.
function TempoControl({ context }) {
  const [liveBpm, setLiveBpm] = useState(120);
  const [draft, setDraft] = useState(null);
  const editingRef = useRef(false);
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (editingRef.current) return;
      const cps = context.editorRef?.current?.repl?.scheduler?.cps;
      if (typeof cps === 'number' && !isNaN(cps)) {
        const bpm = Math.round(cps * 60 * 10) / 10;
        setLiveBpm((prev) => (Math.abs(prev - bpm) > 0.05 ? bpm : prev));
      }
    }, 250);
    return () => clearInterval(id);
  }, [context.editorRef]);

  const commit = (rawValue) => {
    const bpm = parseFloat(rawValue);
    if (!isNaN(bpm) && bpm > 0) {
      context.editorRef?.current?.repl?.setCps(bpm / 60);
      setLiveBpm(Math.round(bpm * 10) / 10);
    }
    setDraft(null);
    editingRef.current = false;
  };

  return (
    <div className="flex items-center gap-1 px-2 text-sm text-foreground" title="tempo (bpm = cps × 60)">
      <span className="text-xs opacity-50">bpm</span>
      <input
        type="number"
        min={1}
        step={1}
        value={draft ?? liveBpm}
        onFocus={() => {
          editingRef.current = true;
          setDraft(String(liveBpm));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            editingRef.current = false;
            return;
          }
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(e.target.value);
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            skipNextBlurRef.current = true;
            setDraft(null);
            editingRef.current = false;
            e.currentTarget.blur();
          }
        }}
        className="w-14 bg-background text-foreground border border-muted rounded px-1 py-0.5 text-sm outline-none focus:border-foreground"
      />
    </div>
  );
}

function MainMenu({ context, isEmbedded = false, className }) {
  const { started, pending, isDirty, activeCode, handleTogglePlay, handleEvaluate, handleShare, handlePanic } = context;
  const { isCSSAnimationDisabled } = useSettings();
  // The grid and the main single-pattern transport share one editor and
  // scheduler (see patternGrid.mjs's header comment) -- letting both
  // drive it at once is exactly the "playback gets mixed up" confusion
  // that was reported. While the grid is playing, play/stop and update
  // go inert; per explicit request, playback is then "fully controlled
  // via grid tools." Panic and tempo stay live -- panic should always be
  // able to silence everything in an emergency, and tempo is genuinely
  // shared (the grid's own tempo control does the same setCps() call).
  const gridPlaying = useGridPlaying();
  return (
    <div className={cx('flex text-sm max-w-full shrink-0 overflow-hidden text-foreground px-2 h-10', className)}>
      <button
        onClick={handleTogglePlay}
        disabled={gridPlaying}
        title={gridPlaying ? 'the grid is controlling playback -- stop the grid to use this' : started ? 'stop' : 'play'}
        className={cx(
          'px-2',
          gridPlaying ? 'opacity-30 cursor-default' : cx('hover:opacity-50', !started && !isCSSAnimationDisabled && 'animate-pulse'),
        )}
      >
        <span className={cx('flex items-center space-x-2')}>
          {started ? <StopIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
          {!isEmbedded && <span>{gridPlaying ? 'grid' : pending ? '...' : started ? 'stop' : 'play'}</span>}
        </span>
      </button>
      {!isEmbedded && <LevelMeter context={context} />}
      {!isEmbedded && (
        <button
          onClick={handlePanic}
          title="panic (Ctrl-Shift-.) -- instantly silence everything"
          className="px-2 hover:opacity-50 hover:text-red-400"
        >
          <ExclamationTriangleIcon className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={handleEvaluate}
        disabled={gridPlaying}
        title={gridPlaying ? 'the grid is controlling playback -- stop the grid to use this' : 'update'}
        className={cx(
          'flex items-center space-x-1 px-2',
          gridPlaying ? 'opacity-30 cursor-default' : !isDirty || !activeCode ? 'opacity-50' : 'hover:opacity-50',
        )}
      >
        {!isEmbedded && <span>update</span>}
      </button>
      {!isEmbedded && <TempoControl context={context} />}
      {!isEmbedded && (
        <button
          title="share"
          className={cx('cursor-pointer hover:opacity-50 flex items-center space-x-1 px-2')}
          onClick={handleShare}
        >
          <span>share</span>
        </button>
      )}
      {!isEmbedded && (
        <a
          title="learn"
          href={`${baseNoTrailing}/workshop/getting-started/`}
          className={cx('hover:opacity-50 flex items-center space-x-1', !isEmbedded ? 'p-2' : 'px-2')}
        >
          <span>learn</span>
        </a>
      )}
      {!isEmbedded && (
        <button
          title="keyboard shortcuts (?)"
          onClick={toggleShortcuts}
          className={cx('hover:opacity-50 flex items-center space-x-1', !isEmbedded ? 'p-2' : 'px-2')}
        >
          <span>?</span>
        </button>
      )}
    </div>
  );
}

export function BottomPanel({ context }) {
  const { isPanelOpen, activeFooter: tab } = useSettings();
  if (!isPanelOpen) {
    return null;
  }
  return (
    <PanelNav className="min-h-[360px] max-h-[360px] overflow-hidden flex flex-col relative border-t border-muted">
      <div className="w-full h-full overflow-auto">
        <PanelContent context={context} tab={tab} />
      </div>
    </PanelNav>
  );
}

export function RightPanel({ context }) {
  const settings = useSettings();
  const { activeFooter: tab, isPanelOpen } = settings;
  if (!isPanelOpen) {
    return null;
  }
  return (
    <PanelNav
      settings={settings}
      className="border-l border-muted shrink-0 h-full overflow-hidden min-w-[min(420px,100vw)] max-w-[min(420px,80vw)]"
    >
      <div className="overflow-auto h-full">
        <PanelContent context={context} tab={tab} />
      </div>
    </PanelNav>
  );
}

const tabNames = {
  welcome: 'intro',
  patterns: 'patterns',
  sounds: 'sounds',
  reference: 'reference',
  export: 'export',
  console: 'console',
  settings: 'settings',
};
if (TAURI) {
  tabNames.files = 'files';
}

// Only these stay as clickable tabs in the panel itself; the rest (welcome,
// patterns, sounds, export, and -- inside Tauri -- files) are reached via
// the in-app sidebar instead (see AppSidebar.jsx), to keep this row from
// being crowded.

function PanelNav({ children, className, ...props }) {
  const settings = useSettings();
  return (
    <nav
      onClick={() => {
        if (!settings.isPanelOpen) {
          setIsPanelOpened(true);
        }
      }}
      aria-label="Menu Panel"
      className={cx('h-full bg-lineHighlight group overflow-x-auto', className)}
      {...props}
    >
      {children}
    </nav>
  );
}

function PanelContent({ context, tab }) {
  useLogger();
  switch (tab) {
    case tabNames.console:
      return <ConsoleTab />;
    case tabNames.sounds:
      return <SoundsTab />;
    case tabNames.reference:
      return <Reference />;
    case tabNames.export:
      return <ExportTab handleExport={context.handleExport} />;
    case tabNames.settings:
      return <SettingsTab started={context.started} />;
    case tabNames.files:
      return <FilesTab />;
    default:
      return <WelcomeTab context={context} />;
  }
}


export function PanelToggle({ isEmbedded, isZen }) {
  const { panelPosition, isPanelOpen } = useSettings();
  return (
    !isEmbedded &&
    !isZen &&
    panelPosition === 'right' && (
      <button
        title="menu"
        className={cx('border-l border-muted px-2 py-0 text-foreground hover:opacity-50')}
        onClick={() => setIsPanelOpened(!isPanelOpen)}
      >
        <Bars3Icon className="w-6 h-6" />
      </button>
    )
  );
}
