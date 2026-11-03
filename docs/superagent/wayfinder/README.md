# Super-agent 实施前决策图

正式地图：[Super-agent 实施前关键技术决策](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/2)。十二项决策已完成；地图中的具体前置问题已定案，完整证据与限制留在各决策票。

最新结论：[旧核心切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/10#issuecomment-6601672028)，本地镜像见 [决议](resolutions/legacy-cutover.md)，研究入口见 [参考资料](../../../super-agent-references/README.md)。

本地图的结束意味着可以进入 to-spec 汇总及 to-tickets 拆分，不代表生产功能、真实 DSH/设备交接或用户迁移已验收。实施票必须携带对应证据边界与故障场景。

其他已定协议包含 [双模式切换](resolutions/execution-modes.md)、[协作状态](resolutions/collaboration-state.md) 与 [执行所有权](resolutions/execution-ownership.md)。本地 map.md 是正式地图正文镜像，manifest.json 保存票与原生依赖关系。

协作状态 HTML 原型已按用户要求删除，不再作为实现参考。已通过具体场景对话确认的行为协议继续有效；页面布局、视觉设计和交互方式不受该原型约束。DeepSeek 官方文章与官方研究原型保持原样。
