# DS Bot Super-agent 总体实现方案 v1

- 日期：2026-11-02。
- 本文确定本次建议采用的总体技术方案与交付范围，供用户评审；不代表已经实施或通过运行验收。
- 用户已明确：大胆采用 Super-agent 新架构，原有 DS Bot 架构可以替换。
- 范围：完整覆盖文章的连续、高效、主动、持久，以及双层、事件、交互、存算与环境分离、Watchdog 五个模块。
- 本轮只新增本地研究和方案文件，没有修改产品源码、配置、参考原型、分支或远程 Issue。

## 1. 阅读顺序与证据

先读本文确定整体方向；修改事件或授权时读 [领域研究](../../super-agent-references/analysis/domain.md)；修改执行、恢复、持久化时读 [执行研究](../../super-agent-references/analysis/execution.md)；修改来源、提示词、交互或部署时读 [来源与交互研究](../../super-agent-references/analysis/sources.md)。三份笔记含源码位置和已阅读测试索引。

主来源是 [官方文章 Markdown](../../super-agent-references/super-agent%20reference/super-agent.md)，共 321 行。已逐段阅读，并查看总架构图、链式召回图、计算/状态/环境分离图。

官方原型远程 HEAD 为 `6337fc823ce20251c8de8085948165c81aaa701e`。本地 README、package.json、docs/004、docs/006、src/core/intake.ts、src/executor/dsh.ts、src/app/store.ts、tests/core-engine.spec.ts 共 8 个文件，规范换行后与该提交逐字节相同。这是抽样来源核对，不代表整个目录的逐文件完整性验证。

阅读包括原型 docs/000—008 的相关设计、core/app/executor/sources 的关键执行链路、提示词、工具注册、预设和回归测试断言。源码与文档出现区别时以当前源码说明实际行为，并记录产品选择。

### 已执行的有限实验

在当前 Node v25.4.0 下，通过 `node --experimental-transform-types super-agent-references/analysis/core-probe.mts` 直接导入未修改的原型 Engine 与 MemoryRepositories。7 个断言组通过，结果见 [core-probe-results.json](../../super-agent-references/analysis/core-probe-results.json)：

1. 稳定 Trigger ID 去重。
2. 新请求被程序准入拒绝时不进入 Assessor。
3. 重复 accept 复用原 Ticket 与 Assignment。
4. 已订阅人类跟进直通 Worker，Router 重派被拒绝。
5. handback 释放消息归属并允许重新 Eval。
6. 人工停止的 Ticket 不因 CI 或新消息自动恢复。
7. 无待完成交付 Thread 的 ready 结束工作，后续人类消息可恢复同一 Ticket。

实验使用自写的假 Policy、Assessor、Executor、Outbox 和内存仓库，验证领域控制路径；不验证真实来源策略、SQLite、DSH loop、模型或网络。未安装依赖，未运行原型完整 vitest、DS Bot 全量检查或真实服务。首次运行因实验脚本导入路径错误失败，修正仅涉及该脚本，随后 7 组全部通过。

## 2. 产品目标与架构决定

用户面对一个连续的 Super-agent。底层 Session、Worker、重试和设备选择由系统管理，用户仍可查看具体执行依据并中途改变方向。

采用以下总体方案：

1. 以官方原型的领域规则和执行生命周期为基础移植、适配，避免重新发明一套简化任务队列。
2. 新运行核心作为独立、类型明确的 TypeScript 内核和 DSH bundle；仍使用 DSH 的原生 agent loop、Session、工具与模型路由。
3. 保留 DS Bot 桌面壳、模型设置、可用工具能力及部分交互，通过适配接入；新输入只有一个调度入口。
4. 一个上下文共享域先采用一个逻辑 Router；多个独立 Worker 并发执行。Worker 内部可用 DSH Subagent 或 Agent Team。
5. 部署支持单机常驻和服务器常驻，两种形态共用逻辑模块。完整交付包含服务器持久在线、独立状态后端及个人设备 daemon。
6. 开发与单机基线使用 SQLite；服务器共享状态采用 PostgreSQL。领域存储和 Session 存储分别实现相应适配器，单写所有权由部署与存储协议共同保证。
7. 首个界面采用统一聊天入口与按需监督视图。任务对象用于授权、恢复和追踪；主界面不预先锁定为工单看板。
8. 首个真实外部来源采用 GitHub；飞书和定时来源沿相同接口接入。多来源实例的标识在初始 schema 中确定。

