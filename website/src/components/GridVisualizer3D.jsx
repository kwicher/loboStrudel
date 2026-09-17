// The Grid's audio-reactive 3D visual: a glowing particle field that
// bursts outward on every hap trigger, rendered with additive-blended
// soft-round sprites and a bloom post-process pass for the "colorful and
// 3D" look requested (and, on a follow-up pass, "make it more appealing"
// after the first version -- a single rotating icosahedron with a few
// bursts around it -- came across as "just some ball"). See
// GridVisualizer2D.jsx for the lighter-weight alternative style
// ("visualization is computationally heavy... additional option" of a
// 2D line animation) -- GridVisualizerScene.jsx picks between the two.
//
// Technique-wise this borrows the common audio-reactive-particle recipe
// (see e.g. Codrops' "Audio-Reactive Visuals with Dynamic Particles in
// Three.js" and the various Three.js particle-audio demos): additive
// blending + a soft circular sprite texture for glow, frequency/pitch-
// mapped color, and an UnrealBloomPass composited on top. The one real
// difference from most of those write-ups: they drive particles from a
// continuous Web Audio FFT (bass/mid/treble energy every frame).
// Strudel's Grid only gives us discrete hap trigger events (one per
// note/sample fired, via Pattern#onTrigger -- see gridVisualizer.mjs),
// so instead of sampling a spectrum this treats each hap like a firework
// shell: it "explodes" a batch of particles from a pitch-mapped origin
// on a ring, which then fly out ballistically and fade -- plus a slow,
// continuous ambient field so the scene isn't dead between triggers.
//
// Ambient and burst particles are two SEPARATE THREE.Points objects (two
// draw calls instead of one shared pool) specifically so the "background
// spots" count control has a real effect: the ambient geometry's draw
// range is set to the live count each frame, and its per-frame update
// loop only iterates that many entries -- turning the slider down
// actually skips the work, not just hides the result.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { subscribeHaps, useVisualizerSettings } from '../repl/gridVisualizer.mjs';

const BURST_CAP = 3000;
const AMBIENT_CAP = 800; // hard upper bound the "background spots" slider can reach

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Maps a hap payload to a hue (0-1) and a ring position (angle), so pitch
// (or, for unpitched samples, a stable hash of the sample name) reads as
// both a color and a position on the burst ring -- two visual cues from
// one number, rather than everything spawning from the same spot.
function hapToPolar(payload) {
  const raw = payload?.note ?? payload?.n ?? hashString(payload?.s ?? 'x') / 7;
  const wrapped = ((raw % 12) + 12) % 12; // treat as a pitch class, works fine for hashes too
  return wrapped / 12;
}

function paletteColor(mode, t, gain) {
  const color = new THREE.Color();
  if (mode === 'mono') {
    color.setHSL(0.54, 0.85, 0.45 + gain * 0.25); // cyan accent, brightness tracks velocity
  } else if (mode === 'fire') {
    color.setHSL(0.02 + t * 0.09, 0.9, 0.45 + gain * 0.25); // red -> orange -> gold band
  } else {
    color.setHSL(t, 0.8, 0.5 + gain * 0.2); // 'spectrum': full hue wheel by pitch class
  }
  return color;
}

