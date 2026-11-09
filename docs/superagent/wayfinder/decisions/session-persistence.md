## Question

固定 DSH 版本的公开 SessionPersistence 合约，能否支持独立持久状态、单写所有权与 Host 替换后恢复？

核对 create/open/append/flush/close、实时写入、崩溃修复、跨进程所有权和后端热替换的事实，识别共享后端实现必须承担的责任。输出证据、明确的能力边界，以及需要后续运行实验或上游支持的最小问题；不把公开扩展接口的存在视为目标部署已经通过。

基线采用 DSH 原生 loop、SQLite 单机与 PostgreSQL 服务器方向，不重新选择产品架构。研究以官方版本化文档和源码为依据。关联规格：[存储、事务与所有权](https://github.com/IceFireIcer/DS-SuperAgent/issues/1)。
