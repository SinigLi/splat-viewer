import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { Capacitor } from '@capacitor/core';
import {
  collectProject as collectProjectState,
  parseProject, extractSettings, extractMeshTransform, extractCamera,
  serializeSettings, parseSettings, SETTINGS_KEY,
  buildProjectZip, parseProjectFile,
} from './project-state.js';
import {
  pathsFor, emptyRegistry, upsertProject, removeProject,
  validateProjectName, isDirty, parseMeta,
} from './projects.js';

const hud = document.getElementById('hud');
const hint = document.getElementById('hint');
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');
const modelPage = document.getElementById('modelPage');
const projectsPage = document.getElementById('projectsPage');

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
// canvas 挂在模型页内（项目列表页是独立 DOM）
renderer.domElement.style.cssText = 'position:absolute; inset:0; touch-action:none;';
document.getElementById('modelPage').appendChild(renderer.domElement);

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
    // 相机手势永远只操作相机（对齐 SuperSplat：模型变换是独立工具，不混入手势层）
    orbitBy(dx, dy);
  } else if (pointers.size === 2 && pinch.valid) {
    const s = pinchState();
    // 双指：pan + 捏合 zoom（SuperSplat 同款组合）
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

// ---- 手势诊断日志（真机排查用：📤 导出发给开发） ----
const gestureLog = [];
function glog(kind, data = {}) {
  gestureLog.push({
    t: +(performance.now() / 1000).toFixed(2), kind, ...data,
    st: {
      d: +orbit.dist.toFixed(2), az: +orbit.azim.toFixed(3), el: +orbit.elev.toFixed(3),
      fx: +orbit.focal.x.toFixed(2), fy: +orbit.focal.y.toFixed(2), fz: +orbit.focal.z.toFixed(2),
      np: pointers.size, pin: pinch.valid,
      vvScale: +(window.visualViewport ? window.visualViewport.scale : 0).toFixed(3),
    },
  });
  if (gestureLog.length > 600) gestureLog.shift();
}
glog('boot', { ua: navigator.userAgent.slice(0, 80), dpr: window.devicePixelRatio,
  w: window.innerWidth, h: window.innerHeight, ta: getComputedStyle(canvas).touchAction });
canvas.addEventListener('pointerdown', (e) => glog('pd', { id: e.pointerId, x: +e.clientX.toFixed(1), y: +e.clientY.toFixed(1), pt: e.pointerType, btn: e.button }));
canvas.addEventListener('pointermove', (e) => glog('pm', { id: e.pointerId, x: +e.clientX.toFixed(1), y: +e.clientY.toFixed(1) }));
canvas.addEventListener('pointerup', (e) => glog('pu', { id: e.pointerId }));
canvas.addEventListener('pointercancel', (e) => glog('pc', { id: e.pointerId }));
window.visualViewport && visualViewport.addEventListener('resize', () => glog('vvresize', { scale: +visualViewport.scale.toFixed(3), w: window.innerWidth, h: window.innerHeight }));

// 📤 导出日志：按钮在 index.html（与能点的⚙️💾同款写法），点开全屏日志面板
const glogBtn = document.getElementById('glogBtn');
const glogPanel = document.createElement('div');
glogPanel.style.cssText = 'position:absolute; inset:0; background:rgba(0,0,0,.92); z-index:100; display:none; flex-direction:column; padding:12px; padding-top:max(calc(env(safe-area-inset-top)+12px),16px);';
const glogClose = document.createElement('button');
glogClose.textContent = '✕ 关闭';
glogClose.style.cssText = 'align-self:flex-end; padding:8px 16px; border-radius:8px; border:none; background:rgba(255,255,255,.15); color:#fff; font-size:15px;';
const glogTip = document.createElement('div');
glogTip.textContent = '长按文本框 → 全选 → 复制，发给开发';
glogTip.style.cssText = 'color:#8cf; font-size:13px; margin:8px 0;';
const glogTA = document.createElement('textarea');
glogTA.style.cssText = 'flex:1; width:100%; background:#111; color:#9f9; border:1px solid #333; border-radius:8px; font:11px monospace; white-space:pre;';
glogPanel.appendChild(glogClose); glogPanel.appendChild(glogTip); glogPanel.appendChild(glogTA);
modelPage.appendChild(glogPanel);
// 用 pointerup 触发（WebView click 可能被吞），并挡掉画布手势
for (const evt of ['pointerdown', 'pointerup', 'click']) {
  glogBtn.addEventListener(evt, (e) => e.stopPropagation());
}
glogBtn.addEventListener('pointerup', (e) => {
  e.stopPropagation(); e.preventDefault();
  glogTA.value = gestureLog.map((l) => JSON.stringify(l)).join('\n');
  glogPanel.style.display = 'flex';
  glog('log_opened');
});
glogClose.addEventListener('pointerup', (e) => { e.stopPropagation(); glogPanel.style.display = 'none'; });
for (const evt of ['pointerdown', 'pointermove', 'pointerup']) {
  glogPanel.addEventListener(evt, (e) => e.stopPropagation());
}
window.__svGlog = () => gestureLog.slice();
glog('glog_ready');

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

// ---- 模型变换（阶段1将以独立工具按钮回归，参考 SuperSplat move-tool + gizmo；
// 手势层已解耦：相机手势永不操作模型）----
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

// ---- 项目管理器 ----
// 修复闪退：不再走系统分享，直接存 App 私有目录（Directory.Data，无需权限）
// 存储：projects/<encoded>/project.svproj + thumb.jpg + meta.json + localStorage 注册表
let currentProjectName = null;   // 当前打开的项目名
let lastSavedSnapshot = null;    // 最近一次保存的快照（脏检查用）

// base64 工具（native Filesystem 二进制走 base64）
function bytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// 存储适配：native = Capacitor Filesystem；web = IndexedDB（跨会话持久）
const store = Capacitor.isNativePlatform() ? {
  async write(path, u8) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path, data: bytesToBase64(u8), directory: Directory.Data, recursive: true,
    });
  },
  async read(path) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const r = await Filesystem.readFile({ path, directory: Directory.Data });
    const data = typeof r.data === 'string' ? r.data : await (async () => {
      const b = await (/** @type {Blob} */ (r.data)).arrayBuffer();
      return bytesToBase64(new Uint8Array(b));
    })();
    return base64ToBytes(data);
  },
  async remove(path) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    try { await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true }); } catch (_) {}
  },
} : {
  // web：IndexedDB KV（key=path），测试与桌面预览用
  _idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('sv-store', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async write(path, u8) {
    const db = await this._idb();
    await new Promise((res, rej) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').put(u8, path);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  },
  async read(path) {
    const db = await this._idb();
    return new Promise((res, rej) => {
      const t = db.transaction('files').objectStore('files').get(path);
      t.onsuccess = () => { if (!t.result) throw new Error('不存在: ' + path); res(t.result); };
      t.onerror = () => rej(t.error);
    });
  },
  async remove(path) {
    const db = await this._idb();
    await new Promise((res, rej) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').delete(path);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  },
};

const REGISTRY_KEY = 'sv-registry';
function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) { const r = JSON.parse(raw); if (r && Array.isArray(r.projects)) return r; }
  } catch (_) {}
  return emptyRegistry();
}
function saveRegistry(reg) {
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg)); } catch (_) {}
}