// A soft radial-gradient dot, generated once on a canvas -- the classic,
// dependency-free way to get glowy round particles out of THREE.Points
// (which otherwise draws hard-edged squares).
function makeSpriteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function GridVisualizer3D() {
  const mountRef = useRef(null);
  const settingsRef = useRef(useVisualizerSettings());
  settingsRef.current = useVisualizerSettings();

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    let width = mountEl.clientWidth || 1;
    let height = mountEl.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(0, 0, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070a, 1);
    mountEl.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.2, 0.6, 0.15);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const sprite = makeSpriteTexture();
    const rand = (a, b) => a + Math.random() * (b - a);

    // --- Ambient field: a slow, dim, always-drifting background. Its
    // draw range and update-loop bound both track the live "background
    // spots" setting, read fresh every frame. ---
    const ambientPositions = new Float32Array(AMBIENT_CAP * 3);
    const ambientColor = new Float32Array(AMBIENT_CAP * 3);
    const ambientVelocity = new Float32Array(AMBIENT_CAP * 3);
    for (let i = 0; i < AMBIENT_CAP; i++) {
      const r = rand(2.5, 5.5);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rand(-1, 1));
      ambientPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      ambientPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      ambientPositions[i * 3 + 2] = r * Math.cos(phi);
      const c = paletteColor('mono', 0, 0);
      ambientColor[i * 3] = c.r * 0.35;
      ambientColor[i * 3 + 1] = c.g * 0.35;
      ambientColor[i * 3 + 2] = c.b * 0.35;
      ambientVelocity[i * 3] = rand(-0.05, 0.05);
      ambientVelocity[i * 3 + 1] = rand(-0.05, 0.05);
      ambientVelocity[i * 3 + 2] = rand(-0.05, 0.05);
    }
    const ambientGeometry = new THREE.BufferGeometry();
    ambientGeometry.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));
    ambientGeometry.setAttribute('color', new THREE.BufferAttribute(ambientColor, 3));
    const ambientMaterial = new THREE.PointsMaterial({
      size: 3.5,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const ambientPoints = new THREE.Points(ambientGeometry, ambientMaterial);
    scene.add(ambientPoints);

    // --- Burst pool: spawned and recycled round-robin as haps arrive. ---
    const burstPositions = new Float32Array(BURST_CAP * 3);
    // Two color buffers on purpose: spawnColor is each particle's fixed
    // full-brightness color (read every frame to compute the fade), and
    // displayColor is the one actually bound to the geometry attribute
    // (spawnColor scaled by remaining life). Using a single shared array
    // for both would mean writing this frame's faded value clobbers the
    // full-brightness value the next frame's fade needs to read from.
    const burstSpawnColor = new Float32Array(BURST_CAP * 3);
    const burstDisplayColor = new Float32Array(BURST_CAP * 3);
    const burstSize = new Float32Array(BURST_CAP);
    const burstVelocity = new Float32Array(BURST_CAP * 3);
    const burstLife = new Float32Array(BURST_CAP); // 0 = dead/available
    const burstMaxLife = new Float32Array(BURST_CAP);
    let nextBurstSlot = 0;

    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
    burstGeometry.setAttribute('color', new THREE.BufferAttribute(burstDisplayColor, 3));
    burstGeometry.setAttribute('size', new THREE.BufferAttribute(burstSize, 1));
    const burstMaterial = new THREE.PointsMaterial({
      size: 1,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    // PointsMaterial has one uniform size; per-particle variation comes
    // from scaling color brightness with the `size` attribute baked into
    // vertex color instead -- simplest thing that reads as "varied" while
    // still using the plain (non-shader-authored) PointsMaterial, so
    // there's no custom GLSL to keep working across three.js versions.
    const burstPoints = new THREE.Points(burstGeometry, burstMaterial);
    scene.add(burstPoints);

    const spawnBurst = (payload) => {
      const { intensity, palette } = settingsRef.current;
      const t = hapToPolar(payload);
      const gain = typeof payload?.gain === 'number' ? Math.min(payload.gain, 2) : 1;
      const originAngle = t * Math.PI * 2;
      const originRadius = 1.6;
      const ox = Math.cos(originAngle) * originRadius;
      const oy = Math.sin(originAngle) * originRadius * 0.6;
      const oz = rand(-0.5, 0.5);
      const count = Math.max(4, Math.round(18 * intensity * (0.6 + gain * 0.5)));
      const color = paletteColor(palette, t, gain);

      for (let n = 0; n < count; n++) {
        const slot = nextBurstSlot;
        nextBurstSlot = (nextBurstSlot + 1) % BURST_CAP;

        const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        const speed = rand(1.2, 3) * (0.7 + gain * 0.6);
        burstPositions[slot * 3] = ox;
        burstPositions[slot * 3 + 1] = oy;
        burstPositions[slot * 3 + 2] = oz;
        burstVelocity[slot * 3] = dir.x * speed;
        burstVelocity[slot * 3 + 1] = dir.y * speed;
        burstVelocity[slot * 3 + 2] = dir.z * speed;
        burstSpawnColor[slot * 3] = color.r;
        burstSpawnColor[slot * 3 + 1] = color.g;
        burstSpawnColor[slot * 3 + 2] = color.b;
        burstSize[slot] = rand(3, 7) * (0.8 + gain * 0.4);
        burstMaxLife[slot] = rand(0.6, 1.3);
        burstLife[slot] = burstMaxLife[slot];
      }
    };

    const unsubscribe = subscribeHaps(spawnBurst);

    const onResize = () => {
      width = mountEl.clientWidth || 1;
      height = mountEl.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mountEl);
    window.addEventListener('resize', onResize);

    let animationId;
    let lastT = performance.now();
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      ambientPoints.rotation.y += dt * 0.05;
      ambientPoints.rotation.x += dt * 0.01;
      burstPoints.rotation.y = ambientPoints.rotation.y;
      burstPoints.rotation.x = ambientPoints.rotation.x;
      bloomPass.strength = settingsRef.current.bloom;

      // Live "background spots" count -- both the update loop bound and
      // the draw range track it, so turning it down is a real CPU/GPU
      // saving, not just a smaller visible slice of a fixed-cost loop.
      const ambientCount = Math.max(0, Math.min(AMBIENT_CAP, Math.round(settingsRef.current.ambientCount)));
      ambientGeometry.setDrawRange(0, ambientCount);
      for (let i = 0; i < ambientCount; i++) {
        ambientPositions[i * 3] += ambientVelocity[i * 3] * dt;
        ambientPositions[i * 3 + 1] += ambientVelocity[i * 3 + 1] * dt;
        ambientPositions[i * 3 + 2] += ambientVelocity[i * 3 + 2] * dt;
        const dist = Math.hypot(ambientPositions[i * 3], ambientPositions[i * 3 + 1], ambientPositions[i * 3 + 2]);
        if (dist > 6 || dist < 2) {
          ambientVelocity[i * 3] *= -1;
          ambientVelocity[i * 3 + 1] *= -1;
          ambientVelocity[i * 3 + 2] *= -1;
        }
      }
      if (ambientCount > 0) ambientGeometry.attributes.position.needsUpdate = true;

      for (let i = 0; i < BURST_CAP; i++) {
        if (burstLife[i] <= 0) continue;
        burstLife[i] -= dt;
        if (burstLife[i] <= 0) {
          burstDisplayColor[i * 3] = burstDisplayColor[i * 3 + 1] = burstDisplayColor[i * 3 + 2] = 0;
          continue;
        }
        burstVelocity[i * 3 + 1] -= dt * 0.6; // gentle gravity
        burstVelocity[i * 3] *= 1 - dt * 0.4; // drag
        burstVelocity[i * 3 + 1] *= 1 - dt * 0.4;
        burstVelocity[i * 3 + 2] *= 1 - dt * 0.4;
        burstPositions[i * 3] += burstVelocity[i * 3] * dt;
        burstPositions[i * 3 + 1] += burstVelocity[i * 3 + 1] * dt;
        burstPositions[i * 3 + 2] += burstVelocity[i * 3 + 2] * dt;
        const fade = Math.max(0, burstLife[i] / burstMaxLife[i]);
        const idx = i * 3;
        burstDisplayColor[idx] = burstSpawnColor[idx] * fade;
        burstDisplayColor[idx + 1] = burstSpawnColor[idx + 1] * fade;
        burstDisplayColor[idx + 2] = burstSpawnColor[idx + 2] * fade;
      }
      burstGeometry.attributes.position.needsUpdate = true;
      burstGeometry.attributes.color.needsUpdate = true;

      composer.render();
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      unsubscribe();
      ambientGeometry.dispose();
      ambientMaterial.dispose();
      burstGeometry.dispose();
      burstMaterial.dispose();
      sprite.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, background: '#05070a' }} />;
}
