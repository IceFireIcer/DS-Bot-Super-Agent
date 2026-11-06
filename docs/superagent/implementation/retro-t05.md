# T05 复盘改进

- 日期：2026-11-06。
- 基线：`50d9ad2`；代码与工具提交：`f6eff3c`；范围：用户确认的五项复盘改进。
- 验收入口：公开 Engine、Effects 命令与回执、原生 DSH 模型替身，以及独立进程运行的测试脚本。

## 变更与依据

1. Engine 集成测试复现了真实通知逐条运行的问题：Router 忙时新到的 alpha/beta 被拆成两个 turn。Effects 现在允许 handler 显式选择有界批处理，在一次事务中按 lane claim，逐项保留 row identity、generation、attempt、token 和回执；Execution 准备完所有请求后交给 NativeSessions 合并。未处理项可单独 transient 重试；未知结果保持 unknown。默认 handler 仍按串行派发。
2. Eval 回归组合 ASCII、中文、控制字符 evidence、转义标识符、长规则和不同批次大小，检查放行结果的实际持久化字节、逐项 evidence 与 receipts；超限时没有 Eval/head 遗留。
3. `npm test -- <文件> --test-name-pattern=<名称>` 会先构建再定向运行。构建失败停止，转发过滤选项，使用独立进程验证顺序与退出码。
4. mock responder 的 async function 在 Session 创建前报错；运行时也检查 iterable 契约。mock 演示共用 Router 响应生成器，覆盖合并后的多个独立工具。
5. 实施记录补上已有提交引用，撤回超出证据范围的结论。CI 增加提交占位检查，本地可选择验证历史引用。跨模块验收的审查指引放在实施入口，避免扩张全局 AGENTS.md。

## 验证与审查

- 已观察失败：Engine busy-Router 集成测试；Promise-returning mock 的契约测试；旧记录的提交占位检查。
- 新核心全量 91/91；仓库脚本 7/7；typecheck、lint、diff 检查与实施记录本地 commit 引用检查通过。最终清理仅把稀疏数组测试的创建方式改为显式 length，随后定向 2/2 与 lint 再次通过。
- 原生负载演示：10 项工作、20 次传输重试、11 个 Session、20 条交付消息；重试没有额外模型调用。
- 双轴复审基线为 `50d9ad2`，目标是提交前的完整工作树，对应代码提交 `f6eff3c`。Standards 0 个阻塞项；保留 single/batch 结果验证重复这一可选气味。Spec 发现稀疏数组结果遗漏结算的问题，已先复现 TypeError、修复为逐 claim 位置验证，并取得复审“无剩余阻塞项”。
- 远端 CI：代码提交时尚未验证；以 PR #86 对实际推送头的检查为准。
- 真实来源、真实模型质量与远端发布仍不在这次验收范围。