TypeScript 内核与 bundle 是模块拆分，不要求把每个模块拆成独立网络服务。旧 JavaScript 功能只在适配需要时改动。

文章依据：第 1 节（29—42 行）、第 2 节（58—95 行）、第 5 节（205—227 行）、第 8.2 节（285—291 行）。存储产品、包布局和交付顺序是本项目的工程决定，不是文章规定。

## 3. 领域词汇与职责

| 名称 | 本方案中的含义 |
| --- | --- |
| Super-agent instance | 一组可以共享上下文的服务范围。彼此隔离的私人/团队范围使用不同实例 |
| Source kind / instance | 可复用的来源实现 / 一份具体账号、仓库或聊天范围配置 |
| Trigger | 一个稳定标识的不可变环境事件；正文和引用按外部数据处理 |
| Thread | 来源原生的连续讨论流；可关联多项工作 |
| Subscription | Thread 与工作之间的多对多信息投递关系 |
| Eval / Decision | 对新请求或重新交回请求的研判过程 / 记录的决定 |
| Policy / Mandate | 当前接单规则 / 某项工作的授权依据与范围 |
| Ticket | 一项持久的授权工作。名字沿用原型，不要求用户学习“工单”概念 |
| Assignment | Ticket 与一次执行安排的绑定；可以更换而保留 Ticket |
| Worker Session | 执行任务的 DSH 上下文；通常在多次 Assignment 间复用，换代需显式交接 |
| Execution environment | 文件、工具链、命令和其他能力实际执行的设备与工作目录 |
| Report / Attention | 结构化进展或结果 / 等待人回答的明确问题 |
| Effect / Outbox | 已提交但待执行的操作 / 带回执的待发消息 |

来源：原型 docs/001-domain.md、src/core/model.ts、src/core/ports.ts；扩展的 instance 标识见第 5 节。

## 4. 采用原型的机制，以及必须纠正的简化理解

### 4.1 Router 轻，Worker 深入任务

Router 保持全局连续性、批量分派与跨任务协调；Worker 阅读原始请求、调查、设计、执行与验证。Router 不把短请求改写成自己发明的实施规格。

Router 使用有限工具集，Worker 使用工作所需工具。文章提出 Router 可以没有 Bash；原型实际仍带受限 read/shell/jobs，并用 no-wait 规则限制阻塞。新 Router 优先使用结构化查询和路由工具，必要运维调用显式受限；验收职责和响应能力，不以“有没有 shell”代替职责验证。

来源：文章 70—95 行；原型 prompts/shared.md、dispatch.md、src/app/sessions.ts:59、cordis.patch.yml。

### 4.2 分开“接收上下文”和“批准新工作”

实际入站主线：稳定 ID 去重与 SourceScope 检查 → 记录事件及 Thread → 向订阅者 fan-out → 未被既有 Worker 拥有的请求进入 Eval → Gate 与必要语义研判 → 记录 Decision → 建立或关联工作。

已有工作自有 Thread 上的人类跟进由 Worker 判断。存在 owner 时 Router 不能重复 accept/attach/ignore/requeue；符合授权的 stop 是例外。所有 owner handback 后才能重新 Eval。机器人/CI 可同时作为既有任务上下文和新候选，受候选策略约束。仅供上下文的订阅不授予新权限，也不恢复已结束工作。

因此，不把“所有事件先通过新任务白名单”接在订阅直通之前；仍检查来源接收范围，Worker 工作维持在原 Mandate 的范围内。Policy 变化使当前 Eval 失效重排，仅通知受影响的 live Ticket，不自动取消；ended Ticket 恢复前重新校验 Mandate。不得把这套机制实现成每条订阅输入重走新任务 Gate。新加入来源时，来源原生身份必须能追溯，正文不能修改账号、规则或执行权限。

来源：src/core/intake.ts、model.ts:69、part.ts、evals.ts；详见领域研究。

### 4.3 统一对外由受控通道保障

主要结果、人工问题和对外更新由 Router 组织。Worker 可以通过窄接口请求发送对原始请求的确认；它经相同 Engine/Outbox 检查和去重，不需要每次再唤醒 Router LLM。

