# 技术架构与设计决策

> 本文档面向后续基于此框架的开发者，说明"为什么是现在这个样子"。
> 功能清单见 README.md，本文讲结构、决策与约束。

## 1. 总体架构

```
┌─────────────────────────────────────────────┐
│                index.html                    │
│   双页 DOM：projectsPage ⇄ modelPage         │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│            src/main.js (装配层)              │
│  渲染器 · orbit相机 · 手势 · 页面切换 · 事件  │
│  存储适配(native/web) · 项目管理UI逻辑       │
└──────┬───────────────────┬──────────────────┘
       │                   │
┌──────▼─────────┐  ┌──────▼───────────────┐
│ project-state  │  │      projects.js     │
│ 工程状态纯逻辑 │  │ 项目管理器纯逻辑     │
│ (v1 JSON/v2zip)│  │ (路径/注册表/脏检查) │
└──────┬─────────┘  └──────┬───────────────┘
       │      单元测试盖这两层（58 用例）
       │
┌──────▼──────────────────────────────────────┐
│  三方：three.js · gaussian-splats-3d ·      │
│  fflate(zip) · Capacitor(filesystem/share)  │
└─────────────────────────────────────────────┘
```

**分层原则：纯逻辑与装配层分离。**

- `project-state.js` / `projects.js`：**零 DOM、零网络依赖**，Node 里直接跑 Vitest
- `main.js`：所有与 DOM/渲染器/平台 API 打交道的代码，由桌面 E2E 兜底

这是教训换来的结构：v0.3.5 曾把逻辑重构进 main.js 后按钮全挂（残留调用导致模块初始化崩溃），
单元测试却全绿——因为测试根本盖不到装配层。此后固定双层验证：**单测 + CDP 冒烟**。

## 2. 关键设计决策

### 2.1 相机：球坐标 orbit，永不直接改四元数

采用 SuperSplat（playcanvas）同款方案：相机状态只有四个数
`{azim, elev, dist, focal}`，每帧由 `applyCamera()` 重算位置。

- 不漂移、不翻转（elev 限 ±89°）
- 序列化/还原天然简单（工程文件存这四个数即可）
- 灵敏度手感与 SuperSplat 对齐（0.3°/px）

### 2.2 工程文件：v2 自包含 zip

`.svproj` = zip 包（`state.json` + `model.ply` 原始字节）。

- **为什么自包含**：Android SAF 一次性授权拿不到模型持久路径，打开工程时
  无法保证还能访问原模型文件。模型内嵌后打开一步到位。
- **代价**：工程文件 ≈ 模型体积（3~4MB）。可接受。
- **v1 兼容**：文件头非 `PK` 魔数则按纯 JSON 解析，提示重选模型。
- 打包/解包用 `fflate`：无依赖、浏览器与 Node 通用。

### 2.3 项目数据存储：App 私有目录，不走系统分享

| 平台 | 实现 |
|---|---|
| Android (Capacitor) | `Filesystem` + `Directory.Data`（免权限） |
| Web / 桌面预览 | IndexedDB KV（`sv-store`，key=路径） |

- **为什么不用系统分享导出**：`Share.share` 传 3.7MB 文件在部分机型闪退（v0.3.7 真机实锤），已根除。
- **注册表放 localStorage**：轻量索引（名字+时间+hasModel），避免每次列目录。
  孤儿目录（注册表丢了但文件在）可通过目录反推补录——`pathsFor()` 是纯函数，可枚举。

### 2.4 缩略图：同 tick 截帧

`preserveDrawingBuffer=false`（性能默认）下 canvas 会读不到内容，
必须在 `viewer.render()` 后**同一 tick** 内 `toDataURL('image/jpeg', 0.7)`。

## 3. 约束与踩坑记录

| 坑 | 结论 |
|---|---|
| PLY 模型打开角度不对 | 库坐标约定：加载后 mesh 绕 Z 轴转 180°（SuperSplat 同款处理） |
| 库不自动渲染 | 主循环必须手动 `viewer.update() + viewer.render()` |
| 辅助网格清掉泼溅画面 | 库 render 后 `autoClear` 被恢复，画 helpers 前要临时 `autoClear=false` 叠加 |
| helpers 挂 mesh 父级不显示 | 库的 render() 只画 splatMesh → helpers 放独立 Scene |
| `pointercancel` 不监听 | 手势会误判卡死（SuperSplat 踩过同款坑） |
| Capacitor v8 冲突 | 全家桶锁 v7（`@capacitor/filesystem@7`） |
| 设置 key 改名丢数据 | `SETTINGS_KEY='sv-settings'` 冻结，与已发布版本一致 |

## 4. 质量体系

```
提交 → CI (GitHub Actions, 免费公开仓库)
        ├─ npm ci
        ├─ vitest run          ← 58 用例，纯逻辑层
        ├─ vite build          ← 构建失败即拦截
        ├─ cap sync android
        └─ gradle assembleDebug ← 出 APK artifact
```

发版前手动过一遍桌面 E2E（`tests/e2e/`，CDP 驱动真实浏览器），
盖住单测碰不到的装配层（按钮绑定、页面切换、手势、存储落地）。

**两层都绿才发版**——这条纪律来自 v0.3.5 按钮全挂事故。

## 5. 后续开发指南

加新功能的常规路径：

1. **纯逻辑**（状态计算/序列化/校验）→ 放 `src/*.js` 纯模块 + 单测
2. **UI 交互** → `index.html` 加 DOM，`main.js` 绑事件，桌面 E2E 补用例
3. **渲染相关** → 参考 §3 坑表，改完跑 E2E 截图确认
4. **平台能力** → 优先 Capacitor 官方插件（锁 v7），注意 web 端也要有对应实现（store 模式）

版本号随发版递增（当前 v0.4.0），APK 经 Actions artifact → zip 包 → 飞书交付。
