# Super-agent 实施前决策图

正式地图：[Super-agent 实施前关键技术决策](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/2)。终点是解决尚缺证据的关键技术假设，回填规格，达到可拆实施票的状态。

用户已经确认终点与 dev 基线；已定架构方向和测试接口保持。总体规格见 [Super-agent 架构重建规格](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/1)。

## 首批决策

| 决策 | 类型 | 前置决定 |
| --- | --- | --- |
| [确认 DSH Session 共享持久化与恢复合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/3) | research，已解决公开合约问题 | 无；运行能力另验证 |
| [确认 DSH 远程执行能力与作用域合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/4) | research，已解决公开合约问题 | 无；运行能力另验证 |
| [验证异步领域事务与 Effects 原子性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/5) | task，已解决事务安排；有独立 PostgreSQL 验证 | 无 |
| [确定 Host、Session 与设备作业的执行所有权](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/6) | grilling，已解决 | Session 运行验证、远程一致性实验、异步事务、PostgreSQL 事务实验 |
| [验证来源实例身份与跨信道归属冲突](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/7) | task，已解决协议边界 | 无 |
| [确定主动规则与 Watchdog 的干预权限](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/8) | grilling，已由用户确认 | 无 |
| [确认跟进、停止与恢复的协作状态模型](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/9) | prototype | 执行所有权、来源归属、监督权限 |
| [验证旧核心退出与历史导入的切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/10) | task | 执行所有权、来源归属 |
| [验证 Session 后端写入屏障与接管行为](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/11) | task，最小运行协议已验证 | Session 公开合约研究已完成 |
| [验证远程路径与工具执行环境一致性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/12) | task，同平台最小协议已验证 | 远程能力研究已完成 |
| [验证 PostgreSQL 实例写锁与提交结果对账](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/13) | task，真实数据库最小协议已验证 | 异步事务合约已解决 |

地图是索引，已关闭决定的完整结论留在对应票的 resolution comment；本地 map.md 是地图正文镜像，manifest.json 保存本轮创建的 Issue 身份与关系。

两项公开合约研究已完成，形成 [Session 研究](../../../super-agent-references/analysis/wayfinder/session-persistence.md) 和 [远程能力研究](../../../super-agent-references/analysis/wayfinder/remote-capabilities.md)，分别在独立 docs/research-* 分支留存。委派研究代理连接失败后由主代理接回，这两项证据属于源码/文档核对，不包含 DSH 或设备运行验收。

[异步事务实验](../../../super-agent-references/analysis/wayfinder/async-transactions.md) 已完成 3 组负对照和 13 组正例，采用显式异步事务上下文。它是原创小模型的真实 SQLite 证据，不代表完整 Engine 或 PostgreSQL 已验收；PostgreSQL 运行任务已加入执行所有权的前置依赖。

## 工作约定

- 通过 GitHub 原生子 Issue 与 blocked-by 关系查询当前可开始、未认领的决策；以上表格不代替实时状态。
- 工作前认领，研究可以并行；人的取舍与原型体验需要实际交流，不由代理代答。
- 决策票只带 wayfinder 标签，不混入 ready-for-agent。得到结果后按证据关闭并更新地图索引。
- 研究分支从 dev 创建，采用仓库允许的 docs/research-* 前缀，推送留存而不建 PR、不合并。
- 建图轮只提出问题、建立依赖与启动研究；后续每轮最多解决一项非研究决策。当前阶段不实施生产代码。

[来源身份实验](../../../super-agent-references/analysis/wayfinder/source-identity.md) 已完成 17 组虚构事件重放，包含 2 组负对照；真实来源鉴权、版本顺序和连接器未验收。

[监督权限确认记录](discussions/supervision-authority.md)：任务纠偏/暂停先问用户，故障服务可自动优雅重启；未部署监督器。

[Session 运行协议实验](../../../super-agent-references/analysis/wayfinder/session-runtime.md)：公开 DSH 服务与原创 SQLite provider 的 8 组证据，保留自动租约、PostgreSQL 和完整 loop 的验收边界。

[远程运行实验](../../../super-agent-references/analysis/wayfinder/remote-runtime.md)：10 组本机协议与公开 scope 子集证据，完整 provider 和真实设备仍待实施验收。

[PostgreSQL 实验](../../../super-agent-references/analysis/wayfinder/postgres-runtime.md)：真实独立集群11组证据；执行所有权技术前置已完成，完整后端与Host租约另行验收。

[执行所有权决议](resolutions/execution-ownership.md)：用户确认按参考推荐授权和 Watchdog 边界；Host 接管必须先持久 fencing、逐层代次核验和设备作业对账，人工 stop 与未知结果优先，不把业务锁当成设备停止证明。
