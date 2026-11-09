## Resolution

已确认：固定 DSH 基线提供公开的 SessionPersistence 与 SessionHandle 合约，可在保持原生 agent loop 的前提下接第三方共享后端。采用这一扩展位置，保留 append 连续序号、flush 持久化屏障、live 事件路由、单写 handle 生命周期以及恢复时 synthetic closers。

跨进程排他和失效写者隔离由具体后端负责；文件后端的本机内核锁不能直接等同于跨设备租约。业务状态与 Session 历史是两套持久状态，使用稳定消息身份、flush 和恢复对账衔接，不宣称共享一个 ACID 事务。

研究票以“公开合约与边界已明确”结束。共享后端真实运行、双写者接管、flush 失败与投递窗口仍由独立运行实验验证；本结论不是 PostgreSQL、Host 故障转移或真实 DSH 运行通过。

研究资料：[固定提交中的完整研究记录](https://github.com/IceFireIcer/DS-Bot-SuperAgent/blob/25c09f5bc9b7ee77d39a5ea2790cc7ac348330bf/super-agent-references/analysis/wayfinder/session-persistence.md)。研究分支 docs/research-session-persistence 已推送，不建 PR、不合并。

证据固定到 DSH dsh-v0.2.1-rc.4 提交 504a01a9578abc2c6f1fb896b1dc322c9fe24f66。委派代理连接失败，本研究由主代理直接接回，未计为独立代理评审通过。

下一项运行验证：[验证 Session 后端写入屏障与接管行为](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/11)。
