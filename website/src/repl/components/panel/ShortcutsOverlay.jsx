// Keyboard shortcuts help overlay. The keymap it documents already existed
// (packages/codemirror/codemirror.mjs) but had no visible cheat-sheet
// anywhere in the app -- this doesn't add any new editor shortcuts, it just
// makes the existing ones discoverable, plus documents this session's own
// additions (pattern tabs, history, tempo).
import { useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/16/solid';
import { closeShortcuts, toggleShortcuts, useShortcutsOpen } from '../../shortcutsOverlay.mjs';

const EDITOR_SHORTCUTS = [
  { keys: 'Ctrl-Enter / Alt-Enter', desc: 'evaluate (whole pattern, or just the block under the cursor in block mode)' },
  { keys: 'Ctrl-. / Alt-.', desc: 'stop' },
  { keys: 'Alt-w', desc: 'jump to the next $: block' },
  { keys: 'Alt-q', desc: 'jump to the previous $: block' },
];

const VIM_HELIX_SHORTCUTS = [
  { keys: ':w', desc: 'evaluate (when the editor keybinding mode in Settings is vim or helix)' },
  { keys: ':q', desc: 'stop (vim / helix mode)' },
  { keys: 'gcc / gc (visual)', desc: 'toggle line comment (vim mode)' },
];

const APP_SHORTCUTS = [
  { keys: '?', desc: 'toggle this help (only while focus isn’t inside the code editor)' },
  { keys: 'double-click a pattern tab', desc: 'rename it' },
  { keys: '+ on the tab strip', desc: 'open one of your saved patterns as a new tab' },
  { keys: 'clock icon on the tab strip', desc: 'browse and restore previous takes of the pattern you’re viewing' },
];

function ShortcutRow({ keys, desc }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <code className="shrink-0 min-w-[9rem] text-[11px] font-mono px-1.5 py-0.5 rounded bg-background border border-muted">
        {keys}
      </code>
      <span className="text-sm opacity-80">{desc}</span>
    </div>
  );
}

function ShortcutSection({ title, items }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1">{title}</div>
      {items.map((item) => (
        <ShortcutRow key={item.keys} {...item} />
      ))}
    </div>
  );
}

export function ShortcutsOverlay() {
  const open = useShortcutsOpen();

  // A single global "?" listener toggles this overlay from anywhere in the
  // app. Guarded so typing "?" inside the code editor (or any other text
  // field, e.g. the tempo box or a search input) just types the character
  // instead of popping this open.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== '?') return;
      const el = document.activeElement;
      const typing = el && (el.closest('.cm-editor') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      if (typing) return;
      e.preventDefault();
      toggleShortcuts();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeShortcuts();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-label="Keyboard shortcuts">
      <div className="w-[420px] max-h-[80vh] flex flex-col bg-lineHighlight border border-muted rounded-lg overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-3 py-2 border-b border-muted">
          <span className="text-sm font-semibold">Keyboard shortcuts</span>
          <button onClick={closeShortcuts} title="close" className="hover:opacity-60">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto px-3 py-2">
          <ShortcutSection title="editor" items={EDITOR_SHORTCUTS} />
          <ShortcutSection title="vim / helix mode" items={VIM_HELIX_SHORTCUTS} />
          <ShortcutSection title="app" items={APP_SHORTCUTS} />
          <div className="text-xs opacity-50 mt-2">
            Editor keybinding mode (plain / vim / emacs / helix / vscode) is set in Settings.
          </div>
        </div>
      </div>
    </div>
  );
}
