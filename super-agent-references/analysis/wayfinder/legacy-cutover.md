# 旧核心退出与历史导入：协议实验

2026-11-03；对应[验证旧核心退出与历史导入的切换协议](https://github.com/IceFireIcer/DS-SuperAgent/issues/10)。原创模型，不是生产迁移器。

## 实际代码依据

基线为 `7b4009798dd066d06144dfa0ea51b5fec71328a8`：

- [app/src/import.mjs](https://github.com/IceFireIcer/DS-SuperAgent/blob/7b4009798dd066d06144dfa0ea51b5fec71328a8/app/src/import.mjs) 的 LEFT_BEHIND 排除 state.lock、inflight.json、workspace；importTeam 复制 bot 状态，清除 workspaceId/agents，再分步复制 Session/附件/目录并最终发布 bot 目录。它还具有凭据导入逻辑，本实验未调用该函数或读取任何凭据。
- [ds-bot/src/host/store.js](https://github.com/IceFireIcer/DS-SuperAgent/blob/7b4009798dd066d06144dfa0ea51b5fec71328a8/ds-bot/src/host/store.js) 的状态含 works、requests、questions、switching 等运行事实，不能直接解释为新核心可执行队列。
- [home-lock.js](https://github.com/IceFireIcer/DS-SuperAgent/blob/7b4009798dd066d06144dfa0ea51b5fec71328a8/ds-bot/src/host/home-lock.js) 的 token/心跳保护的是旧 home；它不核验新业务库的 Host epoch。旧 store 还有锁不可用时继续工作的路径，因此不能把旧锁或旧 PID 消失单独当成新旧交接完成证明。

结论是新协议需使用明确导出映射、不可执行历史和新入口激活屏障，不能直接复用 importTeam 作为整个 Super-agent 切换器；不需要也不允许修改 DSH。

## 选定协议

1. 导入到新的项目数据目录，来源为只读副本；记录 source profile 身份、schema/内容摘要、文件清单、Session 格式、缺失项、原对象到新对象的显式映射和批次 ID。原数据不改写，敏感数据不放进日志或研究材料。
2. 历史以隔离只读档案保存；角色和可共享记忆只按明确映射导入，不据此继承 Main Bot 权限。新执行使用新 Session/显式历史引用，不能因为旧历史可读就自动恢复旧 agent loop。格式不支持或历史缺失时保留原件并阻止要求完整历史的发布，不跳过后宣称成功。
3. 不导入旧锁、inflight、live Agent 或 works/requests/questions 为可执行意图；未完成、结果未知、人工停止的旧工作保留待核查条目，只有人工明确决定及当前授权才建立新 Ticket。
4. 用持久批次与校验清单完成 prepared 状态。相同来源/摘要重复导入复用映射；同批次内容改变报冲突，新批次需重新审阅。任何失败保持 staging 不可见，原资料与既有目标不被覆盖。
5. 切换先封住旧侧新输入消费和重启入口，停止/排空旧调度、回合、后台作业与外发，确认其静止；无证明则保持 quiescing。对无法终止或结果不明的部分保留 unknown、隔离受影响入口，不能仅靠换 epoch 宣称设备进程已停止。
6. 最终切点复核来源摘要/增量、输入游标与旧已接受回执，静止后生成最终一致快照并重新校验。切换空窗接收的输入持久缓冲，不能按本机时间戳猜归属；全限定来源身份及稳定 ID 贯穿旧、新消费记录。
7. 旧已接受输入保留其归属和结果/待核查状态；只有能证明未接受的新输入才可交给新核心。没有原生稳定 ID、连续游标或可靠回执时，相关历史/边界输入隔离并请求人工核查，不能承诺自动无损切换。
8. 在同一协调事务中发布 activation manifest、当前核心标识与新 epoch；只有当前有效入口可提交接受回执和 Effect 意图。启动重复或 COMMIT 应答丢失以原批次/命令 ID 对账，不重新激活或派活。新旧核心不同时消费同一入口。
9. 激活前可放弃 staging；旧入口停止后尚未激活时，可经重新核验为旧核心重新授权，沿用原归属账本，不重放已接受请求。激活后不做一键二进制降级：先停新入口并对账新副作用，经逆向交接才可恢复旧入口；默认保留新状态和只读旧历史。

这些是切换行为与验收契约。统一入口桥接、对旧回执的可信导出、进程静止证明、Session/文件真实导入均需在实施切片实现；旧核心不配合时采取停止/隔离及人工核查，不能悄悄退化为双消费者。

## 可复跑证据

```powershell
python super-agent-references/analysis/wayfinder/legacy-cutover-probe.py
```

[脚本](legacy-cutover-probe.py) 只生成虚构 JSON 与独立 SQLite 临时库；两个子进程分别在激活事务 COMMIT 前后主动退出，返回后所有连接关闭、临时目录清理。[结果](legacy-cutover-results.json) 为 14/14：2 组负对照及 12 组协议断言。负对照展示直接重放旧 work、独立消费回执导致重复意图；正例覆盖档案无派发、源字节不变、映射幂等、失败回滚、缺历史、跨来源身份、激活屏障、空窗输入、两种进程中断、旧代写入、回退边界与未知旧工作不重放。

SQLite 是真实运行，但状态机、旧/新消费桥接和静止证明为原创模型。未调用真实 importTeam/DSH/新 Engine，未运行 Windows 应用或远端设备，没有迁移真实数据。原生外部副作用 exactly-once 不由本实验保证；旧回执无法证明、非幂等写入结果不明时必须停在待核查边界。真实集成验收不能由这 14 组检查替代。
