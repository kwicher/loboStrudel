// Horizontal tab strip sitting directly above the code editor, one tab per
// pattern the user has opened this session -- modeled on LoboCloner's
// sequence tabs. Deliberately session-scoped and separate from the user's
// full pattern library: opening a pattern (from here, or from the sidebar's
// new/duplicate/open actions) adds a tab; closing a tab only removes it
// from this strip, it never deletes the underlying saved pattern.
import { useMemo, useRef, useState } from 'react';
import {
  ClockIcon,
  DocumentDuplicateIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StarIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { useSettings } from '../../../settings.mjs';
import { useActivePattern, useViewingPatternData, userPattern } from '../../../user_pattern_utils.mjs';
import { getMetadata } from '../../../metadata_parser.js';
import { closePatternTab, openPatternTab, useOpenPatternTabIds } from '../../openPatternTabs.mjs';
import { useFileLinks } from '../../patternFileLink.mjs';
import { getTitleOverride, setTitleOverride, useTitleOverrides } from '../../patternTitles.mjs';
import { togglePinSnapshot, useSnapshots } from '../../patternSnapshots.mjs';

// A pattern's title is metadata (patternTitles.mjs), not a line of code --
// see that module for why the old "rewrite a `// \"Title\"` comment in the
// code" scheme got removed. getMetadata() is still consulted as a fallback
// purely for *reading* a title out of a pattern someone already wrote that
// convention into by hand, or that was saved under the old scheme before
// this change -- nothing here ever writes it back into the code.
export function patternTitle(pattern) {
  if (!pattern) return 'untitled';
  const override = getTitleOverride(pattern.id);
  if (override) return override;
  const meta = getMetadata(pattern.code);
  if (meta.title != null) return meta.title;
  const date = new Date(pattern.created_at);
  if (!isNaN(date)) return date.toLocaleDateString();
  return pattern.id || 'unnamed';
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function snapshotPreview(code) {
  const firstLine = (code || '').split('\n').find((l) => l.trim() !== '') || '';
  return firstLine.trim().slice(0, 44);
}

// V1, V2, ... in actual recording order (oldest first), regardless of how
// the list is currently sorted for display (pinned-first) -- a version
// number that shuffled around based on pin state would defeat the point
// of having one.
function versionLabels(snapshots) {
  const order = [...snapshots].sort((a, b) => a.ts - b.ts);
  const labels = {};
  order.forEach((snap, i) => {
    labels[snap.ts] = `V${i + 1}`;
  });
  return labels;
}

export function PatternTabs({ context }) {
  const { userPatterns } = useSettings();
  const openIds = useOpenPatternTabIds();
  const activePattern = useActivePattern();
  const viewingPatternData = useViewingPatternData();
  const viewingPatternID = viewingPatternData?.id;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const pickerButtonRef = useRef();
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const snapshots = useSnapshots(viewingPatternID);
  // Patterns opened from, or saved to, a real file on disk (patternFileLink.mjs)
  // have their title locked to that file's name -- see startRename below.
  const fileLinks = useFileLinks();
  // Subscribed purely so this component re-renders when a title changes
  // (patternTitle() itself reads the store directly, non-reactively, since
  // it's a plain function called from several other files too).
  useTitleOverrides();

  // Tabs for patterns that no longer exist (e.g. "delete-all" ran, or the
  // pattern was deleted from somewhere that didn't also close its tab) just
  // disappear at render time rather than every deletion path needing to
  // remember to close a tab too.
  const openPatterns = useMemo(
    () => openIds.map((id) => userPatterns?.[id]).filter(Boolean),
    [openIds, userPatterns],
  );

  const updateCodeWindow = (patternData) => context.handleUpdate(patternData);

  const selectTab = (id) => {
    updateCodeWindow({ ...userPatterns[id], collection: userPattern.collection });
    if (context.started && activePattern === id) {
      context.handleEvaluate();
    }
  };

  const closeTab = (e, id) => {
    e.stopPropagation();
    const nextId = closePatternTab(id, viewingPatternID);
    if (nextId && userPatterns[nextId]) {
      selectTab(nextId);
    } else if (!nextId && viewingPatternID === id) {
      updateCodeWindow({ id: null, code: '', collection: userPattern.collection });
    }
  };

  const startRename = (e, pattern) => {
    e.stopPropagation();
    if (fileLinks[pattern.id]) return; // linked to a file -- name comes from there, not a rename
    setEditingId(pattern.id);
    setEditingValue(patternTitle(pattern));
  };

  const commitRename = (id, rawValue) => {
    if (!userPatterns[id]) return;
    // Pure metadata now -- the pattern's code (on disk, in the editor, in
    // storage) is never touched by a rename.
    setTitleOverride(id, rawValue);
  };

  const finishRename = (commit) => {
    if (commit && editingId != null) {
      commitRename(editingId, editingValue);
    }
    setEditingId(null);
    setEditingValue('');
  };

  const restoreSnapshot = (snap) => {
    const pattern = userPatterns[viewingPatternID];
    if (!pattern) return;
    updateCodeWindow({ ...pattern, code: snap.code });
    setHistoryOpen(false);
  };

  // Forks a past take into its own new, separately-saved pattern (opened
  // as a fresh tab) instead of loading it over the current one -- per the
  // SHARP research, people wanted to audition an old direction without it
  // silently replacing what's live. Leaves the currently-viewed pattern
  // untouched. Titled "<original> Vn" (metadata only, same as every other
  // title in this app now -- see patternTitles.mjs) so the fork doesn't
  // land as a bare "untitled" tab with no link back to where it came from.
  const forkSnapshot = (snap) => {
    const original = userPatterns[viewingPatternID];
    const label = versionLabels(snapshots)[snap.ts] ?? '';
    const { data } = userPattern.create();
    const forked = userPattern.update(data.id, { ...data, code: snap.code });
    setTitleOverride(forked.id, [patternTitle(original), label].filter(Boolean).join(' '));
    openPatternTab(forked.id);
    updateCodeWindow(forked.data);
    setHistoryOpen(false);
  };

  const visiblePatterns = useMemo(() => {
    const all = Object.values(userPatterns || {}).reverse();
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter((p) => patternTitle(p).toLowerCase().includes(q));
  }, [search, userPatterns]);

  const openFromPicker = (id) => {
    openPatternTab(id);
    selectTab(id);
    setPickerOpen(false);
    setSearch('');
  };

  return (
    <div className="relative flex items-stretch h-8 min-h-8 max-h-8 border-b border-muted bg-lineHighlight select-none">
      <div className="flex items-stretch overflow-x-auto grow">
        {openPatterns.length === 0 && <div className="px-3 flex items-center text-xs opacity-40">no patterns open</div>}
        {openPatterns.map((pattern) => {
          const id = pattern.id;
          const active = id === viewingPatternID;
          const linkedPath = fileLinks[id];
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => {
                // Picked up by GridTab.jsx's track drop zones -- dropping a
                // tab onto a track adds that pattern to the track's queue
                // (see patternGrid.mjs / GridTab.jsx for the other half of
                // this). A distinct MIME type from the grid's own
                // entry-reordering drags so the two don't get confused.
                e.dataTransfer.setData('application/x-strudel-pattern-id', id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => selectTab(id)}
              title={linkedPath ? `${patternTitle(pattern)} -- linked to ${linkedPath}` : patternTitle(pattern)}
              className={cx(
                'group flex items-center gap-1 pl-3 pr-1.5 max-w-[180px] border-r border-muted cursor-pointer text-xs shrink-0',
                active ? 'bg-background border-b-2 border-b-foreground -mb-px' : 'border-b-2 border-b-transparent hover:opacity-70',
              )}
            >
              {editingId === id ? (
                <input
                  autoFocus
                  value={editingValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={() => finishRename(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      finishRename(true);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      finishRename(false);
                    }
                  }}
                  className="w-24 min-w-0 bg-background text-foreground text-xs outline-none border-b border-foreground"
                />
              ) : (
                <span
                  onDoubleClick={(e) => startRename(e, pattern)}
                  title={linkedPath ? 'linked to a file -- save under a different name to rename' : 'double-click to rename'}
                  className={cx('truncate flex items-center gap-1', id === activePattern && context.started && 'italic')}
                >
                  {linkedPath && <LockClosedIcon className="w-2.5 h-2.5 opacity-40 shrink-0" />}
                  {patternTitle(pattern)}
                  {active && context.isDirty && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#ffcb6b] shrink-0"
                      title="unsaved changes -- evaluate to record this as a take"
                    />
                  )}
                </span>
              )}
              <button onClick={(e) => closeTab(e, id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0" title="close tab">
                <XMarkIcon className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="relative shrink-0 border-l border-muted">
        <button
          className="h-full px-2 hover:opacity-60 disabled:opacity-30 disabled:cursor-default"
          title="pattern history"
          disabled={!viewingPatternID}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <ClockIcon className="w-4 h-4" />
        </button>
        {historyOpen && viewingPatternID && (
          <div className="absolute right-0 top-full mt-1 w-72 max-h-80 flex flex-col bg-lineHighlight border border-muted rounded shadow-lg z-50">
            <div className="flex items-center justify-between px-2 py-1 border-b border-muted">
              <span className="text-[11px] uppercase tracking-wide opacity-50 truncate">
                history -- {patternTitle(userPatterns[viewingPatternID])}
              </span>
              <button
                className="shrink-0 opacity-50 hover:opacity-100"
                onClick={() => setHistoryOpen(false)}
                title="close"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-auto">
              {snapshots.length === 0 && (
                <div className="px-2 py-1.5 text-xs opacity-50">no takes yet -- evaluate to record one</div>
              )}
              {(() => {
                const labels = versionLabels(snapshots);
                return [...snapshots]
                  .sort((a, b) => (a.pinned === b.pinned ? b.ts - a.ts : a.pinned ? -1 : 1))
                  .map((snap) => (
                    <div
                      key={snap.ts}
                      onClick={() => restoreSnapshot(snap)}
                      className="w-full text-left px-2 py-1.5 hover:opacity-70 border-b border-muted last:border-b-0 cursor-pointer flex items-start gap-1.5"
                      title="restore this take into the editor"
                    >
                      <div className="min-w-0 grow">
                        <div className="text-[10px] opacity-50 flex items-center gap-1">
                          <span className="font-mono opacity-80">{labels[snap.ts]}</span>
                          <span>· {relativeTime(snap.ts)}</span>
                        </div>
                        <div className="text-xs font-mono truncate">{snapshotPreview(snap.code) || '(empty)'}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => togglePinSnapshot(viewingPatternID, snap.ts)}
                          title={snap.pinned ? 'unpin (exempt from history trimming)' : 'pin (keep this take even as older ones get trimmed)'}
                          className="shrink-0"
                        >
                          <StarIcon className={cx('w-3.5 h-3.5', snap.pinned ? 'text-[#ffcb6b]' : 'opacity-25 hover:opacity-60')} />
                        </button>
                        <button
                          onClick={() => forkSnapshot(snap)}
                          title={`save ${labels[snap.ts]} as its own separate pattern (opens as a new tab, doesn't touch the current one)`}
                          className="shrink-0 opacity-40 hover:opacity-90"
                        >
                          <DocumentDuplicateIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ));
              })()}
            </div>
          </div>
        )}
      </div>
      <div className="relative shrink-0 border-l border-muted">
        <button
          ref={pickerButtonRef}
          className="h-full px-2 hover:opacity-60"
          title="open pattern…"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
        {pickerOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 max-h-80 flex flex-col bg-lineHighlight border border-muted rounded shadow-lg z-50">
            <div className="flex items-center gap-1 px-2 py-1 border-b border-muted">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 opacity-50 shrink-0" />
              <input
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Search patterns…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="shrink-0 opacity-50 hover:opacity-100" onClick={() => setPickerOpen(false)} title="close">
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-auto">
              {visiblePatterns.length === 0 && <div className="px-2 py-1.5 text-xs opacity-50">No patterns</div>}
              {visiblePatterns.map((pattern) => (
                <button
                  key={pattern.id}
                  onClick={() => openFromPicker(pattern.id)}
                  className="w-full text-left px-2 py-1.5 text-sm truncate hover:opacity-70"
                  title={patternTitle(pattern)}
                >
                  {patternTitle(pattern)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
