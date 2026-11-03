## Resolution

选择预先存在的 Instance 协调行 + READ COMMITTED 的显式异步事务。每个领域写命令先 SELECT FOR UPDATE 锁定协调行，再读状态/回执，同事务写入状态、Effect、命令回执；所有写入口遵守，多对象锁使用稳定顺序，不以不存在的行冒充互斥。同 Instance 串行，不同 Instance 可独立推进。

同 Instance + command ID 的输入指纹一致时复用原回执，不同输入拒绝。连接或 COMMIT 结果未知时换新连接，以原 ID 在新事务重新取得同 Instance 锁后查询回执：存在则返回原结果；取得锁后仍缺失才可用原 ID 重算。不能用一次无锁空查询推断原事务未提交；无法查证时保持 unknown，不盲换 ID。

设置有界 lock_timeout/statement_timeout。40P01、40001 回滚后重跑整个事务与计算逻辑，保留 ID，不在事务回调中做外部副作用；55P03 是锁争用超时，不宣称已接单；23505 等错误不能无分类重试。实验上限三次，锁1500ms/语句4000ms，独立锁超时用例100ms；这些是实验参数，不是产品 SLA。

### 真实运行证据

临时独立 PostgreSQL 17.11 Windows x64，fsync=on、synchronous_commit=on，只监听127.0.0.1随机端口，Node v25.4.0。11组通过：实际同 Instance 阻塞观测、不同 Instance 独立、并发去重、整体回滚、真实 backend 终止、55P03、40P01、40001 整事务重试、三次耗尽，以及 COMMIT 前切断和提交后丢应答两个路径。

提交后丢应答由真实协议代理复现：服务端 C/COMMIT 已观察到但未转发，Z/ReadyForQuery 也被抑制，客户端 query(COMMIT) 拒绝且 callerConfirmed=false；新连接锁后查到回执，同 ID 重投仅一个 Effect。这不是客户端已收到确认后再杀进程。

[报告](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/d9a5ef86b552641d7dad53ad502105df523c3f3a/super-agent-references/analysis/wayfinder/postgres-runtime.md)、[实验](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/d9a5ef86b552641d7dad53ad502105df523c3f3a/super-agent-references/analysis/wayfinder/postgres-runtime/probe.mjs)、[协议代理](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/d9a5ef86b552641d7dad53ad502105df523c3f3a/super-agent-references/analysis/wayfinder/postgres-runtime/commit-proxy.mjs)、[结果](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/d9a5ef86b552641d7dad53ad502105df523c3f3a/super-agent-references/analysis/wayfinder/postgres-runtime/results.json) 已推送 docs/research-postgres-transactions，无 PR/合并。

### 边界与后续

实际死锁检测/回滚和一致顺序跟进已测，自动整事务重试实际由40001驱动，不声称死锁自动重试另已通过。单字段 JSON 指纹不是生产规范化编码认证。代理只针对无TLS的simple-query COMMIT；没有生产池化/TLS、复制切换、掉电、完整schema/Session provider、Host租约或远端exactly-once证据。

实验真实停止和清理临时集群，不连接用户数据库、不注册系统服务、不创建系统用户、不启动Docker。第三方二进制和node_modules不提交，依赖清单/lockfile保留可复跑入口。

本项解除执行所有权的最后一个技术前置。何时接管与如何隔离旧Host/Assignment/设备仍由现有人机决定处理，完整后端/部署在实施切片验收，无新增独立前置决定。

仓库检查1431通过、2跳过、0失败；生成一致性通过；lint退出0有既有警告。产品host未改，未跑host smoke。
