// Persistent in-app sidebar: the app's one real navigation surface.
//
// Modeled on LoboCloner's sidebar -- plain labeled icon buttons for file
// actions, section for switching panels -- deliberately NOT a native OS
// menu. The pattern list itself no longer lives here: patterns now open as
// tabs across the top of the editor (see PatternTabs.jsx), so this sidebar
// only holds the actions that create/find/import/export patterns, not a
// second copy of the list. Everything here is plain React state + the same
// setTab/setIsPanelOpened functions the old in-panel tab row already used,
// so there is no IPC event plumbing: clicking a button just calls a
// function directly.
import { useEffect, useState } from 'react';
import {
  FolderOpenIcon,
  DocumentArrowDownIcon,
  DocumentPlusIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { isTauri } from '@src/tauri.mjs';
import { setActiveFooter as setTab, setIsPanelOpened, useSettings } from '../../../settings.mjs';
import { exportPatterns, importPatterns, useViewingPatternData, userPattern } from '../../../user_pattern_utils.mjs';
import { basenameNoExt, openPatternFile, readPatternFileAt, savePatternFile } from '../../nativePatternFile.mjs';
import { getLinkedFilePath, linkPatternToFile } from '../../patternFileLink.mjs';
import { openPatternTab, closePatternTab } from '../../openPatternTabs.mjs';
import { patternTitle } from './PatternTabs.jsx';
import { setTitleOverride } from '../../patternTitles.mjs';
import { toggleGridPanel, useGridPanelOpen } from '../../patternGrid.mjs';
import { addRecentFile, removeRecentFile } from '../../recentPatternFiles.mjs';
import { RecentPatternsMenu } from './RecentPatternsMenu.jsx';
import { useRef } from 'react';

const TAURI = typeof window !== 'undefined' && isTauri();

// Panels reachable from the sidebar's "Panels" section. Kept separate from
// the small in-panel tab row (reference/console/settings), which stays for
// quick switching once a panel is already open.
// 'patterns' is deliberately not listed here -- patterns are opened via the
// top tab strip's "+" picker now, not a panel.
const PANEL_LINKS = [
  { key: 'welcome', label: 'welcome', tab: 'intro' },
  { key: 'sounds', label: 'sounds', tab: 'sounds' },
  { key: 'files', label: 'files', tab: 'files', tauriOnly: true },
  { key: 'export', label: 'export', tab: 'export' },
  { key: 'reference', label: 'reference', tab: 'reference' },
  { key: 'console', label: 'console', tab: 'console' },
  { key: 'settings', label: 'settings', tab: 'settings' },
];

function SidebarLabel({ children }) {
  return <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide opacity-50 select-none">{children}</div>;
}

function SidebarAction({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      className={cx(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:opacity-70',
        disabled && 'opacity-40 cursor-default',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AppSidebar({ context }) {
  const [collapsed, setCollapsed] = useState(false);
  const viewingPatternData = useViewingPatternData();
  const viewingPatternID = viewingPatternData?.id;
  const { userPatterns, activeFooter: tab, isPanelOpen } = useSettings();
  const gridPanelOpen = useGridPanelOpen();
  const importRef = useRef();

  // Settings persist across restarts, so anyone who had the old "patterns"
  // panel open before this sidebar existed will otherwise reopen it every
  // launch -- a second, stale copy of the list right next to this one.
  // Panels.jsx no longer even renders that route; just close the panel.
  useEffect(() => {
    if (tab === 'patterns' && isPanelOpen) {
      setIsPanelOpened(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCodeWindow = (patternData, reset = false) => context.handleUpdate(patternData, reset);

  const openPanel = (tabKey) => {
    setTab(tabKey);
    setIsPanelOpened(true);
  };

  // A pattern opened from disk always takes the file's own name as its
  // title (as metadata -- patternTitles.mjs -- never written into the
  // code itself) and gets linked to that path (patternFileLink.mjs),
  // which is what PatternTabs.jsx checks to lock its rename. The whole
  // point is that the tab and the file can't silently drift apart, so the
  // tab defers to the file's name here rather than the other way around.
  const openFile = async () => {
    const result = await openPatternFile();
    if (result) {
      const { data } = userPattern.create();
      const updated = userPattern.update(data.id, { ...data, code: result.code });
      setTitleOverride(updated.id, basenameNoExt(result.path));
      linkPatternToFile(updated.id, result.path);
      addRecentFile(result.path);
      openPatternTab(updated.id);
      updateCodeWindow(updated.data);
    }
  };

  // "Recent patterns" popup hands back a list of paths the user ticked --
  // this is the multi-open version of openFile() above, minus the dialog
  // (the paths are already known). Reads each in turn, skipping (and
  // pruning from the recent list) any that no longer exist -- a file can
  // easily have moved or been deleted since it was last opened. Every
  // successfully-read one gets its own tab, same linking/title rules as a
  // single open; only the first one actually becomes the visible/active
  // pattern, same as opening several browser tabs at once would leave the
  // first in focus.
  const openFilesAt = async (paths) => {
    let firstOpened = null;
    for (const path of paths) {
      const result = await readPatternFileAt(path);
      if (!result) {
        removeRecentFile(path);
        continue;
      }
      const { data } = userPattern.create();
      const updated = userPattern.update(data.id, { ...data, code: result.code });
      setTitleOverride(updated.id, basenameNoExt(result.path));
      linkPatternToFile(updated.id, result.path);
      addRecentFile(result.path);
      openPatternTab(updated.id);
      if (!firstOpened) firstOpened = updated;
    }
    if (firstOpened) updateCodeWindow(firstOpened.data);
  };

  // A pattern that isn't linked to a file yet (new, or duplicated, or this
  // is its first save) has no path to write straight to, so this always
  // prompts -- same as forceDialog ("save as"). Either way, once a path
  // comes back, the pattern's title is set to match *that* file's name
  // and it gets (re)linked -- the "choose a different filename and the
  // tab renames itself and locks" behavior. A quick "save pattern" on an
  // already-linked pattern skips the dialog and the retitle entirely
  // (target already matches). Only ever touches title metadata, never the
  // pattern's actual code.
  const saveFile = async (forceDialog = false) => {
    if (!viewingPatternID) return;
    const linkedPath = getLinkedFilePath(viewingPatternID);
    const code = viewingPatternData?.code ?? '';
    const written = await savePatternFile(code, {
      path: linkedPath,
      forceDialog,
      defaultName: patternTitle(viewingPatternData),
    });
    if (!written) return; // dialog cancelled
    if (written !== linkedPath) {
      setTitleOverride(viewingPatternID, basenameNoExt(written));
      linkPatternToFile(viewingPatternID, written);
    }
    addRecentFile(written);
  };

  return (
    <aside
      className={cx(
        'h-full shrink-0 flex flex-col bg-lineHighlight border-r border-muted overflow-hidden transition-[width]',
        collapsed ? 'w-10' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between px-2 h-10 min-h-10 border-b border-muted">
        {!collapsed && <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Strudel</span>}
        <button
          className="px-1 py-0.5 text-foreground hover:opacity-50 ml-auto"
          title={collapsed ? 'expand sidebar' : 'collapse sidebar'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {!collapsed && (
        <>
          <SidebarLabel>Panels</SidebarLabel>
          <div className="px-1 pb-1">
            {PANEL_LINKS.filter((p) => !p.tauriOnly || TAURI).map((p) => (
              <button
                key={p.key}
                onClick={() => openPanel(p.tab)}
                className={cx(
                  'w-full text-left px-2 py-1 rounded text-sm hover:opacity-70',
                  isPanelOpen && tab === p.tab && 'ring-selection',
                )}
              >
                {p.label}
              </button>
            ))}
            {/* Grid is docked directly below the code editor (ReplEditor.jsx)
                rather than routed through the generic panel system above --
                the narrow right-hand panel made its per-track rows go into
                their own scroll almost immediately. Its own toggle, its own
                open flag (patternGrid.mjs), so it's rendered the same way
                here for visual consistency but wired differently. */}
            <button
              onClick={toggleGridPanel}
              className={cx('w-full text-left px-2 py-1 rounded text-sm hover:opacity-70', gridPanelOpen && 'ring-selection')}
            >
              grid
            </button>
          </div>

          <div className="border-t border-muted py-1">
            <SidebarAction
              icon={DocumentPlusIcon}
              label="New pattern"
              onClick={() => {
                const { data } = userPattern.createAndAddToDB();
                openPatternTab(data.id);
                updateCodeWindow(data);
              }}
            />
            <SidebarAction
              icon={DocumentDuplicateIcon}
              label="Duplicate"
              onClick={() => {
                // Duplicates are never linked to the original's file (or
                // any file) -- they're a fresh, unsaved pattern, so their
                // tab stays freely editable until their own first save,
                // same as "New pattern". Defaults to "Copy of X" as title
                // metadata only -- the code itself (userPattern.duplicate()
                // copies it verbatim) is never touched.
                const { data } = userPattern.duplicate(viewingPatternData);
                setTitleOverride(data.id, `Copy of ${patternTitle(viewingPatternData)}`);
                openPatternTab(data.id);
                updateCodeWindow(data);
              }}
            />
            <SidebarAction
              icon={TrashIcon}
              label="Delete"
              onClick={() => {
                const deletedId = viewingPatternID;
                const { data } = userPattern.delete(deletedId);
                const nextId = closePatternTab(deletedId, deletedId);
                if (nextId && userPatterns[nextId]) {
                  updateCodeWindow({ ...userPatterns[nextId], collection: userPattern.collection });
                } else {
                  updateCodeWindow({ ...data, collection: userPattern.collection });
                }
              }}
            />
          </div>

          <div className="border-t border-muted py-1">
            {TAURI && (
              <>
                <SidebarAction icon={FolderOpenIcon} label="Open pattern file…" onClick={openFile} />
                <RecentPatternsMenu onOpenPaths={openFilesAt} />
                <SidebarAction icon={DocumentArrowDownIcon} label="Save pattern" onClick={() => saveFile(false)} />
                <SidebarAction icon={DocumentArrowDownIcon} label="Save pattern as…" onClick={() => saveFile(true)} />
              </>
            )}
            <input
              ref={importRef}
              style={{ display: 'none' }}
              type="file"
              multiple
              accept="text/plain,text/x-markdown,application/json"
              onChange={(e) => importPatterns(e.target.files)}
            />
            <SidebarAction icon={ArrowUpTrayIcon} label="Import…" onClick={() => importRef.current.click()} />
            <SidebarAction icon={ArrowDownTrayIcon} label="Export all" onClick={exportPatterns} />
          </div>
        </>
      )}
    </aside>
  );
}
