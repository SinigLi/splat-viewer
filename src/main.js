import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

const hud = document.getElementById('hud');
const hint = document.getElementById('hint');
const openBtn = document.getElementById('openBtn');
const fileInput = document.getElementById('fileInput');

function chip(text) {
  const el = document.createElement('div');
  el.className = 'chip';
  el.textContent = text;
  hud.appendChild(el);
  return el;
}

const fpsChip = chip('FPS: --');
const infoChip = chip('未加载模型');

function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return (n / 1e3).toFixed(0) + ' KB';
}

// ---- 渲染器只创建一次 ----
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

// ---- 自有相机 + SuperSplat 式球坐标 orbit 状态 ----
// 参考 playcanvas/super-splat src/controllers.ts + camera.ts：
// 旋转 = 方位角/仰角绕焦点转，绝不直接改四元数 → 不翻转不漂移
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
const orbit = {
  azim: 0,                 // 方位角 (rad)
  elev: -0.35,             // 仰角 (rad)，初始俯视约 20°
  dist: 8,                 // 到焦点距离
  focal: new THREE.Vector3(0, 0, 0),
};
const ELEV_LIMIT = Math.PI / 2 - 0.02; // ±~89°，防止翻越顶部/底部

function applyCamera() {
  orbit.elev = Math.max(-ELEV_LIMIT, Math.min(ELEV_LIMIT, orbit.elev));
  const ce = Math.cos(orbit.elev), se = Math.sin(orbit.elev);
  camera.position.set(
    orbit.focal.x + orbit.dist * ce * Math.sin(orbit.azim),
    orbit.focal.y + orbit.dist * se,
    orbit.focal.z + orbit.dist * ce * Math.cos(orbit.azim)
  );
  camera.lookAt(orbit.focal);
}
applyCamera();

let viewer = null;

function createViewer() {
  const v = new GaussianSplats3D.Viewer({
    renderer,
    camera,                    // 外部相机：相机完全由我们的 orbit 状态驱动
    selfDrivenMode: false,
    useBuiltInControls: false, // 关掉内置 OrbitControls，用 SuperSplat 式手势
    sharedMemoryForWorkers: false,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    dynamicScene: false,
  });
  return v;
}
viewer = createViewer();

// ---- SuperSplat 式触摸/鼠标手势（PointerController 移植）----
// 单指拖动 = orbit；双指 = 中点 pan + 捏合 zoom；滚轮 = zoom
const canvas = renderer.domElement;
const pointers = new Map(); // pointerId -> {x, y}
let pinch = { midx: 0, midy: 0, len: 0, valid: false };

const dist2d = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function pinchState() {
  const pts = [...pointers.values()];
  return {
    midx: (pts[0].x + pts[1].x) * 0.5,
    midy: (pts[0].y + pts[1].y) * 0.5,
    len: dist2d(pts[0].x, pts[0].y, pts[1].x, pts[1].y),
  };
}

function orbitBy(dx, dy) {
  // 灵敏度随视口高度自适应：整屏高约转 2π*0.4，接近 SuperSplat 手感
  const sens = (Math.PI * 2 * 0.4) / Math.max(window.innerHeight, 1);
  orbit.azim -= dx * sens;
  orbit.elev -= dy * sens;
  applyCamera();
}

