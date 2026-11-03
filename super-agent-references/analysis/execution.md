# Super-agent 原型：执行、持久化与恢复核对

日期：2026-11-02。本文核对本地官方原型源码及测试断言；没有安装依赖、启动 DSH 或运行测试。下文的 `src/`、`tests/`、`docs/` 均相对 `super-agent-references/dsh-superagent-prototype/`。

## 主要结论

原型已经包含相当具体的任务执行与恢复规则，应保留这些语义后适配 DS Bot。它不是简单的后台队列，也不提供命令在崩溃处续跑或分布式 exactly-once 执行保证。Ticket、Assignment、Session、turn、后台 job 的生命周期必须分开。

## 已核实的实现

### 1. Runtime 拥有应用生命周期

- Runtime 先锁定状态目录，再打开 SQLite 并组合 Engine、Executor、Sessions、Effects、Outbox 等。
- 初始化完成后才恢复执行并启动 passes 和 effects；启动期间收到 stop 时，不继续启动后台循环。
- stop 幂等。停机路径停止处理、取消工作、等待清理，恢复环境，再关 Store 并释放目录锁。
- 这是一套单应用实例的生命周期，不能据此推导多机调度与分布式锁。

证据：`src/app/runtime.ts:87`、`:93`、`:168`、`:212`、`:214`、`:229`、`:245`。

### 2. 持久事务与副作用分离

- Store 使用 `node:sqlite` 的 `DatabaseSync`，开启 WAL 和 `synchronous=FULL`。
- `atomic` 支持嵌套事务；领域状态和待处理 effect 可以同事务提交。
- `afterCommit` 用于无需跨重启存活的内存跟进；需要跨重启的操作进入 Effects。
- Effects 使用 `(kind,key)` 合并待处理操作，`seq` 保留队列位置，`generation` 防止旧执行完成后删掉新 payload。
- 关机时被切断的 effect 保留，下次启动重试。
- `Later` 是延后执行，不递增失败计数；普通错误采用有上限的指数退避，连续失败再呈现健康问题。

证据：`src/app/store.ts:60`、`:64`、`:140`、`:157`；`src/app/effects.ts:3`、`:38`、`:61`、`:70`、`:105`、`:130`、`:134`、`:136`、`:155`。

### 3. 一个 Ticket 的 Worker Session 通常稳定复用

- Session ID 固定为 `worker-<ticketId>`。
- retry/restart 产生新的 Assignment，但复用任务的 Session 和执行目录。
- 启动前检查 Ticket、最新 Assignment、pause 和主机关闭状态，避免过期启动继续提交。
- 目录不存在时才运行 prepare；已有目录被视为已准备。
- 新 Assignment 先等待旧后台工作的停止，再安排新消息。
- 第一次提供原始任务与来源；后续 Assignment 若历史已有首条任务消息，则只提供新增执行安排。

证据：`src/executor/dsh.ts:24`、`:424`、`:434`、`:440`、`:443`、`:452`、`:468`。

### 4. 并发槽不等于正在运行的 LLM 调用数

- prepare、启动、唤醒都占槽；预留在 await 前同步完成，避免并发启动争抢最后一槽。
- Worker 回合结束后若 shell jobs 或 subagents 仍在运行，仍持有槽。
- 普通自动输入等待正常槽位；人的后续消息或状态请求可使用超过配置上限的一个额外槽。
- 额外槽是有界的一个，并不是所有人工输入无限超额启动。

证据：`src/executor/dsh.ts:166`、`:171`、`:182`、`:192`、`:229`、`:274`、`:303`、`:405`。

### 5. 投递、读取与执行结果是不同事实

- `AgentDelivery` 通过稳定 message ID、当前历史、持久化历史和 inbox 去重。
- 投递模式区分 queue、steer、inject；inject 不唤醒 Agent。
- 发送后 flush Session 持久化，再向生产者确认。
- Worker Input 的 readAt 来自实际写入 Session 历史的 `user/message`，不是仅凭 `agent/inbox/claimed`。
- 某步 claim 后在入历史前取消或失败，消息仍必须能够恢复。
- 新 Assignment 启动前移除 inbox 中即将重投的旧副本，避免一个未读 Input 被两次送入。

证据：`src/app/delivery.ts:15`、`:31`、`:40`、`:63`、`:68`；`src/executor/dsh.ts:447`、`:489`、`:496`、`:502`。

### 6. 后台工作与人工交接有明确清理规则

- 普通回合结束后，jobs/subagents 可以继续，完成时唤醒同一 Worker。
- 一个 idle 后后台工作默认最多等待 30 分钟；到限杀 shell jobs，注入说明，subagents 可以继续，随后报告 waiting。
- ready、结构化问题、blocked/failed 等交给人处理时释放并发槽。
- 交接停止子代理，但可留下供人验收的 server jobs；它们不占槽、不受该 30 分钟限制，结束也不唤醒 Worker。
- Assignment 结束时杀其 jobs、释放 subagents，并收集结束通知，避免旧任务完成又唤醒新执行。
- 等待人工之后新到达的输入属于新工作，不能被旧交接状态吞掉。

