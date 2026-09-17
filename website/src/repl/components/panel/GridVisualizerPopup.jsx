// The visualizer's window chrome: a movable, closable popup <div>
// floating over the app (portal to document.body, dragged by its title
// bar) -- replacing what used to be a separate native Tauri window. Per
// explicit request: "visualisation shold not open as a seprate brawser
// window but as a movable popup DIV." Mounted once at the ReplEditor
// level (not inside GridTab) so it survives the Grid panel being closed
// or the user switching tabs -- only its own close button, or toggling
// "feeding" off in GridToolsPanel, dismisses it.
//
// Dragging is plain pointer-event math, the same shape as this codebase's
// other drag interactions (GridTab.jsx's native HTML5 DnD is a different
// mechanism, used there because it interoperates with dragging pattern
// tabs; a floating window doesn't need that, just its own position state).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/16/solid';
import GridVisualizer3D from '../../../components/GridVisualizer3D.jsx';
import { closeVisualizerPopup, useVisualizerPopupOpen } from '../../gridVisualizer.mjs';

const DEFAULT_SIZE = { width: 480, height: 340 };

export function GridVisualizerPopup() {
  const open = useVisualizerPopupOpen();
  const [pos, setPos] = useState(null); // null until first open, so it can center itself once
  const dragRef = useRef(null); // { startX, startY, originLeft, originTop } while dragging

  useEffect(() => {
    if (open && !pos) {
      setPos({
        left: Math.max(16, window.innerWidth - DEFAULT_SIZE.width - 32),
        top: Math.max(16, window.innerHeight - DEFAULT_SIZE.height - 96),
      });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e) => {
      if (!dragRef.current) return;
      const { startX, startY, originLeft, originTop } = dragRef.current;
      setPos({
        left: Math.min(Math.max(0, originLeft + (e.clientX - startX)), window.innerWidth - 60),
        top: Math.min(Math.max(0, originTop + (e.clientY - startY)), window.innerHeight - 40),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [open]);

  if (!open || !pos) return null;

  const onDragStart = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, originLeft: pos.left, originTop: pos.top };
  };

  return createPortal(
    <div
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height }}
      className="flex flex-col bg-lineHighlight border border-muted rounded shadow-2xl overflow-hidden z-[300]"
    >
      <div
        onPointerDown={onDragStart}
        className="flex items-center justify-between px-2 h-7 min-h-7 border-b border-muted shrink-0 cursor-move select-none bg-background/40"
      >
        <span className="text-[10px] uppercase tracking-wide opacity-60">grid visualizer</span>
        <button onClick={closeVisualizerPopup} title="close">
          <XMarkIcon className="w-3.5 h-3.5 opacity-50 hover:opacity-100" />
        </button>
      </div>
      <div className="relative grow overflow-hidden">
        <GridVisualizer3D />
      </div>
    </div>,
    document.body,
  );
}
