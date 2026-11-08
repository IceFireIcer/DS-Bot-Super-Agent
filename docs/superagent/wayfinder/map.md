## Destination

把现有 Super-agent 规格中尚缺证据的关键技术假设逐项定案，回填规格，达到可拆实施票的状态；明确纯本地与本地控制远端设备两种运行方式，以及它们之间的安全切换边界。保留已确认的连续、高效、主动、持久四个目标、总体架构方向和测试接口。

## Notes

- 依据：[Super-agent 架构重建规格](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/1)。本图寻找可实施的决定与验证依据，不实施产品。
- 用户已确认本图终点；已确认以当前 fork 的 main 提交 `7b4009798dd066d06144dfa0ea51b5fec71328a8` 建立 dev。dev 已建立，工作区原有未提交资料保持。
- 图及决策票仅使用 wayfinder 标签。先按原生阻塞关系选可开始的未认领决策，再认领；不将实施规格的 ready-for-agent 混到决策图。
- 事实由源码、官方文档与独立研究查明；人的取舍通过 grilling 讨论，可运行状态模型通过 prototype 供人检验；工程实验 task 只为决定提供证据。
- 每轮按 wayfinder、grilling 与 domain-modeling 工作；研究票使用 research；原型票使用 prototype。已定四目标、DSH 原生运行时和无 DSH 补丁规则不是重新投票事项。
- 遵从仓库分支规则，研究使用从 dev 建立的独立 docs/research-* 分支，推送留存、不建 PR、不合并；这是对技能默认的研究分支前缀的项目适配。
- 本地地图与决策草稿放 docs/superagent/wayfinder；研究放 super-agent-references/analysis/wayfinder。GitHub Issue 是地图与决定的正式索引，决定的完整结论保留在对应决策票。
- 单次只手动解决一项决策，研究票可并行。建图轮不手动解决决策票；研究结果交回各自票后才沿依赖推进。

## Decisions so far

- [确认 DSH Session 共享持久化与恢复合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/3#issuecomment-6571936949)：采用公开 SessionPersistence/Handle 扩展，共享后端承担跨进程写所有权与持久屏障，运行验证单独推进。
- [确认 DSH 远程执行能力与作用域合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/4#issuecomment-6571938850)：配套适配 fs/subprocess 与 Agent scope；搜索有 Host 路径假设，跨重启作业须另行对账，运行一致性单独验证。
- [验证异步领域事务与 Effects 原子性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/5#issuecomment-6572399470)：采用显式异步 Tx，同事务保存状态/意图/回执；SQLite 最小实验通过，PostgreSQL 与提交未知另行验证。
- [验证来源实例身份与跨信道归属冲突](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/7#issuecomment-6572678939)：采用实例化元组身份、版本投影与可核查关联证据；17 组内存重放通过，真实来源映射留在切片验收。
- [确定主动规则与 Watchdog 的干预权限](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/8#issuecomment-6577190186)：沿用参考主动机制；自动查证、安全重试及故障服务优雅重启，任务纠偏/暂停先问用户。
- [确定 Host、Session 与设备作业的执行所有权](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/6#issuecomment-6596958118)：采用 Instance 锁、Host epoch、Assignment/Session 代次和设备 incarnation/job ID 的权威链；接管先 fencing 与对账，人工 stop 和局部 unknown 优先。
- [确认跟进、停止与恢复的协作状态模型](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/9#issuecomment-6601078863)：跨信道跟进回到原 Ticket/Worker/Session；人工 stop 只有用户明确恢复才能解除；waiting-human、waiting-device、unknown 分开呈现；Host 接管创建新 Assignment，旧回调标 stale。
- [验证 Session 后端写入屏障与接管行为](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/11#issuecomment-6596190011)：公开 DSH/SQLite 协议 8 组通过；补齐恢复构造期记录，flush 后确认，显式 epoch fencing 隔离旧写者，自动接管另定。
- [验证远程路径与工具执行环境一致性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/12#issuecomment-6596259789)：固定配套环境、设备侧搜索和稳定作业对账；10 组本机协议/scope 实验通过，完整 DSH/异构设备另验收。
- [验证 PostgreSQL 实例写锁与提交结果对账](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/13#issuecomment-6596499513)：真实集群11组通过；先锁Instance再读写，COMMIT未知按原ID锁后对账，整事务有界重试。

- [确定本地与远端双模式的执行目标与 Assignment 切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/14#issuecomment-6601494478)：Instance 默认 local、Ticket 约束、Assignment 固定环境；安全边界/flush/作业对账/副本校验后换代，离线或 unknown 不盲切。

- [验证旧核心退出与历史导入的切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/10#issuecomment-6601672028)：只读档案与批次映射、旧侧静止证明、稳定输入归属和激活屏障；14 组 SQLite 模型通过，真实迁移另验收。

## Not yet specified

本图的已知实施前问题已具名定案，当前无待新增决策。已复核原三类疑问：
- 公开接口与适配责任已由合约研究及最小运行实验定位；本轮未发现一个必须另选架构的具体缺口。
- 实际部署、模型负载、资源预算、完整租约/设备隔离和集成故障行为由后续实施切片的合约与真实环境验收覆盖；不得把模型证据写成已实现能力。若验证推翻当前假设，按具体缺口另立决策。
- 跨信道跟进、人工停止、等待与双模式交接的行为边界已通过具体场景对话定案并记录在对应票中。协作状态 HTML 原型已按用户要求删除，不再作为实现参考，不约束页面布局、视觉设计和交互方式。

下一步用 to-spec 汇总各票结论和证据限制，再用 to-tickets 拆完整行为切片。本地图关闭不授权直接迁移用户数据或跳过产品验收。

## Out of scope

- 在本图内交付生产功能、部署真实账号、迁移用户数据或把全部实施票预先建完。
- 改变已确认的四目标，或把完整常驻目标降为仅本地 UI 可恢复。
- 修改 DSH 安装文件或依赖非公开内部接口绕过限制。
- Router 分片、组织级跨实例 A2A、专项模型训练、重新设计全部视觉风格。
- 直接覆盖既有用户资料或自动重放旧派活。
