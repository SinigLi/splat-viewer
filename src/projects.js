// projects.js - 项目管理器纯逻辑（路径规划/注册表校验/脏检查，可单元测试）
// 存储：Directory.Data/projects/<encoded>/ 下 project.svproj + thumb.jpg + meta.json

export const PROJECTS_ROOT = 'projects';

/**
 * 目录名编码：项目名可能含中文/空格/特殊字符，用 encodeURIComponent
 */
export function dirNameFor(projectName) {
  return encodeURIComponent(projectName);
}

/**
 * 项目目录内的固定文件布局
 */
export function pathsFor(projectName) {
  const dir = PROJECTS_ROOT + '/' + dirNameFor(projectName);
  return {
    dir,
    proj: dir + '/project.svproj',
    thumb: dir + '/thumb.jpg',
    meta: dir + '/meta.json',
  };
}

/**
 * 项目注册表：轻量索引，避免每次列目录。
 * 序列化到 localStorage，也从项目目录反推（发现孤儿目录时补录）。
 */
export function emptyRegistry() {
  return { projects: [] };
}

/**
 * @param {object} reg 注册表
 * @param {{name: string, updatedAt: string, hasModel: boolean}} entry
 */
export function upsertProject(reg, entry) {
  if (!entry.name || typeof entry.name !== 'string') throw new Error('项目名无效');
  const rest = reg.projects.filter((p) => p.name !== entry.name);
  return {
    projects: [{ name: entry.name, updatedAt: entry.updatedAt, hasModel: !!entry.hasModel }, ...rest],
  };
}

export function removeProject(reg, name) {
  return { projects: reg.projects.filter((p) => p.name !== name) };
}

/**
 * 校验项目名：非空、不含路径分隔符、长度限制
 */
export function validateProjectName(name) {
  const n = (name || '').trim();
  if (!n) return { ok: false, reason: '项目名不能为空' };
  if (n.length > 50) return { ok: false, reason: '项目名过长（最多50字符）' };
  if (/[/\\:*?"<>|]/.test(n)) return { ok: false, reason: '项目名不能包含 / \\ : * ? " < > |' };
  return { ok: true, name: n };
}

/**
 * 脏检查：当前状态与最近一次保存的快照是否有差异。
 * 数值用容差比较（浮点抖动不算改动）。
 */
export function isDirty(current, saved) {
  if (!saved) return !!(current && current.hasModel);
  const TOL = 1e-6;
  const neq = (a, b) => (typeof a === 'number' && typeof b === 'number')
    ? Math.abs(a - b) > TOL
    : a !== b;
  const c = current, s = saved;
  if (neq(c.modelName, s.modelName)) return true;
  // mesh
  const cm = c.mesh, sm = s.mesh;
  if (!cm !== !sm) return true;
  if (cm && sm) {
    if (cm.position.some((v, i) => neq(v, sm.position[i]))) return true;
    if (neq(cm.scale, sm.scale) || neq(cm.rotationZ, sm.rotationZ)) return true;
  }
  // camera
  if (neq(c.camera.azim, s.camera.azim)) return true;
  if (neq(c.camera.elev, s.camera.elev)) return true;
  if (neq(c.camera.dist, s.camera.dist)) return true;
  if (c.camera.focal.some((v, i) => neq(v, s.camera.focal[i]))) return true;
  // settings（xform 已废弃，读旧工程时忽略）
  for (const k of ['sens', 'grid', 'axes']) {
    if (neq(c.settings[k], s.settings[k])) return true;
  }
  return false;
}

/**
 * meta.json 规范化（读回时容错）
 */
export function parseMeta(raw) {
  try {
    const m = JSON.parse(raw);
    if (m && typeof m.name === 'string') return m;
  } catch { /* fallthrough */ }
  return null;
}
