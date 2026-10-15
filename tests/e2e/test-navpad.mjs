// test-navpad.mjs - 验证诊断导航器：按钮点击驱动相机状态变化
import { writeFileSync } from 'node:fs';
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2); }, 90000);

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
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
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
const s1 = await mkTab('navpad');

// 新建项目进入模型页并导入模型
await s1.ev(`document.getElementById('newProjBtn').click()`);
await s1.ev(`document.getElementById('newProjName').value='navtest'`);
await s1.ev(`document.getElementById('newProjConfirm').click()`);
await sleep(600);
await setFiles(s1.send, '#fileInput', [PLY]);
await sleep(11000);
out.modelLoaded = await s1.ev(`!!(window.__sv.viewer && window.__sv.viewer.splatMesh)`);
out.navPadVisible = await s1.ev(`(function(){ const n = document.getElementById('navPad'); return n && getComputedStyle(n).display !== 'none'; })()`);

const readOrbit = () => s1.ev(`JSON.stringify({d:+window.__sv.orbit.dist.toFixed(3),a:+window.__sv.orbit.azim.toFixed(4),f:[window.__sv.orbit.focal.x.toFixed(2),window.__sv.orbit.focal.y.toFixed(2)]})`);
const before = JSON.parse(await readOrbit());

// 点击 ➕（拉近）
await s1.ev(`document.querySelector('#navPad [data-nav=zin]').click()`);
await sleep(300);
const afterZin = JSON.parse(await readOrbit());
out.zoomIn = { distBefore: before.d, distAfter: afterZin.d, changed: afterZin.d < before.d };

// 点击 ↻（旋转）
await s1.ev(`document.querySelector('#navPad [data-nav=rotR]').click()`);
await sleep(300);
const afterRot = JSON.parse(await readOrbit());
out.rotate = { azimBefore: afterZin.a, azimAfter: afterRot.a, changed: afterRot.a !== afterZin.a };

// 点击 ➡️（平移）
await s1.ev(`document.querySelector('#navPad [data-nav=right]').click()`);
await sleep(300);
const afterPan = JSON.parse(await readOrbit());
out.pan = { focalBefore: afterRot.f, focalAfter: afterPan.f, changed: afterPan.f[0] !== afterRot.f[0] };

// 长按连发（hold 800ms 应触发多次）
await s1.ev(`(function(){ const b = document.querySelector('#navPad [data-nav=zout]');
  b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); })()`);
await sleep(800);
await s1.ev(`document.getElementById('navPad').dispatchEvent(new PointerEvent('pointerup', {bubbles:true}))`);
await sleep(200);
const afterHold = JSON.parse(await readOrbit());
out.holdRepeat = { distAfter: afterHold.d, grew: afterHold.d > afterPan.d };

out.loopErr = await s1.ev(`window.__svLoopError || null`);
console.log(JSON.stringify(out, null, 1));
s1.ws.close(); process.exit(0);
