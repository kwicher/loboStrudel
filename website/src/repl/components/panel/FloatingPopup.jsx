// Shared chrome for a movable, closable popup <div> floating over the
// app -- portaled to document.body, dragged by its own title bar. Used
// by both GridVisualizerPopup.jsx and GridToolsPanel.jsx (the latter
// used to be a cramped docked column that needed inner scrolling; moved
// here per explicit request: "it should also be a floating pop-up DIV").
// Dragging is plain pointer-event math (not native HTML5 DnD, which
// GridTab.jsx uses for a different purpose -- interoperating with
// dragging pattern tabs onto tracks -- that a standalone floating window
// doesn't need).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/16/solid';

export function FloatingPopup({ title, onClose, width, height, defaultPosition, children }) {
  const [pos, setPos] = useState(null); // null until first open, so it can place itself once
  const dragRef = useRef(null); // { startX, startY, originLeft, originTop } while dragging

  useEffect(() => {
    if (!pos) {
      setPos(defaultPosition());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
  }, []);

  if (!pos) return null;

  const onDragStart = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, originLeft: pos.left, originTop: pos.top };
  };

  return createPortal(
    <div
      style={{ position: 'fixed', left: pos.left, top: pos.top, width, height }}
      className="flex flex-col bg-lineHighlight border border-muted rounded shadow-2xl overflow-hidden z-[300]"
    >
      <div
        onPointerDown={onDragStart}
        className="flex items-center justify-between px-2 h-7 min-h-7 border-b border-muted shrink-0 cursor-move select-none bg-background/40"
      >
        <span className="text-[10px] uppercase tracking-wide opacity-60">{title}</span>
        <button onClick={onClose} title="close">
          <XMarkIcon className="w-3.5 h-3.5 opacity-50 hover:opacity-100" />
        </button>
      </div>
      <div className="relative grow overflow-auto">{children}</div>
    </div>,
    document.body,
  );
}