// 缩略图：渲染一帧后立即截取（preserveDrawingBuffer=false 时必须同 tick）
function captureThumbJPEG() {
  try {
    viewer.render();
    return renderer.domElement.toDataURL('image/jpeg', 0.7);
  } catch (_) { return null; }
}

function showPage(id) {
  for (const p of [projectsPage, modelPage]) p.classList.remove('active');
  document.getElementById(id).classList.add('active');
}

function renderProjectList() {
  const reg = loadRegistry();
  const list = document.getElementById('projectList');
  const empty = document.getElementById('emptyProjects');
  list.innerHTML = '';
  empty.style.display = reg.projects.length ? 'none' : 'block';
  for (const item of reg.projects) {
    const card = document.createElement('div');
    card.className = 'projCard';
    const info = document.createElement('div');
    info.className = 'projInfo';
    const name = document.createElement('div');
    name.className = 'projName';
    name.textContent = item.name;
    const sub = document.createElement('div');
    sub.className = 'projSub';
    sub.textContent = (item.hasModel ? '已导入模型' : '未导入模型') + ' · ' + (item.updatedAt || '').slice(0, 16).replace('T', ' ');
    info.appendChild(name); info.appendChild(sub);
    card.appendChild(info);
    // 缩略图（异步）
    const thumbHolder = document.createElement('div');
    thumbHolder.className = 'projThumbEmpty';
    thumbHolder.textContent = '🔮';
    card.insertBefore(thumbHolder, info);
    if (item.hasModel) {
      const p = pathsFor(item.name);
      store.read(p.thumb).then((u8) => {
        const url = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' }));
        const img = document.createElement('img');
        img.className = 'projThumb';
        img.src = url;
        thumbHolder.replaceWith(img);
      }).catch(() => {});
    }
    card.addEventListener('click', () => openProject(item.name));
    // 删除按钮
    const del = document.createElement('button');
    del.className = 'projDelete';
    del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除项目「' + item.name + '」？模型数据将一并删除。')) return;
      const p = pathsFor(item.name);
      await store.remove(p.dir).catch(() => {});
      saveRegistry(removeProject(loadRegistry(), item.name));
      renderProjectList();
    });
    card.appendChild(del);
    list.appendChild(card);
  }
}

