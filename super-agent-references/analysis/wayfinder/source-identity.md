# 来源实例身份与跨信道归属实验

决策：[验证来源实例身份与跨信道归属冲突](https://github.com/IceFireIcer/DS-SuperAgent/issues/7)。日期：2026-11-02。

## 选定合约

1. Instance 是上下文边界，sourceInstanceId 是具体来源配置的持久身份；kind 只选实现。来源身份由已注册的接收路径给定，不能采用消息正文自报的账号、kind、Instance 或权限。来源配置须核查实际服务/仓库/租户/讨论范围；改到另一个身份范围不能沿用旧身份，重命名展示名称不应换身份。
2. 持久键采用无歧义的结构化元组。逻辑来源对象包含 Instance、来源实例、原生资源类型和身份；GitHub 的原生资源证据保留服务地址、仓库及资源类型/ID，不只保留编号。Thread、Actor、Channel 及 Policy 来源部分均带 Instance/来源实例。配置导入应避免为同一已确认范围重复生成身份；范围别名/迁移只能由显式映射决定。
3. 逻辑消息与版本事件分开：消息身份跨编辑不变，Trigger 身份包含可核查的原生版本与事件类型。传输重试 ID 不是消息身份。同版本重放去重；同版本异文或缺失可比版本时记录冲突/未知并查证，不能凭到达时间发明全序。历史事件不可变，当前投影只接受已确定较新的版本。
4. 删除有明确证据时形成 tombstone；迟到旧编辑不恢复它，删除内容不能成为新的接单或自动关联依据。删除不等于人工 stop，也不静默撤销既有 Mandate；历史依据保留。来源历史列表中未出现一条消息不构成删除证据。
5. 新消息先依实际来源和原生 Actor 验证准入。跨信道关联需属于同 Instance、可访问目标、唯一目标和已验证的引用/上下文证据，并保存 source event、目标与决定。URL、Ticket ID、正文相似度只提供候选，不能授予读取私密来源、扩大工作或外发权限。多候选、无效引用、无访问权均不自动订阅整条 Thread。
6. 订阅提供上下文与已定范围内的跟进，不自行产生新授权。接收时保存本条事件的 fanout/拥有者依据，不能由后来订阅反向赋予历史消息所有权。context-only 和机器人事件不取得人类跟进归属；剩余任一拥有者时 Router 不重复派活。handback 针对本事件及本 Ticket，全部交回后才能重评，不能立即关联回交回者；订阅继续用于后续事件。
7. 兼容映射保留旧键到新全限定键的显式记录。必须有受信部署配置、唯一目标、正确 Instance 和资源证据；缺少或歧义时保留未映射原因，不按文本相似度、同用户名或同编号猜测。本实验仅验证“多候选拒绝”的最小映射例子，未实现完整历史导入。

## 证据

从本分支仓库根目录运行：

```powershell
node super-agent-references/analysis/wayfinder/source-identity/probe.mjs
```

[原创实验](source-identity/probe.mjs)、[结构化结果](source-identity/results.json)：Node v25.4.0 Windows，无依赖、账号或用户数据。17 组断言通过，包含 2 组负对照（kind+编号碰撞、Actor 单独白名单串权）及 15 组正例。

正例覆盖双仓库与双聊天实例的同 ID、事件/对象/Thread/Actor/Channel 分离、来源范围检查和正文伪造、元组分隔符、重复与编辑、删除后乱序、同版本冲突报告、编辑继续原工作、跨信道关联证据、模糊/多候选/无权限拒绝、多 owner handback、context-only/机器人、快照重放，以及兼容映射唯一性。

复核发现并修正了当前 tombstone 仍可 associate 的漏洞，补充删除拒绝及目标访问权负例；明确冲突仅由模型返回报告，没有持久隔离日志。生产适配器仍需记录冲突证据。原型的 fanout 依据也落实为接收快照，避免后来订阅追认旧消息。

## 原型事实

固定提交 `6337fc823ce20251c8de8085948165c81aaa701e`，本轮读取本地对应参考快照，未修改官方文件：

- [SourceRegistry](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/registry.ts#L20)：按 kind 唯一注册，resolve 的 id 固定为 kind，不能直接表达同 kind 多实例。
- [GitHub Trigger](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/github-trigger.ts#L65)：Thread/Channel 使用编号；评论版本含更新时间，初始 Issue ID 仅编号。不能据此声称通用编辑模型已存在。
- [飞书 Trigger](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/feishu-trigger.ts#L16)：Trigger 仅消息 ID；编辑版本需要本项目明确适配。
- [followupOwners](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/model.ts#L75) 和 [handback](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L178)：基于实际 fanout、context 与交回记录判断拥有者，不能把上下文相关性当成任务授权。

## 限制和实施验收

这是原创内存协议模型，source version 为虚构可比较整数，verified/readable 是受信判定结果的替身。没有验证真实 GitHub/飞书的版本次序、webhook 签名、资源访问权、分页/游标、OAuth、语义引用解析、数据库持久化、DSH、完整 stopped/ended 状态或连接器。快照恢复只证明结构化数据重放，不等于进程崩溃恢复。

实现来源切片时，每个 adapter 必须提供其真实身份/版本/删除证据的映射与不支持窗口；无法排序的事件保留 unknown 并重新读取核查。相关行为已有 D03/D05/D17 与 A15/A18 验收范围，本轮没有发现需要新增架构选择的问题，不追加泛化的“验证完整连接器”决策票。人机状态原型、权限边界与历史切换继续由现有票处理。

仓库基线回归：1431 通过、2 跳过、0 失败；生成一致性检查通过；lint 退出 0、有既有警告。产品代码未改，未跑 host smoke；这不代表 Super-agent 真实集成通过。
