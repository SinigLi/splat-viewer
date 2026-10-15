// tests/projects.test.js - 项目管理器纯逻辑单元测试
import { describe, it, expect } from 'vitest';
import {
  dirNameFor, pathsFor, emptyRegistry, upsertProject, removeProject,
  validateProjectName, isDirty, parseMeta, PROJECTS_ROOT,
} from '../src/projects.js';

describe('路径规划', () => {
  it('英文项目名', () => {
    const p = pathsFor('dino');
    expect(p.dir).toBe(PROJECTS_ROOT + '/dino');
    expect(p.proj).toBe(PROJECTS_ROOT + '/dino/project.svproj');
    expect(p.thumb).toBe(PROJECTS_ROOT + '/dino/thumb.jpg');
    expect(p.meta).toBe(PROJECTS_ROOT + '/dino/meta.json');
  });

  it('中文名编码（目录安全）', () => {
    const d = dirNameFor('恐龙项目');
    expect(d).not.toMatch(/恐/);
    expect(decodeURIComponent(d)).toBe('恐龙项目');
    expect(pathsFor('恐龙项目').dir).toBe(PROJECTS_ROOT + '/' + d);
  });

  it('空格与特殊字符编码', () => {
    expect(dirNameFor('my proj')).toBe('my%20proj');
  });
});

describe('项目名校验', () => {
  it('合法名', () => {
    expect(validateProjectName('dino').ok).toBe(true);
    expect(validateProjectName('  空格两侧  ').name).toBe('空格两侧');
  });

  it('拒绝空名', () => {
    expect(validateProjectName('').ok).toBe(false);
    expect(validateProjectName('   ').ok).toBe(false);
    expect(validateProjectName(null).ok).toBe(false);
  });

  it('拒绝路径分隔符与非法字符', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b']) {
      expect(validateProjectName(bad).ok).toBe(false);
    }
  });

  it('拒绝超长名', () => {
    expect(validateProjectName('x'.repeat(51)).ok).toBe(false);
    expect(validateProjectName('x'.repeat(50)).ok).toBe(true);
  });
});

describe('注册表', () => {
  it('upsert 新增并置顶', () => {
    let reg = emptyRegistry();
    reg = upsertProject(reg, { name: 'a', updatedAt: 't1', hasModel: true });
    reg = upsertProject(reg, { name: 'b', updatedAt: 't2', hasModel: false });
    expect(reg.projects.map((p) => p.name)).toEqual(['b', 'a']);
  });

  it('upsert 更新已存在项并置顶', () => {
    let reg = emptyRegistry();
    reg = upsertProject(reg, { name: 'a', updatedAt: 't1', hasModel: false });
    reg = upsertProject(reg, { name: 'b', updatedAt: 't2', hasModel: false });
    reg = upsertProject(reg, { name: 'a', updatedAt: 't3', hasModel: true });
    expect(reg.projects[0].name).toBe('a');
    expect(reg.projects[0].hasModel).toBe(true);
    expect(reg.projects.length).toBe(2);
  });

  it('remove 删除', () => {
    let reg = emptyRegistry();
    reg = upsertProject(reg, { name: 'a', updatedAt: 't1', hasModel: true });
    reg = upsertProject(reg, { name: 'b', updatedAt: 't2', hasModel: true });
    reg = removeProject(reg, 'a');
    expect(reg.projects.map((p) => p.name)).toEqual(['b']);
  });

  it('hasModel 强制布尔化', () => {
    let reg = emptyRegistry();
    reg = upsertProject(reg, { name: 'a', updatedAt: 't1', hasModel: 'yes' });
    expect(reg.projects[0].hasModel).toBe(true);
  });
});

describe('脏检查 isDirty', () => {
  const saved = {
    modelName: 'final.ply',
    mesh: { position: [1, 0, 0], scale: 1.5, rotationZ: Math.PI },
    camera: { azim: 1, elev: -0.5, dist: 10, focal: [2.59, -0.26, 1.16] },
    settings: { sens: 0.3, grid: false, axes: false, xform: false },
  };
  const clone = () => JSON.parse(JSON.stringify(saved));

  it('完全相同 → 不脏', () => {
    expect(isDirty(clone(), saved)).toBe(false);
  });

  it('浮点抖动（1e-9）→ 不脏', () => {
    const c = clone();
    c.camera.azim = 1 + 1e-9;
    c.camera.dist = 10 + 1e-9;
    expect(isDirty(c, saved)).toBe(false);
  });

  it('相机角度变 → 脏', () => {
    const c = clone();
    c.camera.azim = 1.001;
    expect(isDirty(c, saved)).toBe(true);
  });

  it('模型位移变 → 脏', () => {
    const c = clone();
    c.mesh.position[0] = 2;
    expect(isDirty(c, saved)).toBe(true);
  });

  it('缩放变 → 脏', () => {
    const c = clone();
    c.mesh.scale = 1.6;
    expect(isDirty(c, saved)).toBe(true);
  });

  it('设置变 → 脏', () => {
    const c = clone();
    c.settings.grid = true;
    expect(isDirty(c, saved)).toBe(true);
  });

  it('模型名变 → 脏', () => {
    const c = clone();
    c.modelName = 'other.ply';
    expect(isDirty(c, saved)).toBe(true);
  });

  it('无保存记录 + 有模型 → 脏（需要保存）', () => {
    expect(isDirty({ ...clone(), hasModel: true }, null)).toBe(true);
  });

  it('无保存记录 + 无模型 → 不脏', () => {
    expect(isDirty({ ...clone(), hasModel: false }, null)).toBe(false);
  });
});

describe('meta 解析', () => {
  it('合法 meta', () => {
    expect(parseMeta('{"name":"a","updatedAt":"t"}').name).toBe('a');
  });
  it('坏数据返回 null', () => {
    expect(parseMeta('not json')).toBeNull();
    expect(parseMeta('{"noname":1}')).toBeNull();
    expect(parseMeta(null)).toBeNull();
  });
});
