## Resolution

采用 Instance + 持久来源实例 + 原生资源身份的无歧义元组键，kind 只选实现。来源身份由注册接收路径确定，不能来自正文自报；Thread、Actor、Channel 和 Policy 的来源部分都进入实例范围。同号资源、同名用户或同 native ID 不共享订阅与权限。

逻辑消息身份与版本事件分开，编辑保留历史；只以来源可核查版本更新当前投影。迟到旧版本不覆盖新版本或删除 tombstone，同版本异文/不可比版本保留冲突或 unknown 并查证。删除不自动撤销已有 Mandate 或等同人工 stop，也不能作为新的接单或关联依据。

跨信道关联要求同 Instance、可访问目标、唯一候选和已验证引用/上下文证据，保存来源事件、目标与决定，不扩大授权。相似度、URL、Ticket ID 不自行取得权限。接收时记录 fanout，context-only/机器人不取人类跟进归属；全部拥有者 handback 后才重评，不能立即关联回交回者。最小兼容映射要求明确部署范围和唯一目标，歧义保留待核查。

### 证据

原创内存重放模型 17 组断言通过：2 组负对照复现 kind+编号碰撞及 Actor 白名单串权；15 组正例覆盖双仓库/双聊天实例、正文伪造、结构化键、重试/编辑/删除乱序、冲突报告、跨信道关联、无效/模糊/多候选/无权限拒绝、handback 与快照重放。复核修复 tombstone 仍可 associate 的漏洞，并补拒绝用例。

[实验报告](https://github.com/IceFireIcer/DS-SuperAgent/blob/88d194370bc804b3665d8c5ff53a6facc57113cc/super-agent-references/analysis/wayfinder/source-identity.md)、[脚本](https://github.com/IceFireIcer/DS-SuperAgent/blob/88d194370bc804b3665d8c5ff53a6facc57113cc/super-agent-references/analysis/wayfinder/source-identity/probe.mjs)、[结果](https://github.com/IceFireIcer/DS-SuperAgent/blob/88d194370bc804b3665d8c5ff53a6facc57113cc/super-agent-references/analysis/wayfinder/source-identity/results.json) 保留在已推送 docs/research-source-identity 分支，无 PR/合并。

### 边界与后续

虚构整数版本与 verified/readable 标志是协议替身，没有验证真实平台版本次序、鉴权、引用解析、连接器、数据库或 DSH。冲突仅由模型报告，生产适配器须另存证据；快照重放不是崩溃恢复。兼容例子只证明唯一候选约束，完整导入仍归历史切换决定。完整 stopped/ended 行为继续按既有领域/状态原型验收。

来源切片必须逐 adapter 验证真实身份、版本、删除证据和不支持窗口；这些属于已有 D03/D05/D17 与 A15/A18 的实现验收，本轮不再追加泛化连接器决策。执行所有权、状态原型和切换仍由既有票承接。

仓库基线 1431 通过、2 跳过、0 失败；生成一致性通过；lint 退出 0、有既有警告。未改产品代码、未跑 host smoke。
