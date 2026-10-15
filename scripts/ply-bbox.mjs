// 解析 INRIA 格式 PLY，计算 x/y/z 包围盒（按 header 属性顺序定位偏移）
import { openSync, readSync, readFileSync, closeSync } from 'node:fs';
const PLY = 'E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply';
const fd = openSync(PLY, 'r');
const headBuf = Buffer.alloc(65536);
const n = readSync(fd, headBuf, 0, 65536, 0);
const headStr = headBuf.toString('latin1', 0, n);
const endIdx = headStr.indexOf('end_header') + 'end_header'.length;
// 动态跳过 end_header 后的换行符（\r\n 或 \n），不能硬编码 +2
let dataStart = endIdx;
while (dataStart < n && (headBuf[dataStart] === 13 || headBuf[dataStart] === 10)) dataStart++;
const header = headStr.slice(0, endIdx);
const lines = header.split(/\r?\n/);
let vertexCount = 0;
const props = [];
let inVertex = false;
for (const line of lines) {
  if (line.startsWith('element vertex')) vertexCount = parseInt(line.split(' ')[2]);
  if (line.startsWith('property')) props.push(line.trim().split(' ').pop());
  if (line.startsWith('element vertex')) inVertex = true;
  if (line.startsWith('element') && !line.includes('vertex')) inVertex = false;
}
const floatCount = props.length;
const stride = floatCount * 4;
const xi = props.indexOf('x'), yi = props.indexOf('y'), zi = props.indexOf('z');
console.error(`props=${floatCount} stride=${stride} vertices=${vertexCount} xyz at [${xi},${yi},${zi}]`);
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
const buf = Buffer.alloc(stride);
for (let i = 0; i < vertexCount; i++) {
  readSync(fd, buf, 0, stride, dataStart + i * stride);
  const x = buf.readFloatLE(xi * 4), y = buf.readFloatLE(yi * 4), z = buf.readFloatLE(zi * 4);
  const a = [x, y, z];
  for (let k = 0; k < 3; k++) { if (a[k] < mn[k]) mn[k] = a[k]; if (a[k] > mx[k]) mx[k] = a[k]; sum[k] += a[k]; }
}
closeSync(fd);
const avg = sum.map(v => v / vertexCount);
console.log(JSON.stringify({ vertexCount, stride, min: mn.map(v => +v.toFixed(2)), max: mx.map(v => +v.toFixed(2)), avg: avg.map(v => +v.toFixed(2)) }));
