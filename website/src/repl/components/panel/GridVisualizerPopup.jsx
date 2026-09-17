// The visualizer's floating window, built on the shared FloatingPopup
// chrome (drag-by-title-bar, close button, portaled to document.body).
// Mounted once at the ReplEditor level (not inside GridTab) so it
// survives the Grid panel being closed or the user switching tabs.
import { FloatingPopup } from './FloatingPopup.jsx';
import GridVisualizerScene from '../../../components/GridVisualizerScene.jsx';
import { closeVisualizerPopup, useVisualizerPopupOpen } from '../../gridVisualizer.mjs';

const SIZE = { width: 480, height: 340 };

export function GridVisualizerPopup() {
  const open = useVisualizerPopupOpen();
  if (!open) return null;
  return (
    <FloatingPopup
      title="grid visualizer"
      onClose={closeVisualizerPopup}
      width={SIZE.width}
      height={SIZE.height}
      defaultPosition={() => ({
        left: Math.max(16, window.innerWidth - SIZE.width - 32),
        top: Math.max(16, window.innerHeight - SIZE.height - 96),
      })}
    >
      <GridVisualizerScene />
    </FloatingPopup>
  );
}
