# Splat Viewer 🔮

移动端/桌面端 3D 高斯泼溅（Gaussian Splatting）查看器。纯离线、无账号、无云端依赖，基于
Web 技术（Three.js + [@mkkellogg/gaussian-splats-3d](https://github.com/mkkellogg/gaussian-splats-3d)）
+ Capacitor 打包为 Android APK。

后续新功能都将基于本项目框架迭代开发。

## 功能

- **模型查看**：加载 `.ply` / `.splat` / `.ksplat` 泼溅模型，自动取景，FPS 与 splat 数量实时显示
- **SuperSplat 式手势**：单指旋转 / 双指平移+捏合缩放 / 滚轮缩放，不翻转不漂移
- **项目管理器**：首页项目列表（缩略图卡片、新建、删除），未保存改动退出提醒
- **工程文件 `.svproj`**：v2 自包含 zip（state.json + 模型原始字节），打开工程一步还原全部状态；兼容 v1 纯 JSON（需重新选模型）
- **模型变换模式**：单指拖动移动模型、双指捏合缩放模型
- **设置持久化**：旋转灵敏度、网格/坐标轴开关，localStorage 自动记忆
- **辅助元素**：地面网格、坐标轴（跟随取景中心与模型尺度）

## 目录结构

```
splat-viewer/
├── index.html                 # 双页结构（项目列表页 + 模型页）+ 全部样式
├── src/
│   ├── main.js                # 应用装配层：渲染器/orbit 相机/手势/页面切换/UI 事件
│   ├── project-state.js       # 工程状态纯逻辑（v1 JSON + v2 zip 打包解包）
│   └── projects.js            # 项目管理器纯逻辑（路径/注册表/脏检查）
├── tests/
│   ├── project-state.test.js  # 工程状态单元测试（Vitest）
│   ├── project-zip.test.js    # v2 zip 工程单元测试
│   ├── projects.test.js       # 项目管理器单元测试
│   └── e2e/                   # 桌面端 CDP 端到端测试（详见 tests/e2e/README.md）
├── scripts/
│   └── ply-bbox.mjs           # PLY 包围盒分析小工具
├── .github/workflows/
│   └── build-apk.yml          # CI：测试 → 打包 APK → 上传 artifact
├── android/                   # Capacitor Android 壳（npm run cap:sync 后生成同步）
├── vite.config.js             # Vite 配置
└── capacitor.config.json      # Capacitor 配置
```

## 开发

```bash
npm install            # 安装依赖
npm run dev            # 桌面浏览器开发预览（Vite）
npm test               # 运行全部单元测试（58 个用例）
npm run build:web      # 构建网页版到 dist/
npm run cap:sync       # 同步 web 资产到 Android 工程
```

桌面端 E2E 测试（需本机 4173 端口 preview + 无头浏览器 CDP，见 `tests/e2e/README.md`）：

```bash
npx vite preview --port 4173 &        # 起预览
node tests/e2e/probe-cdp.mjs          # 验证 CDP 通道
node tests/e2e/test-project-manager.mjs   # 项目管理器全流程
```

## 发版流程（GitHub Actions 云构建）

1. 提交并推送 `main`
2. CI 自动：`npm ci → vitest run → build:web → cap sync → gradle assembleDebug` → 上传 APK artifact
3. 从 Actions 页面下载 artifact（zip 内含 `app-debug.apk`）
4. 分发时把 APK 套一层 zip（部分 IM 会拦截裸 .apk）

公开仓库 Actions 构建免费不限量，单次约 3 分钟。

## 环境要求

- Node.js ≥ 20（本机 24）
- Android 构建由云端 CI 完成，本机无需 Android SDK
- 桌面端预览：任何 Chromium 内核浏览器

## 已知约定与坑（重要）

- **PLY 加载约定**：绕 Z 轴旋转 180°（对齐 SuperSplat 的坐标处理），打开模型角度才正确
- **相机**：不直接改四元数，全部经方位角/仰角/距离/焦点球坐标驱动（SuperSplat 同款方案）
- **渲染循环**：库不自动渲染，必须手动 `viewer.update() + viewer.render()`；辅助网格需在泼溅渲染后以 `autoClear=false` 叠加
- **缩略图**：`preserveDrawingBuffer=false` 时必须在 `render()` 同一 tick 内 `toDataURL`
- **项目存储**：Android 存 App 私有目录（`Directory.Data`，免权限）；web/桌面存 IndexedDB。**不走系统分享**（大文件分享在部分机型闪退，已根除）
- **工程文件体积**：v2 自包含模型字节，约等于模型大小（换取打开即还原）
- **Android SAF 限制**：一次性授权拿不到持久路径，这是项目数据存 App 私有目录的根本原因
