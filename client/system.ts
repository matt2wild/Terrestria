// =============================================================================
// client/system.ts — an ambient 3D star-system view (Three.js). Purely
// decorative: a glowing star with orbiting worlds, one highlighted per colony
// in the game (yours green, rivals red) plus a few neutral dead worlds for
// flavor. It renders only when there's screen room for it (wide + tall
// viewports) and WebGL is available; otherwise the panel hides itself.
// =============================================================================
import * as THREE from 'three';
import type { NetView } from '../engine.js';

interface World { pivot: THREE.Object3D; mesh: THREE.Mesh; ring: THREE.Mesh; speed: number; spin: number; }

const COL = { you: 0x4ddf9a, rival: 0xff6b6b, neutral: 0x6b7a90, star: 0xffd27a };
const ORBITS = [3.0, 4.1, 5.2, 6.3, 7.4];

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let system: THREE.Group;
let worlds: World[] = [];
let host: HTMLElement | null = null;
let started = false;
let last = 0;
let desired = { count: 0 };

function webglOK(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
function hidePanel(): void { const p = document.getElementById('system'); if (p) p.style.display = 'none'; }

export function initSystem(): void {
  try {
    host = document.getElementById('system-canvas');
    if (!host) return;
    if (!webglOK()) { hidePanel(); return; }
    const mq = window.matchMedia('(min-width: 1000px) and (min-height: 760px)');
    const tryStart = (): void => { if (mq.matches) start(); };
    mq.addEventListener?.('change', tryStart);
    tryStart();
  } catch { hidePanel(); }
}

function start(): void {
  if (started || !host) return;
  started = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 7, 13.5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  host.appendChild(renderer.domElement);

  system = new THREE.Group();
  system.rotation.x = 0.34;
  scene.add(system);

  // central star + soft corona + light
  system.add(new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 24), new THREE.MeshBasicMaterial({ color: COL.star })));
  system.add(new THREE.Mesh(new THREE.SphereGeometry(1.75, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending })));
  const sun = new THREE.PointLight(0xfff0d0, 2.4, 0, 0); scene.add(sun);
  scene.add(new THREE.AmbientLight(0x3a4a66, 0.9));

  resize();
  new ResizeObserver(resize).observe(host);
  rebuild();
  last = performance.now();
  loop();
}

function rebuild(): void {
  for (const w of worlds) {
    system.remove(w.pivot); system.remove(w.ring);
    w.mesh.geometry.dispose(); (w.mesh.material as THREE.Material).dispose();
    w.ring.geometry.dispose(); (w.ring.material as THREE.Material).dispose();
  }
  worlds = [];
  const n = Math.max(desired.count, 0);
  const total = Math.min(Math.max(n, 5), ORBITS.length);   // show ≥5 bodies for a lived-in system
  for (let i = 0; i < total; i++) {
    const r = ORBITS[i];
    const isColony = i < n;
    const color = !isColony ? COL.neutral : (i === 0 ? COL.you : COL.rival);

    const pivot = new THREE.Object3D();
    pivot.rotation.y = Math.random() * Math.PI * 2;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(isColony ? 0.42 : 0.3, 20, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: isColony ? 0.4 : 0.12, roughness: 0.75, metalness: 0.1 }),
    );
    mesh.position.x = r;
    pivot.add(mesh);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.015, r + 0.015, 96),
      new THREE.MeshBasicMaterial({ color: isColony ? color : 0x2c3a52, transparent: true, opacity: isColony ? 0.5 : 0.28, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;

    system.add(ring); system.add(pivot);
    worlds.push({ pivot, mesh, ring, speed: 0.3 / Math.sqrt(r), spin: 0.4 + Math.random() * 0.5 });
  }
}

function resize(): void {
  if (!renderer || !host) return;
  const w = host.clientWidth || 300, h = host.clientHeight || 240;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

function loop(): void {
  requestAnimationFrame(loop);
  if (!renderer) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  for (const w of worlds) { w.pivot.rotation.y += w.speed * dt; w.mesh.rotation.y += w.spin * dt; }
  system.rotation.y += 0.03 * dt;
  renderer.render(scene, camera);
}

/** Sync the number of highlighted colony worlds to the live game. */
export function updateSystem(view: NetView): void {
  try {
    const count = 1 + (view.opponents?.length ?? 0);
    if (count !== desired.count) { desired = { count }; if (started) rebuild(); }
  } catch { /* decorative only — never break the game render */ }
}
