import { Fragment, useEffect } from 'react';
import React, { useMemo, useState } from 'react';
import {
  isAudioFile,
  readDir,
  dir,
  playFile,
  pickFolder,
  readAbsoluteDir,
  playAbsoluteFile,
  registerAbsoluteFolder,
} from '../../files.mjs';
import { PanelHeader } from './PanelHeader.jsx';
import cx from '@src/cx.mjs';
import { FolderIcon, FolderOpenIcon, SpeakerWaveIcon, ChevronRightIcon } from '@heroicons/react/16/solid';

// root.kind: 'music' (the original ~/music browser) or 'custom' (a folder
// picked via the native dialog). root.base is the absolute path prefix
// used to build the `samples('...')` snippet and to resolve files for
// playback — for 'music' that's the "~/music" shorthand Strudel already
// understands via registerSamplesPrefix; for 'custom' it's the real
// absolute path, played back via playAbsoluteFile instead.
const MUSIC_ROOT = { kind: 'music', base: '~/music', label: '~/music' };

export function FilesTab() {
  const [root, setRoot] = useState(MUSIC_ROOT);
  const [path, setPath] = useState([]);
  const [browsing, setBrowsing] = useState(false);
  const [registered, setRegistered] = useState(null); // { bankCount, sampleCount } | null
  const [playingName, setPlayingName] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load =
      root.kind === 'music'
        ? readDir('', { dir, recursive: true })
        : readAbsoluteDir(root.base);
    load
      .then((children) => {
        if (!cancelled) setPath([{ name: root.label, children }]);
      })
      .catch((err) => {
        console.log('error loading files', err);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const current = useMemo(() => path[path.length - 1], [path]);
  const subpath = useMemo(
    () =>
      path
        .slice(1)
        .map((p) => p.name)
        .join('/'),
    [path],
  );
  const folders = useMemo(() => current?.children.filter((e) => !!e.children), [current]);
  const files = useMemo(() => current?.children.filter((e) => !e.children && isAudioFile(e.name)), [current]);
  const select = (e) => setPath((p) => p.concat([e]));

  const browseOtherFolder = async () => {
    setBrowsing(true);
    try {
      const selected = await pickFolder();
      if (selected) {
        const label = selected.split(/[\\/]/).filter(Boolean).slice(-1)[0] || selected;
        setRoot({ kind: 'custom', base: selected, label });
        // Register every subfolder as a sample bank so patterns can use
        // s("<subfolder-name>") right away, same as the ~/music flow does.
        const result = await registerAbsoluteFolder(selected);
        setRegistered({ bankCount: result.bankCount, sampleCount: result.sampleCount });
      }
    } finally {
      setBrowsing(false);
    }
  };

  const playSelected = async (name) => {
    setPlayingName(name);
    await (root.kind === 'music'
      ? playFile(`${subpath}/${name}`)
      : playAbsoluteFile(`${root.base}/${subpath ? subpath + '/' : ''}${name}`));
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Files" subtitle={root.label}>
        <button
          className="text-xs px-2 py-1 rounded border border-muted hover:opacity-70 whitespace-nowrap"
          onClick={browseOtherFolder}
          disabled={browsing}
        >
          {browsing ? 'choosing…' : 'browse folder…'}
        </button>
        {root.kind === 'custom' && (
          <button
            className="text-xs px-2 py-1 rounded border border-muted hover:opacity-70 whitespace-nowrap"
            onClick={() => {
              setRoot(MUSIC_ROOT);
              setRegistered(null);
            }}
          >
            ~/music
          </button>
        )}
      </PanelHeader>

      <div className="px-3 flex flex-col h-full overflow-hidden">
        {registered && (
          <div className="text-xs text-gray-500 pt-2">
            registered {registered.sampleCount} samples in {registered.bankCount} bank
            {registered.bankCount === 1 ? '' : 's'} — usable now as s("&lt;subfolder-name&gt;")
          </div>
        )}

        <div className="flex items-center flex-wrap gap-0.5 font-mono text-xs pt-2 pb-1 opacity-70">
          {path?.map((p, i) => {
            const last = i === path.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <ChevronRightIcon className="w-3 h-3 opacity-40" />}
                <span
                  className={cx('cursor-pointer', last ? 'text-foreground opacity-100' : 'hover:underline')}
                  onClick={() => setPath((p) => p.slice(0, i + 1))}
                >
                  {p.name}
                </span>
              </Fragment>
            );
          })}
        </div>

        <div className="overflow-auto pb-2 grow">
          {!folders?.length && !files?.length && <span className="text-gray-500 text-sm">Nothing here</span>}

          {!!folders?.length && (
            <div className="grid gap-1.5 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
              {folders.map((e, i) => (
                <button
                  key={i}
                  onClick={() => select(e)}
                  className="group flex flex-col items-start gap-1 px-2.5 py-2 rounded-md border border-muted hover:border-foreground/40 hover:bg-background/40 text-left"
                >
                  <FolderIcon className="w-4 h-4 opacity-60 group-hover:hidden" />
                  <FolderOpenIcon className="w-4 h-4 opacity-80 hidden group-hover:block" />
                  <span className="text-xs truncate w-full">{e.name}</span>
                </button>
              ))}
            </div>
          )}

          {!!files?.length && (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
              {files.map((e, i) => (
                <button
                  key={i}
                  onMouseDown={() => playSelected(e.name)}
                  onMouseUp={() => setPlayingName(null)}
                  title={e.name}
                  className={cx(
                    'group flex flex-col items-start gap-1 px-2.5 py-2 rounded-md border text-left select-none',
                    'border-muted hover:border-foreground/40 hover:bg-background/40',
                    playingName === e.name && 'border-foreground bg-background/60',
                  )}
                >
                  <SpeakerWaveIcon
                    className={cx('w-4 h-4 shrink-0 opacity-60', playingName === e.name && 'opacity-100')}
                  />
                  <span className="text-xs truncate w-full text-gray-500">{e.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
