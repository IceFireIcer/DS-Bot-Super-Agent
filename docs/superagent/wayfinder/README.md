# Super-agent 实施前决策图

正式地图：[Super-agent 实施前关键技术决策](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/2)。终点是明确技术前提、本地/远端双模式与安全切换边界，回填规格，达到可拆实施票状态。

## 当前开放决策

- [验证旧核心退出与历史导入的切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/10)：只读导入、唯一消费、安全回退与旧工作人工核查。

开放状态以 GitHub 原生子 Issue 和 blocked-by 实时查询为准。

## 最近完成

- [协作状态决议](resolutions/collaboration-state.md)：用户已确认四项规则，见对应票的 resolution comment。
- [双模式与交接决议](resolutions/execution-modes.md)：Instance local 默认、Ticket 约束、Assignment 绑定；本机控制面支持本地或远端执行；经安全边界、flush、作业对账及工作副本校验后换代。完整结论保留在对应票中。

本地图仅产出决定和证据；生产适配器、真实设备切换和用户数据迁移由后续实施票验收。项目材料放 docs 或 super-agent-references。
