# Session 共享持久化与恢复合约研究

- 日期：2026-11-02。决策：[确认 DSH Session 共享持久化与恢复合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/3)。
- 固定 DSH 基线：`dsh-v0.2.1-rc.4`，实时查询标签指向提交 `504a01a9578abc2c6f1fb896b1dc322c9fe24f66`。本文链接固定到该提交。
- 证据：官方公开服务合约、类型声明、官方后端/loop 文档，以及本地 Super-agent 原型的 Session 消息投递实现。没有运行 DSH、数据库或共享后端实验。
- 两个受委派研究代理均因 OpenAI 连接 EOF/502 退出；本项由主代理直接完成，没有把委派失败计为独立评审或研究通过。

## 结论与选用方向

公开 SessionPersistence 是可实现第三方持久化的合约，支持本项目单机 JSONL 与服务器共享后端方向。首个云端实现采用单活动 Host，业务库和 Session 后端分别持久化，通过稳定消息身份、flush 和恢复对账衔接。

共享后端必须自己保证跨进程单写、写者失效隔离、连续日志和持久化屏障。仅实现 create/open/append 方法，或把文件目录挂到网络盘，不能证明这些保证。数据库具体锁/租约协议留给执行所有权决定；运行验证作为单独的技术任务，不在文档研究中假称完成。

## 已核实的公开合约

| 项目 | 固定版本事实 | 对本项目的约束 |
| --- | --- | --- |
| 服务注册 | backend 注册为 ctx.sessionPersistence，服务公开 create/open/flush/stat/list | 从公开服务接入，不导入官方私有具体后端 |
| Handle | create/open 返回持有读写权限与生命周期的 SessionHandle；read/append/flush/close 走 handle | 生命周期和写归属不能退化为随意按 ID append |
| 顺序 | append 必须从当前 next-seq 连续追加，已提交事件不重写 | 事务检查序号，拒绝重复、跳号和失效写者 |
| 持久性 | append 完成保证当前后端可见；flush 才保证故障后可恢复 | 发出业务投递确认前建立适用的 Session flush 屏障 |
| 可见性 | 同一 backend instance 中，append/flush 后新读至少可见该前缀；并发读取没有更强顺序承诺 | 跨进程可见性是共享后端必须另外定义和验证的行为 |
| close | 幂等、异步且不可取消，写 handle 完成持久化后释放写归属 | 关闭/接管过程必须排空与隔离，不通过取消等待伪造完成 |
| live 写入 | backend 监听发布 Session 的 event、flush、disposed，路由到已取得的 handle | 只有静态存储方法不够，还要接完整 live-write 生命周期 |
| 发布入口 | 原生 agent loop 在 create/resume 时取得 write handle，再发布 Session | 保留原生 loop，不另建绕过 handle 的会话执行路径 |

服务定义：[index.ts L137–203](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence/src/index.ts#L137)。Handle 语义：[handle.ts L45–116](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence/src/handle.ts#L45)。日志校验：[storage-contract.ts L145](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence/src/storage-contract.ts#L145)。

## 恢复、所有权与换后端

1. 存储交回物理有效日志；resume 的原生 agent loop 对中断 turn 补 synthetic closers。它不是从命令原位置或半个模型 turn 无缝继续。
2. 通用 seam 规定 backend instance 内单写；跨进程排他由具体 provider 负责。官方 JSONL 用本机内核机制，但其网络文件系统和 Windows 登录会话限制不等于多机数据库租约。
3. 后端 live reload 后旧 handle 不能继续有效使用，必须协调 Session 重启。rolling deployment 的接管不等于在线更换一个 backend 变量。
4. 已提交日志出现不兼容事件或格式应失败关闭，不能当作坏尾静默截断。共享后端提供当前逻辑格式和兼容/拒绝策略。
5. list 没有分页与筛选、没有删除/保留 API；大规模索引与运维保留在后端和读模型中单独设计。

依据：[SessionPersistence README 的恢复与限制](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence/README.md#L59)、[loop 持久化集成 L114](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/core/agent-loop/README.md#L114)、[JSONL 后端排他限制 L168](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence-jsonl/README.md#L168)。

## 两套持久状态的交接窗口

本地原型 AgentDelivery 用稳定 messageId 检查持久历史及 inbox，在注入或送入 next-step/next-turn 后调用 SessionPersistence.flush，再向发送侧确认。原型依靠重复投递识别与领域 Input 状态衔接，不把业务 SQLite 事务和 Session 事件视作一个共享事务。

必须区分：业务 Input 已保存、进入 inbox、写入 user/message、flush 成功，以及后续执行承接。claim 后入历史前取消属于未读，不能因为调用过 steer/followup 就删除恢复依据。

依据：[固定原型 AgentDelivery](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/delivery.ts)。本项目既有执行研究作为本地背景保留，远程研究分支的证据以这里的固定源码链接为准。

## 下一步最小运行验证

该研究问题可以以“公开合约和能力边界已查明”结束。生产实现是否满足合约仍需独立任务验证：

- 一个虚构 Session 从 create 到 live event、flush、close、resume，验证有序、不丢失和拒绝无归属写入。
- 两个隔离进程竞争同一 Session；旧写者失效后迟到 append 被拒绝，新写者只在合法取得写权后继续。
- append 已应答而 flush 前失败、flush 失败、进程硬退出和 close 中断，分别记录哪部分可恢复。
- 业务提交后 Session 投递失败、Session 已 flush 但业务回执未提交，按稳定消息 ID 恢复且不重复生效。
- 对公开 provider 运行合约与 live-write 场景；测试源码可作为规格依据，不能依赖未公开内部实现。

运行结果用于收敛所有权协议和实现票。当前未证明 PostgreSQL provider、真实 Host 故障转移、跨进程 flush 时序或 Windows 原生部署已运行成功。
