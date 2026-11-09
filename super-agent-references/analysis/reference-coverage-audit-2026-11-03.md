# 官方 Super-agent 资料覆盖审计

日期：2026-11-03。对象：官方文章、固定 prototype 与当前 v2 规格、55 张实施票草案。结论：核心架构已吸收，尚有 8 组行为细节未形成充分明确的规格或验收；不能称为全部吸收。

## 范围与依据

- [官方文章](../super-agent%20reference/super-agent.md)：321 行，按第 1—9 节及其子节核对。
- [官方 prototype](../dsh-superagent-prototype/README.md)：固定提交 `6337fc823ce20251c8de8085948165c81aaa701e`。核对 docs/000—008 的行为说明、007 的模块/测试目录、下列发现对应源码和相关测试标题/断言。不是逐行审查全部 216 个受版本管理文件，也不是完整测试集运行。
- [当前正式规格](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/1)：本轮实时读取正文。最后更新时间：2026-11-03T12:01:13Z。正文 LF 规范化 SHA256：`4e9b650ca610b7c38af84d10ce99b230ec8c8d15f2ba9bfaa2b6a7a5ebf3e908`。
- [实施票草案](../../docs/superagent/tickets-draft.md)：55 张，待批准。功能父票组织仍为对话建议，未作为已落地的 Issue 树验收。
- 既有领域、执行、来源三份研究提供重点机制分析；v2 的十二项决议矩阵证明决议已进入规格，不自动证明官方所有行为均已覆盖。

这里“覆盖”只表示可在规格/票中找到对应承诺，不表示功能已实现。缺口表示现有承诺不够明确，不能证明开发者一定会保留原型相应行为。本轮不扩大首版范围，不直接修改正式规格或实施票，也不运行产品、模型或设备测试。

## 官方文章逐节映射

| 文章位置 | 机制 | 规格 | 实施票 | 判定 |
| --- | --- | --- | --- | --- |
| §1 | 连续、高效、主动、持久四目标及五模块 | Solution、D01—D19、A26 | T55 及各行为票 | 核心已覆盖 |
| §2、§2.1 | 轻 Router、隔离 Worker、批处理及全局协调 | D01、D04、D08 | T02、T05、T11、T13 | 已覆盖架构；Router 通知合并细节见 F03 |
| §2.2 | Worker 原始证据、工具、内部子代理/Team、统一对外 | D01、D08、D10 | T02、T03、T13、T18 | 已覆盖 |
| §3.1 | 程序准入 Fast Path 与语义 Slow Path | D04、D06 | T05、T10 | 已覆盖两级；准入表细节见 F01 |
| §3.2 | Thread 多对多订阅、直通、交回 | D03、D05 | T06、T07、T27 | 已覆盖主路径；人工控制见 F02 |
| §3.3 | Inline/Spill、邻近上下文、链式召回 | D11 | T21、T22、T37 | 已覆盖；角色可读范围见 F04 |
| §3.4 | 预算内投机准备，有价值才交付 | D06、D15 | T28、T29 | 已覆盖 |
| §4.1 | 异步启动/停止与完成事件，全双工 | D08、D14 | T11—T14、T33—T35 | 已覆盖，真实运行待验收 |
| §4.2 | IM 简短低打扰，异步信道结构化交付 | D10、D17 | T18、T26、T31 | 原则已覆盖；100 词等具体原型默认尚未确定为本项目硬阈值 |
| §5.1 | 计算与 Session 状态分离 | D09、D13 | T15、T20、T42—T44 | 已覆盖，并扩展写权/提交对账 |
| §5.2 | 计算与真实环境分离、BYOM、daemon | D14、D19 | T32—T41 | 已覆盖，第二设备及故障证据仍待实施 |
| §6 | 独立运维/语义 Watchdog，受信在线配置 | D12、D16 | T47—T49 | 已覆盖；干预权限按项目决议适配 |
| §7.1 | 单 Session/双层/去直通的调度消融比较 | Testing Decisions 性能标准 | T54 | 已覆盖比较方向；无需复刻官方实验数值 |
| §7.2 | Router 批处理负载与成本测量 | D01、Testing Decisions | T05、T54 | 已覆盖指标；通知合并验收见 F03 |
| §8.1 | Router 分片、专项训练、跨月记忆问题 | D11、Out of Scope | 明确延期 | 已处置，不当作首版缺失 |
| §8.2 | 隐藏 Session、领域交互、中途干预 | D07、D17 | T08、T09、T24、T27 | 已覆盖方向，实际体验另验收 |
| §8.3 | 上下文共享边界、跨实例 A2A | D03、D17、Out of Scope | T04、T45；A2A 延期 | 实例隔离已覆盖，A2A 明确延期 |
| §8.4 | 不可信内容、凭据、设备授权与信任 | D03、D06、D14、D17 | T03、T04、T21、T32、T38、T45 | 原则已覆盖，不声明通用安全问题已解决；角色读取见 F04 |
| §9、文末说明 | 研究方向与参考原型，非正式产品 | Further Notes、证据边界 | 公共交付条件 | 已保留研究/产品证据区分 |

