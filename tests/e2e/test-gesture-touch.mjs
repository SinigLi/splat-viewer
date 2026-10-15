// test-gesture-touch.mjs - 真触摸事件级 E2E：Input.dispatchTouchEvent 模拟真双指捏合/拖动
// 之前 CDP 鼠标模拟盖不住触摸合成路径，此测试验证 touch-action 修复后的真实事件链
import { writeFileSync } from 'node:fs';
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
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
  return { ws, send, ev };
};
const setFiles = async (send, selector, files) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
};

const out = {};
const PLY = 'E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply';
const s1 = await mkTab('touch');

// 新建项目 + 导入模型
await s1.ev(`document.getElementById('newProjBtn').click()`);
await s1.ev(`document.getElementById('newProjName').value='touchtest'`);
await s1.ev(`document.getElementById('newProjConfirm').click()`);
await sleep(600);
await setFiles(s1.send, '#fileInput', [PLY]);
await sleep(11000);
out.modelLoaded = await s1.ev(`!!(window.__sv.viewer && window.__sv.viewer.splatMesh)`);

// 关键前置：canvas touch-action 检查
out.touchAction = await s1.ev(`getComputedStyle(renderer0()).touchAction`);
function renderer0() { return 'window.__sv.renderer.domElement'; }
// 上面字符串拼接不便，直接再取一次
out.touchAction = await s1.ev(`getComputedStyle(window.__sv.renderer.domElement).touchAction`);

const readOrbit = () => s1.ev(`JSON.stringify({d:+window.__sv.orbit.dist.toFixed(3),az:+window.__sv.orbit.azim.toFixed(4),fx:+window.__sv.orbit.focal.x.toFixed(3)})`);
const readModel = () => s1.ev(`JSON.stringify({p:[window.__sv.viewer.splatMesh.position.x.toFixed(3),window.__sv.viewer.splatMesh.position.y.toFixed(3)],s:+window.__sv.viewer.splatMesh.scale.x.toFixed(4)})`);
const before = { orbit: JSON.parse(await readOrbit()), model: JSON.parse(await readModel()) };

// ---- 真双指捏合缩放（touch 事件序列：两指 down → 多步 move 靠拢 → up）----
const pinchSteps = [];
for (let i = 0; i <= 8; i++) {
  const spread = 200 - i * 18; // 200px → 56px 靠拢
  pinchSteps.push([
    { type: 'touchChanged', x: 210 - spread / 2, y: 400 },
    { type: 'touchChanged', x: 210 + spread / 2, y: 400 },
  ]);
}
await s1.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinchSteps[0] });
for (let i = 1; i < pinchSteps.length; i++) {
  await s1.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinchSteps[i] });
  await sleep(30);
}
await s1.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const afterPinch = { orbit: JSON.parse(await readOrbit()), model: JSON.parse(await readModel()) };
out.pinch = {
  distBefore: before.orbit.d, distAfter: afterPinch.orbit.d,
  distChanged: afterPinch.orbit.d !== before.orbit.d,
  modelScaleUnchanged: afterPinch.model.s === before.model.s,
  focalUnchangedX: afterPinch.orbit.fx === before.orbit.fx,
};

// ---- 真双指拖动（两指同向平移 60px）----
const beforePan = JSON.parse(await readOrbit());
const panSteps = [];
for (let i = 0; i <= 6; i++) {
  panSteps.push([
    { type: 'touchChanged', x: 150 + i * 10, y: 400 + i * 6 },
    { type: 'touchChanged', x: 270 + i * 10, y: 400 + i * 6 },
  ]);
}
await s1.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: panSteps[0] });
for (let i = 1; i < panSteps.length; i++) {
  await s1.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: panSteps[i] });
  await sleep(30);
}
await s1.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const afterPan = JSON.parse(await readOrbit());
out.pan = { fxBefore: beforePan.fx, fxAfter: afterPan.fx, changed: afterPan.fx !== beforePan.fx };

// ---- 真单指旋转 ----
const beforeRot = JSON.parse(await readOrbit());
const rotSteps = [];
for (let i = 0; i <= 6; i++) rotSteps.push([{ type: 'touchChanged', x: 150 + i * 15, y: 400 }]);
await s1.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: rotSteps[0] });
for (let i = 1; i < rotSteps.length; i++) {
  await s1.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: rotSteps[i] });
  await sleep(30);
}
await s1.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const afterRot = JSON.parse(await readOrbit());
out.rotate = { azBefore: beforeRot.az, azAfter: afterRot.az, changed: afterRot.az !== beforeRot.az };

// 手势日志尾部（页面侧记录的事件链）
out.gestureLogTail = await s1.ev(`window.__svGlog ? window.__svGlog().slice(-12) : null`);
out.loopErr = await s1.ev(`window.__svLoopError || null`);
console.log(JSON.stringify(out, null, 1));
s1.ws.close(); process.exit(0);
