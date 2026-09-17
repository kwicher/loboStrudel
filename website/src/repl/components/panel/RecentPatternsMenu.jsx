// "Recent patterns" sidebar menu item: a small popup (portal-positioned
// off the trigger button, same technique as Toolbox.jsx -- see its
// comment for why a portal is needed rather than a plain absolutely-
// positioned dropdown) listing recently opened/saved native pattern
// files, each with a checkbox, so several can be opened as tabs at once
// instead of one open-dialog round trip per file.
//
// This component only owns the popup UI and selection state -- it has no
// idea what a "pattern" is. AppSidebar.jsx passes down the actual list
// (recentPatternFiles.mjs) and an onOpenPaths(paths) callback that does
// the real work (read each file, create/link/title the pattern, open its
// tab) so all of that stays in one place alongside openFile/saveFile.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon, XMarkIcon } from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { basenameNoExt } from '../../nativePatternFile.mjs';
import { clearRecentFiles, removeRecentFile, useRecentFiles } from '../../recentPatternFiles.mjs';

export function RecentPatternsMenu({ onOpenPaths }) {
  const recent = useRecentFiles();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.top, left: rect.right + 4 });
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
      if (e.target.closest?.('[data-recent-patterns-popover]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  // Selection is scoped to one popup session -- reopening starts unchecked
  // rather than remembering last time's picks, which would be surprising.
  useEffect(() => {
    if (open) setChecked(new Set());
  }, [open]);

  const toggle = (path) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openSelected = () => {
    const paths = recent.map((e) => e.path).filter((p) => checked.has(p));
    if (paths.length === 0) return;
    onOpenPaths(paths);
    setOpen(false);
  };

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        disabled={recent.length === 0}
        title={recent.length === 0 ? 'no recent pattern files yet' : 'recent pattern files'}
        className={cx(
          'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:opacity-70',
          recent.length === 0 && 'opacity-40 cursor-default',
        )}
      >
        <ClockIcon className="w-4 h-4 shrink-0" />
        <span className="truncate">Recent patterns</span>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            data-recent-patterns-popover
            style={{ position: 'fixed', top: coords.top, left: coords.left }}
            className="w-72 max-h-[70vh] flex flex-col gap-2 bg-lineHighlight border border-muted rounded shadow-lg z-[200] p-2"
          >
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold">Recent patterns</span>
              <button onClick={() => setOpen(false)} title="close">
                <XMarkIcon className="w-3.5 h-3.5 opacity-50 hover:opacity-100" />
              </button>
            </div>
            <div className="text-[9px] opacity-50 -mt-1 leading-tight shrink-0">
              tick one or more, then open them all as tabs at once
            </div>
            <div className="flex flex-col overflow-y-auto gap-0.5 -mx-1 px-1">
              {recent.length === 0 && <div className="text-[10px] opacity-40 px-1 py-2">nothing here yet</div>}
              {recent.map((e) => (
                <div key={e.path} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-background/40 group">
                  <input
                    type="checkbox"
                    checked={checked.has(e.path)}
                    onChange={() => toggle(e.path)}
                    className="shrink-0"
                  />
                  <button
                    onClick={() => toggle(e.path)}
                    title={e.path}
                    className="flex-1 min-w-0 text-left text-xs truncate"
                  >
                    {basenameNoExt(e.path)}
                  </button>
                  <button
                    onClick={() => removeRecentFile(e.path)}
                    title="remove from recent list (doesn't touch the file)"
                    className="shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between shrink-0 pt-1 border-t border-muted">
              <button
                onClick={clearRecentFiles}
                disabled={recent.length === 0}
                className="text-[10px] opacity-50 hover:opacity-90 disabled:opacity-20"
              >
                clear list
              </button>
              <button
                onClick={openSelected}
                disabled={checked.size === 0}
                className="text-[10px] px-2 py-0.5 rounded border border-muted hover:opacity-70 disabled:opacity-30"
              >
                open {checked.size > 0 ? checked.size : ''} selected
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
