# Issue tracker

本项目使用 GitHub Issues：<https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues>。

- 依据：当前 origin 指向此 fork；仓库已启用 Issues。用户显式调用 to-spec，授权将本轮规格发布到项目追踪器。
- 规格以总体 Issue 保存，正文同时保留在项目文档中；发布前检查同标题和同范围 Issue，避免重试重复创建。
- 后续实施票使用 GitHub 原生子 Issue 和阻塞关系，本轮用户已明确委托代理决定审计补充、功能归组和发布。
- PRs as a request surface：off。既有仓库分支、Issue 占用与 maintainer 规则继续适用；本轮规划发布沿用现有资料工作区，不切换或改写用户分支。
- 本地规格与实施票资料放在 docs；官方参考与研究放在 super-agent-references。遵从用户明确目录约定。
- 本次仅记录当前任务所需配置；完整技能环境可通过 setup-matt-pocock-skills 补齐，配置修改遵从其流程与仓库规则。

## 当前规格

- [Spec: Rebuild DS Bot around the Super-agent architecture](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/1)
- 本地正文：[Super-agent 架构重建规格 v2.1](../superagent/spec.md)。
- 标签：ready-for-agent、enhancement。
- 实施结构为总规格 → G01—G14 功能父票 → T01—T53 实施子票；T54/T55 直接属于总规格。发布结果及原生关系以 [publication.json](../superagent/publication.json) 的回读验证记录为准。
- 功能父票使用 enhancement 聚合；实施子票使用 ready-for-agent 和 enhancement。实施只从已满足具体 blockers 的子票开始，不能将功能父票或总体规格误作单张可一次完成的实现任务。
- 每张实施票只有一个功能父票；跨功能依赖仍由子票的原生 blocked-by 表达，不新增整组阻塞。父票完成需子票证据及完整功能场景验收。

## Wayfinding operations

- 正式地图：[Super-agent 实施前关键技术决策](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/2)，作为总体规格的原生子 Issue；决策票是地图的原生子 Issue，研究结果出现后可继续添加必要的运行验证决定。
- 地图标签仅 wayfinder:map；决策票按类型只带 wayfinder:research、wayfinder:task、wayfinder:grilling 或 wayfinder:prototype。ready-for-agent 保留给规格/实施票。
- 当前登录开发者为 IceFireIcer。开始工作前用 assignee 认领；有人认领的票不重复接手。
- 子 Issue 使用 GitHub REST 的 issue/sub_issues 接口，新增时传数值 sub_issue_id；原生阻塞使用 issue/dependencies/blocked_by 接口，传阻塞方的数值 issue_id。
- 当前可开始集合由地图未关闭子 Issue、blocked_by 全部关闭、assignees 为空三个条件计算；查询时读取实时状态，不以正文编号列表代替。
- 问题正文保持为 Question；结论写 resolution comment，再关闭并在地图 Decisions so far 增加具名链接与一句话索引，不把完整结论复制到地图。
- 本地镜像与关系清单在 [决策图入口](../superagent/wayfinder/README.md)；研究在 super-agent-references 下保留。
- 用户已确认 dev 从 main 的 7b4009798dd066d06144dfa0ea51b5fec71328a8 建立；研究分支采用 docs/research-*，遵从仓库前缀规则，替代技能默认的研究分支前缀。
