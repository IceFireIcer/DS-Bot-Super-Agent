## Question

采用什么最小隔离实验，验证固定 DSH Session 后端的写入屏障、live 事件路由和接管行为，满足共享持久化所需契约？

公开合约研究已查明第三方后端扩展位置；本任务验证 create、append、flush、close、resume，以及两个隔离进程争用同一 Session、写归属丢失后迟到 append 被拒绝、业务提交与 Session 回执中断后的对账。

先给出可复跑的最小 provider/协议实验、结果和选定的后端接管约束，不实现完整 PostgreSQL 产品后端。若实验只用替身而非真实共享数据库，应明确哪些保证仍未被证明，并形成必要的后续决定。全部使用虚构 Session 和独立测试数据。

依据：[确认 DSH Session 共享持久化与恢复合约](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/3)。研究结论不是运行验收，本任务用于补齐这一证据层。
