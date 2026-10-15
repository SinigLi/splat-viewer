# tests/e2e — 桌面端端到端测试

通过 Chrome DevTools Protocol（CDP）驱动真实浏览器验证完整用户流程。
单元测试盖不到的页面装配层（事件绑定、手势、页面切换、存储落地）由这层兜底。

## 前置条件

1. **构建 + 预览**：

   ```bash
   npm run build:web
   npx vite preview --port 4173 --strictPort
   ```

2. **无头浏览器 + CDP**（端口 9223）：

   ```powershell
   # Edge（本机 Chrome 更新损坏时的替代，同样支持 CDP）
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless `
     --disable-gpu --no-sandbox --remote-debugging-port=9223 `
     --user-data-dir=C:\temp\cdp-edge --no-first-run --window-size=420,900 about:blank
   ```

3. **验证通道**：

   ```bash
   node tests/e2e/probe-cdp.mjs    # 建 tab → WebSocket → evaluate 1+1=2
   ```

## 测试清单

| 脚本 | 覆盖内容 |
|---|---|
| `test-project-manager.mjs` | 项目管理器全流程：新建→导入模型→调整视角→保存→返回列表（缩略图）→重开会话自动还原→脏检查弹窗 |
| `test-zip-project.mjs` | v2 zip 工程：双会话保存/打开往返，模型字节与视角精确还原 |
| `test-project.mjs` | 工程状态收集/恢复往返 |
| `test-settings.mjs` | 设置面板 + localStorage 持久化 |
| `test-xform.mjs` | 模型变换模式（移动/缩放） |
| `diag-buttons.mjs` | 按钮绑定诊断（抓控制台错误，回归排查用） |

所有脚本输出 JSON 结果，任何 `loopErr` / 控制台错误都会体现在输出中。

## 本机环境经验（重要）

- **node 的 fetch 对 CDP `json/new` 会挂死**，必须用 `curl.exe` 子进程建 tab（见 probe 脚本）
- **每次 evaluate 都要带超时**（脚本内 `evT`），CDP 僵死时才不会无限等待
- 脚本带全局看门狗（100s 强制退出），防止 CI/交互式运行卡死
- 无头浏览器进程可能被系统回收，**建议在同一条命令内完成 启动浏览器 → 跑测试 → 收结果**
- Chrome 自动更新后可能出现"并行配置不正确"无法启动，可换 Edge（参数一致）
- PowerShell 里 stderr 会被包装成错误显示，属正常现象，看 `[step]` 打点判断实际进度

## 测试模型

E2E 导入模型使用本机测试数据（`final.ply`，约 3.7MB），路径写在脚本内，
跑之前按需修改 `setFiles` 调用里的绝对路径。
