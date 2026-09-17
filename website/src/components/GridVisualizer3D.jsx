// The Grid's "cooler than pianoroll" visual: a colorful, audio-reactive
// 3D scene, rendered here rather than in the main app window -- this
// component is mounted (client:only) by website/src/pages/visualizer.astro,
// which Tauri opens as its own native window (see gridVisualizer.mjs).
// Data arrives over Tauri's cross-window event bus (there's no shared JS
// state between two separate webview windows), one 'grid-hap' event per
// note/sample trigger, already reduced to a small plain object by the
// hook in gridVisualizer.mjs -- this file never touches Strudel's
// scheduler or pattern objects directly.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const HAP_EVENT = 'grid-hap';
const MAX_BURSTS = 80;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// note/n (if present) pick a stable, evenly-spread hue; otherwise the
// sample name is hashed into one instead, so an unpitched hit (a drum
// sample with no note) still gets a consistent, distinct color rather
// than always landing on the same fallback hue.
function hapColor(payload) {
  const seed = payload?.note ?? payload?.n ?? hashString(payload?.s ?? 'x');
  const hue = (((seed * 47) % 360) + 360) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.75, 0.6);
}

export default function GridVisualizer3D() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mountEl.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const point = new THREE.PointLight(0xffffff, 1.3);
    point.position.set(4, 4, 6);
    scene.add(point);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4, 1),
      new THREE.MeshStandardMaterial({
        color: 0x89ddff,
        metalness: 0.25,
        roughness: 0.35,
        emissive: 0x14232b,
        emissiveIntensity: 0.4,
      }),
    );
    scene.add(core);

    const burstGeometry = new THREE.IcosahedronGeometry(0.18, 0);
    /** @type {{mesh: THREE.Mesh, born: number, life: number}[]} */
    let bursts = [];

    const spawnBurst = (payload) => {
      const color = hapColor(payload);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.7,
        transparent: true,
      });
      const mesh = new THREE.Mesh(burstGeometry, material);
      const radius = 1.6 + Math.random() * 0.7;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      mesh.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );
      const gain = typeof payload?.gain === 'number' ? payload.gain : 1;
      mesh.scale.setScalar(0.6 + Math.min(gain, 2) * 0.7);
      scene.add(mesh);
      bursts.push({ mesh, born: performance.now(), life: 650 + Math.random() * 350 });

      // Also nudge the core itself, so the scene visibly reacts even
      // when a given burst lands out of frame.
      core.material.emissiveIntensity = Math.min(1.5, core.material.emissiveIntensity + 0.35);
      core.material.color.lerp(color, 0.3);

      if (bursts.length > MAX_BURSTS) {
        const stale = bursts.shift();
        scene.remove(stale.mesh);
        stale.mesh.material.dispose();
      }
    };

    let unlisten = null;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        unlisten = await listen(HAP_EVENT, (event) => spawnBurst(event.payload));
      } catch {
        // Not running under Tauri (e.g. this page opened directly in a
        // plain browser tab) -- the scene still renders, just idle,
        // with no live data feeding it.
      }
    })();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const now = performance.now();

      core.rotation.x += 0.004;
      core.rotation.y += 0.006;
      core.material.emissiveIntensity = Math.max(0.35, core.material.emissiveIntensity * 0.96);

      bursts = bursts.filter((b) => {
        const age = now - b.born;
        if (age > b.life) {
          scene.remove(b.mesh);
          b.mesh.material.dispose();
          return false;
        }
        const t = age / b.life;
        b.mesh.rotation.x += 0.05;
        b.mesh.rotation.y += 0.08;
        b.mesh.material.opacity = Math.max(0, 1 - t);
        b.mesh.position.multiplyScalar(1 + 0.004);
        return true;
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', onResize);
      unlisten?.();
      bursts.forEach((b) => {
        scene.remove(b.mesh);
        b.mesh.material.dispose();
      });
      core.geometry.dispose();
      core.material.dispose();
      burstGeometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'fixed', inset: 0, background: '#05070a' }} />;
}
