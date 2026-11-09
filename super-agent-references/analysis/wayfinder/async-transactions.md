# 异步领域事务与 Effects 原子性实验

- 日期：2026-11-02。决策：[验证异步领域事务与 Effects 原子性](https://github.com/IceFireIcer/DS-SuperAgent/issues/5)。
- 固定参考：官方 Super-agent 原型提交 `6337fc823ce20251c8de8085948165c81aaa701e`。实验代码为本项目原创的小型 Engine/存储模型，未复制或修改官方实现。
- 环境：Windows、Node v25.4.0、SQLite 3.51.1，WAL、synchronous=FULL；每个 SQLite 连接由独立 worker thread 持有。Docker CLI 存在，但 Docker 引擎未运行；本轮没有 PostgreSQL 服务实验。

(一) 结论与选用合约

采用显式异步 Unit of Work（一次领域命令的事务上下文），将它传给领域规则和存储端口。公开命令返回 Promise；同命令涉及的读取、领域写入、Effect 意图、Outbox 记录及命令回执必须绑定同一事务连接。等待所有事务内操作完成后才能 COMMIT，只有已提交意图允许进入派发流程。实验的小模型含 Ticket、Effect、command receipt，不包含完整 Outbox 或官方 Engine。

本轮确定以下实现约束：

1. 同一 Instance 的写命令串行化，避免跨 Ticket、Thread、Policy 等对象的不变量被并发修改破坏。SQLite 实验以 BEGIN IMMEDIATE 和每连接队列实现；它是数据库级写锁，比 Instance 隔离更粗。PostgreSQL 拟以事务内锁定 Instance 写入协调行实现，不能仅依靠某进程的 Promise 队列；其具体行为留给真实 PostgreSQL 实验。查询使用独立读事务，返回一致快照。
2. 事务上下文只在本次回调有效。内部规则复用已有上下文，不自行再开顶层事务；禁止将不同异步命令塞进共享 depth/current-transaction 全局字段。实验对本 Store 的嵌套事务直接拒绝，避免等自己的连接队列。
3. 事务内只执行有界数据库操作和确定性的规则，不等待模型、网络、设备或外发。需要这些动作时先提交 Effect，由外部适配器执行后通过新的公开命令记录事实。跨领域对象读写仍属于同一次事务。
4. 数据库队列是持久依据；提交后的 wake 只是低延迟提示。启动与周期扫描必须能补上丢失的 wake，通知失败不能把已经提交的命令误报为已回滚。
5. Effect 的稳定键、不可复用的行身份和 payload 代次共同确定一次尝试。成功删除、失败退避、延期均条件匹配这些身份；同键更新保留排队位置，删除后重建使用新身份，防止 generation 重用造成 ABA。该条件保护队列回执，不保证远端副作用已经撤回。
6. Effect 回执隔离与领域回调隔离分别检查；后者需核对当前 Assignment、人工停止及后续执行所有权合约。命令回执以稳定 command ID 和规范化输入指纹去重；同 ID 不同输入应拒绝。生产编码还需定义可接受输入、schema/default 规范化和版本，实验仅规范化 JSON 对象键顺序。
7. COMMIT 调用出错不能一概推断未提交。连接丢失或应答未知时用原 command ID 在新连接查询持久回执；查不清则返回结果未知，不换 ID 盲重试。实验覆盖提交已经应答后丢失 wake/客户端结果，没有模拟 COMMIT 应答丢失。

(二) 比较过的方案

| 方案 | 观察与决定 |
| --- | --- |
| 同步 atomic 直接接收 async 回调 | 拒绝。N1 复现 await 后失败但状态已提交；同步异常捕获不接住异步拒绝。 |
| 事务内沿用 microtask 派发 | 拒绝。N2 用同连接读到未提交 Effect，handler 已运行后事务才回滚。 |
| 先提交状态，再在内存回调持久化 Effect | 拒绝。N3 真正杀掉子进程后，只剩状态、没有 Effect。 |
| 显式异步事务绑定端口 | 选用。直接对应原型已有规则组合，能保留跨聚合事务边界；需要约束持锁时间、连接归属和派发屏障。 |
| 快照 → 纯规则 → revision CAS 提交 | P11 证明小模型可以检测冲突后重读重算，不是错误方案。暂不选为总体基线：完整原型还需要完整的跨聚合读取集合、谓词/缺失行冲突和无副作用重跑证明，不能只给单 Ticket 加 revision。 |

(三) 可复跑证据

从包含本实验的仓库根目录运行，无 npm 依赖、密钥、DSH 服务或用户数据要求：

```powershell
node super-agent-references/analysis/wayfinder/async-transactions/probe.mjs
```

- [实验脚本](async-transactions/probe.mjs)、[SQLite worker](async-transactions/sqlite-worker.mjs)、[本次结构化结果](async-transactions/results.json)。
- 结果：16 组断言通过，其中 3 组负对照成功复现不安全方案，13 组正例覆盖选择的合约。负对照的通过指检测到预期失败，不代表该方案安全。
- 隔离数据库位于实验目录下唯一的 `.dsh-test-async-transactions-*` 子目录；结束时关闭 worker/子进程，检查绝对路径仍在实验目录内后清理本轮数据。

| 断言 | 已观察事实 |
| --- | --- |
| N1 | 回调 Promise 未结束即提交，之后拒绝仍留下状态。 |
| N2 | 同事务连接的 microtask 提前派发，随后数据库回滚；外部调用与持久状态不一致。 |
| N3 | 状态单独提交后、Effect 写入前杀子进程，重开库确认意图丢失。 |
| P1 | 保存状态后、保存 Effect 后、COMMIT 前三处注错，状态/意图/命令回执全回滚，无 wake。 |
| P2 | 写事务 await 期间，第二真实 WAL 读连接只见旧的已提交快照；wake 仅在 COMMIT 后发生。读连接代表扫描入口，没有运行真实 dispatcher。 |
| P3，提交前 | 公开 create 命令在 COMMIT 前暂停，杀子进程后重开库，三类记录均不存在。 |
| P3，提交后 | 同命令提交后、wake/结果返回前杀子进程，重开库找回意图与回执；同 command ID 重放不重复入队。只证明可派发意图恢复，未执行真实 handler。 |
| P4 | 两 Engine/两连接并发读后写，26 次增量无丢失，最终 steps=26、Effect generation=27。未声称精确确认第二写者在哪一时刻开始等待锁。 |
| P5 | 并发同 ID 命令只保留一次结果和入队；不同输入拒绝，对象键顺序变化不改变指纹。 |
| P6 | payload 更新后，旧成功、旧失败、旧延期均影响 0 行，保留新 payload、代次和重试资料。 |
| P7 | 删除后同键重建虽可能复用 generation，仍以新 seq 隔离旧完成。 |
| P8 | 当前 Assignment 回调可成功；旧 Assignment 及人工停止后的回调不能改变当前事实。 |
| P9 | wake 抛错后命令仍成功，持久意图可扫描。 |
| P10 | 事务结束后泄露的 Tx 能力拒绝使用；同 Store 嵌套事务立即拒绝。 |
| P11 | 小模型快照冲突被 CAS 检测，重新读取重算后正确提交两次增量。 |
| P12 | 真实 SQLite query_only 故障拒绝写入，没有持久接受和 wake；它不等于网络断连。 |

(四) 证据边界与后续验证

- 已通过：原创最小模型的 SQLite 异步事务合约、双连接并发、实际进程终止后的数据库恢复、条件回执及命令去重。Node SQLite 接口仍有 ExperimentalWarning，本轮选择的是事务协议，未定生产驱动。
- 未通过也未声称：官方完整 Engine 异步移植、完整 Outbox 行为、真实 dispatcher、DSH Session、模型、远程设备、跨 Host 租约/抢占、数据库掉电与磁盘故障。
- PostgreSQL 需要单独验证 Instance 行锁、同/不同 Instance 并发、连接中断和 COMMIT 应答未知后的命令回执对账。这会为执行所有权决定提供补充依据；不能由 SQLite 的单写行为推导已经通过。
- 外部平台收到了操作但回复丢失仍需 Channel/设备幂等键或对账。事务原子性不是远端 exactly-once。
- 实验 Store 是说明协议的最小实现；生产适配器还要区分 COMMIT 未知/已回滚，保留原错误，具备有界连接清理、重试分类和故障观测，不能直接把本实验作为产品实现。

(五) 参考依据与仓库回归

- [原型同步 Repositories 合约](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/ports.ts#L105)。
- [原型 Store.atomic / afterCommit](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/store.ts#L133)。
- [原型 Effects 入队与回执代次](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts#L60)。
- [原型 Effects 回归场景](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/effects.spec.ts)。

只读复核指出并修正了扫描与实际派发的证据用语、输入键顺序指纹、同 Store 嵌套事务和 worker 退出清理问题。复核不是完整产品代码评审。

在本轮独立分支安装构建及 harness 依赖后，DS Bot 基线 `npm test`：1433 个测试，1431 通过、2 跳过、0 失败；生成一致性检查通过；lint 退出 0，保留基线警告。部分测试输出包含既有故障注入/上下文日志，不以日志文本代替测试结果。未改变 index.js/src/host，未运行 host smoke。这些检查验证基线未受本轮资料影响，不能替代 Super-agent 集成验收。