关注消息用途、原始目标、当前状态和回执。普通 progress 留在内部；人类问题结构化为 Attention；result 由当前 ready 报告或已结束的 completed/merged/dropped 结果授权，是否需要通知仍依沟通规则判断，dropped 通常静默。确认、回答回原消息，交付回原发起信道，保持跨信道关系而不任意复制私人内容。

来源：src/app/tools/executor.ts、main.ts、src/core/replies.ts、prompts/replies.md。

### 4.4 执行与恢复保留完整状态机

Ticket、Assignment、Session、turn、job 分别有生命周期。重试通常创建新 Assignment 并复用原 Session 与目录；ready 不总等于 Ticket 结束，绑定 PR 的工作继续跟踪交付条件。

并发槽包含准备目录、启动、活跃回合和回合后仍运行的后台工作。人工消息有优先唤醒机制。交给人验收时释放槽、结束相应子代理，可保留预览服务；Assignment 结束时按归属清理后台工作。

Input 投递成功、进入 Session 历史、被后续执行承接分别记录。恢复要处理未读输入和旧 inbox 副本。停止是持久事实，CI 和监督器不能自行解除人的停止。

Effects 与 Outbox 可靠排队不代表远端恰好一次。适配器必须使用幂等键、稳定 marker 或对账；外部结果未知时先验证现状。进程崩溃后的恢复不保证 shell 从原执行点续跑。

来源：docs/003-execution.md、src/executor/dsh.ts、background.ts、src/core/assignments.ts、src/app/delivery.ts、effects.ts、outbox.ts。

### 4.5 提示词是受版本管理的行为配置

保留角色分工、团队沟通/范围/交付规则、按需技能、内建默认与覆盖值的版本及升级差异。记录每个 Session 使用的版本，更新在明确的模型请求边界生效。

自然语言规则不替代 Gate、Mandate、工具限制和消息用途检查。原型的 coding/PR、200 行自动合并等默认是具体部署约束，按本项目的授权和仓库规则重新配置。

来源：docs/004-prompts.md、src/app/prompts.ts、versions.ts、tests/prompts.spec.ts。

## 5. 新核心的模块接口与数据边界

### 5.1 模块

| 模块 | 对外职责 | 实现依据 |
| --- | --- | --- |
| Domain Engine | 接收事件、决定、任务操作、执行事实回报 | 原型 core 的五部分；保持唯一领域写入口 |
| Runtime | 装配、锁/所有权、启动、关闭、配置 | 原型 app/runtime 与 passes |
| DSH Session adapter | 创建/恢复 Session、角色工具与提示词、输入与取消 | 原型 sessions/delivery/executor；继续用公开 DSH loop |
| Sources and Channels | 接收、游标、原生 Thread、上下文读取、可靠发送 | kind/registry/host 机制，扩为实例化配置 |
| Execution adapter | 任务目录、并发槽、作业与设备能力 | 本地 adapter 与远程 adapter 共享控制语义 |
| Storage and Effects | 事务、查询、待执行操作、回执 | SQLite 单机与 PostgreSQL 服务器 adapters |
| Client and read models | 统一对话、人工问题、结果、按需监督 | 复用 DS Bot 界面能力，读模型可从持久事实重建 |
| Watchdog | 外部运维与任务语义监督 | 原型已有运维配方，加任务进展监督 |

### 5.2 初始 schema 就确定的标识

- 所有持久对象属于 `instanceId`。
- 来源身份分为 `sourceKind` 与 `sourceInstanceId`；Thread/Trigger/Channel 包含来源实例与原生标识，编辑事件加入原生版本。
- ActorRef 与 Policy 的来源配置也按 `(instanceId, sourceInstanceId, nativeActorId)` 定位；允许清单和机器人清单不因两个来源账号使用相同原生 ID 而共享权限。
- GitHub 资源保留 host、owner/repo、资源类型及编号；跨来源关联必须保留实际引用与来源证据。
- Ticket/Assignment/Input/Effect/Message/Environment 使用各自稳定 ID，回调携带所属 Assignment 代次。
- 按内容相似度查找只提供候选，不直接建立整个 Thread 的订阅。显式引用或唯一且有证据的指代才能关联，保留为何关联的记录。