function panBy(dx, dy) {
  // 屏幕像素 → 世界位移：按当前距离与 FOV 换算，任意缩放级别手感一致
  const worldPerPixel = (2 * orbit.dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(window.innerHeight, 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  orbit.focal.addScaledVector(right, -dx * worldPerPixel);
  orbit.focal.addScaledVector(up, dy * worldPerPixel);
  applyCamera();
}

function zoomBy(ratio) {
  orbit.dist = Math.max(0.05, Math.min(5000, orbit.dist * ratio));
  applyCamera();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const s = pinchState();
    pinch = { ...s, valid: true };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;

  if (pointers.size === 1) {
    orbitBy(dx, dy);
  } else if (pointers.size === 2 && pinch.valid) {
    const s = pinchState();
    panBy(s.midx - pinch.midx, s.midy - pinch.midy);
    if (pinch.len > 0 && s.len > 0) zoomBy(pinch.len / s.len);
    pinch = { ...s };
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch.valid = false;
  if (pointers.size === 1) {
    const only = [...pointers.values()][0];
    // 重置基准点，避免残余位移造成跳变
    only.x = e.clientX; only.y = e.clientY;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer); // SuperSplat 踩坑注释：漏了 cancel 会导致后续手势误判

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

// ---- 打开文件 ----
async function openFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['ply', 'splat', 'ksplat'].includes(ext)) {
    infoChip.textContent = '不支持的格式: .' + ext;
    return;
  }
  hint.style.display = 'none';
  infoChip.textContent = '解析中: ' + file.name + ' (' + fmtBytes(file.size) + ')';

  try {
    if (viewer) { try { await viewer.dispose(); } catch (_) {} }
    viewer = createViewer();

    const buf = await file.arrayBuffer();
    const blobUrl = URL.createObjectURL(new Blob([buf]));
    const format = ext === 'ply'
      ? GaussianSplats3D.SceneFormat.Ply
      : (ext === 'ksplat' ? GaussianSplats3D.SceneFormat.KSplat : GaussianSplats3D.SceneFormat.Splat);

    await viewer.addSplatScene(blobUrl, {
      format,
      showLoadingUI: false,
      splatAlphaRemovalThreshold: 0,
    });

    const mesh = viewer.splatMesh;
    const count = mesh && typeof mesh.getSplatCount === 'function' ? mesh.getSplatCount() : 0;

    // SuperSplat 的 PLY 加载约定：绕 Z 轴转 180°（splat-transform
    // src/lib/utils/math.ts: "PLY coordinate convention: 180-degree
    // rotation around Z"）——这是 SuperSplat 打开模型角度正确的处理
    if (mesh) {
      mesh.rotation.set(0, 0, Math.PI);
      mesh.updateMatrixWorld(true);
    }

    // 自动取景：世界空间计算点云包围球（含 mesh 旋转），相机对准中心
    if (mesh && typeof mesh.getSplatCenter === 'function' && count > 0) {
      const tmp = new THREE.Vector3();
      const acc = new THREE.Vector3();
      const step = Math.max(1, Math.floor(count / 2000));
      let cnt = 0;
      for (let i = 0; i < count; i += step) {
        mesh.getSplatCenter(i, tmp);
        tmp.applyMatrix4(mesh.matrixWorld);
        acc.add(tmp); cnt++;
      }
      const center = acc.multiplyScalar(1 / cnt);
      let radius = 0;
      for (let i = 0; i < count; i += step) {
        mesh.getSplatCenter(i, tmp);
        tmp.applyMatrix4(mesh.matrixWorld);
        const d = tmp.distanceTo(center);
        if (d > radius) radius = d;
      }
      if (!isFinite(radius) || radius <= 0) radius = 5;

      orbit.focal.copy(center);
      orbit.dist = Math.max((radius * 2.2) / Math.tan((camera.fov * Math.PI) / 360), radius + 0.5);
      camera.near = Math.max(0.01, radius * 0.01);
      camera.far = Math.max(500, orbit.dist + radius * 10);
      camera.updateProjectionMatrix();
      applyCamera();
    }

    infoChip.textContent = file.name + ' — ' + count.toLocaleString() + ' splats, ' + fmtBytes(file.size);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error(err);
    infoChip.textContent = '加载失败: ' + (err && err.message ? err.message : '未知错误');
  }
}

openBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) openFile(f);
  fileInput.value = '';
});

// ---- 窗口尺寸变化 ----
function handleResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyCamera();
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 300));

// ---- 主循环：update()（排序）+ render()（库不自动渲染，必须手动调）----
let frames = 0, last = performance.now();
let loopErr = null;
(function loop() {
  requestAnimationFrame(loop);
  try {
    viewer.update();
    viewer.render();
  } catch (e) {
    if (!loopErr) { loopErr = e; console.error('loop error:', e); window.__svLoopError = e.message; }
  }
  frames++;
  const now = performance.now();
  if (now - last >= 1000) {
    fpsChip.textContent = 'FPS: ' + frames;
    frames = 0;
    last = now;
  }
})();

// 调试钩子
window.__sv = { get viewer() { return viewer; }, renderer, camera, orbit };