## prototype 文档与行为映射

| 官方文档 | 已进入规格/票的部分 | 仍需补清楚 |
| --- | --- | --- |
| 000 Philosophy | 按授权行动、低打扰、结构化问题、诚实交付、少设置 | 没有发现需要新增一套架构的遗漏；具体工作流默认按项目授权适配 |
| 001 Domain | Source/Trigger/Thread/Eval/Mandate/Ticket/Assignment 分离、fan-out、生命周期 | 订阅撤销及人工重评 F02，跨任务 note F03 |
| 002 Authorization | 两条输入路径、显式/推断、off/observe/auto、Policy 变化和恢复校验 | 准入表/成员同步 F01，人工重评/忽略问题 F02 |
| 003 Execution | 并发槽、异步作业、准备目录、ready/PR、停止、恢复、Outbox | 来源逐项失败与游标 F05，prepare/setup 具体失败边界 F07 |
| 004 Prompts | 角色配置、覆盖来源、版本、revision、升级差异 | 模板/大小校验及异步保存竞争 F06；规则条款具体优先级 F01 |
| 005 Panel | 先显示需要人的事项，依据可追查，实际操作和真实状态 | 重评/撤订阅/忽略不可用问题 F02；setup 与分项健康 F07 |
| 006 Deployment | 独立 profile、DSH 公开入口、常驻、外部 Watchdog、权限和凭据 | setup 前置与改账号检查 F07，升级备份/新 schema 拒绝 F08 |
| 007 Architecture | Engine 唯一领域入口、窄接口、Effects、Source、Session、卡片/读模型 | 角色资源范围 F04，通知/跨任务工具 F03，schema 生命周期 F08 |
| 008 Cookbook | kind/instance、稳定映射、受信身份、Channel 幂等、上下文、插件生命周期方向 | 默认空接收范围、逐项错误、cursor、abort F05/F07；Source 配置验证不等于完整来源契约 |

## 发现与最小补充建议

### F01 准入表、规则评估及名单同步只覆盖了概要

- 当前：D04/D06、T05/T10 表达了 Gate、授权及模式，但没有列出接收 scope、是否在名单、是否直接寻址的准入组合；没有明确启动/手动成员同步及同步竞争。
- 官方证据：[002 Authorization](../dsh-superagent-prototype/docs/002-authorization.md) 的 Admission、Bots、Accept mode、Revalidation；[008 Cookbook](../dsh-superagent-prototype/docs/008-cookbook.md) 第 7 步；`src/app/settings.ts:231—249`、`tests/settings.spec.ts:44—86`。
- 影响：实现可能退化成单一白名单；或同步的旧结果覆盖人工新配置。每条启用规则应有判断，匹配规则的流程/沟通条款也没有明确落到验收。
- 建议落点：T05/T10 明确准入组合与 matched rules 的范围/沟通条款，T30 补名单同步入口、来源原生身份、revision 竞争及有界失败重试；不强迫所有来源必须有自动同步能力。

### F02 缺少订阅与研判的人工处置闭环

