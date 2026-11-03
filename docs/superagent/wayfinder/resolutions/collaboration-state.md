# 跟进、停止与恢复的协作状态决议

对应决策：[确认跟进、停止与恢复的协作状态模型](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/9)。用户确认四项推荐全部采用。

## 状态模型

- `Ticket` 表示持续的目标、授权和交付条件；`Assignment` 表示一次具体执行；`Session` 保留上下文与工具历史。
- 一个 Ticket 可以有连续换代的 Assignment，但同一时刻只有一个有效执行 Assignment。Assignment 换代不创建新的 Ticket。
- Assignment 的用户可见状态至少区分：`running`、`waiting-human`、`waiting-device`、`unknown`、`stopped` 和 `ready`。每种等待都明确显示下一步由 Worker、用户、设备或对账流程推动。

## 跟进与方向变化

跨信道的人类跟进回到原 Ticket、原 Worker 和原 Session；它作为新的稳定 Input 进入历史，方向版本递增，原 Mandate 和授权保持不变。结果可以按明确的沟通规则投递到最近的来源信道。跟进不会因为来源信道变化而重新创建工作或绕过原有授权；超出范围的要求必须形成新的决定和授权。

## 停止、恢复与等待

人工 stop 是持久约束：当前 Assignment 结束，Ticket 历史保留，CI、Watchdog、Host 重启和设备重新上线都不能自行恢复。只有用户明确恢复，才创建新的 Assignment，并重新核验授权；Ticket、Session 历史和工作目录可以保留。

`waiting-human` 表示结构化问题等待用户回答；`waiting-device` 表示设备或外部条件正常等待，不自动判定失败。用户回答可以让原 Worker 继续。设备重新上线只能解除设备等待，不能解除人工 stop。

## 未知结果与 Host 接管

`unknown` 表示外部操作可能已经发生但结果无法确认。只暂停受影响的工作及其依赖；无关工作继续。先按原 command/job ID 做有界查证，或向用户提出一次带证据的问题；在对账或用户决定前，不盲目重做、换设备或扩大目标。

Host 接管沿用执行所有权决议：新 Host 取得新 epoch，读取 Ticket/Session/Assignment，对账设备 job 和未知结果，结束旧 Assignment，再创建新 Assignment。旧 Host 的迟到回调只能记录为 stale，不能改变当前状态。Session flush/replay 保留历史和未读输入边界，不承诺半个模型 turn、shell 或设备命令从原位置续跑。

## 证据边界

这是用户确认的协作行为协议，不等于生产 UI 或完整 Host/设备故障切换已经验收。交互原型作为决策参考保留；实现时仍须通过 Domain Engine 公开命令与查询、来源/存储/Session/设备契约测试以及 Windows 和真实远端验收。
