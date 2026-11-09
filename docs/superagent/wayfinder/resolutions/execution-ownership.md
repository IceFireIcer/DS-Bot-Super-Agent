# Host、Session 与设备作业执行所有权决议

对应决策：[确定 Host、Session 与设备作业的执行所有权](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/6)。

## 决议

采用一条可持久核验的执行权威链：

`Instance 协调行锁 → Host epoch/fencing token → Assignment 代次 → Session write epoch → Environment incarnation + device jobId`

每个领域写入、Session 回调、Assignment 回调和设备 job 回调都必须携带所属代次，并在同一个持久事务中核对当前有效值。旧 Host、旧 Assignment、旧 Session handle、旧设备实例或旧 job 回调必须被拒绝，或只记录为 stale 审计事实；它们不能改变当前 Ticket、Assignment、Session 或 Effect。Instance 业务锁证明的是业务写入的顺序与所有权，不证明设备上的进程已经停止。

## Host 接管

允许在原 Mandate 内自动接管，但 Watchdog 只能报告疑似失联，不能绕过持久所有权步骤夺权。新 Host 必须在 Instance 协调锁内确认旧租约已经过期，或已经由持久 fencing 隔离，然后取得新的 epoch。接管顺序固定为：

1. 取得 Instance 协调锁和新的 Host epoch。
2. 读取 Ticket、Assignment 与 Session 的持久状态。
3. 按 `Environment incarnation + device jobId` 对账设备作业，并查明已提交但结果未知的外部操作。
4. 结束旧 Assignment。
5. 创建带恢复说明和新代次的新 Assignment。
6. 只恢复尚未实际进入 Session 的 Input；已经进入历史的 Input 通过稳定消息 ID 去重。

旧 Host 后来恢复时必须重新申请接入，不能使用旧 epoch 写入、派发或确认。无法证明旧执行已经隔离、设备状态未知或外部副作用未知时，受影响的工作保持 `unknown` 或等待人工；无关 Ticket 可以继续。人工 stop、暂停和权限撤销优先于自动恢复，接管不能解除它们。

## Session 与 Assignment 边界

接管保留原 Ticket、Session、工作目录、授权和已 flush 的 Session 历史；它结束旧 Assignment，并创建带恢复说明和新代次的 Assignment。恢复遵循已验证的公开 Session flush/replay 边界，不承诺 shell、半个模型 turn 或设备命令从原位置续跑。未进入 Session 的 Input 可以恢复；进入历史的 Input 只能按稳定 ID 去重。任何旧回调都可以留下审计事实，但不能修改当前 Assignment 或 Ticket。

## 设备断连、停止与未知结果

已确认启动的设备 job 可以在原授权和设备本地时限内有界继续。Host 断连不等于设备作业停止；重连或接管必须先用 `Environment incarnation + jobId` 查询，未确认旧作业状态前不得启动冲突的新执行。

人工 stop 立即写入持久事实，使当前和未来自动恢复失效。设备离线时停止请求进入 `stopping` 或 `pending-device-confirmation`，不能伪报 `cancelled`。只有设备确认相同 managed range 实际静止后，才能进入 `cancelled`。设备身份变化、job 查不到或外部结果仍不明时保持 `unknown`，向用户提出一次带证据的具体问题；设备重新上线也不能自动解除人工 stop。

对可能已经发生的外部副作用，完成有界查证后只阻止受影响操作及其依赖；无关工作继续。等待期间通知去重，不自动重做、改目标或换设备。只有用户作出决定或可靠对账完成后，才使用原 command/job ID 继续、确认、补偿或终止。

## 用户确认与证据边界

用户确认四项推荐：按动作级别预先授权；Watchdog 可在原授权内查证与安全重试；任务纠偏或暂停前先询问用户；服务故障按参考流程优雅重启，尊重人工 stop，不强杀、不因配置或初始化缺失而重启。

支撑证据包括：公开 DSH Session/SQLite 写入屏障与 epoch 实验 8 组、远程执行环境与 scope 实验 10 组、真实 PostgreSQL 17.11 锁与提交未知实验 11 组，以及异步事务和来源身份实验。尚未证明完整生产后端、自动租约实现、真实 Host 故障切换、跨设备隔离和远程 exactly-once；这些仍是实施切片的验收边界，不能从本决议推导为已完成能力。
