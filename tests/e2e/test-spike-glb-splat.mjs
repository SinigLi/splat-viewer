// test-spike-glb-splat.mjs - 阶段0 spike：PLY泼溅 + 骨骼GLB 同场景渲染 + 动画播放
// 页面带 ?spikeglb 参数时 main.js 动态加载 src/spike-glb.js（打包内模块，window.__SpikeGLB）
import { writeFileSync, readFileSync } from 'node:fs';
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2); }, 120000);

const mkTab = async (tag) => {
  console.error('[step] mkTab ' + tag);
  const { execFileSync } = await import('node:child_process');
  const raw = execFileSync('curl.exe', ['-s', '--max-time', '15', '-X', 'PUT',
    `http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/?spikeglb')}`], { encoding: 'utf8' });
  const tab = JSON.parse(raw);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws open timeout')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error('ws error')); };
  });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr, awaitPromise = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }); return r.result?.result?.value; };
  const evT = (expr, ms = 15000, awaitPromise = false) => Promise.race([ev(expr, awaitPromise), new Promise((r) => setTimeout(() => r('<<TIMEOUT>>'), ms))]);
  for (let i = 0; i < 20; i++) { if (await evT('document.readyState') === 'complete') break; await sleep(500); }
  return { ws, send, ev, evT };
};
const setFiles = async (send, selector, files) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
};

const out = {};
const GLB = 'F:\\openclawhome\\openclaw\\game_artist_workspace\\tools\\3D-models\\blender-addon\\pose-library\\Cats\\SomaliCat.glb';
const PLY = 'E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply';

const s1 = await mkTab('spike');
out.moduleLoaded = await s1.ev(`!!window.__sv`);

// spike 模块随页面动态加载
for (let i = 0; i < 20; i++) { if (await s1.evT(`window.__spikeGLBReady === true || !!window.__spikeGLBErr`) === true) break; await sleep(500); }
out.loaderReady = await s1.ev(`window.__spikeGLBReady === true`);
out.loaderErr = await s1.ev(`window.__spikeGLBErr || null`);

// 1) 导入泼溅模型
await setFiles(s1.send, '#fileInput', [PLY]);
await sleep(12000);
out.splatLoaded = await s1.ev(`!!(window.__sv.viewer && window.__sv.viewer.splatMesh)`);
out.splatCount = await s1.ev(`window.__sv.viewer.splatMesh ? window.__sv.viewer.splatMesh.getSplatCount() : 0`);

// 2) GLB base64 分块传入 → SpikeGLB.loadGLB（加入 helpersScene + Mixer 播放）
const glbB64 = readFileSync(GLB).toString('base64');
const CHUNK = 512 * 1024;
let sent = 0, idx = 0;
await s1.ev(`window.__glbChunks = []`);
while (sent < glbB64.length) {
  const part = glbB64.slice(sent, sent + CHUNK);
  await s1.ev(`window.__glbChunks.push(${JSON.stringify(part)})`);
  sent += CHUNK; idx++;
}
out.glbChunks = idx;
const glbParse = await s1.evT(`(async () => {
  try {
    const b64 = window.__glbChunks.join('');
    const names = await window.__SpikeGLB.loadGLB(b64);
    window.__spikeActions = names;
    return 'OK ' + names.length + ' anims';
  } catch (e) { return 'ERR ' + String(e); }
})()`, 30000, true);
out.glbParse = glbParse;
out.animNames = await s1.ev(`window.__spikeActions ? window.__spikeActions.slice(0, 10) : null`);

// 3) 相机对准原点看猫（猫在原点附近），开 grid 触发 helpersScene 叠加渲染
await s1.ev(`document.getElementById('gridToggle').checked = true;
  document.getElementById('gridToggle').dispatchEvent(new Event('change'));`);
await s1.ev(`(function(){ const w = window.__sv; const o = w.orbit;
  o.azim = 0.5; o.elev = 0.15; o.dist = 2.5; o.focal.set(0, 0.3, 0);
  const ce = Math.cos(o.elev), se = Math.sin(o.elev);
  w.camera.position.set(o.focal.x + o.dist*ce*Math.sin(o.azim), o.focal.y + o.dist*se, o.focal.z + o.dist*ce*Math.cos(o.azim));
  w.camera.lookAt(o.focal); })()`);
await sleep(500);

// 4) 渲染一帧（泼溅 + helpersScene/GLB 叠加）并截图
const shotData = await s1.evT(`(function(){
  if (window.__SpikeGLB.mixer) window.__SpikeGLB.mixer.update(0.016);
  const v = window.__sv.viewer; v.update(); v.render();
  const r = window.__sv.renderer; r.autoClear = false;
  try { r.render(window.__sv.helpersScene, window.__sv.camera); } catch (e) {}
  r.autoClear = true;
  return r.domElement.toDataURL('image/jpeg', 0.6);
})()`, 15000);
if (typeof shotData === 'string' && shotData.startsWith('data:image')) {
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/spike-glb-splat.jpg', Buffer.from(shotData.split(',')[1], 'base64'));
  out.shot = true;
  out.frameJpegLen = shotData.length;
}
// 像素多样性（纯背景 = 少量颜色；有猫和泼溅 = 颜色丰富）
const pixelCheck = await s1.evT(`(async () => {
  try {
    const r = window.__sv.renderer;
    const url = r.domElement.toDataURL('image/png');
    const img = new Image(); await new Promise(res => { img.onload = res; img.src = url; });
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) colors.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return 'colors=' + colors.size;
  } catch (e) { return 'ERR ' + String(e); }
})()`, 15000);
out.pixelCheck = pixelCheck;
out.loopErr = await s1.ev(`window.__svLoopError || null`);
console.log(JSON.stringify(out, null, 1));
s1.ws.close(); process.exit(0);
