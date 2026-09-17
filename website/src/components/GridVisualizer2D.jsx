// The Grid's lighter-weight visual: a plain 2D canvas, no WebGL, no
// particle allocation, no bloom pass -- added as an explicit alternative
// to GridVisualizer3D.jsx after "visualization is computationally
// heavy... additional option [of] some fancy 2D line animation."
//
// The shape: a ring of N angle "buckets" around the center, each holding
// an energy value that decays every frame and gets boosted when a hap
// lands near that angle (same pitch-class -> angle mapping as the 3D
// scene's hapToPolar, so switching styles keeps the same visual logic --
// a given note pushes out the ring in the same place either way). Each
// frame traces one closed polyline through all the bucket radii and
// strokes it, plus draws the frame with a low-alpha fill instead of a
// full clear so the previous frames bleed through as a fading trail --
// the "line animation" part. All of this is a few dozen trig calls and
// canvas draw commands per frame, nowhere near the 3D scene's per-
// particle simulation + WebGL + post-processing cost.
import { useEffect, useRef } from 'react';
import { subscribeHaps, useVisualizerSettings } from '../repl/gridVisualizer.mjs';

const BUCKETS = 96;
const DECAY = 0.9; // per-frame energy decay factor

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function hapToPolar(payload) {
  const raw = payload?.note ?? payload?.n ?? hashString(payload?.s ?? 'x') / 7;
  const wrapped = ((raw % 12) + 12) % 12;
  return wrapped / 12;
}

function paletteCss(mode, t, alpha) {
  let h;
  if (mode === 'mono') h = 194;
  else if (mode === 'fire') h = 7 + t * 32;
  else h = t * 360;
  return `hsla(${h}, 80%, 62%, ${alpha})`;
}

export default function GridVisualizer2D() {
  const canvasRef = useRef(null);
  const settingsRef = useRef(useVisualizerSettings());
  settingsRef.current = useVisualizerSettings();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const energy = new Float32Array(BUCKETS);
    const hue = new Float32Array(BUCKETS); // last hue seen in each bucket, for that bucket's stroke color

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width);
      canvas.height = Math.max(1, rect.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement);

    const onHap = (payload) => {
      const t = hapToPolar(payload);
      const gain = typeof payload?.gain === 'number' ? Math.min(payload.gain, 2) : 1;
      const { intensity } = settingsRef.current;
      const bucket = Math.floor(t * BUCKETS) % BUCKETS;
      // Spread the boost across a few neighboring buckets so a single hit
      // reads as a soft bump in the line rather than a single spike pixel.
      for (let d = -2; d <= 2; d++) {
        const i = ((bucket + d + BUCKETS) % BUCKETS);
        const falloff = 1 - Math.abs(d) / 3;
        energy[i] = Math.min(1.5, energy[i] + gain * intensity * 0.6 * falloff);
      }
      hue[bucket] = t;
    };
    const unsubscribe = subscribeHaps(onHap);

    let rotation = 0;
    let animationId;
    let lastT = performance.now();
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      rotation += dt * 0.08;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.22;
      const maxBoost = Math.min(w, h) * 0.22;

      // Low-alpha fill instead of clearRect -- previous frames bleed
      // through, faded, producing the trailing/comet look cheaply.
      ctx.fillStyle = 'rgba(5,7,10,0.16)';
      ctx.fillRect(0, 0, w, h);

      const { palette } = settingsRef.current;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= BUCKETS; i++) {
        const idx = i % BUCKETS;
        const angle = (idx / BUCKETS) * Math.PI * 2 + rotation;
        const radius = baseRadius + energy[idx] * maxBoost;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.65; // slight ellipse, reads less like a plain circle
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = paletteCss(palette, (rotation / (Math.PI * 2)) % 1, 0.9);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // A dim second pass at a smaller radius for a bit of depth, tinted
      // per-bucket by whatever note last hit it.
      ctx.beginPath();
      for (let i = 0; i <= BUCKETS; i++) {
        const idx = i % BUCKETS;
        const angle = (idx / BUCKETS) * Math.PI * 2 - rotation * 0.6;
        const radius = baseRadius * 0.55 + energy[idx] * maxBoost * 0.5;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.65;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = paletteCss(palette, hue[Math.floor(BUCKETS / 2)], 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < BUCKETS; i++) energy[i] *= DECAY;
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      unsubscribe();
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#05070a' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
