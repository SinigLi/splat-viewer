import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { Capacitor } from '@capacitor/core';
import {
  collectProject as collectProjectState,
  parseProject, extractSettings, extractMeshTransform, extractCamera,
  serializeSettings, parseSettings, SETTINGS_KEY,
  buildProjectZip, parseProjectFile,
} from './project-state.js';

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
  // 对齐 SuperSplat 默认灵敏度：orbitSensitivity 0.3（scene-config.ts:39）
  // playcanvas 角度制 = 0.3°/px ≈ 0.00524 rad/px
  const sens = orbitSensitivity * Math.PI / 180;
  orbit.azim -= dx * sens;
  orbit.elev += dy * sens;  // 垂直方向反转：下拖=视角升高（手感对齐习惯）
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
    if (modelXform) {
      moveMeshBy(dx, dy);
    } else {
      orbitBy(dx, dy);
    }
  } else if (pointers.size === 2 && pinch.valid) {
    const s = pinchState();
    if (modelXform) {
      // 变换模式：捏合缩放模型，双指中点位移忽略（避免和移动混淆）
      if (pinch.len > 0 && s.len > 0) scaleMeshBy(s.len / pinch.len);
    } else {
      panBy(s.midx - pinch.midx, s.midy - pinch.midy);
      if (pinch.len > 0 && s.len > 0) zoomBy(pinch.len / s.len);
    }
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

// ---- 设置面板 ----
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const sensRange = document.getElementById('sensRange');
const sensVal = document.getElementById('sensVal');
const gridToggle = document.getElementById('gridToggle');
const axesToggle = document.getElementById('axesToggle');

// 设置点击不穿透到画布手势
for (const el of [settingsBtn, settingsPanel]) {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
}
settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('open'));

// 旋转灵敏度（0.1 ~ 1.0 °/px，默认 0.3 = SuperSplat 同款）
let orbitSensitivity = 0.3;
sensRange.addEventListener('input', () => {
  orbitSensitivity = parseFloat(sensRange.value);
  sensVal.textContent = orbitSensitivity.toFixed(2);
});

// 地面网格 / 坐标轴：独立场景渲染（库的 render() 只画 splatMesh，
// 且 splatMesh 无父级，挂父级不会被绘制）
const helpersScene = new THREE.Scene();
const grid = new THREE.GridHelper(20, 20, 0x444444, 0x2a2a2a);
const axes = new THREE.AxesHelper(2);
grid.visible = false;   // 与复选框初始态一致（默认关）
axes.visible = false;
helpersScene.add(grid, axes);

// 网格/坐标轴跟随取景中心与模型尺度，切换时同步
function updateHelpers() {
  helpersScene.position.copy(orbit.focal);
  const s = Math.max(orbit.dist / 8, 0.01);
  grid.scale.setScalar(s);
  axes.scale.setScalar(Math.max(orbit.dist / 6, 0.01));
}
gridToggle.addEventListener('change', () => { grid.visible = gridToggle.checked; });
axesToggle.addEventListener('change', () => { axes.visible = axesToggle.checked; });

// ---- 设置持久化（localStorage：轻量设置自动记忆）----
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, serializeSettings({
      sens: orbitSensitivity,
      grid: gridToggle.checked,
      axes: axesToggle.checked,
    }));
  } catch (_) {}
}
(function loadSettings() {
  const s = parseSettings(localStorage.getItem(SETTINGS_KEY));
  if (!s) return;
  if (typeof s.sens === 'number') {
    orbitSensitivity = s.sens;
    sensRange.value = String(s.sens);
    sensVal.textContent = s.sens.toFixed(2);
  }
  if (typeof s.grid === 'boolean') { gridToggle.checked = s.grid; grid.visible = s.grid; }
  if (typeof s.axes === 'boolean') { axesToggle.checked = s.axes; axes.visible = s.axes; }
})();
sensRange.addEventListener('change', saveSettings);
gridToggle.addEventListener('change', saveSettings);
axesToggle.addEventListener('change', saveSettings);

// ---- 模型变换模式（参考 SuperSplat splats-transform-handler：
// 用 TRS 变换作用到模型整体；查看器里等效为变换 splatMesh 本身，
// 单指拖=屏幕平面移动模型，双指捏合=缩放模型）----
const xformToggle = document.getElementById('xformToggle');
let modelXform = false;
xformToggle.addEventListener('change', () => { modelXform = xformToggle.checked; });

