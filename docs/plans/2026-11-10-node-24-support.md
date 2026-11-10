# Node 24 单一运行时

- 日期：2026-11-10
- 相关：Issue #88

## 为什么

Node 22.19 曾是 Super-agent 的最低运行时，用于验证 `node:sqlite`、worker、Session 和 device job 在最低版本上的行为。实际部署面已经统一到 Node 24：Docker 使用 `node:24`，桌面应用和移动工具链由 Node 24 构建，当前 DSH 版本在 Node 24 上验证通过。保留 Node 22 的唯一收益是兼容性声明，但 Windows Node 22 的测试腿多次比 Node 24 慢数倍并产生超时噪声，降低 CI 信号质量。

## 已定的行为

- 项目当前支持的 Node 运行时统一为 Node 24；README、安装说明、`engines.node`、类型包和 CI 只声明 Node 24。
- `superagent` 的 `engines.node` 为 `>=24.0.0`，`@types/node` 跟随 Node 24。
- 主测试矩阵和 Super-agent core 只运行 Node 24；Docker 与发布流程保持 Node 24。
- 历史实施记录中的 Node 22 运行证据保留，作为当时的验收事实；当前支持声明不再引用它。

## 不做什么

- 不支持 Node 22；用户会收到引擎不匹配警告，属于明确的不支持，不会静默降级。
- 不在 Linux 单独保留 Node 22 兼容腿；Windows 是主要产品平台，Linux 结果不能证明 Windows Node 22 的实际支持。
- 不因移除 22 而回滚历史验收记录或已推送的 CI-hardening 提交。

## 已知限制

- Node 22 用户必须升级才能继续使用新版本；不提供兼容层。
- 该决定只统一运行时，不改变 DSH 版本矩阵或 Electron/移动端的运行时来源。

## 变更

- 2026-11-10：统一到 Node 24，移除 Node 22 CI 矩阵，更新类型包和安装文档（Issue #88）。