// 新建项目
const newProjDialog = document.getElementById('newProjDialog');
const newProjName = document.getElementById('newProjName');
document.getElementById('newProjBtn').addEventListener('click', () => {
  newProjName.value = '';
  newProjDialog.classList.add('open');
  setTimeout(() => newProjName.focus(), 50);
});
document.getElementById('newProjCancel').addEventListener('click', () => newProjDialog.classList.remove('open'));
document.getElementById('newProjConfirm').addEventListener('click', createProject);
newProjName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(); });

async function createProject() {
  const v = validateProjectName(newProjName.value);
  if (!v.ok) { newProjName.placeholder = v.reason; return; }
  const reg = loadRegistry();
  if (reg.projects.some((p) => p.name === v.name)) {
    newProjName.value = '';
    newProjName.placeholder = '项目「' + v.name + '」已存在';
    return;
  }
  newProjDialog.classList.remove('open');
  // 注册 + 空项目状态
  saveRegistry(upsertProject(loadRegistry(), {
    name: v.name, updatedAt: new Date().toISOString(), hasModel: false,
  }));
  await enterEmptyProject(v.name);
}

async function enterEmptyProject(name) {
  currentProjectName = name;
  lastSavedSnapshot = null;
  // 清空场景
  try { if (viewer) { await viewer.dispose(); } } catch (_) {}
  viewer = createViewer();
  currentModelName = null;
  lastModelBytes = null;
  lastModelExt = null;
  pendingMeshXform = null;
  pendingCamera = null;
  hint.style.display = 'flex';
  infoChip.textContent = '项目「' + name + '」— 请导入模型';
  showPage('modelPage');
}

// 打开项目
async function openProject(name) {
  try {
    const p = pathsFor(name);
    const projBytes = await store.read(p.proj);
    const proj = parseProjectFile(projBytes);
    const meta = await store.read(p.meta).then((u8) => parseMeta(new TextDecoder().decode(u8))).catch(() => null);
    currentProjectName = name;
    applyProject(proj.state);
    lastSavedSnapshot = proj.state;
    if (proj.modelBytes) {
      await loadModelBytes(proj.modelBytes, proj.state.model.fileName || ('model.' + proj.modelExt), proj.modelExt);
    } else {
      // 纯状态工程（未导入过模型）
      try { if (viewer) { await viewer.dispose(); } } catch (_) {}
      viewer = createViewer();
      currentModelName = null; lastModelBytes = null; lastModelExt = null;
      hint.style.display = 'flex';
      infoChip.textContent = '项目「' + name + '」— 请导入模型';
    }
    if (meta) infoChip.textContent = meta.name + ' 已打开';
    showPage('modelPage');
  } catch (err) {
    console.error(err);
    alert('打开项目失败: ' + (err && err.message ? err.message : '未知错误'));
  }
}

