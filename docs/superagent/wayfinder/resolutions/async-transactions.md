## Resolution

选用显式异步 Unit of Work：同一次领域命令的读取、状态修改、Effect 意图及命令回执绑定同一事务连接，await 完成后才提交；派发只读取已提交意图。内部规则复用 Tx，不自开嵌套顶层事务，不使用跨 await 的全局 depth。事务内只保留有界数据库操作和确定性规则，模型、外发与设备操作经提交后的 Effect 执行。

同 Instance 写命令串行化；SQLite 以数据库写锁和连接队列验证，PostgreSQL 拟采用事务内 Instance 协调行锁，具体运行保证留给独立实验。提交后 wake 仅作提示，启动/周期扫描补齐丢失通知。Effect 成功、失败退避和延期均匹配稳定键、不可复用行身份、payload 代次；领域回调另检查当前 Assignment 与人工停止。

公开命令使用稳定 command ID、规范化输入指纹和持久回执；提交应答未知时在新连接查同一回执，查不清就保留 unknown，不换身份盲重试。本轮没有注入 COMMIT 应答丢失。

### 方案比较与证据

- 拒绝直接给同步 atomic 塞 async 回调、事务内 microtask 提前派发，以及状态提交后才在内存回调入队：3 组负对照分别复现了提前提交、回滚前已外发和崩溃丢意图。
- 13 组正例通过，覆盖真实 SQLite 三个回滚窗口、双连接可见性与并发、提交前/后真实杀进程、命令去重、旧成功/失败/延期、删后重建 ABA、旧 Assignment/停止回调、wake 故障及 Tx 作用域。
- 快照加 revision CAS 在小模型内也能检测冲突并重算，未选作总体基线：完整跨聚合读取集合、缺失行/谓词冲突和无副作用重跑需要额外证明。

完整材料：[实验报告](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/4b601d6638002e196c7364a53bb8e595022d4a89/super-agent-references/analysis/wayfinder/async-transactions.md)、[可复跑实验](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/4b601d6638002e196c7364a53bb8e595022d4a89/super-agent-references/analysis/wayfinder/async-transactions/probe.mjs)、[结构化结果](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/4b601d6638002e196c7364a53bb8e595022d4a89/super-agent-references/analysis/wayfinder/async-transactions/results.json)。独立分支 docs/research-async-transactions 已推送，无 PR、无合并。

### 限制与后续

这是原创小型 Engine/存储合约实验，不是官方 Engine 异步移植或正式存储实现。独立读连接只代表派发扫描入口；重开库找回的是可派发意图，没有运行真实 dispatcher/handler。未验证 PostgreSQL、DSH Session、远程设备、跨 Host 所有权、掉电或远端 exactly-once。

新增前置任务：[验证 PostgreSQL 实例写锁与提交结果对账](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/13)。它承接本决定并阻塞执行所有权决定，补齐真实 PostgreSQL 行锁、并发及提交应答未知的证据；Session 与远程运行实验继续保留。

仓库基线检查：npm test 为 1431 通过、2 跳过、0 失败；client 生成一致性通过；lint 退出 0、有基线警告。未改变 host 产品代码，未跑 host smoke。上述回归不代替 Super-agent 集成验收。
