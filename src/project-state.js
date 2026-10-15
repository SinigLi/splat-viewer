// project-state.js - 工程状态快照的纯逻辑（无 DOM/网络依赖，可单元测试）
// .svproj = { version, app, savedAt, model, mesh, camera, settings }

export const PROJECT_APP_ID = 'splat-viewer';
export const PROJECT_VERSION = 1;
export const SETTINGS_KEY = 'sv-settings'; // 保持与已发布版本一致，改动会丢用户已存设置

/**
 * 从运行时状态收集工程快照
 * @param {{modelName: string|null, mesh: {position: number[], scale: number, rotationZ: number}|null,
 *          camera: {azim: number, elev: number, dist: number, focal: number[]},
 *          settings: {sens: number, grid: boolean, axes: boolean, xform: boolean}}} state
 */
export function collectProject(state) {
  return {
    version: PROJECT_VERSION,
    app: PROJECT_APP_ID,
    savedAt: new Date().toISOString(),
    model: { fileName: state.modelName },
    mesh: state.mesh ? {
      position: state.mesh.position,
      scale: state.mesh.scale,
      rotationZ: state.mesh.rotationZ,
    } : null,
    camera: {
      azim: state.camera.azim,
      elev: state.camera.elev,
      dist: state.camera.dist,
      focal: state.camera.focal,
    },
    settings: { ...state.settings },
  };
}

/**
 * 校验并规范化工程文件内容
 * @returns 规范化后的工程对象
 * @throws {Error} 无效工程文件
 */
export function parseProject(jsonText) {
  let p;
  try {
    p = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  if (!p || typeof p !== 'object') throw new Error('不是有效的工程文件');
  if (p.app !== PROJECT_APP_ID) throw new Error('不是有效的工程文件');
  if (p.version !== PROJECT_VERSION) throw new Error('不支持的工程版本: ' + p.version);
  return p;
}

/**
 * 从工程提取设置部分（打开工程时立即应用）
 */
export function extractSettings(p) {
  const s = p.settings || {};
  const out = {};
  if (typeof s.sens === 'number' && s.sens >= 0.01 && s.sens <= 10) out.sens = s.sens;
  if (typeof s.grid === 'boolean') out.grid = s.grid;
  if (typeof s.axes === 'boolean') out.axes = s.axes;
  if (typeof s.xform === 'boolean') out.xform = s.xform;
  return out;
}

/**
 * 从工程提取待恢复的网格变换（模型加载后应用），返回 null 表示无
 */
export function extractMeshTransform(p) {
  const m = p.mesh;
  if (!m) return null;
  if (!Array.isArray(m.position) || m.position.length !== 3) return null;
  if (m.position.some((v) => typeof v !== 'number' || !isFinite(v))) return null;
  if (typeof m.scale !== 'number' || !isFinite(m.scale) || m.scale <= 0) return null;
  if (typeof m.rotationZ !== 'number' || !isFinite(m.rotationZ)) return null;
  return { position: m.position.slice(), scale: m.scale, rotationZ: m.rotationZ };
}

/**
 * 从工程提取待恢复的相机状态，返回 null 表示无
 */
export function extractCamera(p) {
  const c = p.camera;
  if (!c) return null;
  const nums = [c.azim, c.elev, c.dist];
  if (nums.some((v) => typeof v !== 'number' || !isFinite(v))) return null;
  if (!Array.isArray(c.focal) || c.focal.length !== 3 || c.focal.some((v) => !isFinite(v))) return null;
  if (c.dist <= 0) return null;
  return { azim: c.azim, elev: c.elev, dist: c.dist, focal: c.focal.slice() };
}

/**
 * localStorage 设置的序列化/反序列化（安全解析，坏数据返回 null）
 */
export function serializeSettings(s) {
  return JSON.stringify(s);
}

export function parseSettings(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null) return null;
    const out = {};
    if (typeof s.sens === 'number' && s.sens >= 0.01 && s.sens <= 10) out.sens = s.sens;
    if (typeof s.grid === 'boolean') out.grid = s.grid;
    if (typeof s.axes === 'boolean') out.axes = s.axes;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
