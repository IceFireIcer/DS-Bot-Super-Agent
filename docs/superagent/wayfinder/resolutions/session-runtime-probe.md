## Resolution

完成最小公共接口/provider 协议实验，采用发布前取得 write handle、按序路由 live event、await flush 后确认输入、close 持久化成功后才释放写权。写者 epoch 不复用，append 与 flush 检查写权，旧 handle 不自动重获所有权。业务 Input 与 Session 日志用稳定 message ID 对账。

固定 DSH 0.2.1-rc.4，真实 Cordis/SessionStore/SessionQuery 公共服务加原创 SQLite provider，8 组断言通过：live 写入/await flush/disposed/公开 replay、同实例读可见性与另一实例的持久前缀、flush 故障传播、两个 OS 进程争用和显式 epoch fencing、真实杀进程后的已 flush 保留/未 flush 丢失、close 失败保留写权，以及两套持久状态的稳定 ID 重投对账。

新发现并验证：恢复 Session 的 prepare 阶段会生成未发布 session/end-seed。实验在 enter 后、announce 前通过公共 SessionQuery 取完整副本，补存构造期记录并 flush，再开始 live 发布；不能只监听后续 event 而漏掉这段序列。没有使用私有安装路径、已弃用同步读取或内部 plugin record API。

[报告](https://github.com/IceFireIcer/DS-SuperAgent/blob/043a9a1184e1e60906811fed7144fc0426d175c9/super-agent-references/analysis/wayfinder/session-runtime.md)、[可复跑脚本](https://github.com/IceFireIcer/DS-SuperAgent/blob/043a9a1184e1e60906811fed7144fc0426d175c9/super-agent-references/analysis/wayfinder/session-runtime/probe.mjs)、[结果](https://github.com/IceFireIcer/DS-SuperAgent/blob/043a9a1184e1e60906811fed7144fc0426d175c9/super-agent-references/analysis/wayfinder/session-runtime/results.json) 已推送 docs/research-session-runtime 分支，无 PR/合并。

### 限制和后续

SQLite 为真实本机数据库；fence 是测试控制端的显式动作，不是自动租约/故障检测。实验验证公共 Session 服务生命周期与协议子集，不等于完整 provider conformance、agent-loop resume、AgentDelivery/inbox、PostgreSQL、跨机器 Host 接管、设备、掉电或磁盘故障。完整格式/fork/取消/并发交错和服务替换矩阵尚未验收。

既有执行所有权决定继续明确何时可合法接管、如何判断旧写者失效；PostgreSQL 事务运行验证及远程环境验证仍为其前置。生产 Session provider 在对应实施切片验证共享数据库写权与 flush 保证，不把完整后端实现混进本次最小协议任务；没有新增独立前置决定。

基线检查：1431 通过、2 跳过、0 失败，生成一致性通过，lint 退出 0、有既有警告。没有修改产品 host，未跑 host smoke，未接触用户 DSH 数据。
