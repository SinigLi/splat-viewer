// CDP 端到端测试：导航 → 注入 ply → 读 HUD/相机 → 截图
import { writeFileSync } from 'node:fs';

const CDP_PORT = process.env.CDP_PORT || '9226';
const PAGE_URL = 'http://localhost:4173/';
const PLY = 'E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply';
const SHOT = 'F:/openclawhome/openclaw/fullstack_workspace/media/splat-test-render2.png';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });

let msgId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || '').slice(0, 300));
  }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => m.error ? resolve({ __err: m.error }) : resolve(m.result ?? {}));
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// 等页面加载完成
let ready = '';
for (let i = 0; i < 30; i++) {
  const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  ready = r.result?.value ?? '';
  if (ready === 'complete') break;
  await sleep(500);
}

// 注入文件
const doc = await send('DOM.getDocument', { depth: 1 });
const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
if (!q.nodeId) { console.log(JSON.stringify({ fatal: '#fileInput not found', errors })); process.exit(1); }
await send('DOM.setFileInputFiles', { files: [PLY], nodeId: q.nodeId });
await sleep(12000);

// 读 HUD + 相机诊断
const hud = await send('Runtime.evaluate', { expression: `document.getElementById('hud').innerText`, returnByValue: true });
const diag = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `JSON.stringify((()=>{const v=window.__sv&&window.__sv.viewer;if(!v)return{err:'no viewer'};const c=v.camera;const m=v.splatMesh;let sc=null;try{const t=new (c.position.constructor)();const acc=new (c.position.constructor)();const n=m?m.getSplatCount():0;const step=Math.max(1,Math.floor(n/2000));let cnt=0;for(let i=0;i<n;i+=step){m.getSplatCenter(i,t);acc.add(t);cnt++;}const center=acc.multiplyScalar(1/Math.max(cnt,1));let radius=0;for(let i=0;i<n;i+=step){m.getSplatCenter(i,t);const d=t.distanceTo(center);if(d>radius)radius=d;}return {cam:c.position.toArray().map(x=>+x.toFixed(1)),near:+c.near.toFixed(3),far:+c.far.toFixed(1),count:n,center:center.toArray().map(x=>+x.toFixed(1)),radius:+radius.toFixed(2)}})())`,
});
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.data) writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

console.log(JSON.stringify({ hud: hud.result?.value, diag: JSON.parse(diag.result?.value || '{}'), errors: errors.slice(0, 5), shot: !!shot.data }, null, 1));
ws.close();
process.exit(0);