- 当前：T07 有 handback/context-only，T05 有 unavailable 重评，但缺少人撤销 Thread 订阅、Worker 标记无关 Thread 的边界，以及人工把仍有 owner 的消息送回 Eval、dismiss 不可用问题。
- 官方证据：`src/core/engine.ts:145—155`、`src/core/tickets.ts:185—193`、`src/core/evals.ts:193—198`；`docs/001-domain.md` Subscription；`docs/002-authorization.md` Handing back；`docs/005-panel.md` Reading individual records；`tests/followups.spec.ts:284`。
- 影响：用户不能纠正错误归属或消除已处理的不可用告警；也可能误把退订当作撤销已接收消息的 ownership。
- 建议落点：T07/T24 增加人工退订/重评/dismiss 与 Worker 无关订阅操作。保留原始和 Source 绑定 Thread 的保护；退订不追溯清空既有 ownership，人工 override 与 Router 自行 requeue 权限区分。

### F03 Router 通知合并、状态请求与跨任务事实传递不够明确

- 当前：D01/D04、T05 覆盖候选批处理，D08 提到状态请求优先，但没有落实对应命令；也没有明确报告/跟进进入 Router inbox 的合并与按序可靠传递。
- 官方证据：`docs/007-architecture.md:29—42,233—241,490—503,581—594`；`src/core/tickets.ts:150—154,395—400`；`tests/followups.spec.ts:103—132,157—177`。
- 影响：可能只批量处理同 Thread 的 Eval，却对跟进/报告逐条唤醒 Router；跨任务协调只能依赖泛化提示词。
- 建议落点：T05/T11 验证 Router 忙时积压通知在后续 step 合并，T17 验证 relay/notice 顺序与恢复，T07/T24 增加受限状态请求及跨任务 note（只给事实、不增授权）。不承诺直通意味着 Router 零模型调用。

### F04 同 Instance 内 Worker 的可读资源范围未具体化

- 当前：D17 和 T21 有权限检查，T04/T45 有实例隔离；没有明确 Worker 只能读取其工作及合法关联资源，响应页面也不能泄露其他工作或 Decision 的标识。
- 官方证据：`docs/007-architecture.md:64,550—575`，尤其 573；`src/app/resources.ts` 的角色资源读取以及 `tests/tools.spec.ts` 的角色读取用例。
- 影响：即使没有跨 Instance，通用 read 接口仍可能给任意 Worker 暴露无关工作的对象、历史或配置版本。这里发现的是规格边界缺失，不是已确认的生产越权漏洞。
- 建议落点：T21/T23 明确 Router/Worker/人类客户端的查询范围及版本可读性，以直接猜 ID、分页关联 ID 和 transcript 作为负例；由 Router 有依据地转交必要事实。保留当前工具位置与凭据规则。

### F05 来源游标、局部错误与订阅轮询缺少明确故障验收

- 当前：T25/T30 有“保存游标、断连补读”，但未写接收成功后才推进 cursor、单项失败不吞整页、部分 Thread 失败不阻塞其他 Thread、404 不等于已删除，以及结束后订阅的监听期限。
- 官方证据：`docs/003-execution.md` Source failure；`docs/008-cookbook.md:299—328`；`src/sources/poll.ts:6—28`；`src/sources/github.ts:155—164,315—341`。
- 影响：最危险的实现是先推进 cursor 再保存输入，导致中断丢消息；另一种是把读取 404 当删除，或一个坏记录永久卡住来源。
- 建议落点：T25/T30 明确持久接收和游标顺序、中断重放、迟到写入重叠、畸形项目计数、逐 Thread 错误/恢复及 abort+await。结束后继续监听的期限需记录选择，原型两周/五秒回退/24 小时放弃不是自动采用的产品常量。

### F06 提示词验证和异步配置保存竞争尚未落到验收

- 当前：T23 有版本冲突、草稿和升级差异，但未列模板必需占位符、未知 part/保留技能名、总大小上限、移除旧覆盖及设置检查期间的竞争。
- 官方证据：`docs/004-prompts.md` Built-in parts、Versions；`src/app/prompts.ts:164—192`、`src/app/settings.ts:148—176`；`tests/prompts.spec.ts:93,164,178,204,227`，`tests/settings.spec.ts:18—57`。
- 影响：配置可以保存却无法正确组装；异步模型/账号检查后旧保存可能覆盖较新的设置。
- 建议落点：T23 增加上述校验及请求边界证据，T10/T25/T30 的异步配置保存二次核验 revision，T49 复用同一验证入口。具体模板布局不强求复制原型。

### F07 首次 setup、来源生命周期和分项健康缺少直接承担

