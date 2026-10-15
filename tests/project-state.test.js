// tests/project-state.test.js - .svproj 工程状态纯逻辑单元测试
import { describe, it, expect } from 'vitest';
import {
  collectProject, parseProject, extractSettings, extractMeshTransform,
  extractCamera, serializeSettings, parseSettings,
  PROJECT_APP_ID, PROJECT_VERSION, SETTINGS_KEY,
} from '../src/project-state.js';

const validProject = {
  version: 1,
  app: 'splat-viewer',
  savedAt: '2026-10-15T12:00:00.000Z',
  model: { fileName: 'final.ply' },
  mesh: { position: [1.279, 0, 0], scale: 1.15, rotationZ: Math.PI },
  camera: { azim: 1.234, elev: -0.5, dist: 12, focal: [1, 2, 3] },
  settings: { sens: 0.5, grid: true, axes: false, xform: false },
};

describe('collectProject', () => {
  it('生成带正确 app 标识与版本的快照', () => {
    const p = collectProject({
      modelName: 'a.ply',
      mesh: { position: [0, 0, 0], scale: 1, rotationZ: 0 },
      camera: { azim: 0, elev: 0, dist: 8, focal: [0, 0, 0] },
      settings: { sens: 0.3, grid: false, axes: false, xform: false },
    });
    expect(p.app).toBe(PROJECT_APP_ID);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.model.fileName).toBe('a.ply');
    expect(p.savedAt).toBeTruthy();
  });

  it('mesh 为 null 时保留 null（未加载模型也可存设置）', () => {
    const p = collectProject({
      modelName: null,
      mesh: null,
      camera: { azim: 0, elev: 0, dist: 8, focal: [0, 0, 0] },
      settings: { sens: 0.3, grid: false, axes: false, xform: false },
    });
    expect(p.mesh).toBeNull();
    expect(p.model.fileName).toBeNull();
  });

  it('settings 是拷贝而非引用（后续修改不影响快照）', () => {
    const settings = { sens: 0.3, grid: false, axes: false, xform: false };
    const p = collectProject({
      modelName: null, mesh: null,
      camera: { azim: 0, elev: 0, dist: 8, focal: [0, 0, 0] },
      settings,
    });
    settings.sens = 9.9;
    expect(p.settings.sens).toBe(0.3);
  });
});

describe('parseProject', () => {
  it('接受合法 JSON 文本', () => {
    const p = parseProject(JSON.stringify(validProject));
    expect(p.model.fileName).toBe('final.ply');
  });

  it('接受已解析的对象', () => {
    expect(parseProject(validProject).app).toBe('splat-viewer');
  });

  it('拒绝非法 JSON 文本', () => {
    expect(() => parseProject('{broken')).toThrow('JSON');
  });

  it('拒绝非对象（null/数字/字符串）', () => {
    expect(() => parseProject('null')).toThrow();
    expect(() => parseProject('42')).toThrow();
    expect(() => parseProject('"str"')).toThrow();
  });

  it('拒绝 app 不匹配的文件', () => {
    expect(() => parseProject(JSON.stringify({ ...validProject, app: 'other' }))).toThrow('不是有效');
  });

  it('拒绝未知版本', () => {
    expect(() => parseProject(JSON.stringify({ ...validProject, version: 99 }))).toThrow('版本');
  });
});

describe('extractSettings', () => {
  it('提取全部合法设置', () => {
    const s = extractSettings(validProject);
    expect(s).toEqual({ sens: 0.5, grid: true, axes: false, xform: false });
  });

  it('丢弃越界/类型错误的字段', () => {
    const s = extractSettings({ settings: { sens: 999, grid: 'yes', axes: 1 } });
    expect(s).toEqual({});
  });

  it('settings 缺失时返回空对象', () => {
    expect(extractSettings({})).toEqual({});
  });
});

