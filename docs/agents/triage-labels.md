# Triage labels

本次规格按用户显式调用的 to-spec 技能使用 ready-for-agent，表示规格可用于后续拆分与基线工作。标签不等于全部实现前提已验证，也不授予外部部署或发布权限。

- ready-for-agent：已形成自包含行为规格，可进入依赖拆分与实施。
- enhancement：沿用当前仓库已有的功能类型标签，本次架构规格使用此标签。

其他分诊角色与优先级沿用仓库贡献指南；本次不批量创建或改写标签体系。完整技能标签映射可在后续 setup-matt-pocock-skills 中补齐。

## 本轮功能与实施层级

- 功能父票仅用 enhancement 聚合交付范围，不能直接按单张实施票执行。
- T01—T55 实施子票使用 ready-for-agent、enhancement；标签表示已形成自包含契约，能否开始仍取决于原生 blockers、占用状态及 maintainer 规则。
- 总规格保留原标签和 open 状态；功能完成不能仅依据子票关闭数量，须核查对应功能场景证据。
