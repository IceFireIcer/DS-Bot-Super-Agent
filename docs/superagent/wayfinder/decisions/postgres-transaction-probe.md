## Question

采用什么 PostgreSQL 事务与恢复协议，能在真实连接上保持同一 Super-agent Instance 的写命令串行化，并在连接中断或 COMMIT 应答未知时通过稳定 command ID 对账？

沿用异步事务实验选定的显式 Tx：领域状态、Effect 意图、命令回执在同事务写入。使用独立测试数据库/容器和至少两个真实连接，验证同 Instance 协调行锁、不同 Instance 的独立推进、并发同 command ID 去重、事务中连接退出后的回滚、提交后连接退出的恢复，以及可复现的 COMMIT 应答丢失或等效协议故障注入。不能把“COMMIT 已应答后杀进程”当作应答丢失。

给出有界锁等待、锁获取顺序、死锁/序列化失败的整命令重试和未知结果处理约束。无法查明提交结果时保留 unknown，不换新命令身份盲目重试；重试规则不能包含外部副作用。对没有实际注入的窗口明确证据边界。

只产出可复跑的最小数据库协议实验、选定约束和剩余限制，不交付完整 PostgreSQL 产品后端，不触碰用户数据或 DSH 安装。该证据用于后续 Host/Session/设备执行所有权决定；不会单独证明跨 Host 租约或远端 exactly-once。

依据：[验证异步领域事务与 Effects 原子性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/5)。SQLite 单写实验不能代替 PostgreSQL 并发与网络故障语义。
