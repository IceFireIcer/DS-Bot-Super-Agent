# Super-agent 原型：来源接入、提示词、交互与部署核对

日期：2026-11-02。本文基于本地官方参考目录的文档、源码和测试源码；没有安装依赖、运行测试、配置账号或发送外部消息。

所有简写路径相对 `super-agent-references/dsh-superagent-prototype/`；行号指本地参考快照。下文将已核实事实、读过的测试断言和本项目建议分开。

## 核心结论

原型提供的价值是完整的事件接入、受控交互和运维机制；它的部署、来源标识和工具策略仍面向一个仓库及一组固定账号。
因此可以移植机制和不变量，但不能把“注册 Source kind”直接理解为已经支持任意多个同类账号、仓库或多租户。
统一对外的实际含义是统一的授权、目的、地址和 Outbox，而不是所有外发消息都必须再调用一次 Router 模型。
原型已有主系统外部的定时 Agent 运维回路；需要补充的是文章中监督 Worker 实质进展和方向偏离的能力。

## 1. Source 接口有扩展位置，但当前 kind 与 instance 实际重合

`SourceRegistry` 注册 kind、验证配置、提供范围检查、发送、引用解析和 Thread 上下文读取。
`instances()` 按 `settings.sources[kind.kind]` 获取唯一配置，`instance(id)` 用 id 找 kind，`resolve()` 返回 `id: kind.kind`。
重复注册同一 kind 被拒绝。这一实现允许添加新的来源类型，未提供同一种类型的多个独立实例。

来源：`src/sources/registry.ts:13`、`:20`、`:45`、`:50`、`:134`。

GitHub Source 当前绑定一个 `repository` 和 CLI；GitHub Thread 使用 `github:<number>`。
Issue Trigger ID 使用编号，CI ID 使用 PR 编号或分支及 revision，均没有仓库实例命名空间。
`find()` 把任意仓库格式的 GitHub URL 提取出的编号映成当前 `github:<number>`，这建立在单仓库部署假设上。
真实地址解析 `githubAddress(url, repository)` 则检查仓库，不能把两个解析函数混为一谈。

来源：`src/sources/github.ts:39`、`:66`；`src/sources/github-trigger.ts:6`、`:8`、`:13`、`:82`、`:98`、`:103`。

**方案含义：**如果本项目要扩展到多仓库、多账号，首个持久 schema 就要区分 source kind、source instance、来源原生对象 ID。
查询引用必须携带或解析仓库实例，不能把不同仓库的 `#12` 合并。该变化是我们的扩展设计，不是原型已有能力。

## 2. 稳定事件 ID、读取位置与订阅轮询共同维护连续性

GitHub 评论 Trigger ID 带评论 URL/ID 和更新版本；同一个评论编辑后可以产生新事件。
PR 和 Issue 共用编号空间，因此新 PR 重用 Issue Trigger 的 ID 结构。
CI Trigger 没有人的发送者，也不一定有可回复的 Channel；不能默认每个事件都有外发目的地。

来源：`src/sources/github-trigger.ts:65`、`:68`、`:90`、`:98`。

Source 扩展指南要求在写代码前确定 Trigger、Thread、Actor、Channel 和接收范围的稳定映射。
来源自己的消息应被去掉；来源内容、引文和 metadata 不能成为改写部署规则的指令。
新的来源默认接收范围应为空；范围过滤结果需保留原因，而不是在轮询代码里无声丢弃所有事件。

来源：`docs/008-cookbook.md:19`、`:75`、`:100`、`:120`、`:145`。

**方案含义：**桌面聊天应实现为新 Source，走同一事件路径；UI 的消息 ID、重发和回复位置需要进入正式契约。
“跨信道”必须落实为可核对的来源引用与订阅关系，不能用主题相似度自动拼接两件工作。

## 3. Reply 是统一的目的和地址约束，Worker 可以请求受控确认

