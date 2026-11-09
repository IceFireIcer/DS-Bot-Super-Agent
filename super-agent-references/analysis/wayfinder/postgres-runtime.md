# PostgreSQL 实例写锁与提交结果对账实验

日期：2026-11-03。对应[验证 PostgreSQL 实例写锁与提交结果对账](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/13)。原创新协议实验，不是正式存储后端。

## 采用的协议

每次领域命令在一条事务连接上运行，先锁定预先存在的 Instance 协调行，再读取领域状态与命令回执，最后同事务保存状态、Effect 意图和回执。采用 READ COMMITTED；同一 Instance 所有写入口遵循相同顺序，多 Instance/聚合锁按稳定顺序获取。不存在的协调行必须拒绝，不能以 SELECT FOR UPDATE 没返回行冒充已获得互斥。

命令身份为 Instance + 稳定 command ID，绑定规范化后的输入摘要。实验仅使用单字段 increment 的 JSON 指纹，不是生产规范化编码测试。同 ID 同输入返回原回执，不同输入拒绝；不在事务内执行网络/模型/设备副作用。

连接丢失或 COMMIT 应答未知时，坏连接不可继续复用。新连接重新开始 READ COMMITTED 事务，取得同 Instance 协调锁后再读原回执。查到回执即返回原结果；取得锁后仍无回执，才可用同 ID 重新计算和执行。不能用未加锁的一次空查询判定原提交失败；原事务可能尚在完成。若不能取得锁或查证，保持 unknown/暂不可确认，不换新 ID 盲重试。

锁等待和语句执行都必须有界。实验 lock_timeout=1500ms，statement_timeout=4000ms；独立超时用例设 100ms。40P01（死锁）和 40001（序列化失败）先回滚再重跑整个事务，包括读状态和规则计算；实验重试上限三次。55P03 返回可重试的争用失败，不伪报接单；23505 等冲突不能无分类地重复。生产具体预算按负载基线调整，不把这些实验数值直接当产品 SLA。

## 环境与复跑

使用 npm 锁定 embedded-postgres 17.11.0-beta.19 和 pg 8.23.1。wrapper 包带 beta 后缀，实际运行服务报告 PostgreSQL 17.11 / Windows x64。二进制和 node_modules 不提交，只保留依赖清单/lockfile；下载依赖不意味着修改系统 PostgreSQL。服务在唯一 .dsh-test-postgres-* 目录初始化，只监听 127.0.0.1 的随机空闲端口，凭据仅本轮内存生成，未使用用户数据库、DSH 或账号。

```powershell
cd super-agent-references/analysis/wayfinder/postgres-runtime
npm ci --no-fund --no-audit
node probe.mjs
```

[实验](postgres-runtime/probe.mjs)、[协议代理](postgres-runtime/commit-proxy.mjs)、[结果](postgres-runtime/results.json)。需要 Windows x64 或依赖包支持的平台；依赖安装需允许其平台包的 postinstall 准备二进制。实验明确设置并查询 fsync=on、synchronous_commit=on，不以禁用持久化换取通过。结束时关闭所有连接/代理、停止本轮集群，校验绝对目录范围后删除本轮数据；没有注册系统服务、启动 Docker 或创建系统用户。

## 11 组运行事实

| 实验 | 已观察结果 |
| --- | --- |
| 同 Instance 并发 | pg_blocking_pids 确认第二连接真的在等待第一连接；解锁后新读状态，两个增量均保留。 |
| 不同 Instance | A 持锁期间 B 命令独立完成，未使用全数据库写锁。 |
| 同命令并发重投 | 同一结果、一次状态增量、一个 Effect；同 ID 改输入拒绝。 |
| 提交前失败 | 状态、Effect、回执整体回滚，锁后对账查不到残留。 |
| 事务中断连 | 对本轮连接 pg_terminate_backend，写锁释放、未提交回执回滚；新连接可对账。 |
| 有界锁等待 | 实际返回 55P03；不是将语句超时或注入字符串当锁超时。 |
| 死锁 | 两连接反序锁两行实际产生一次 40P01，不预设牺牲者；回滚后统一顺序可完成。 |
| 整事务重试 | 实际 40001 后重读并重算，第二次提交，最终仅一个 Effect/回执。 |
| 重试耗尽 | 连续真实 40001 在三次后退出，无失败命令回执。 |
| 服务端已提交、客户端未确认 | 代理实际观察到 C/COMMIT，但未向客户端转发该帧，并抑制 Z/ReadyForQuery 后断线；客户端 COMMIT 拒绝，新连接锁后查到回执，同 ID 重投无重复。 |
| COMMIT 尚未转发 | 代理在客户端 COMMIT 到服务端前切断，锁后查不到回执；同 ID 再执行，仅一个 Effect。 |

代理按 type + length 拆分 TCP 帧，处理拆包/合包，防止先透传含 COMMIT 应答的 chunk 再错误声称丢确认。结果分别记录 commitForwarded、commitCompleteSeen、commitCompleteForwarded、readySuppressed、callerConfirmed。它是实际 PostgreSQL wire protocol 故障注入，不是“await COMMIT 已返回后再杀客户端”。

## 限制及后续

- 实际死锁已检测和回滚，但整事务 retry runner 在本轮由 40001 驱动；没有声称实际死锁驱动的完整命令重试也单独通过。
- 协议代理只针对本实验的无 TLS simple-query COMMIT，未验证生产 TLS/连接池/故障转移代理。随机端口分配存在关闭探测端口到启动的短竞态，服务启动冲突应失败，不回退其他数据库。
- fsync/synchronous_commit 已开启，未做掉电、磁盘故障、数据库重启、复制或主从切换；不能将进程/连接实验扩大为上述耐久保证。
- 尚未实现完整领域 schema、生产池化与错误 API、完整 Session provider、跨 Host 租约/fencing、远程 exactly-once。网络中断原因本身不证明未提交，无法对账时 unknown 合约仍须由生产接口呈现。
- 这项给现有执行所有权决定提供了真实数据库前置证据。何时接管 Host/Session/设备仍需用户取舍；完整后端与部署验收放在实施切片，没有新增独立前置决定。

## 官方依据与回归

[PostgreSQL 17 行锁与死锁](https://www.postgresql.org/docs/17/explicit-locking.html)、[事务重试](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)、[协议消息](https://www.postgresql.org/docs/17/protocol-message-formats.html)。先锁同 Instance 后读取回执以消除“空查询与原提交竞争”，是依据事务/锁语义作出的本项目工程结论。临时运行依赖来源为 [embedded-postgres](https://github.com/leinelissen/embedded-postgres) 与 [node-postgres](https://node-postgres.com/)，只通过公开依赖使用，未复制第三方实现。

仓库检查：1431 通过、2 跳过、0 失败；生成一致性通过；lint 退出 0、有既有警告。产品运行代码未改，未跑 host smoke；本轮不等于生产存储已实现。
