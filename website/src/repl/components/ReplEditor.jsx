import { XMarkIcon } from '@heroicons/react/16/solid';
import { Code } from '@src/repl/components/Code';
import Loader from '@src/repl/components/Loader';
import { BottomPanel, MainPanel, RightPanel } from '@src/repl/components/panel/Panel';
import { AppSidebar } from '@src/repl/components/panel/AppSidebar';
import { GridTab } from '@src/repl/components/panel/GridTab';
import { GridVisualizerPopup } from '@src/repl/components/panel/GridVisualizerPopup';
import { PatternTabs } from '@src/repl/components/panel/PatternTabs';
import { ShortcutsOverlay } from '@src/repl/components/panel/ShortcutsOverlay';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { closeGridPanel, useGridPanelOpen } from '@src/repl/patternGrid.mjs';
import { useSettings } from '@src/settings.mjs';

// type Props = {
//  context: replcontext,
// }

export default function ReplEditor(Props) {
  const { context, ...editorProps } = Props;
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen } = settings;
  const isEmbedded = typeof window !== 'undefined' && window.location !== window.parent.location;
  const gridPanelOpen = useGridPanelOpen();

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <div className="flex flex-col grow overflow-hidden">
        {/* <MainPanel context={context} isEmbedded={isEmbedded} className="hidden sm:block" /> */}
        <MainPanel context={context} isEmbedded={isEmbedded} />
        <div className="flex overflow-hidden h-full">
          {!isZen && !isEmbedded && <AppSidebar context={context} />}
          <div className="flex flex-col grow min-w-0 overflow-hidden">
            {!isZen && !isEmbedded && <PatternTabs context={context} />}
            <Code containerRef={containerRef} editorRef={editorRef} init={init} />
            {/* Docked in the lower half of THIS column (the code editor
                area), not the app-wide bottom strip (BottomPanel, sized for
                a console/reference tab) or the narrow right panel (sized
                for a sound-preview popup) -- the grid's per-track rows need
                real width and height, or they go straight into their own
                scroll, which is what was happening before. */}
            {!isZen && !isEmbedded && gridPanelOpen && (
              <div className="flex flex-col h-[42vh] min-h-[220px] max-h-[55%] shrink-0 border-t border-muted overflow-hidden">
                <div className="flex items-center justify-between px-2 h-6 min-h-6 border-b border-muted shrink-0">
                  <span className="text-[10px] uppercase tracking-wide opacity-50">grid</span>
                  <button onClick={closeGridPanel} title="close grid" className="opacity-50 hover:opacity-90">
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grow overflow-auto">
                  <GridTab context={context} />
                </div>
              </div>
            )}
          </div>
          {!isZen && panelPosition === 'right' && <RightPanel context={context} />}
        </div>
      </div>
      <GridVisualizerPopup />
      <ShortcutsOverlay />
      <UserFacingErrorMessage error={error} />
      {!isZen && panelPosition === 'bottom' && <BottomPanel context={context} />}
      {/* <MainPanel context={context} isEmbedded={isEmbedded} className="block sm:hidden" /> */}
    </div>
  );
}
