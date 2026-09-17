import {
  exportPatterns,
  importPatterns,
  loadAndSetFeaturedPatterns,
  loadAndSetPublicPatterns,
  patternFilterName,
  useActivePattern,
  useViewingPatternData,
  userPattern,
} from '../../../user_pattern_utils.mjs';
import { useMemo, useRef } from 'react';
import { getMetadata } from '../../../metadata_parser.js';
import { useExamplePatterns } from '../../useExamplePatterns.jsx';
import { parseJSON, isUdels } from '../../util.mjs';
import { useSettings } from '../../../settings.mjs';
import { ActionButton } from '../button/action-button.jsx';
import { Pagination } from '../pagination/Pagination.jsx';
import { useState } from 'react';
import { useDebounce } from '../usedebounce.jsx';
import cx from '@src/cx.mjs';
import { Textbox } from '@src/repl/components/panel/SettingsTab.jsx';
import { PanelHeader } from './PanelHeader.jsx';

export function PatternLabel({ pattern } /* : { pattern: Tables<'code'> } */) {
  const meta = useMemo(() => getMetadata(pattern.code), [pattern]);

  let title = meta.title;
  if (title == null) {
    const date = new Date(pattern.created_at);
    if (!isNaN(date)) {
      title = date.toLocaleDateString();
    } else {
      title = pattern.id || 'unnamed';
    }
  }

  const author = Array.isArray(meta.by) ? meta.by.join(',') : 'Anonymous';
  return <>{`${title} by ${author.slice(0, 100)}`.slice(0, 60)}</>;
}

// Patterns render as a wrapping row of name tabs (mirrors the app's old
// top-level PanelTab underline style) instead of a single-column list of
// links, so the pattern's name sits at the top of its tab the way a browser
// tab does, and many patterns wrap across multiple rows rather than forcing
// one long vertical scroll.
function PatternButton({ showOutline, onClick, pattern, showHiglight }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'max-w-[200px] px-2 py-1 text-sm text-left truncate border-b-2 cursor-pointer hover:opacity-70',
        showOutline ? 'border-foreground' : 'border-transparent',
        showHiglight && 'ring-selection',
      )}
    >
      <PatternLabel pattern={pattern} />
    </button>
  );
}

function PatternButtons({ patterns, activePattern, onClick, started }) {
  const viewingPatternData = useViewingPatternData();
  const viewingPatternID = viewingPatternData.id;
  return (
    <div className="p-2 flex flex-wrap content-start gap-x-1 gap-y-1">
      {Object.values(patterns)
        .reverse()
        .map((pattern) => {
          const id = pattern.id;
          return (
            <PatternButton
              pattern={pattern}
              key={id}
              showHiglight={id === viewingPatternID}
              showOutline={id === activePattern && started}
              onClick={() => onClick(id)}
            />
          );
        })}
    </div>
  );
}

const updateCodeWindow = (context, patternData, reset = false) => {
  context.handleUpdate(patternData, reset);
};

