# Super-agent 原型：事件、授权与任务领域核对

日期：2026-11-02。范围：本地 `super-agent-references/dsh-superagent-prototype` 的领域设计、核心源码、策略与相关测试。本文只记录源码核对；没有安装依赖或运行测试。完整路径相对仓库根目录；简写的 `src/`、`docs/`、`tests/` 路径相对上述原型目录。

## 结论

文章给出逻辑职责与工作模式；原型把它落实为事务领域核心、不可变授权、跟进消息归属和可恢复执行。不能把原型简化成“Gate → Router → 每次新建 Worker”，也不能把订阅理解成无条件授予后续操作权限。建议整体保留已经成体系的领域约束，外部来源和 Executor 则通过适配接入 DS Bot 的新产品。

## 已核实的源码事实

### 1. 领域事务与外部执行分离

`Engine` 是 Trigger、Thread、Decision、Ticket、Assignment 的唯一事务写入口；内部拆为 Intake、Evals、Tickets、Assignments、Replies，公开命令通过 `repo.atomic()` 执行。Executor、Assessor、Outbox 在事务内接受排队请求，外部执行由适配层承担。它是任务领域控制核心，不是第二套模型 agent loop。

来源：`super-agent-references/dsh-superagent-prototype/src/core/engine.ts:19`、`:24`、`:48`；`src/core/ports.ts:60`。

### 2. 实际入站顺序

`Intake.receive` 依次：规范时间 → 要求至少一个 Thread → 根据稳定 Trigger ID 去重 → 检查 SourceScope → 保存事件及 disposition → 建立 Thread 与 correlation → fan-out 到订阅 Ticket → 将无人拥有的消息排入主 Thread 的 Eval → 唤醒可恢复 Ticket。

范围外事件也保存过滤原因，但不创建 Thread。一个 Trigger 可以属于多个 Thread；首个 Thread 承载 Eval，额外 Thread 形成关联上下文。correlation 不承担路由。

来源：`super-agent-references/dsh-superagent-prototype/src/core/intake.ts:18`、`:24`、`:30`、`:46`、`:55`；`src/core/model.ts:25`、`:170`。

### 3. 订阅、授权与 follow-up ownership 是三件不同的事

订阅 fan-out 不重新检查发送者是否在准入白名单；它投递上下文，不扩张 Ticket 的 Mandate。对 live Ticket，自有 Thread 上的人类消息由其 Worker 决定是否属于当前工作。仍有 owner 时主 Session 的 accept/attach/ignore/requeue 被拒绝，stop 是例外，但仍需 explicit 强度。多个 Ticket 都拥有消息时，需所有 owner handback，消息才回到 Eval；每个 Ticket 对每条 Trigger 只能 handback 一次。

机器人/CI Trigger 不产生 follow-up ownership，因此即使到达既有 Ticket，也可能同时独立进入 Eval。只为上下文订阅的 Thread 不产生 ownership，也不凭人类消息唤醒已结束 Ticket。

来源：`super-agent-references/dsh-superagent-prototype/src/core/model.ts:69`（`followupOwners`）；`src/core/intake.ts:37`、`:55`；`src/core/evals.ts:142`、`:186`；`src/core/part.ts:34`；`src/core/tickets.ts:407`。

### 4. 两种批处理需分别理解

领域层每个 Thread 同时最多一个 Eval，等待事件组成下一批；不同 Thread 可各自存在 Eval。Router Session 的 inbox 还可以把执行中收到的多个通知合并到后续推理步。这不是一个把所有 Thread 混为一单的全局队列。

同一 Eval 批次的授权强度由最强的 admissible Trigger 决定，相同强度取较新的事件。该事件成为 `primary`，其 actor 和 basis 进入 Mandate，其信道用于初次确认。批次内其他消息是上下文，不能用最后一条未授权消息替换授权来源。

来源：`super-agent-references/dsh-superagent-prototype/src/core/evals.ts:75`、`:100`、`:114`；`src/core/tickets.ts:36`。

### 5. Mandate 和 Policy 的精确语义

accept 生成不可变 Mandate：strength、policyVersion、basis、actor、scope。原型没有在原 Ticket 上直接修改授权范围的接口。新工作走新的 accept；后续输入仍受原范围约束。

explicit 与 inferred 路径分开：允许的人直接提出请求可以获得 explicit；列入允许清单的机器人最多 inferred；未列机器人的新任务请求被拒绝。inferred 接单需要 auto 模式和已启用的匹配规则。observe 模式记录 would_accept 而不执行。

Policy version 对规则、accept mode 和来源策略计算散列，不包括模型、并发、pause 和轮询间隔。策略变化让进行中的 Eval 失效并重新排队；只向受影响的 live Ticket 投递变化说明，不自动中断全部执行。已结束 Ticket 恢复前重新校验 Mandate；不再有效时保留结束并释放待处理消息回 Eval。

来源：`super-agent-references/dsh-superagent-prototype/src/core/evals.ts:281`、`:306`；`src/policy.ts:40`、`:116`、`:144`、`:167`、`:212`、`:213`；`src/core/tickets.ts:196`、`:252`、`:312`。

### 6. Ticket 结束、Assignment 结束、等待人工必须分开

Ticket 持久代表工作，Assignment 是一次执行绑定。retry/restart 新增 Assignment，保留原 Ticket 和 Mandate。非人工结束的 Ticket 可因自身 Thread 上的人类消息恢复，不需要新 Eval/Decision；人工 stop 结束的 Ticket 不自动恢复，也不再接收订阅输入。