原型 SourceRegistry 实际按 kind 保存一个实例，GitHub Thread 用 `github:<number>`，不能直接覆盖多仓库。新命名空间从第一版建立，首个真实 GitHub adapter 可先启用一个仓库，契约测试必须用两个实例验证不串号。

### 5.3 两套持久状态

业务状态保存事件、授权、任务、输入消费、订阅、报告、Effects、Outbox 和配置版本；DSH Session 状态保存模型对话与工具执行历史。迁移业务库不自动迁移 Session。

单机采用 SQLite 与 DSH 已提供的 Session 持久化后端；服务器阶段同时接入共享业务存储与符合公开 SessionPersistence 合约的后端。业务与 Session 之间用稳定消息 ID、flush 与启动对账衔接，不宣称两者天然构成同一个 ACID 事务。

原型仓库方法和 Engine 同步，不能把 PostgreSQL 仅替换成连接字符串。新公开命令/存储接口采用异步合约，内部纯状态规则尽量保持同步且可独立验证；适配时保留原行为回归集，并单独验证事务中的副作用排队。T0 验证该接口，不先整体改写所有原型文件。

## 6. 计算、状态、环境的正式部署

正式形态为常驻 Host（Router/Worker DSH loops 与 Sources）＋独立状态后端＋桌面客户端＋设备 daemon。先采用单个活动 Host，备用 Host 可替换；同一实例不同时存在多个无协调 Router。

桌面客户端与 Host 之间使用认证、按实例授权和受保护传输；原型仅 loopback 的管理接口保持运维范围，通过专门的远程客户端接入层开放所需操作。客户端断连不终止已授权工作，重新连接按游标补读结果，撤销客户端权限不授予或改变 Worker 权限。

后续扩展计算副本时，业务任务和 Session 都要有可验证的写所有权、租约与 fencing；旧执行者失去归属后不再提交有效回调。数据库隔离和部署排他先满足契约，再考虑横向扩容。

设备端保留实际文件、工具链、工作副本和执行所需作业记录，Agent 会话历史保存在 Host/存储侧。工具请求明确 Environment 与工作目录；文件读取/写入、glob/grep、shell/PTY、输出、取消必须指向同一执行世界。附件/spill/技能加载等跨界路径单独核对。

公开接口已有可替换 `ctx.fs`、`ctx.subprocess` 和 SessionPersistence 的依据；尚未在本项目实际运行远程实现。远程 daemon 需要设备认证、授权范围、可撤销连接、作业对账和有界输出。MCP、浏览器和 Office 首先保持本地能力适配，声明运行位置；未通过远程契约的能力不标成跨设备可用。

参考 DSH `dsh-v0.2.1-rc.4` 的官方 [文件接口](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.1-rc.4/packages/fs/fs/README.md)、[子进程接口](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.1-rc.4/packages/subprocess/subprocess/README.md)、[搜索工具](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.1-rc.4/packages/fs/tool-fs-search/README.md)、[Session 存储接口](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.1-rc.4/packages/session/session-persistence/README.md)。搜索工具经 subprocess 执行，不能只替换文件后端就宣称搜索已远程化。

## 7. 主动性、长期连续性与 Watchdog

主动执行依赖明确、版本化的规则：off/observe/auto；explicit 请求不受 proactive 开关替代。observe 记录 would-accept，auto 才开始规则允许的实际工作。投机任务在隔离执行目录中按预算提前研究、复现和准备可审阅结果。没有可用结果时静默结束；发布、合并和发送外部消息按各自权限判断。

上下文由小卡片、邻近原文、关联 ID、全文续读和多跳资源读取组织。缓存、历史压缩和 Session 换代不会删除原始证据。第一版支持任务级持续工作与有依据的恢复；跨月长期记忆作为独立评估问题，不能用引用图宣称已经解决。

Watchdog 分两部分：

1. 外部运维回路：借鉴原型另一 profile 的 hourly Agent 配方，检查服务、分类错误、恢复并尊重人工 stop。Windows 使用原生受控进程/服务管理，不依赖 tmux 脚本。
2. 任务语义监督：独立 Session 对比目标、关键报告、工具与交付证据、连续多次状态变化，判断是否循环、偏离或无进展。输出结构化观察与恢复提案；可自动查证与安全重试，但任务纠偏和暂停前须取得用户决定。维护者可明确指令在线修改版本化提示词/规则，不授予监督器任意自主改写权限，每次留下依据与记录。