function moveMeshBy(dx, dy) {
  const mesh = viewer && viewer.splatMesh;
  if (!mesh) return;
  const worldPerPixel = (2 * orbit.dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(window.innerHeight, 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  mesh.position.addScaledVector(right, dx * worldPerPixel);
  mesh.position.addScaledVector(up, -dy * worldPerPixel);
  mesh.updateMatrixWorld(true);
}

function scaleMeshBy(ratio) {
  const mesh = viewer && viewer.splatMesh;
  if (!mesh) return;
  const s = Math.max(0.01, Math.min(100, mesh.scale.x * ratio));
  mesh.scale.setScalar(s);
  mesh.updateMatrixWorld(true);
}

// ---- 工程（.svproj）：状态快照 = 模型变换 + 相机 + 设置 ----
// SuperSplat 的工程在云端（账号体系）；我们是纯离线 App，采用本地
// 状态文件方案：小 json 存状态，打开时重新载入对应模型文件。
let currentModelName = null;
let lastModelBytes = null;  // 当前模型的原始字节（保存工程用）
let lastModelExt = null;

function collectProject() {
  const mesh = viewer && viewer.splatMesh;
  return collectProjectState({
    modelName: currentModelName,
    mesh: mesh ? {
      position: mesh.position.toArray(),
      scale: mesh.scale.x,
      rotationZ: mesh.rotation.z,
    } : null,
    camera: {
      azim: orbit.azim,
      elev: orbit.elev,
      dist: orbit.dist,
      focal: orbit.focal.toArray(),
    },
    settings: {
      sens: orbitSensitivity,
      grid: gridToggle.checked,
      axes: axesToggle.checked,
      xform: xformToggle.checked,
    },
  });
}

function applyProject(p) {
  p = parseProject(p);
  // 设置（立即应用）
  const s = extractSettings(p);
  if (typeof s.sens === 'number') {
    orbitSensitivity = s.sens;
    sensRange.value = String(s.sens);
    sensVal.textContent = s.sens.toFixed(2);
  }
  if (typeof s.grid === 'boolean') { gridToggle.checked = s.grid; grid.visible = s.grid; }
  if (typeof s.axes === 'boolean') { axesToggle.checked = s.axes; axes.visible = s.axes; }
  if (typeof s.xform === 'boolean') { xformToggle.checked = s.xform; modelXform = s.xform; }
  saveSettings();
  // 模型变换（在模型加载后应用）
  pendingMeshXform = extractMeshTransform(p);
  // 相机（focal/dist 直接恢复；若无相机状态，加载后自动取景会皂底）
  pendingCamera = extractCamera(p);
  return p.model && p.model.fileName ? p.model.fileName : null;
}

let pendingMeshXform = null;
let pendingCamera = null;

function restorePending() {
  const mesh = viewer && viewer.splatMesh;
  if (mesh && pendingMeshXform) {
    const m = pendingMeshXform;
    if (Array.isArray(m.position)) mesh.position.fromArray(m.position);
    if (typeof m.scale === 'number') mesh.scale.setScalar(m.scale);
    if (typeof m.rotationZ === 'number') mesh.rotation.z = m.rotationZ;
    mesh.updateMatrixWorld(true);
  }
  if (pendingCamera) {
    const c = pendingCamera;
    orbit.azim = c.azim; orbit.elev = c.elev; orbit.dist = c.dist;
    orbit.focal.fromArray(c.focal);
    applyCamera();
  }
  pendingMeshXform = null;
  pendingCamera = null;
}

const saveBtn = document.getElementById('saveBtn');
const openProjBtn = document.getElementById('openProjBtn');
const projInput = document.getElementById('projInput');

saveBtn.addEventListener('click', async () => {
  if (!currentModelName || !lastModelBytes) { infoChip.textContent = '先加载模型再保存工程'; return; }
  const base = currentModelName.replace(/\.[^.]+$/, '');
  const fname = base + '.svproj';
  infoChip.textContent = '正在打包工程…';
  try {
    // v2：zip 包 = state.json + 模型字节（自包含，打开一步还原）
    const projBytes = buildProjectZip({
      modelName: currentModelName,
      mesh: (() => {
        const mesh = viewer && viewer.splatMesh;
        return mesh ? {
          position: mesh.position.toArray(),
          scale: mesh.scale.x,
          rotationZ: mesh.rotation.z,
        } : null;
      })(),
      camera: {
        azim: orbit.azim,
        elev: orbit.elev,
        dist: orbit.dist,
        focal: orbit.focal.toArray(),
      },
      settings: {
        sens: orbitSensitivity,
        grid: gridToggle.checked,
        axes: axesToggle.checked,
        xform: xformToggle.checked,
      },
    }, lastModelBytes, lastModelExt);

    if (Capacitor.isNativePlatform()) {
      // 安卓：写缓存后走系统分享面板（用户可选存到文件管理器/发送任意 App）
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const w = await Filesystem.writeFile({
        path: fname,
        data: projBytes,   // 二进制 zip，不设 encoding
        directory: Directory.Cache,
      });
      await Share.share({ title: fname, url: w.uri });
      infoChip.textContent = '工程已通过系统分享导出: ' + fname + ' (' + fmtBytes(projBytes.length) + ')';
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([projBytes], { type: 'application/zip' }));
      a.download = fname;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      infoChip.textContent = '工程已下载: ' + fname + ' (' + fmtBytes(projBytes.length) + ')';
    }
  } catch (err) {
    console.error(err);
    infoChip.textContent = '保存失败: ' + (err && err.message ? err.message : '未知错误');
  }
});

openProjBtn.addEventListener('click', () => projInput.click());
projInput.addEventListener('change', async () => {
  const f = projInput.files && projInput.files[0];
  projInput.value = '';
  if (!f) return;
  try {
    infoChip.textContent = '正在读取工程…';
    const bytes = new Uint8Array(await f.arrayBuffer());
    const proj = parseProjectFile(bytes);
    if (proj.kind === 'v2') {
      // 自包含工程：状态 + 模型一次到位
      applyProject(proj.state);
      infoChip.textContent = '工程已读（含模型），加载中…';
      await loadModelBytes(proj.modelBytes, proj.state.model.fileName || 'model.' + proj.modelExt, proj.modelExt);
      return;
    }
    // v1 旧格式：只有状态，需重选模型
    const modelName = applyProject(proj.state);
    infoChip.textContent = '旧版工程：请选择模型文件' + (modelName ? '「' + modelName + '」' : '');
    pendingProjName = modelName;
    fileInput.click();
  } catch (err) {
    console.error(err);
    infoChip.textContent = '打开工程失败: ' + (err && err.message ? err.message : '无效文件');
  }
});
let pendingProjName = null;

// ---- 打开文件 ----
// 字节加载核心：文件打开与工程内嵌模型共用
async function loadModelBytes(bytes, fileName, ext) {
  hint.style.display = 'none';
  infoChip.textContent = '解析中: ' + fileName + ' (' + fmtBytes(bytes.length) + ')';

  try {
    if (viewer) { try { await viewer.dispose(); } catch (_) {} }
    viewer = createViewer();

    lastModelBytes = bytes;
    lastModelExt = ext;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
    currentModelName = fileName;

    // SuperSplat 的 PLY 加载约定：绕 Z 轴转 180°（splat-transform
    // src/lib/utils/math.ts: "PLY coordinate convention: 180-degree
    // rotation around Z"）——这是 SuperSplat 打开模型角度正确的处理
    if (mesh) {
      mesh.rotation.set(0, 0, Math.PI);
      mesh.position.set(0, 0, 0);  // 重置上次的移动
      mesh.scale.setScalar(1);      // 重置上次的缩放
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

    // 工程状态恢复（若从「打开工程」进来）：变换 + 相机覆盖自动取景
    restorePending();

    infoChip.textContent = fileName + ' — ' + count.toLocaleString() + ' splats, ' + fmtBytes(bytes.length);
    if (pendingProjName && fileName !== pendingProjName) {
      infoChip.textContent += '（注意：与工程记录的「' + pendingProjName + '」不同名）';
    }
    pendingProjName = null;
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error(err);
    infoChip.textContent = '加载失败: ' + (err && err.message ? err.message : '未知错误');
  }
}

async function openFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['ply', 'splat', 'ksplat'].includes(ext)) {
    infoChip.textContent = '不支持的格式: .' + ext;
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadModelBytes(bytes, file.name, ext);
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
  if (grid.visible || axes.visible) {
    updateHelpers();
    // 库 render() 结束后 autoClear 被恢复为 true，直接画会清掉泼溅画面；
    // 强制不清屏，把辅助对象叠加在泼溅之上
    const saved = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(helpersScene, camera); } catch (_) {}
    renderer.autoClear = saved;
  }
})();

// 调试钩子
window.__sv = { get viewer() { return viewer; }, renderer, camera, orbit, helpersScene, collectProject };
