// Small master-output level meter for the header -- the only playback
// feedback anywhere in the main UI besides the play/stop button itself was
// pure silence-or-not, no sense of "is anything actually loud, is it
// clipping." Reads packages/superdough's getMasterAnalyzerData(), a tap on
// the real master bus (see superdoughoutput.mjs), not a per-voice/preview
// analyser, so it reflects the whole mix.
import { useEffect, useRef } from 'react';
import { getMasterAnalyzerData } from '@strudel/webaudio';
import cx from '@src/cx.mjs';

export function LevelMeter({ context }) {
  const barRef = useRef();
  const clipRef = useRef();
  const rafRef = useRef();
  const clipUntilRef = useRef(0);

  useEffect(() => {
    const draw = () => {
      let level = 0;
      try {
        const data = getMasterAnalyzerData('time');
        if (data && data.length) {
          let sumSq = 0;
          for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
          level = Math.sqrt(sumSq / data.length);
        }
      } catch {
        // audio graph not initialized yet (e.g. before first click) -- just
        // show an empty meter rather than throwing.
      }
      // RMS of a typical mix rarely gets close to 1.0, so a straight linear
      // map reads as "always nearly empty" -- scale it up for a meter that
      // actually moves during normal playback.
      const pct = Math.min(1, level * 3.5) * 100;
      if (barRef.current) barRef.current.style.width = `${pct}%`;
      if (level >= 0.95) clipUntilRef.current = performance.now() + 400;
      if (clipRef.current) {
        clipRef.current.style.opacity = performance.now() < clipUntilRef.current ? '1' : '0';
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="flex items-center gap-1.5 px-2" title="master output level">
      <span
        className={cx('w-1.5 h-1.5 rounded-full shrink-0', context.started ? 'bg-green-400' : 'bg-muted')}
        title={context.started ? 'playing' : 'stopped'}
      />
      <div className="relative w-16 h-1.5 rounded-full bg-background border border-muted overflow-hidden">
        <div ref={barRef} className="h-full bg-green-400" style={{ width: '0%' }} />
        <div
          ref={clipRef}
          className="absolute inset-0 bg-red-500 opacity-0 transition-opacity"
          title="clipping"
        />
      </div>
    </div>
  );
}