describe('extractMeshTransform', () => {
  it('提取合法变换', () => {
    const m = extractMeshTransform(validProject);
    expect(m.position).toEqual([1.279, 0, 0]);
    expect(m.scale).toBe(1.15);
    expect(m.rotationZ).toBeCloseTo(Math.PI);
  });

  it('mesh 为 null 返回 null', () => {
    expect(extractMeshTransform({ mesh: null })).toBeNull();
    expect(extractMeshTransform({})).toBeNull();
  });

  it('拒绝 position 长度错误', () => {
    expect(extractMeshTransform({ mesh: { position: [1, 2], scale: 1, rotationZ: 0 } })).toBeNull();
  });

  it('拒绝非法 scale（负数/非数字/NaN）', () => {
    expect(extractMeshTransform({ mesh: { position: [0, 0, 0], scale: -1, rotationZ: 0 } })).toBeNull();
    expect(extractMeshTransform({ mesh: { position: [0, 0, 0], scale: 'big', rotationZ: 0 } })).toBeNull();
    expect(extractMeshTransform({ mesh: { position: [0, 0, 0], scale: NaN, rotationZ: 0 } })).toBeNull();
  });

  it('拒绝 NaN position / rotationZ', () => {
    expect(extractMeshTransform({ mesh: { position: [NaN, 0, 0], scale: 1, rotationZ: 0 } })).toBeNull();
    expect(extractMeshTransform({ mesh: { position: [0, 0, 0], scale: 1, rotationZ: NaN } })).toBeNull();
  });

  it('返回的 position 是拷贝', () => {
    const m = extractMeshTransform(validProject);
    m.position[0] = 999;
    expect(validProject.mesh.position[0]).toBe(1.279);
  });
});

describe('extractCamera', () => {
  it('提取合法相机状态', () => {
    const c = extractCamera(validProject);
    expect(c).toEqual({ azim: 1.234, elev: -0.5, dist: 12, focal: [1, 2, 3] });
  });

  it('camera 缺失返回 null', () => {
    expect(extractCamera({})).toBeNull();
  });

  it('拒绝 dist <= 0 与 NaN 字段', () => {
    expect(extractCamera({ camera: { azim: 0, elev: 0, dist: 0, focal: [0, 0, 0] } })).toBeNull();
    expect(extractCamera({ camera: { azim: NaN, elev: 0, dist: 5, focal: [0, 0, 0] } })).toBeNull();
  });

  it('拒绝 focal 长度错误', () => {
    expect(extractCamera({ camera: { azim: 0, elev: 0, dist: 5, focal: [1, 2] } })).toBeNull();
  });
});

describe('settings persistence (localStorage 载荷)', () => {
  it('serialize → parse 往返一致', () => {
    const s = { sens: 0.45, grid: true, axes: false };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  it('parseSettings 拒绝坏数据', () => {
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings('')).toBeNull();
    expect(parseSettings('not json')).toBeNull();
    expect(parseSettings('{"sens":"fast"}')).toBeNull();  // 类型错
    expect(parseSettings('{"sens": 500}')).toBeNull();    // 越界
    expect(parseSettings('[]')).toBeNull();               // 非对象
  });

  it('SETTINGS_KEY 稳定（旧版本存的数据要能读回来）', () => {
    expect(SETTINGS_KEY).toBe('sv-settings');
  });
});

describe('save → open 往返（集成路径）', () => {
  it('collect → JSON.stringify → parse → extract 全链路还原', () => {
    const snap = collectProject({
      modelName: 'model.ply',
      mesh: { position: [0.5, -1, 2], scale: 2.5, rotationZ: Math.PI },
      camera: { azim: -1.1, elev: 0.33, dist: 20, focal: [-2.6, 0.26, 1.16] },
      settings: { sens: 0.75, grid: true, axes: true, xform: true },
    });
    const text = JSON.stringify(snap);           // 模拟写文件
    const parsed = parseProject(text);            // 模拟读文件
    expect(extractSettings(parsed)).toEqual({ sens: 0.75, grid: true, axes: true, xform: true });
    expect(extractMeshTransform(parsed).scale).toBe(2.5);
    expect(extractCamera(parsed).focal).toEqual([-2.6, 0.26, 1.16]);
    expect(parsed.model.fileName).toBe('model.ply');
  });
});
