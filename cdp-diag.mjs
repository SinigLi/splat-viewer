// CDP 深度诊断：update() 是否抛异常、场景图结构、相机状态、手动渲染
import { writeFileSync } from 'node:fs';
const CDP_PORT = '9226';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 160); return r.result?.result?.value; };

for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
const doc = await send('DOM.getDocument', { depth: 1 });
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
await send('DOM.setFileInputFiles', { files: ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply'], nodeId: q.result.nodeId });
await sleep(12000);

const out = {};
out.hud = await ev(`document.getElementById('hud').innerText`);
out.hook = await ev('!!window.__sv');
out.cam = await ev(`(()=>{try{const c=window.__sv.viewer.camera;return c.position.toArray().map(x=>+x.toFixed(2))}catch(e){return 'ERR:'+e.message}})()`);
out.updateTest = await ev(`(()=>{try{window.__sv.viewer.update();return 'update OK'}catch(e){return 'UPDATE THROW: '+e.message}})()`);
out.meshParent = await ev(`(()=>{try{const m=window.__sv.viewer.splatMesh;return {parentType:m.parent?m.parent.type:null, visible:m.visible, count:m.getSplatCount()}}catch(e){return 'ERR:'+e.message}})()`);
out.sceneChildren = await ev(`(()=>{try{const s=window.__sv.viewer.threeScene;return s.children.map(c=>c.type+':'+(c===window.__sv.viewer.splatMesh?'IS_SPLATMESH':c.name||'')).slice(0,6)}catch(e){return 'ERR:'+e.message}})()`);
out.glError = await ev(`(()=>{try{const gl=window.__sv.renderer.getContext();return gl.getError()}catch(e){return 'ERR:'+e.message}})()`);
out.manualRender = await ev(`(()=>{try{const v=window.__sv.viewer;v.renderer.render(v.threeScene,v.camera);return 'manual render OK'}catch(e){return 'RENDER THROW: '+e.message}})()`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-diag.png', Buffer.from(shot.result.data, 'base64'));
out.shot = !!shot.result?.data;
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);
