// tests/project-zip.test.js - v2 zip 工程（自包含模型）单元测试
import { describe, it, expect } from 'vitest';
import {
  buildProjectZip, parseProjectFile, collectProject, parseProject,
  STATE_ENTRY,
} from '../src/project-state.js';
import { zipSync, strToU8 } from 'fflate';

const state = {
  modelName: 'final.ply',
  mesh: { position: [1.279, 0, 0], scale: 1.15, rotationZ: Math.PI },
  camera: { azim: 1.234, elev: -0.5, dist: 12, focal: [2.59, -0.26, 1.16] },
  settings: { sens: 0.5, grid: true, axes: false, xform: false },
};
const modelBytes = new Uint8Array([0x70, 0x6c, 0x79, 0x0a, 1, 2, 3, 255]); // 假 PLY

describe('buildProjectZip', () => {
  it('生成 PK 魔数 zip', () => {
    const z = buildProjectZip(state, modelBytes, 'ply');
    expect(z[0]).toBe(0x50);
    expect(z[1]).toBe(0x4b);
  });

  it('拒绝空字节数组模型数据', () => {
    expect(() => buildProjectZip(state, new Uint8Array(0), 'ply')).toThrow('模型数据为空');
  });

  it('modelBytes=null 允许：生成纯状态工程（未导入模型）', () => {
    const noModel = { ...state, modelName: null, mesh: null };
    const z = buildProjectZip(noModel, null, null);
    expect(z[0]).toBe(0x50);
    const out = parseProjectFile(z);
    expect(out.kind).toBe('v2');
    expect(out.modelBytes).toBeNull();
    expect(out.state.model.fileName).toBeNull();
  });

  it('拒绝不支持的模型格式', () => {
    expect(() => buildProjectZip(state, modelBytes, 'exe')).toThrow('不支持');
  });
});

describe('parseProjectFile', () => {
  it('v2 zip 往返：状态 + 模型字节完整还原', () => {
    const z = buildProjectZip(state, modelBytes, 'ply');
    const out = parseProjectFile(z);
    expect(out.kind).toBe('v2');
    expect(out.state.model.fileName).toBe('final.ply');
    expect(out.state.camera.azim).toBeCloseTo(1.234);
    expect(out.modelExt).toBe('ply');
    expect(Array.from(out.modelBytes)).toEqual(Array.from(modelBytes));
  });

  it('v1 纯 json 向后兼容', () => {
    const v1text = JSON.stringify(collectProject(state));
    const out = parseProjectFile(new TextEncoder().encode(v1text));
    expect(out.kind).toBe('v1');
    expect(out.state.model.fileName).toBe('final.ply');
    expect(out.modelBytes).toBeUndefined();
  });

  it('拒绝缺 state.json 的 zip', () => {
    const bad = zipSync({ 'other.txt': strToU8('x') });
    expect(() => parseProjectFile(bad)).toThrow('state.json');
  });

  it('拒绝缺模型数据的 zip（无 state 时报缺模型）', () => {
    const bad = zipSync({ [STATE_ENTRY]: strToU8(JSON.stringify(collectProject(state))) });
    // 含合法 state 但无模型条目 → 纯状态工程，modelBytes=null（v2 新语义）
    const out = parseProjectFile(bad);
    expect(out.kind).toBe('v2');
    expect(out.modelBytes).toBeNull();
  });

  it('拒绝损坏的 zip', () => {
    const z = buildProjectZip(state, modelBytes, 'ply');
    const broken = z.slice(0, Math.floor(z.length / 2));
    expect(() => parseProjectFile(broken)).toThrow(/损坏|缺少/);
  });

  it('拒绝无效 state 内容（app 不匹配）', () => {
    const bad = zipSync({
      [STATE_ENTRY]: strToU8(JSON.stringify({ ...collectProject(state), app: 'other' })),
      'model.ply': modelBytes,
    });
    expect(() => parseProjectFile(bad)).toThrow('不是有效');
  });
});
