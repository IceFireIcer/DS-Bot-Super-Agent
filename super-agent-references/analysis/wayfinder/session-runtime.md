# Session 写入屏障与接管协议实验

日期：2026-11-03。对应[验证 Session 后端写入屏障与接管行为](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/11)。固定运行包 @deepseek-ai/dsh-session / dsh-session-persistence 为 0.2.1-rc.4；参考源码提交 504a01a9578abc2c6f1fb896b1dc322c9fe24f66。

## 结论

采用发布前取得 write handle、按序路由 live event、await Session flush 后确认输入、关闭成功后释放写权的协议。接管使用不可复用写者 epoch，并在持久提交事务内检查身份；旧 handle 不自动重获写权。业务状态和 Session 日志仍为两套事务，用稳定 message ID 对账。

新发现：固定版本恢复 Session 时会生成尚未发布的 session/end-seed。必须覆盖“已存储前缀”和“开始 live 监听”之间的构造期记录，否则下一条 live 事件出现 seq 缺口。本实验通过公开 SessionQuery.readSession 在 enter 后、announce 前取得副本，补存构造期尾部并 flush 后再 announce。该路径不是完整 agent-loop resume；生产适配继续遵从原生 loop 的生命周期。

## 可复跑证据

在本分支根目录先按仓库流程安装 ds-bot/dev/harness 的依赖，再执行：

```powershell
node super-agent-references/analysis/wayfinder/session-runtime/probe.mjs
```

可用 DSH_HARNESS 指向提供同版本公共包的目录。[脚本](session-runtime/probe.mjs)通过包的公开入口解析导入，不导入内部实现文件或修改 DSH。[结果](session-runtime/results.json)记录 Node v25.4.0 / Windows 下 8 组通过：

1. 真实 Cordis/SessionStore 的 prepare、enter、announce、user/message、await flush、disposed、公开恢复；构造期标记与下一条 live 事件序号连续。
2. 已应答 append 对同 Provider 的读 handle 可见；另一 Provider 在 flush 前只见持久前缀。flush 注错后无新增持久行；read-only、闭合 handle、序号跳跃被拒绝。
3. 两个真实 OS 进程争用同一 SQLite Session，第二写者被拒；测试控制端显式 fencing 后旧进程的迟到 append 抛公开 SessionOwnershipLostError，新写者可继续。
4. append 后未 flush 就实际杀进程，缓冲记录丢失；遗留写权不会自动消失，确认退出并显式 fencing 后才能打开。
5. flush 应答后实际杀进程，新写者恢复该日志。仅为进程故障恢复，不是掉电/磁盘故障测试。
6. 真实 ctx.sessions.flush 传播 provider 的持久屏障错误；恢复后可重试，不能把 live event 已发出当成持久成功。
7. close 的 flush 失败时不释放写权；持久屏障成功后释放，重复 close 幂等。
8. 业务 Input 先保存，Session flush 成功但业务回执仍未提交，再投递时按同 message ID 查历史，不重复追加。它是最小协议/数据库对账，不含真实 inbox、AgentDelivery 或完整领域 Engine。

实验数据库由本轮唯一 .dsh-test-session-* 目录隔离，所有进程与连接关闭后检查目录绝对路径再清理。没有读取用户 DSH 数据、账号或密钥。

## 选定约束与证据边界

- append 应答只代表已接受前缀，flush 才是持久承诺；同 backend instance 的读不得遗漏已应答前缀。失败不得伪报送达或释放恢复依据。
- 写权检查涵盖 append 等待前后和 flush 事务内部。fencing 后旧 handle 的未 flush 缓冲不得提交；关闭失败不能伪装成已安全释放。
- disposed 通知不是可等待的关闭屏障；provider 必须跟踪 close Promise，生命周期退出要显式排空。实验公开恢复路径是 prepare/enter/query/bootstrap flush/announce，不使用已弃用同步读取或内部 plugin record 接口。
- 原创 SQLite provider 是公共接口的最小可运行子集，不是生产后端或完整一致性认证；未覆盖 seeded fork、取消、格式损坏与未知事件完整矩阵、所有并发 handle 调用交错、backend reload 或规模索引。
- 没有 PostgreSQL、跨机器故障探测、自动租约过期/续约、真实 Host 替换、设备、模型和完整 agent-loop 恢复证据。测试端 fence 代表已获批准的接管动作，不实现失败判定；生产何时能撤销旧写权仍由执行所有权决定。
- 现有 PostgreSQL 事务实验及执行所有权决定继续承接数据库锁/提交未知、接管条件与副作用对账。共享 Session provider 的生产合约在对应实施切片验收；本轮已有足够最小协议证据，无需把完整后端实现另立为建图阶段交付。

参考公开合约：[SessionPersistence](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/session/session-persistence/README.md)；[Session](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/core/session/README.md)。只读复核核实公开查询恢复路径，并促成同实例读可见性、await 后写权复查及稳定 user/message 用例修正。

仓库基线检查：1431 通过、2 跳过、0 失败；client 生成一致性通过；lint 退出 0（既有警告）。产品 host 未修改，未跑 host smoke；本轮不是正式部署验收。