- 当前：T25/T30 写“配置授权来源”，T47 依赖 setup/部件错误分类，但前面的票没有明确完成 setup 校验、Check again、部分来源失败隔离及 health 单写归属。
- 官方证据：`docs/006-deployment.md:143—148,181—207,216—227`；`docs/007-architecture.md:29—42,255—274`；`docs/008-cookbook.md:75—79,252—291`；`tests/health.spec.ts`、`tests/deployment.spec.ts`、`tests/settings.spec.ts`。
- 影响：来源可能在账号尚未核验时启动；一个可选来源错误导致全局不可用；Watchdog 收不到可靠的“服务故障/部件错误/缺 setup”区别。
- 建议落点：T03 补准备目录失败/重试和相同执行环境，T25/T30 补来源默认空范围、账号核查、setup readiness、停止时 abort 并等待；T24/T46 补 setup 操作和分项健康。凭据验证复用本项目保护，不照搬全局 PATH/git 修改或 danger-full-access。

### F08 升级、备份与不支持 schema 的恢复边界不完整

- 当前：T42 提到 PostgreSQL schema 初始化/升级，T46 保留安装/更新边界，T50—T53 是旧核心切换；这些没有覆盖新核心自身以后升级失败或旧版本打开新 schema 的情形。
- 官方证据：`docs/006-deployment.md:233—246`，`docs/007-architecture.md:450—486`；`tests/migration.spec.ts`。
- 影响：可能有旧核心切换协议，却仍在日常升级中打开未知 schema、丢配置或无法安全回退。
- 建议落点：T17/T42 明确 schema 版本、兼容范围、过新版本拒绝与升级中断恢复；T46 增加业务/Session 两类状态的备份与恢复核验、preset 兼容和配置覆盖保留。回退前仍先对账副作用，不把备份恢复等同于回滚外部世界。

## 已有意适配或延期，不列为遗漏

1. 官方原型的 stop 撤销 Mandate，后续新工作通常重新 accept；本项目经用户决议允许明确 resume 保留 Ticket 并新建 Assignment、重新核验授权。不是可随意照抄原型 stop 测试的地方。
2. 官方原型采用同步 SQLite atomic；本项目显式异步 Tx、PostgreSQL、提交未知和多层 fencing 是已确认扩展，应保留。
3. 单仓库、单一来源配置、POSIX/tmux 脚本与默认 danger-full-access 不直接移植；本项目多实例、Windows、本地/远端选择和实际权限分别适配。
4. 文章描述任务语义 Watchdog，公开原型只足以支撑已有运维配方；T48 单独实现/验收语义监督是必要补足，不能说 prototype 已经实现。
5. Router 分片、跨实例 A2A、专项训练、跨月长期记忆明确延期。文章实验数值、所有 UI 页签和 200 行自动合并默认无需原样复制。
6. prototype 的既有 Session 通常保留创建时模型；本项目 T23 将模型/配置请求边界作为验收。模型切换的 DSH 支持与记录仍须该票核验，不能假定已有 Session 改设置即可生效。
7. 原型无旧记录清理机制；本规格保留原始证据，没有擅自删除的计划。无限增长是容量/保留策略的后续问题，不能通过这次审计自行增加自动清理行为。

## 审计结论与后续

- 文章的核心模块及主要机制都有落点，没有发现需要推翻已定架构的遗漏。
- 不能宣称 prototype 所有行为已吸收。F01—F08 是具体规格/票验收缺口；其中 F04 的角色读取边界和 F05 的游标推进顺序优先补明确。
- 最小处理是把补充项放进上述现有票与相应 D/A 的后续修订，不必先扩成新的大型功能。若某项明确不采用，应记录理由，不能留在“隐含已经支持”的状态。
- 本轮只新增审计记录与资料索引；没有更改远程 Issue、正式规格、55 张票或产品行为。历史实验没有重跑，不能写成审计后已修复/全量通过。

## 后续规划处置（2026-11-03）

用户将决定交给代理后，F01—F08 已补入 v2.1 的对应 D 章节、A37—A44 和既有实施子票。新增的是明确契约，不代表生产行为已经修复。详见[审计处置](../../docs/superagent/audit-disposition.md)；GitHub 实际发布与层级/依赖验证结果见[发布记录](../../docs/superagent/publication.json)。上文保留补充前的审计证据与结论。
