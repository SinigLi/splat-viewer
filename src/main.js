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
  });
  v.camera.position.set(0, 0, 4);
  v.camera.lookAt(0, 0, 0);
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

    const count = viewer.getSplatCount();
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

// ---- 主循环：viewer.update() 同时驱动空场景与已加载场景 ----
let frames = 0, last = performance.now();
(function loop() {
  requestAnimationFrame(loop);
  try { viewer.update(); } catch (_) {}
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
