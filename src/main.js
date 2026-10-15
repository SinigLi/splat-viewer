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

// ---- 渲染器只创建一次，避免多 WebGL 上下文 ----
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

let viewer = null;

function createViewer() {
  const v = new GaussianSplats3D.Viewer({
    renderer,
    selfDrivenMode: false,
    useBuiltInControls: true,
    sharedMemoryForWorkers: false,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    dynamicScene: false,
    // 相机由库在 init() 时创建；只能通过官方参数设定初始位姿，
    // 不能在构造后直接碰 v.camera（此时还是 undefined，会崩整个模块）
    initialCameraPosition: [0, 0, 4],
    initialCameraLookAt: [0, 0, 0],
  });
  return v;
}
viewer = createViewer();

function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return (n / 1e3).toFixed(0) + ' KB';
}

async function openFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['ply', 'splat', 'ksplat'].includes(ext)) {
    infoChip.textContent = '不支持的格式: .' + ext;
    return;
  }
  hint.style.display = 'none';
  infoChip.textContent = '解析中: ' + file.name + ' (' + fmtBytes(file.size) + ')';

  try {
    // 销毁旧场景（外部传入的 renderer 不会被库销毁），再重建 viewer
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

    // Viewer 自身没有 getSplatCount()（运行时已验证），数量在 splatMesh 上
    const mesh = viewer.splatMesh;
    const count = mesh && typeof mesh.getSplatCount === 'function' ? mesh.getSplatCount() : 0;

    // 自动取景：Brush/COLMAP 导出的坐标原点常在模型体外，
    // 必须按点云包围球定位相机并对准中心，否则黑屏
    if (mesh && typeof mesh.getSplatCenter === 'function' && count > 0) {
      const V3 = viewer.camera.position.constructor;
      const tmp = new V3();
      const step = Math.max(1, Math.floor(count / 2000));
      const acc = new V3();
      let cnt = 0;
      for (let i = 0; i < count; i += step) { mesh.getSplatCenter(i, tmp); acc.add(tmp); cnt++; }
      const center = acc.multiplyScalar(1 / cnt);
      let radius = 0;
      for (let i = 0; i < count; i += step) {
        mesh.getSplatCenter(i, tmp);
        const d = tmp.distanceTo(center);
        if (d > radius) radius = d;
      }
      if (!isFinite(radius) || radius <= 0) radius = 5;
      const cam = viewer.camera;
      const fovRad = ((cam.fov || 60) * Math.PI) / 180;
      const dist = Math.max((radius * 2.2) / Math.tan(fovRad / 2), radius + 0.5);
      cam.near = Math.max(0.01, radius * 0.01);
      cam.far = Math.max(500, dist + radius * 10);
      cam.position.set(center.x, center.y, center.z + dist);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      if (viewer.controls) { try { viewer.controls.target.copy(center); viewer.controls.update(); } catch (_) {} }
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

// 调试钩子（无头诊断用，不影响正常使用）
window.__sv = { get viewer() { return viewer; }, renderer };

// ---- 横竖屏切换/窗口尺寸变化：同步渲染器与相机 ----
function handleResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (viewer && viewer.camera) {
    viewer.camera.aspect = window.innerWidth / window.innerHeight;
    viewer.camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 300));

// ---- 主循环：selfDrivenMode=false 时必须同时调 update() 和 render()，
// 库不会自动渲染（render 不走 threeScene，直接渲染 splatMesh）----
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

// ---- 横竖屏切换自适应 ----
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (viewer && viewer.camera) {
    viewer.camera.aspect = window.innerWidth / window.innerHeight;
    viewer.camera.updateProjectionMatrix();
  }
});
