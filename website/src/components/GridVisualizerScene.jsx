// Picks the visualizer's rendering style ('3d' particle scene vs '2d'
// canvas line scope) based on the live setting -- lets GridVisualizerPopup
// stay agnostic to which one's running, and means switching styles from
// GridToolsPanel unmounts one scene and mounts the other cleanly (their
// effect cleanups already dispose everything).
import GridVisualizer3D from './GridVisualizer3D.jsx';
import GridVisualizer2D from './GridVisualizer2D.jsx';
import { useVisualizerSettings } from '../repl/gridVisualizer.mjs';

export default function GridVisualizerScene() {
  const { style } = useVisualizerSettings();
  return style === '2d' ? <GridVisualizer2D /> : <GridVisualizer3D />;
}