证据：`src/executor/dsh.ts:584`、`:588`、`:609`、`:629`、`:646`；`src/executor/background.ts:90`、`:110`、`:122`、`:137`、`:156`。

### 7. 重启恢复是对账和重新安排

- 恢复按任务接受时间遍历；running Assignment 交给 Engine 记录 interrupted。
- 同进程插件重启时，先停止残存工作并保留 inbox，再建立恢复安排。
- pending 且非等待人的执行重新进入启动队列；失败执行不会被无限自动重启。
- 恢复并不证明 shell、网络写入或后台进程可以从故障位置无缝续跑。外部副作用需要检查现实结果。

证据：`src/executor/dsh.ts:521`、`:524`、`:529`、`:533`、`:535`；`docs/003-execution.md` 的 Restart 和 Stored work 小节。

### 8. Outbox 保存发送请求与回执

- 消息回执与 reply effect 在同事务内写入，稳定消息 ID 防止重复排队。
- 发送失败采用 5 秒起、最大 300 秒的退避。
- 同 Ticket 同会话的后续消息在之前消息后等待，超过失败阈值后不无限阻塞后续。
- 来源暂时关闭/未安装时保留等待；目的地不再允许或永久消失才丢弃，保留 dropped 回执。
- 发送本身仍需要 Source 的幂等键或外部对账支持；数据库回执不能消除“外部已收到、响应丢失”的窗口。

证据：`src/app/outbox.ts:22`、`:24`、`:31`、`:39`、`:44`；`src/app/store.ts:251`；`docs/008-cookbook.md:177`。

### 9. 外部运维回路已经有配方

- docs006 要求在操作者另一个 DSH profile 中建立 hourly check，确保被监督服务停机时检查仍能运行。
- 检查通过脚本 exit0/1/2/3 决定安静、恢复、报告运行错误或配置问题，尊重 intentional stop。
- 脚本可读取日志并由该外部 Agent 尝试修复。
- 这证明存在外部 Agent 运维监督配方；尚不足以证明文章中持续判断每个 Worker 实质进展与目标偏离的完整语义监督已实现。

证据：`docs/006-deployment.md:133`、`:138`、`:141`；`scripts/dsh-superagent:82`、`:118`、`:133`。

## 已阅读的测试断言，未运行

- `tests/effects.spec.ts:29`、`:39`、`:105`、`:160`：提交/回滚、运行中更新、停机保留和旧执行不覆盖新代。
- `tests/delivery.spec.ts:89`、`:99`、`:109`、`:117`、`:137`：flush 失败重试、分页历史、加载期间消费、目标销毁与持有消息查询。
- `tests/outbox.spec.ts:17`、`:30`：pause 和 Source 未安装时保留消息。
- `tests/runtime-concurrency.spec.ts:84`、`:146`、`:158`：prepare 并行、人工额外槽、启动占槽。
- `tests/runtime-concurrency.spec.ts:264`、`:281`、`:292`：后台任务持槽、子代理完成、停止清理。
- `tests/runtime-concurrency.spec.ts:352`、`:358`、`:361`、`:381`：交接释放槽，留下 jobs 的特殊语义。
- `tests/runtime-concurrency.spec.ts:452`、`:475`、`:497`：30 分钟窗口及仅子代理仍工作时的行为。
- `tests/runtime-concurrency.spec.ts:597`、`:670`、`:693`、`:710`：同进程重启、claim/read 区分、未读消息只投递一次。

## 总体方案应采用的具体决定

1. 保留 Ticket/Assignment/Session/job 分离和 delivered/read 状态，不以 Agent idle 推断任务完成。
2. 保留事务 Effects 与 Outbox；把 Source 幂等写入、外部结果未知的对账作为端到端契约。
3. 首个验收就加入满槽时人工修正、后台作业完成、人工停止、claim 后失败、重启恢复及投递去重。
4. 远程设备要提供环境标识、作业 ID、取消与结果查询；设备端可持有执行恢复记录，但不保存 Agent 会话状态。
5. 云端化需要跨进程所有权、租约/过期执行隔离与共享持久化后端；原型本地目录锁和 SQLite 不能直接等同于这些能力。
6. 监督从现有外部运维配方延伸：另加 Worker 目标、有效进展、资源与重复操作证据的语义检查；恢复操作服从已有授权与人工 stop。

## 证据边界

以上是源码和测试文本核对。没有运行原型测试，没有真实模型、真实 GitHub/飞书、云端部署或 Windows 设备验收。保留现有语义是工程建议，不代表所有自然语言任务都可由代码精确验证，也不构成原型已达到生产可靠性的声明。