// 保存当前项目（写入 App 私有目录，不走系统分享 → 闪退根除）
document.getElementById('saveProjBtn').addEventListener('click', async () => {
  if (!currentProjectName) { infoChip.textContent = '未在项目中'; return; }
  infoChip.textContent = '正在保存…';
  try {
    const p = pathsFor(currentProjectName);
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
        azim: orbit.azim, elev: orbit.elev, dist: orbit.dist, focal: orbit.focal.toArray(),
      },
      settings: {
        sens: orbitSensitivity, grid: gridToggle.checked,
        axes: axesToggle.checked,
      },
    }, lastModelBytes, lastModelExt);
    await store.write(p.proj, projBytes);
    // 缩略图 + meta（有模型才更新缩略图）
    if (lastModelBytes) {
      const thumb = captureThumbJPEG();
      if (thumb) {
        const thumbBytes = new Uint8Array(await (await fetch(thumb)).arrayBuffer());
        await store.write(p.thumb, thumbBytes);
      }
    }
    const meta = { name: currentProjectName, updatedAt: new Date().toISOString(), hasModel: !!lastModelBytes };
    await store.write(p.meta, new TextEncoder().encode(JSON.stringify(meta)));
    saveRegistry(upsertProject(loadRegistry(), meta));
    lastSavedSnapshot = collectProject();
    infoChip.textContent = '已保存「' + currentProjectName + '」(' + fmtBytes(projBytes.length) + ')';
  } catch (err) {
    console.error(err);
    infoChip.textContent = '保存失败: ' + (err && err.message ? err.message : '未知错误');
  }
});

// 返回列表（脏检查 → 退出确认）
const exitDialog = document.getElementById('exitDialog');
document.getElementById('backBtn').addEventListener('click', () => {
  const current = collectProject();
  current.hasModel = !!lastModelBytes;
  if (isDirty(current, lastSavedSnapshot)) {
    exitDialog.classList.add('open');
  } else {
    showProjectsPage();
  }
});
document.getElementById('exitSave').addEventListener('click', async () => {
  exitDialog.classList.remove('open');
  document.getElementById('saveProjBtn').click();
  showProjectsPage();
});
document.getElementById('exitDiscard').addEventListener('click', () => {
  exitDialog.classList.remove('open');
  showProjectsPage();
});
document.getElementById('exitCancel').addEventListener('click', () => {
  exitDialog.classList.remove('open');
});

function showProjectsPage() {
  renderProjectList();
  showPage('projectsPage');
}

// 启动进入项目列表
renderProjectList();
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

importBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) openFile(f);
  fileInput.value = '';
});

// ---- 诊断导航器：按钮直接驱动相机状态 ----
// 目的：区分「手势层问题」与「内核渲染问题」——按钮生效=手势问题；按钮也无效=渲染问题
const navPad = document.getElementById('navPad');
if (navPad) {
  const navActions = {
    zin: () => zoomBy(0.82),            // 拉近
    zout: () => zoomBy(1.22),           // 拉远
    up: () => panBy(0, -40),            // 视口上移
    down: () => panBy(0, 40),
    left: () => panBy(-40, 0),
    right: () => panBy(40, 0),
    rotL: () => orbitBy(-30, 0),        // 绕焦点旋转
    rotR: () => orbitBy(30, 0),
  };
  let navTimer = null;
  navPad.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-nav]');
    if (!btn) return;
    e.stopPropagation();
    const act = navActions[btn.dataset.nav];
    if (!act) return;
    act();
    navTimer = setInterval(act, 160);   // 长按连发
  });
  const stopNav = () => { if (navTimer) { clearInterval(navTimer); navTimer = null; } };
  navPad.addEventListener('pointerup', stopNav);
  navPad.addEventListener('pointercancel', stopNav);
  navPad.addEventListener('pointerleave', stopNav);
}

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
  // 项目列表页在前台时跳过渲染
  if (!modelPage.classList.contains('active')) return;
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
window.__sv = {
  get viewer() { return viewer; }, renderer, camera, orbit, helpersScene, collectProject,
  applyCamera, zoomBy, panBy, orbitBy,
  get currentProjectName() { return currentProjectName; },
  get lastSavedSnapshot() { return lastSavedSnapshot; },
};

// 阶段0 spike：?spikeglb 时加载 GLB 同场景验证模块（独立 chunk，不进主包）
if (new URLSearchParams(location.search).has('spikeglb')) {
  import('./spike-glb.js').then((m) => { window.__spikeGLBReady = !!m.init(window.__sv); })
    .catch((e) => { window.__spikeGLBErr = String(e); });
}