监督器自身也有动作预算，避免恢复循环。已有明确人工停止不会被基础设施自动重启撤销。提示词或规则变更采用版本化、可追溯的更新，不自动取得新的工作或设备权限。

原型已有运维回路：docs/006-deployment.md:133—141、scripts/dsh-superagent；目前未验证其具有文章所述 Worker 实质进展监督。

## 8. 权限、信道与界面

每个实例是上下文共享边界；私人实例与团队实例隔离。跨实例 A2A、自动全局身份映射和组织级上下文共享留作后续独立设计，首版不把内容相似当成授权证明。

来源范围、任务授权、工具执行权限、设备权限、外部发布权限分开。原型默认 danger-full-access，CLI wrappers 只是账号默认选择，不能视为系统沙箱。沿用 DS Bot 已有的用户授权与凭据管理能力时重新映射到 instance/role/environment，不能因去掉 Bot 模型而丢失保护。

初始产品：统一对话持续协作；就地回答结构化问题；结果含可用交付与验证依据；监督视图优先显示需要人的事项，并提供来源、为什么开始、当前执行与恢复记录。Worker transcript 按需展开，保持对外低干扰。

角色配置可以保留名称、模型、技能和专长；它不再决定一项工作只能挤进某个长期私聊 Session。多角色拟人化、完整看板和新视觉语言不阻塞核心验收。

## 9. 实施顺序与依赖

下表是总体交付切片，尚未发布到 Issue tracker。每项都要在具体规格中进一步控制到单个新上下文可完成的大小；不能把一个里程碑直接等同于一个超大 PR。

| 切片 | 前置 | 完整交付行为与完成依据 |
| --- | --- | --- |
| T0：基线与接口实证 | 无 | 建立 fork 集成基线、固定 DSH 版本与独立 mock 环境；验证角色预设、后台唤醒、异步事务/Session flush、fs/subprocess 作用域。公开接口不足时记录阻塞点 |
| T1：统一入口到结果 | T0 | desktop Source 接收请求，持久 Decision/Ticket/Assignment，隔离 Worker 执行，统一 Outbox 返回结果，最小界面可检查依据 |
| T2：讨论继续与叫停 | T1 | 订阅直通、多 owner handback、context-only、自然恢复、人工 stop；不重复建任务且消息不丢 |
| T3：并发与全双工 | T2 | 多任务、Thread Eval 批次与 Router inbox 批处理、后台命令/子代理、人工优先输入和取消；慢任务不阻塞独立请求 |
| T4：恢复与可靠交付 | T3 | 在提交/启动/投递/读取/报告/发送窗口注入故障；恢复未读输入，核查未知外部结果，清理旧 Assignment 作业 |
| T5：GitHub 实际闭环 | T2、T4 | Issue/PR/评审/CI 输入、PR 绑定与关闭、回原始桌面信道交付；重复和乱序输入有可解释结果 |
| T6：跨信道召回与换代 | T5 | 从真实引用关联讨论，链式读取全文与执行依据，换 Session 后继续；桌面 A→PR B 的方向修改被正确采用 |
| T7：主动观察与提前执行 | T3、T4、T6 | 接入飞书/定时来源，规则 observe→auto，隔离投机执行，有预算、有价值才交付 |
| T8：外部监督与自愈 | T4 | 先完成独立运维回路，再接任务语义监督；进程宕机和假存活循环均可识别，人工停止保持 |
| T9：个人设备执行 | T0、T4 | 接入第二台测试设备，文件/搜索/shell/输出/取消路径一致，断连后可对账并恢复；设备端不保存模型会话 |
| T10：共享状态与计算替换 | T0、T4 | PostgreSQL 业务和 Session adapters 通过合约，跨进程所有权可证明；替换 Host 后任务和上下文连续，旧 Host 回调无效 |
| T11：正式部署与旧核心退出 | T6—T10 | 服务器常驻+桌面客户端+设备 daemon+独立 Watchdog；客户端认证/实例授权/传输/补读、Windows 原生体验、历史导入及唯一调度路径通过验收 |

