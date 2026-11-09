# Super-agent 参考资料与研究

## 总体方案

[DS Bot Super-agent 总体实现方案 v1](../docs/plans/2026-11-02-superagent-overall-plan.md) 说明目标架构、实施顺序、依赖和验收标准。

[Super-agent 架构重建规格 v2.1](../docs/superagent/spec.md) 将已定方案展开为用户故事、行为契约、测试接口和验收场景，用于后续实施票拆分。

规格已发布为 [GitHub 总体规格](https://github.com/IceFireIcer/DS-Bot-SuperAgent/issues/1)，实施文档入口见 [docs/superagent](../docs/superagent/README.md)。

## 官方参考

- [官方文章 Markdown](super-agent%20reference/super-agent.md)：Super-agent 的设计目标、机制、实验与开放问题，配图保留在原目录。
- [官方原型](dsh-superagent-prototype/README.md)：原始设计文档、源码与测试，作为研究依据保留。

## 本项目的研究与实验

以下内容是本项目对官方资料的分析，不属于官方原型：

- [领域研究](analysis/domain.md)：事件、订阅、授权与任务生命周期。
- [执行研究](analysis/execution.md)：执行、并发、持久化与恢复。
- [来源与交互研究](analysis/sources.md)：来源实例、提示词、发信与部署。
- [领域实验脚本](analysis/core-probe.mts) 与 [实验结果](analysis/core-probe-results.json)：7 组内存实验，不代表完整原型或真实 DSH 验收。
- [异步事务合约实验](analysis/wayfinder/async-transactions.md)：显式异步事务、状态/Effects 原子性、并发与中断恢复，含可复跑脚本及证据边界。

从仓库根目录复跑实验：

```powershell
node --experimental-transform-types super-agent-references/analysis/core-probe.mts
```

项目方案放在 `docs/`，围绕这些参考材料的研究和实验放在本目录的 `analysis/`；官方资料与本项目分析分别保存。

- [来源身份与跨信道归属实验](analysis/wayfinder/source-identity.md)：实例隔离、编辑/删除重放、关联证据与 handback，含脚本、结果和证据边界。

- [Session 运行协议实验](analysis/wayfinder/session-runtime.md)：固定 DSH 公共接口、flush 屏障、两进程竞争、显式写权隔离和回执对账。

- [远程执行环境一致性实验](analysis/wayfinder/remote-runtime.md)：配套能力、设备侧搜索、稳定 job ID、断连重读与取消确认。

- [PostgreSQL 写锁与提交结果对账实验](analysis/wayfinder/postgres-runtime.md)：真实行锁、SQLSTATE、整事务重试及COMMIT应答丢失。

- [官方资料覆盖审计（2026-11-03）](analysis/reference-coverage-audit-2026-11-03.md)：文章逐节与 prototype 行为对照，列出 8 组规格/实施票细节缺口及建议落点；不代表产品运行验收。

- [审计补充处置与功能层级](../docs/superagent/audit-disposition.md)：F01—F08 已落实为规格与逐票验收，按总规格、14 个功能父票和 55 个实施票组织；实际发布核查见项目文档。

## 官方快照与项目研究

官方文章、配图与 prototype checkout 是本地参考快照，保留原目录并忽略提交；项目原创 analysis、脚本、结果和索引随仓库发布。prototype 固定于 [官方提交 6337fc8](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e)。需要复跑依赖该快照的实验时，将官方仓库检出到 `super-agent-references/dsh-superagent-prototype` 并核对该提交；不改动官方代码。

[规划分支归档](../docs/superagent/branch-archives.md)保留原研究和决议的全部提交。
