# 本地与远端双模式及执行交接决议

对应：[确定本地与远端双模式的执行目标与 Assignment 切换协议](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/14)。2026-11-03 用户确认第一轮 Q1—Q4「全部按照推荐」。

## 1. 模式层级与实际绑定

Instance 保存默认执行策略，默认 local；Ticket 可覆盖为 local-only、remote-only 或 auto；Assignment 创建时解析并固定一个明确的 Environment。local 默认映射为本机约束；Ticket 的选择受 Instance 和 Mandate 允许范围约束，不能扩大设备权限。全局默认值改变只影响后续目标解析，不迁移已经运行的 Assignment；单次工具命令不能自行改变执行设备。

auto 只能在已授权的 Environment allowlist 中选择，检查在线状态、能力、工作目录、权限、版本/环境指纹及容量。remote-only 没有合格目标时等待或报告阻塞，不静默回落本机。同一 Ticket 不因模式改变重复建立，同一时刻不允许两个有效 Assignment 在两个环境执行同一副作用。

## 2. 两种运行方式

- 纯本地：客户端、Domain Engine、Router/Worker 的 DSH Session、业务数据库、Effects/Outbox 和本机执行环境均在本机，不需要远端 Device Daemon。
- 本地控制远端：上述控制和会话状态仍在本机，文件、搜索、Shell、PTY 和设备作业通过 Remote Execution Adapter 在远端 Device Daemon 执行。远端不运行第二套独立 Router 或业务状态库，只保存执行环境、工作副本和必要的 Managed Job 恢复记录；不保存权威模型会话历史。

两种方式复用同一 Domain Engine、Ticket、Assignment、Session 和授权规则。执行环境位于本机不限定模型服务端点；是否使用本地模型是独立配置。本决议不迁移控制面或业务/Session 存储，也不撤销既有服务器托管 Host 的交付范围。

## 3. 自动选择与切换边界

新 Assignment 可以按 local-only、remote-only、auto 解析目标，呈现最终设备、目录、所需能力与选择依据。已有 running 不自动搬迁；waiting-human 继续等有权限的人决定，waiting-device 等原设备，unknown 禁止盲切，stopped 禁止自动恢复。ready 或安全结束后，后续有授权的工作可用新 Assignment 绑定另一个环境，不能仅因 ready 就重新启动。

远端离线不自动把写操作切回本机。未知副作用先按原 command/job ID 对账；人工 stop、暂停和权限撤销优先于交接，等待人工确认不能被新 Assignment 绕过。缺少能力或授权保持受阻，不能偷偷使用 Host 同名路径或替代设备。

## 4. 显式交接协议

`handoff-requested → 停止新副作用并到达安全边界 → Session flush → 停止/查询/对账原 job → 校验目标及交接内容 → 结束旧 Assignment → 创建新代次 Assignment → 绑定新 Environment → 继续未消费 Input`

保留 Ticket、原授权、原 Session 历史、目标和交接说明；已入历史的 Input 依稳定 ID 去重，不重复读取。原工作目录信息保留，但目标目录必须重新映射、校验；原工作目录路径字符串不表示另一设备有相同文件。

正在运行的 Shell、PTY、半个模型 turn、未确认设备命令和未知外部写入不直接迁移。必须完成或安全停止/对账后才能启动冲突的新执行。业务与 Session 不是同一个事务：交接进度与稳定 ID 持久记录，中断后先对账，再继续未完成步骤；旧代回调沿已定 fencing 规则隔离。

跨环境工作副本默认不实时双写。交接使用明确的 Git commit 加未提交 patch/文件快照，或显式文件同步，并记录版本和校验结果。未跟踪文件、待交接修改和冲突不能静默丢弃；同步内容受原授权及凭据边界约束。目标目录/版本明确不符或缺少同步证据时为 handoff-blocked；副作用真实结果无法查明时为 unknown，不能把已知不匹配伪装成外部结果未知。

## 验收与限制

须验证纯本地闭环、本地 Host 到第二设备执行、默认值变更不迁移在途任务、Ticket 覆盖与 auto 拒绝越权、双向交接、中途崩溃恢复、离线停止、unknown 不回退、工作副本不一致与旧回调隔离。沿 Domain Engine 公开命令/查询及存储、Session、设备契约验证，补 Windows 和真实远端验收。

这是人机确认的行为决定；此前公开 DSH/SQLite、同平台远端协议和 PostgreSQL 实验只支撑部分边界。本轮没有实现适配器、运行真实设备交接或证明跨设备 exactly-once。完整结论正式记录于本决策票的 resolution comment。