ready 并不总是 Ticket 完成：如果绑定了 PR 等 Source Thread，还需其完成条件成立。无所绑定的 ready 才直接 completed。多个 PR 优先检查本 Ticket 创建的 PR 是否全部关闭，再取最后关闭结果；PR 关闭时仍有已承接的跟进工作则延迟结束。

blocked/failed 时自动输入保存但暂停交给 Worker，人的新消息、恢复报告或 retry 可以释放。Attention 是结构化问题；不可用报告 free text 推断“等用户”。stage 按顺序投影：ended → delivery failure → attention → ready/review → blocked/failed → pending → idle → working。

来源：`super-agent-references/dsh-superagent-prototype/src/core/tickets.ts:88`、`:169`、`:232`、`:252`、`:345`、`:369`；`src/core/assignments.ts:99`、`:126`、`:129`；`src/core/stage.ts:11`、`:30`。

### 7. 投递不等于读取，结束时不能吃掉后续消息

Input 在 delivered 后还记录它是否进入 Session 的实际推理步。retry/restart 将替换 Assignment 已投递但未被 step 取走的 Trigger Input 重新排队。Ticket 结束时，尚未读取/承接、未获有效决定的人类后续消息会释放，所有 owner 都释放后重回 Eval。

恢复提示明确要求检查工作副本、git 历史和 GitHub 现状，不能盲目重做外部操作。领域层仅决定应该恢复哪些工作；不能据此宣称 shell 过程可以从崩溃位置续跑。

来源：`super-agent-references/dsh-superagent-prototype/src/core/assignments.ts:21`、`:48`、`:62`、`:83`；`src/core/tickets.ts:283`、`:292`、`:334`、`:345`。

### 8. 对外发送既受状态约束，也有目的与地址约束

Reply purpose 分为 acknowledgement、answer、result、attention。确认和回答回到提出请求的消息；attention 回到引发问题的消息或原始信道；result 回到工作发起处。未 ready 的工作不能发 result，answer 需 Worker 已报告可回答，attention 必须等于当前结构化问题。发送请求具有稳定 ID，替换问题会撤回旧的待发问题。

原型允许 Worker 通过受限工具请求 acknowledgment；关键结果和人工问题走主 Session 转达。故应将“统一对外”理解为统一规则和发送通道，不能错误要求每次确认都由 Router LLM 再生成。原型的受控 Worker 发信与文章的逻辑 Router 职责存在具体实现上的差异，应在设计中注明。

来源：`super-agent-references/dsh-superagent-prototype/src/core/replies.ts:14`、`:35`、`:49`、`:63`；`docs/004-prompts.md:82`。

## 已阅读的测试断言（未运行）

- `tests/followups.spec.ts:14`：人类 follow-up 直通 Worker，同时 Router 收到通知，但不产生 Eval/Decision。
- `tests/followups.spec.ts:47`：owner 尚未交回前拒绝 Router 重新派发；多人/多 Ticket ownership、explicit stop 例外。
- `tests/followups.spec.ts:100`：Router 忙时通知汇入后续 step；直通仍可能唤醒 Router，因此不能承诺 Router 零调用。
- `tests/followups.spec.ts:145`：handback 携带原因，只能一次，不能立即 attach 回拒绝该消息的 Ticket。
- `tests/core-engine.spec.ts:671`：多 owner 需全部交回；`:755`：策略变化只通知受影响任务；`:899`、`:927`：重复 accept 返回原决定。
- `tests/core-engine.spec.ts:1180`、`:1191`、`:1201`：旧 Policy 下决定失效、恢复校验失败、pause 后重新校验。
- `tests/core-engine.spec.ts:1212`、`:1224`：混合批次 primary 的授权归属。
- `tests/core-engine.spec.ts:1486`、`:1555`、`:1585`：step 实际读取、retry 和 restart 未读取输入恢复。
- `tests/policy.spec.ts:54`、`:60`、`:287`、`:335`：来源原生身份、模式、启用规则完整评估。
- `tests/stage.spec.ts`：stage 顺序与 retry 可用性表。

## 对总体方案的建议（尚不是实现）

1. 直接复用/适配成体系的领域约束和规格测试，避免只抄概念名后从零发明弱化版任务队列。原型代码是否逐段移植仍需许可证与适配审查。
2. 新建 desktop Source，让桌面输入和外部 Source 走同一领域路径；旧 Bot 消息调度不能与新核心同时消费同一输入。
3. 首条端到端验收必须覆盖：同 Thread follow-up 直通、多 owner handback、停止不可被 CI 恢复、跨来源 attach 的证据依据、重启前后未读输入不丢失。
4. 对外统一应由受控 Reply/Outbox 保证，禁止 Worker 任意发信工具绕过它；需要明确 PR/代码提交等交付写操作与聊天回复的权限差异。
5. 将 task/assignment/session/environment 分离。Ticket 是授权与生命周期承载物，不意味着产品必须以工单看板为主。
6. 原型既有规则是可选的成熟起点；如果要改变“策略变化不强制停止”“自然结束可自动恢复”等语义，应作为明确设计决定并新增场景验收。

## 仍未被本文证明的部分

- 规则正确执行属于模型行为，源码 gate 不可能验证所有自然语言 scope 遵守情况。
- 文章的外部 Watchdog、云端 Session 后端、跨设备 daemon、长期记忆扩展均不由领域核心证明。
- 单进程同步事务和 Assignment 回调检查不等于分布式租约、过期执行隔离和跨设备副作用一次性保证。
- 本次只读研究，不构成原型测试通过或真实模型行为通过的证据。