export function PatternsTab({ context }) {
  const [search, setSearch] = useState('');
  const activePattern = useActivePattern();
  const viewingPatternData = useViewingPatternData();

  const { userPatterns, patternAutoStart } = useSettings();
  const viewingPatternID = viewingPatternData?.id;

  const visiblePatterns = useMemo(() => {
    if (!search) {
      return userPatterns;
    }
    return Object.fromEntries(
      Object.entries(userPatterns).filter(([_key, pattern]) => {
        const meta = getMetadata(pattern.code);

        // Search for specific meta keys
        const searchLowercaseTrimmed = search.trim().toLowerCase();
        if (searchLowercaseTrimmed.includes(':')) {
          const [metaKey, metaSearch] = searchLowercaseTrimmed.split(/:\s*/);
          if (metaKey !== undefined && metaSearch !== undefined && metaKey in meta) {
            const metaValues = meta[metaKey];
            if (Array.isArray(metaValues)) {
              return metaValues.some((metaValue) => metaValue.toLowerCase().includes(metaSearch));
            } else if (typeof metaValues === 'string') {
              return metaValues.toLowerCase().includes(metaSearch);
            } else {
              return false;
            }
          }
        }
        const title = meta.title ? meta.title : 'unnamed';
        const authors = meta.by ? meta.by : ['anonymous'];
        const tags = meta.tag ? meta.tag : [];
        return (
          title.toLowerCase().includes(searchLowercaseTrimmed) ||
          authors.some((author) => author.toLowerCase().includes(searchLowercaseTrimmed)) ||
          tags.some((tag) => tag.toLowerCase().includes(searchLowercaseTrimmed))
        );
      }),
    );
  }, [search, userPatterns]);

  const importRef = useRef();

  // Native file open/save now lives in the in-app sidebar (see
  // AppSidebar.jsx), which calls openPatternFile()/savePatternFile()
  // directly -- no menu events to listen for here anymore.

  return (
    <div className="w-full h-full text-foreground flex flex-col overflow-hidden">
      <PanelHeader title="Patterns" />
      <Textbox className="w-full border-0" placeholder="Search..." value={search} onChange={setSearch} />
      <div className="px-2 shrink-0 h-8 space-x-4 flex max-w-full overflow-x-auto border-y border-muted">
        <ActionButton
          label="new"
          onClick={() => {
            const { data } = userPattern.createAndAddToDB();
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="duplicate"
          onClick={() => {
            const { data } = userPattern.duplicate(viewingPatternData);
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="delete"
          onClick={() => {
            const { data } = userPattern.delete(viewingPatternID);
            updateCodeWindow(context, { ...data, collection: userPattern.collection });
          }}
        />
        <input
          ref={importRef}
          style={{ display: 'none' }}
          type="file"
          multiple
          accept="text/plain,text/x-markdown,application/json"
          onChange={(e) => importPatterns(e.target.files)}
        />
        <ActionButton label="import" onClick={() => importRef.current.click()} />
        <ActionButton label="export" onClick={exportPatterns} />

        <ActionButton
          label="delete-all"
          onClick={() => {
            const { data } = userPattern.clearAll();
            updateCodeWindow(context, data);
          }}
        />
      </div>

      <div className="overflow-auto">
        {/* bg-background */}
        {/* {patternFilter === patternFilterName.user && ( */}
        <PatternButtons
          onClick={(id) => {
            updateCodeWindow(context, { ...userPatterns[id], collection: userPattern.collection }, patternAutoStart);

            if (context.started && activePattern === id) {
              context.handleEvaluate();
            }
          }}
          patterns={visiblePatterns}
          started={context.started}
          activePattern={activePattern}
          viewingPatternID={viewingPatternID}
        />
        {/* )} */}
      </div>
    </div>
  );
}

function PatternPageWithPagination({ patterns, patternOnClick, context, paginationOnChange, initialPage }) {
  const [page, setPage] = useState(initialPage);
  const debouncedPageChange = useDebounce(() => {
    paginationOnChange(page);
  });

  const onPageChange = (pageNum) => {
    setPage(pageNum);
    debouncedPageChange();
  };

  const activePattern = useActivePattern();
  return (
    <div className="flex flex-grow flex-col  h-full overflow-hidden justify-between">
      <div className="overflow-auto flex flex-col flex-grow bg-background p-2 rounded-md ">
        <PatternButtons
          onClick={(id) => patternOnClick(id)}
          started={context.started}
          patterns={patterns}
          activePattern={activePattern}
        />
      </div>
      <div className="flex items-center gap-2 py-2">
        <label htmlFor="pattern pagination">Page</label>
        <Pagination id="pattern pagination" currPage={page} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

let featuredPageNum = 1;
function FeaturedPatterns({ context }) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.featured);
  const { patternAutoStart } = useSettings();
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={featuredPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(context, { ...patterns[id], collection: patternFilterName.featured }, patternAutoStart);
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetFeaturedPatterns(pageNum - 1);
        featuredPageNum = pageNum;
      }}
    />
  );
}

let latestPageNum = 1;
function LatestPatterns({ context }) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.public);
  const { patternAutoStart } = useSettings();
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={latestPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(context, { ...patterns[id], collection: patternFilterName.public }, patternAutoStart);
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetPublicPatterns(pageNum - 1);
        latestPageNum = pageNum;
      }}
    />
  );
}

function PublicPatterns({ context }) {
  const { patternFilter } = useSettings();
  if (patternFilter === patternFilterName.featured) {
    return <FeaturedPatterns context={context} />;
  }
  return <LatestPatterns context={context} />;
}
