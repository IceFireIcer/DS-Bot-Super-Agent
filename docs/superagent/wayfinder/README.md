# Super-agent 实施前决策图

正式地图：[Super-agent 实施前关键技术决策](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/2)。当前终点包括明确纯本地与本地控制远端设备两种运行方式及安全切换边界，然后回填规格到可拆实施票的状态。

开放决策按 GitHub 原生子 Issue 和 blocked-by 关系查询；本地 `map.md` 是地图正文镜像。

## 当前开放决策

- [确认跟进、停止与恢复的协作状态模型](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/9)：用户确认跨信道跟进、人工停止、等待状态和 Host 接管规则，已进入 resolution。
- [验证旧核心退出与历史导入的切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/10)：验证只读导入、唯一消费与安全回退边界。
- [确定本地与远端双模式的执行目标与 Assignment 切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/14)：依赖协作状态模型，确定本地/远端目标、权限和运行中切换边界。

本地与远端双模式问题正文见 [execution-modes.md](decisions/execution-modes.md)。Issue 14 是待讨论决策，不代表切换策略已经定案。

协作状态决议见 [collaboration-state.md](resolutions/collaboration-state.md)。

用户指定项目资料放在既有 `docs/` 与 `super-agent-references/` 中；本图内只产出决策与证据，不实现生产功能。