Executor 工具列表提供 `orchestrator_ack`，它调用 `engine.reply(purpose: acknowledgement)`，通过同一个 Outbox 发到原消息。
Executor 不具有通用的 `orchestrator_reply` 工具；回答、结果和需要人的问题由主 Session 的回复工具组织交付。
Worker 的结构化报告可带 `human_action`、`question_for_trigger_id` 和 `reply_to_trigger_id`。
常规 progress 留在内部；明确人工问题需要及时转达，不能等到整个任务 blocked 后才处理。

来源：`src/app/tools/executor.ts:23`、`:29`、`:35`、`:80`、`:93`；`src/app/tools/main.ts:1`；`docs/004-prompts.md:84`。

原型要求确认具体且只发一次。Worker 负责确认它即将处理的请求，Router 负责人的任务更新。
因此“Worker 完全不能触发任何人类可见消息”并不符合源码；“Worker 不能绕过目的检查任意向人发消息”更准确。
Worker 在 PR 评审中的回复与处理属于执行工作的一部分，也不应误认为所有代码协作写操作都必须由 Router 逐条生成。

来源：`prompts/replies.md:1`；`prompts/work.md:12`；`src/core/replies.ts:14`。

**方案含义：**保留结构化目的、原始请求引用、发送回执和统一传输；允许确定性的受控确认节省 Router 推理。
跨来源带来的私密内容不能自动复制到公开 GitHub；回复应保持原信道，变更目的地需要明确依据。

## 4. 幂等发送依赖传输实现，Outbox 本身不是外部恰好一次保证

GitHub 发送时在评论中写隐藏的稳定 ID marker；重试先查询已有评论并核对账号及评审根，再决定是否 POST。
评审评论不存在时有回退目标处理；发送端区分永久消失和暂时失败。
飞书使用原消息 ID、`--reply-in-thread` 和稳定的 `--idempotency-key`，发送前检查 IM 字数。

来源：`src/sources/github-channel.ts:17`、`:34`、`:39`；`src/sources/feishu-channel.ts:13`、`:18`、`:22`。

扩展指南明确指出：远端已经收到但本地看到失败时，重试仍不能重复消息；Channel adapter 必须提供相应机制。
失去接收范围的目的地可以终止发送，暂时禁用的 Source 则让消息等待；永久丢弃仍保留回执。

来源：`docs/008-cookbook.md:177`；`src/sources/registry.ts:75`、`:95`。

**方案含义：**每个新 Channel 都必须测试“发送成功但确认丢失”的窗口；不宣称一个 SQLite 事务能跨远端平台保证恰好一次。

## 5. Router 很轻，但原型没有把它实现成绝对无 shell

Router 提示词只允许路由与必要的主动研判，要求转交原始事件和简短路由事实，不追加技术方案、验收清单或自行排查 Worker 阻塞。
明确请求可用一个工具批量路由；候选需要语义评估时才读有界上下文。
attach 必须有明确的 PR、Issue、原消息、确认或唯一近期改动引用，主题类似不足以关联。

来源：`prompts/orchestrator.md:1`；`prompts/dispatch.md:1`；`docs/004-prompts.md:77`、`:82`。

Router preset 仍有受限 read、shell、job 能力，且代码拒绝 sleep 和过长等待，以免当前步骤阻挡新输入。
文章“不配 Bash”是可采用的架构选择，不是官方原型当前实现的事实。

来源：`src/app/sessions.ts:64`、`:70`、`:77`；`cordis.patch.yml:125`。

## 6. 提示词是可版本化配置，不能修改硬授权

团队可编辑 Communication、Ticket scope、Delivery requirements、技能及内置部分覆盖。
配置保存形成不可变版本并携带 base revision；每次模型请求读取最新版本，记录 Session 实际使用的 revision。
生成的 Policy 部分放在末尾，以减少其他前缀变化。修改 prompt 不会改变 gate、Mandate 和工具参数检查。
外部文本是数据，不能通过“请忽略规则”改变这些事实。

