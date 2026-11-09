# Host、Session 与设备作业执行所有权讨论（已确认）

日期：2026-11-03。对应[确定 Host、Session 与设备作业的执行所有权](https://github.com/IceFireIcer/DS-SuperAgent/issues/6)。本页记录用户已确认的取舍；完整 resolution 由决策票记录，实施验收仍按规格执行。

## 已确定的约束

- 一个 Instance 同时一个活动 Host；Ticket 与 Assignment、Session、设备 job 分别具有身份与生命周期。
- 人工 stop 持续有效；监督器可自动查证/安全重试及按参考恢复故障服务，任务纠偏/暂停前问人。
- 同 Instance 数据库协调锁和命令回执用于提交对账，不是跨设备进程已停止的证据。Session flush、显式写者 epoch fencing、稳定设备 job ID 及 incarnation 已有有限实验依据，自动租约与完整 Host 故障切换没有验收。
- 新 Assignment 启动前协调旧执行清理；只查询或取消 Host promise 不构成设备停止确认；旧结果不能改当前有效状态。

## 用户确认

用户确认：“全部按照推荐，但是你要先仔细考虑完善一下决定”。以下四项全部采纳，并按可验证协议收紧。

### 1. 执行权威链

持久执行权威链为：`Instance 协调行锁 → Host epoch/fencing token → Assignment 代次 → Session write epoch → Environment incarnation + device jobId`。每个领域写入、Session 回调、Assignment 回调和设备 job 回调都携带所属代次，在同一持久事务中核对当前有效值；旧 Host、旧 Assignment、旧 Session handle、旧设备实例或旧 job 回调一律被拒绝或记录为 stale。业务锁不代替设备进程已停止证明。

### 2. Host 故障接管

允许自动接管，但新 Host 必须在 Instance 锁内确认旧 Host 租约已过期或已经被持久 fencing，然后取得新 epoch；Watchdog 只能报告疑似失联，不能绕过这一步夺权。接管顺序固定为：取得锁和新 epoch → 读取 Ticket/Assignment/Session 状态 → 对账设备 incarnation/jobId 和外部未知结果 → 结束旧 Assignment → 以恢复说明创建新 Assignment → 恢复未实际进入 Session 的 Input。旧 Host 后来恢复时只能重新申请接入，不能使用旧 epoch 写入或派发。

自动接管只恢复原 Mandate 内可安全恢复的工作。无法证明旧执行已隔离、设备状态未知或外部副作用未知时，局部工作保持 unknown/等待人工；无关 Ticket 可继续。人工 stop、暂停约束和权限撤销优先于恢复，自动接管不能解除它们。

### 3. Session 与 Assignment

保留原 Ticket、Session、工作目录、授权和已 flush 历史；结束旧 Assignment，新建带恢复说明和新代次的 Assignment。Session 恢复遵循已验证的 flush/公开 replay 边界，不承诺 shell、半个模型 turn 或设备命令从原位置续跑。未实际进入 Session 的 Input 可恢复；进入历史的 Input 通过稳定 ID 去重。任何旧回调只能生成审计事实，不能改变当前 Assignment 或 Ticket。

### 4. 设备断连、停止与未知结果

已确认启动的设备 job 在原授权和设备本地时限内有界继续。Host 断连不等于作业已停止；重连或接管时先按 Environment incarnation + jobId 查询，不能重复或冲突启动。人工 stop 立即写入持久事实，使当前和未来自动恢复失效；设备离线时停止请求状态为 stopping/pending-device-confirmation，不能伪报 cancelled。只有设备确认同一 managed range 实际静止后才进入 cancelled；设备身份变化、job 查不到或外部结果仍不明时保留 unknown 并向用户提问。设备重新上线不能自动解除人工 stop。

### 5. 结果未知的局部等待

对可能已经发生的外部副作用，完成有界查证后只阻止受影响操作及依赖它的工作；保留 unknown，向用户提出一次带证据的问题。无关工作继续，等待期间去重通知，不自动重做、改目标或换设备。得到用户决定或可靠对账后，才通过原 command/job ID 继续、确认、补偿或终止。

## 后续整理范围

协议已由用户确认；实施时整理 Host epoch、Session handle、Assignment 和设备 job 的组合校验、更新边界与停止对账。时限/租约数值由实施时的故障预算及测试配置确定，不凭空指定产品 SLA；业务行锁不等于长期租约。不得把设计的 fencing 规则当成设备离线时已生效的远程隔离。

最终 resolution 只在实际人机确认后发布；当前票保持 open。