里程碑：T1—T4 为本地机制闭环；T5—T7 为真实多信道与主动闭环；T8—T10 为持久在线与环境分离；T11 为完整产品交付。T9/T10 可在依赖满足后推进，不必等 T7。

T1 含基础持久化、稳定 ID、全文指针和最小恢复；T4 是系统故障覆盖。T2/T3/T6 分别把订阅、异步交互、召回扩展到完整场景，不能在之前用临时不可恢复队列替代它们。

## 10. 验收矩阵

| 目标 | 必须验证的场景 |
| --- | --- |
| 连续 | 桌面发起、PR 改方向、Worker 换代、自然结束后恢复；原始约束、关联依据和未读输入仍在 |
| 高效 | 并行两个独立工作；突发噪声与请求混合；长命令期间接收修正；人工输入不被自动事件长期饿死 |
| 主动 | 候选有规则与证据；observe 不执行；auto 能静默准备结果；无效事件、机器人反馈不会自发扩大授权 |
| 持久 | 关闭 UI、替换 Host、数据库短时失败、设备离线/上线；人工停止不被恢复器撤销 |
| 恢复 | 各提交/投递/外发窗口中断，输入不丢、不会宣称未证实成功，外部未知结果按协议核查 |
| 隔离 | 两个来源实例同编号不串线、同原生用户 ID 不串权；两个任务目录不混写；客户端按实例授权、可撤销；不同上下文实例不互读；过期 Assignment/Host 被隔离 |
| 监督 | 服务崩溃、服务健康但 Worker 无效循环、Worker 等设备正常等待，监督器分别正确处理 |

观测指标：输入受理与响应延迟、完成时间 p50/p95、Router 调用次数与批次大小、直通比例、token、重复执行与重复通知、恢复耗时、主动误触发与有效交付。具体阈值由基线实验后写入切片规格，不直接套文章的合成实验数字。

三层证据分开：领域与 adapter 契约测试；隔离 DSH mock 集成与故障演练；小规模真实模型、真实信道和 Windows 原生验收。源码中有测试断言不等于测试运行通过。

## 11. DS Bot 迁移与工程交付

旧团队、群聊、记忆和会话先作为只读历史保留，按明示映射导入角色配置与可共享记忆。旧未完成派活在切换时核查状态，再决定是否建立新 Ticket；不自动把旧 works 转成一批会再次执行的任务。

新模式启用时旧入口退出同一输入的消费，避免双重执行。迁移采用副本/新数据目录，保持用户原 DSH 数据只读；本轮无数据迁移。

移植原型代码前登记 MIT 来源、保留版权许可并更新 NOTICE。原型提示词中具体团队流程、账号规则、单仓库假设和自动合并策略按本项目重写/配置。新增核心保持类型检查和可独立测试，现有前端生成规则继续执行。

代码阶段从明确的 dev 集成基线创建 feat/fix 分支，PR 进入 dev。当前 fork 只有 main，需先建立并确认集成基线；本轮未改分支。实际提交按仓库模板、单测、client 一致性、lint、host smoke 及真实界面证据交付。

## 12. 按 ask-matt 进入后续工作的方式

本轮完成研究与总体方案，研究笔记是证据入口。接下来把本方案压成可验证规格，再将 T0—T11 拆成一票一项完整行为，声明阻塞关系，按依赖实施与评审。

不需要再次决定是否采用 Super-agent 或是否允许替换旧架构。需要具体环境信息时再收集服务器、设备与来源账号配置；这些参数不阻塞当前架构。

若 T0 的事实验证推翻某个接口假设，更新对应决定与依赖；不以修改 DSH 安装文件绕过。Router 分片、跨实例 A2A、跨月记忆质量和全面组织级安全属于文章明确开放的问题，形成独立设计与评估后扩展，不作为已完成能力描述。

### 监督权限后续定案

[已确认的监督权限](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/8#issuecomment-6577190186)：默认每小时独立检查，故障服务按参考优雅重启，尊重人工 stop，部件错误/缺 setup 不重启、不强杀；健康及恢复成功静默，相同错误去重。任务纠偏/暂停先问用户，未知结果先对账。完整权限与验收以行为规格 D15/D16/A24 为准。