来源：`docs/004-prompts.md:9`、`:36`、`:59`、`:94`；`src/app/prompts.ts:15`、`:39`、`:52`。

**方案含义：**采用版本化 prompt 与硬规则分离的机制；原型默认的单仓库 coding 范围、提交账号和 auto-merge 条件应作为部署策略审视，不机械复制为 DS Bot 新产品规则。

## 7. 界面是监督入口，原型没有证明必须以工单看板作为主产品形态

Panel 优先回答“有无需要我处理”“系统是否正常”“一件工作的历史”；健康状态少占空间，问题提供直接动作。
其 Overview、Source、Trigger、Eval、Execution、Settings 是原型的监督投影，不能代替文章讨论的跨信道连续 Agent 体验。

来源：`docs/005-panel.md:5`、`:13`、`:50`。

**方案含义：**保留需要人工回答、验收和修复的最小监督界面；桌面聊天、任务浏览及角色形象的最终布局应另外验证。

## 8. 原型已有外部运维控制回路，但没有证明完整任务语义 Watchdog

部署文档明确要求在操作者另一个 DSH profile 创建 hourly check，使主服务下线时监督仍能运行。
监督 Agent 执行 status：正常静默，组件错误与 setup 问题报告而不重启，服务异常时恢复；必要时读日志并修复。
人工 stop 标记受 `--respect-stop` 保护，不能被自动恢复取消。

来源：`docs/006-deployment.md:133`、`:138`、`:141`；`scripts/dsh-superagent:133`。

这是现成的外部 Agent 运维配方。所读文档和代码没有证明它持续评估 Worker 的实质进展、无效循环或偏离目标。
总体方案应写成“移植外部运维回路，补任务语义监督”，而不是“原型完全没有 Watchdog”。

## 9. 部署与权限不是通用安全隔离

原型要求独立 DSH profile，并且会改变进程级 PATH 和 git 环境；同进程随意混装其他个人 Session 有运行影响。
两种 preset 默认 `danger-full-access`，以操作者 OS 用户运行。CLI wrapper 选择账号，不隔离进程；绝对路径可以绕过命令包装。
部署建议使用独立 OS 账号；准备目录用 shell 执行，不能直接把 tmux/POSIX 运维脚本当作 Windows 服务实现。

来源：`docs/006-deployment.md:5`、`:13`、`:19`、`:21`、`:218`、`:225`；`scripts/dsh-superagent:1`。

**方案含义：**新系统需独立运行 profile/进程并提供 Windows 原生常驻方案；远程设备授权、凭据使用和命令执行权限必须显式设计，不能从原型 wrapper 推导为沙箱保证。

## 读过的测试断言（未执行）

- `tests/registry.spec.ts:23`、`:119`：kind 默认配置、重复注册和销毁；`:137`：只向仍被监听的 Channel 回复。
- `tests/sources.spec.ts:115`、`:125`、`:151`：飞书实时与轮询事件一致、自身消息过滤、订阅话题接入。
- `tests/sources.spec.ts:328`、`:344`、`:403`、`:480`：GitHub 评论与评审归一化、仓库地址检查、PR 绑定、订阅轮询。
- `tests/sources.spec.ts:575`、`:602`、`:623`：逐对象失败重读、404 与已删除区分、坏项目跳过计数。
- `tests/tools.spec.ts:136`、`:166`、`:249`、`:258`：批量路由的逐项拒绝、发送状态、IM 字数检查。
- `tests/prompts.spec.ts:27`：版本保存、重启读取、回滚与 revision 冲突。
- `tests/service-script.spec.ts:145`、`:155`、`:164`、`:182`：组件错误/setup 状态、恢复、控制锁。

这些是测试源码定义的行为证据，不能写成当前环境测试已通过。
