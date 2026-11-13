# Super-agent 实施入口

[总体规格 v2.1](https://github.com/IceFireIcer/DS-SuperAgent/issues/1)已补入官方资料审计的八组行为细节。采用总规格 → 功能父票 → 实施子票；跨功能阻塞绑定具体子票。

## 功能父票

| 功能 | 子票 | 外部具体前置 |
| --- | --- | --- |
| [G01 本地接单与执行闭环](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | T01、T02、T03、T04、T05 | 无 |
| [G02 持续协作与人工控制](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | T06、T07、T08、T09、T10 | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31)、[T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33) |
| [G03 并发与异步执行](https://github.com/IceFireIcer/DS-SuperAgent/issues/17) | T11、T12、T13、T14 | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31)、[T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34)、[T09](https://github.com/IceFireIcer/DS-SuperAgent/issues/37) |
| [G04 持久化与故障恢复](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | T15、T16、T17、T18、T19、T20 | [T01](https://github.com/IceFireIcer/DS-SuperAgent/issues/29)、[T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30)、[T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34)、[T08](https://github.com/IceFireIcer/DS-SuperAgent/issues/36)、[T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40) |
| [G05 上下文读取与会话换代](https://github.com/IceFireIcer/DS-SuperAgent/issues/19) | T21、T22 | [T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34)、[T19](https://github.com/IceFireIcer/DS-SuperAgent/issues/47) |
| [G06 配置与监督界面](https://github.com/IceFireIcer/DS-SuperAgent/issues/20) | T23、T24、T49 | [T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30)、[T14](https://github.com/IceFireIcer/DS-SuperAgent/issues/42)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46)、[T19](https://github.com/IceFireIcer/DS-SuperAgent/issues/47)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T45](https://github.com/IceFireIcer/DS-SuperAgent/issues/73) |
| [G07 GitHub 跨信道协作](https://github.com/IceFireIcer/DS-SuperAgent/issues/21) | T25、T26、T27 | [T07](https://github.com/IceFireIcer/DS-SuperAgent/issues/35)、[T14](https://github.com/IceFireIcer/DS-SuperAgent/issues/42)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49) |
| [G08 定时与主动准备](https://github.com/IceFireIcer/DS-SuperAgent/issues/22) | T28、T29 | [T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33)、[T10](https://github.com/IceFireIcer/DS-SuperAgent/issues/38)、[T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46) |
| [G09 飞书协作](https://github.com/IceFireIcer/DS-SuperAgent/issues/23) | T30、T31 | [T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46) |
| [G10 远端设备执行](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | T32、T33、T34、T35、T36、T37、T38 | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31)、[T10](https://github.com/IceFireIcer/DS-SuperAgent/issues/38)、[T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40)、[T13](https://github.com/IceFireIcer/DS-SuperAgent/issues/41)、[T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45)、[T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51) |
| [G11 本地与远端执行交接](https://github.com/IceFireIcer/DS-SuperAgent/issues/25) | T39、T40、T41 | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T36](https://github.com/IceFireIcer/DS-SuperAgent/issues/64) |
| [G12 托管与客户端常驻](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | T42、T43、T44、T45、T46 | [T15](https://github.com/IceFireIcer/DS-SuperAgent/issues/43)、[T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45)、[T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T24](https://github.com/IceFireIcer/DS-SuperAgent/issues/52)、[T35](https://github.com/IceFireIcer/DS-SuperAgent/issues/63) |
| [G13 Watchdog 运维与语义监督](https://github.com/IceFireIcer/DS-SuperAgent/issues/27) | T47、T48 | [T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T24](https://github.com/IceFireIcer/DS-SuperAgent/issues/52)、[T44](https://github.com/IceFireIcer/DS-SuperAgent/issues/72)、[T46](https://github.com/IceFireIcer/DS-SuperAgent/issues/74) |
| [G14 旧核心迁移与切换](https://github.com/IceFireIcer/DS-SuperAgent/issues/28) | T50、T51、T52、T53 | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T45](https://github.com/IceFireIcer/DS-SuperAgent/issues/73) |

功能父票的外部前置是子票依赖的汇总，不表示本功能整体等待。按 ready-for-agent 子票、实际 blocked-by 已关闭、未被他人占用且无 maintainer 限制选择可开始工作。

## 实施子票

| 子票 | 功能归属 | 直接阻塞 |
| --- | --- | --- |
| [T01 建立隔离实例的持久接单与查询闭环](https://github.com/IceFireIcer/DS-SuperAgent/issues/29) | [G01](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | 无 |
| [T02 通过原生 Router 与 Worker 返回首个结果](https://github.com/IceFireIcer/DS-SuperAgent/issues/30) | [G01](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | [T01](https://github.com/IceFireIcer/DS-SuperAgent/issues/29) |
| [T03 在绑定的本地工作目录完成实际工具任务](https://github.com/IceFireIcer/DS-SuperAgent/issues/31) | [G01](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | [T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30) |
| [T04 正确接收来源版本、删除与身份冲突](https://github.com/IceFireIcer/DS-SuperAgent/issues/32) | [G01](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | [T01](https://github.com/IceFireIcer/DS-SuperAgent/issues/29) |
| [T05 对新请求进行有依据的批量研判](https://github.com/IceFireIcer/DS-SuperAgent/issues/33) | [G01](https://github.com/IceFireIcer/DS-SuperAgent/issues/15) | [T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30)、[T04](https://github.com/IceFireIcer/DS-SuperAgent/issues/32) |
| [T06 跟进原工作并恢复自然结束的任务](https://github.com/IceFireIcer/DS-SuperAgent/issues/34) | [G02](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | [T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33) |
| [T07 处理多订阅、只读上下文与越界交回](https://github.com/IceFireIcer/DS-SuperAgent/issues/35) | [G02](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | [T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34) |
| [T08 就地提出人工问题并由授权回答继续](https://github.com/IceFireIcer/DS-SuperAgent/issues/36) | [G02](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | [T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34) |
| [T09 持久停止本地工作并显式恢复](https://github.com/IceFireIcer/DS-SuperAgent/issues/37) | [G02](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31)、[T08](https://github.com/IceFireIcer/DS-SuperAgent/issues/36) |
| [T10 调整策略和暂停处理而不丢失输入](https://github.com/IceFireIcer/DS-SuperAgent/issues/38) | [G02](https://github.com/IceFireIcer/DS-SuperAgent/issues/16) | [T09](https://github.com/IceFireIcer/DS-SuperAgent/issues/37) |
| [T11 并行两项工作并优先处理人工跟进](https://github.com/IceFireIcer/DS-SuperAgent/issues/39) | [G03](https://github.com/IceFireIcer/DS-SuperAgent/issues/17) | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31)、[T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34) |
| [T12 长命令异步执行并把完成事件送回原 Worker](https://github.com/IceFireIcer/DS-SuperAgent/issues/40) | [G03](https://github.com/IceFireIcer/DS-SuperAgent/issues/17) | [T09](https://github.com/IceFireIcer/DS-SuperAgent/issues/37)、[T11](https://github.com/IceFireIcer/DS-SuperAgent/issues/39) |
| [T13 子代理与 Agent Team 继承工作授权和环境](https://github.com/IceFireIcer/DS-SuperAgent/issues/41) | [G03](https://github.com/IceFireIcer/DS-SuperAgent/issues/17) | [T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40) |
| [T14 交付验收时释放执行槽并管理预览服务](https://github.com/IceFireIcer/DS-SuperAgent/issues/42) | [G03](https://github.com/IceFireIcer/DS-SuperAgent/issues/17) | [T13](https://github.com/IceFireIcer/DS-SuperAgent/issues/41) |
| [T15 用 SQLite 持久恢复完整 Session 生命周期](https://github.com/IceFireIcer/DS-SuperAgent/issues/43) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30) |
| [T16 重启后恢复未处理输入而不重复追加历史](https://github.com/IceFireIcer/DS-SuperAgent/issues/44) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34)、[T15](https://github.com/IceFireIcer/DS-SuperAgent/issues/43) |
| [T17 可靠执行事务意图并对账未知命令提交](https://github.com/IceFireIcer/DS-SuperAgent/issues/45) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T01](https://github.com/IceFireIcer/DS-SuperAgent/issues/29) |
| [T18 按消息用途可靠发送并呈现真实回执](https://github.com/IceFireIcer/DS-SuperAgent/issues/46) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T08](https://github.com/IceFireIcer/DS-SuperAgent/issues/36)、[T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45) |
| [T19 原任务换代恢复并隔离迟到回调](https://github.com/IceFireIcer/DS-SuperAgent/issues/47) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40)、[T16](https://github.com/IceFireIcer/DS-SuperAgent/issues/44)、[T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45) |
| [T20 在本机协调 Host 写权与合法接管](https://github.com/IceFireIcer/DS-SuperAgent/issues/48) | [G04](https://github.com/IceFireIcer/DS-SuperAgent/issues/18) | [T19](https://github.com/IceFireIcer/DS-SuperAgent/issues/47) |
| [T21 沿证据卡片和分页入口读取完整上下文](https://github.com/IceFireIcer/DS-SuperAgent/issues/49) | [G05](https://github.com/IceFireIcer/DS-SuperAgent/issues/19) | [T06](https://github.com/IceFireIcer/DS-SuperAgent/issues/34) |
| [T22 上下文满后换 Session 并继续未完成工作](https://github.com/IceFireIcer/DS-SuperAgent/issues/50) | [G05](https://github.com/IceFireIcer/DS-SuperAgent/issues/19) | [T19](https://github.com/IceFireIcer/DS-SuperAgent/issues/47)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49) |
| [T23 按版本配置角色、模型、提示词与技能](https://github.com/IceFireIcer/DS-SuperAgent/issues/51) | [G06](https://github.com/IceFireIcer/DS-SuperAgent/issues/20) | [T02](https://github.com/IceFireIcer/DS-SuperAgent/issues/30) |
| [T24 从监督视图追查需要人处理的工作](https://github.com/IceFireIcer/DS-SuperAgent/issues/52) | [G06](https://github.com/IceFireIcer/DS-SuperAgent/issues/20) | [T14](https://github.com/IceFireIcer/DS-SuperAgent/issues/42)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46)、[T19](https://github.com/IceFireIcer/DS-SuperAgent/issues/47)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49) |
| [T25 从真实 GitHub 来源可靠接收 Issue、PR 与评审事件](https://github.com/IceFireIcer/DS-SuperAgent/issues/53) | [G07](https://github.com/IceFireIcer/DS-SuperAgent/issues/21) | [T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46) |
| [T26 跟踪真实 PR 交付条件直至工作结束](https://github.com/IceFireIcer/DS-SuperAgent/issues/54) | [G07](https://github.com/IceFireIcer/DS-SuperAgent/issues/21) | [T14](https://github.com/IceFireIcer/DS-SuperAgent/issues/42)、[T25](https://github.com/IceFireIcer/DS-SuperAgent/issues/53) |
| [T27 跨桌面与 GitHub 修正方向并更新交付位置](https://github.com/IceFireIcer/DS-SuperAgent/issues/55) | [G07](https://github.com/IceFireIcer/DS-SuperAgent/issues/21) | [T07](https://github.com/IceFireIcer/DS-SuperAgent/issues/35)、[T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T25](https://github.com/IceFireIcer/DS-SuperAgent/issues/53) |
| [T28 用定时来源产生可追溯且不重复的候选](https://github.com/IceFireIcer/DS-SuperAgent/issues/56) | [G08](https://github.com/IceFireIcer/DS-SuperAgent/issues/22) | [T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33) |
| [T29 在规则预算内主动准备可审阅结果](https://github.com/IceFireIcer/DS-SuperAgent/issues/57) | [G08](https://github.com/IceFireIcer/DS-SuperAgent/issues/22) | [T10](https://github.com/IceFireIcer/DS-SuperAgent/issues/38)、[T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40)、[T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46)、[T28](https://github.com/IceFireIcer/DS-SuperAgent/issues/56) |
| [T30 接收飞书讨论并保持来源归属](https://github.com/IceFireIcer/DS-SuperAgent/issues/58) | [G09](https://github.com/IceFireIcer/DS-SuperAgent/issues/23) | [T05](https://github.com/IceFireIcer/DS-SuperAgent/issues/33) |
| [T31 在飞书就地回答问题并可靠交付](https://github.com/IceFireIcer/DS-SuperAgent/issues/59) | [G09](https://github.com/IceFireIcer/DS-SuperAgent/issues/23) | [T18](https://github.com/IceFireIcer/DS-SuperAgent/issues/46)、[T30](https://github.com/IceFireIcer/DS-SuperAgent/issues/58) |
| [T32 配对授权远端设备并完成文件与搜索任务](https://github.com/IceFireIcer/DS-SuperAgent/issues/60) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T03](https://github.com/IceFireIcer/DS-SuperAgent/issues/31) |
| [T33 在远端启动稳定身份的命令并续读输出](https://github.com/IceFireIcer/DS-SuperAgent/issues/61) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T12](https://github.com/IceFireIcer/DS-SuperAgent/issues/40)、[T32](https://github.com/IceFireIcer/DS-SuperAgent/issues/60) |
| [T34 确认远端 PTY 与进程树真正停止](https://github.com/IceFireIcer/DS-SuperAgent/issues/62) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T13](https://github.com/IceFireIcer/DS-SuperAgent/issues/41)、[T33](https://github.com/IceFireIcer/DS-SuperAgent/issues/61) |
| [T35 设备断连与 daemon 重启后对账原作业](https://github.com/IceFireIcer/DS-SuperAgent/issues/63) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45)、[T34](https://github.com/IceFireIcer/DS-SuperAgent/issues/62) |
| [T36 选择本地、远端或自动目标并固定执行绑定](https://github.com/IceFireIcer/DS-SuperAgent/issues/64) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T10](https://github.com/IceFireIcer/DS-SuperAgent/issues/38)、[T35](https://github.com/IceFireIcer/DS-SuperAgent/issues/63) |
| [T37 在远端保持附件、spill 与技能路径一致](https://github.com/IceFireIcer/DS-SuperAgent/issues/65) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T35](https://github.com/IceFireIcer/DS-SuperAgent/issues/63) |
| [T38 明确本地浏览器、MCP 与 Office 的能力位置](https://github.com/IceFireIcer/DS-SuperAgent/issues/66) | [G10](https://github.com/IceFireIcer/DS-SuperAgent/issues/24) | [T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T36](https://github.com/IceFireIcer/DS-SuperAgent/issues/64) |
| [T39 准备并核验可交接的跨设备工作副本](https://github.com/IceFireIcer/DS-SuperAgent/issues/67) | [G11](https://github.com/IceFireIcer/DS-SuperAgent/issues/25) | [T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T36](https://github.com/IceFireIcer/DS-SuperAgent/issues/64) |
| [T40 在安全边界双向交接执行环境](https://github.com/IceFireIcer/DS-SuperAgent/issues/68) | [G11](https://github.com/IceFireIcer/DS-SuperAgent/issues/25) | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T39](https://github.com/IceFireIcer/DS-SuperAgent/issues/67) |
| [T41 在运行、断连或交接中断时守住切换约束](https://github.com/IceFireIcer/DS-SuperAgent/issues/69) | [G11](https://github.com/IceFireIcer/DS-SuperAgent/issues/25) | [T40](https://github.com/IceFireIcer/DS-SuperAgent/issues/68) |
| [T42 用 PostgreSQL 完成同一领域命令与提交对账](https://github.com/IceFireIcer/DS-SuperAgent/issues/70) | [G12](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | [T17](https://github.com/IceFireIcer/DS-SuperAgent/issues/45) |
| [T43 用共享后端持久恢复原生 Session](https://github.com/IceFireIcer/DS-SuperAgent/issues/71) | [G12](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | [T15](https://github.com/IceFireIcer/DS-SuperAgent/issues/43) |
| [T44 替换服务器 Host 并继续原工作](https://github.com/IceFireIcer/DS-SuperAgent/issues/72) | [G12](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T35](https://github.com/IceFireIcer/DS-SuperAgent/issues/63)、[T42](https://github.com/IceFireIcer/DS-SuperAgent/issues/70)、[T43](https://github.com/IceFireIcer/DS-SuperAgent/issues/71) |
| [T45 认证客户端接入并在断连后补读结果](https://github.com/IceFireIcer/DS-SuperAgent/issues/73) | [G12](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | [T24](https://github.com/IceFireIcer/DS-SuperAgent/issues/52) |
| [T46 在 Windows 常驻 Host 并独立关闭客户端](https://github.com/IceFireIcer/DS-SuperAgent/issues/74) | [G12](https://github.com/IceFireIcer/DS-SuperAgent/issues/26) | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T45](https://github.com/IceFireIcer/DS-SuperAgent/issues/73) |
| [T47 用独立 Watchdog 分类恢复故障服务](https://github.com/IceFireIcer/DS-SuperAgent/issues/75) | [G13](https://github.com/IceFireIcer/DS-SuperAgent/issues/27) | [T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T44](https://github.com/IceFireIcer/DS-SuperAgent/issues/72)、[T46](https://github.com/IceFireIcer/DS-SuperAgent/issues/74) |
| [T48 识别无效循环并先提出语义干预建议](https://github.com/IceFireIcer/DS-SuperAgent/issues/76) | [G13](https://github.com/IceFireIcer/DS-SuperAgent/issues/27) | [T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T24](https://github.com/IceFireIcer/DS-SuperAgent/issues/52) |
| [T49 经受信指令在线修改版本化行为配置](https://github.com/IceFireIcer/DS-SuperAgent/issues/77) | [G06](https://github.com/IceFireIcer/DS-SuperAgent/issues/20) | [T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51)、[T45](https://github.com/IceFireIcer/DS-SuperAgent/issues/73) |
| [T50 将旧团队资料导入可核验的只读历史档案](https://github.com/IceFireIcer/DS-SuperAgent/issues/78) | [G14](https://github.com/IceFireIcer/DS-SuperAgent/issues/28) | [T21](https://github.com/IceFireIcer/DS-SuperAgent/issues/49)、[T23](https://github.com/IceFireIcer/DS-SuperAgent/issues/51) |
| [T51 停用旧消费并核清切换空窗输入归属](https://github.com/IceFireIcer/DS-SuperAgent/issues/79) | [G14](https://github.com/IceFireIcer/DS-SuperAgent/issues/28) | [T20](https://github.com/IceFireIcer/DS-SuperAgent/issues/48)、[T45](https://github.com/IceFireIcer/DS-SuperAgent/issues/73)、[T50](https://github.com/IceFireIcer/DS-SuperAgent/issues/78) |
| [T52 原子激活新核心并恢复唯一消费](https://github.com/IceFireIcer/DS-SuperAgent/issues/80) | [G14](https://github.com/IceFireIcer/DS-SuperAgent/issues/28) | [T51](https://github.com/IceFireIcer/DS-SuperAgent/issues/79) |
| [T53 激活前放弃或激活后逆向交接旧核心](https://github.com/IceFireIcer/DS-SuperAgent/issues/81) | [G14](https://github.com/IceFireIcer/DS-SuperAgent/issues/28) | [T52](https://github.com/IceFireIcer/DS-SuperAgent/issues/80) |
| [T54 比较协作负载并确认已声明的资源预算](https://github.com/IceFireIcer/DS-SuperAgent/issues/82) | [总规格](https://github.com/IceFireIcer/DS-SuperAgent/issues/1) | [T22](https://github.com/IceFireIcer/DS-SuperAgent/issues/50)、[T27](https://github.com/IceFireIcer/DS-SuperAgent/issues/55)、[T29](https://github.com/IceFireIcer/DS-SuperAgent/issues/57)、[T31](https://github.com/IceFireIcer/DS-SuperAgent/issues/59)、[T41](https://github.com/IceFireIcer/DS-SuperAgent/issues/69)、[T47](https://github.com/IceFireIcer/DS-SuperAgent/issues/75)、[T48](https://github.com/IceFireIcer/DS-SuperAgent/issues/76) |
| [T55 验收四目标的完整产品协作场景](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | [总规格](https://github.com/IceFireIcer/DS-SuperAgent/issues/1) | [T26](https://github.com/IceFireIcer/DS-SuperAgent/issues/54)、[T37](https://github.com/IceFireIcer/DS-SuperAgent/issues/65)、[T38](https://github.com/IceFireIcer/DS-SuperAgent/issues/66)、[T49](https://github.com/IceFireIcer/DS-SuperAgent/issues/77)、[T53](https://github.com/IceFireIcer/DS-SuperAgent/issues/81)、[T54](https://github.com/IceFireIcer/DS-SuperAgent/issues/82)、[T56](https://github.com/IceFireIcer/DS-SuperAgent/issues/90)、[T57](https://github.com/IceFireIcer/DS-SuperAgent/issues/91)、[T58](https://github.com/IceFireIcer/DS-SuperAgent/issues/92)、[T59](issues/T59.md)、[T60](issues/T60.md) |

## T55 验收前置子票（2026-11-12 派生）

T56–T60 是 T55 的子票，也是 T55 的直接阻塞；T59/T60 的 GitHub 原生关系待发布后建立。T55 本身仍是最终验收票，不承担 production factory、产品 profile、前端分叉、真实环境接入或托管部署的实施。

| 子票 | 父票 | 直接阻塞 |
| --- | --- | --- |
| [T56 将生产 Engine factory 注入现有 ds-bot Host](https://github.com/IceFireIcer/DS-SuperAgent/issues/90) | [T55](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | T02、T15、T18、T23、T24、T45、T46 |
| [T57 接入真实模型与 GitHub/飞书测试环境](https://github.com/IceFireIcer/DS-SuperAgent/issues/91) | [T55](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | T23、T25、T26、T27、T29、T30、T31、T48、T49 |
| [T58 组合托管 Host、断连撤销、接管与第二设备](https://github.com/IceFireIcer/DS-SuperAgent/issues/92) | [T55](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | T35、T37、T40、T41、T44、T45、T46、T47、T56、T57、T59、T60 |
| [T59 新增 ds-superagent profile 并接通现有聊天界面](issues/T59.md) | [T55](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | T56、T45、T46 |
| [T60 复制聊天界面为 ds-superagent-ui 并实现最小新核心接口](issues/T60.md) | [T55](https://github.com/IceFireIcer/DS-SuperAgent/issues/83) | T59、T24、T21、T18 |

T59 在 T56 代码合入并通过发布核对后可开始；T60 阻塞于 T59。T57 可与 T59 并行，但受真实账号、模型和测试群配置约束；T58 阻塞于 T56/T57/T59/T60 及设备、交接、托管、客户端和 Watchdog 具体票。T55 阻塞于上述各项完成后的最终汇合。

2026-11-12：T56、T59 已实现并通过双轴审查，证据见 [T56 实施记录](implementation/t56.md)、[T56 审查](implementation/reviews/t56.md)、[T59 实施记录](implementation/t59.md) 和 [T59 审查](implementation/reviews/t59.md)。T59/T60 目前只有本地票，尚未发布到 GitHub；T60 已复制独立聊天界面并接通新核心，证据见 [T60 记录](implementation/t60.md) 和 [T60 审查](implementation/reviews/t60.md)。T57 已完成真实模型、主动准备和真实 GitHub 输入/外发验收；真实飞书 tenant/群未配置并被维护者明确暂缓，环境检查保持 `unverified`，T57 于 2026-11-13 收口，证据见 [T57 记录](implementation/t57.md) 和 [T57 证据](implementation/t57-evidence.json)。T58 仍受托管 Host 和第二设备组合约束。

## 资料与验证

- [规格正文](spec.md)
- [逐票验收条件及 D/A 映射](tickets-draft.md)
- [机器可读计划](tickets-draft.json)（原始 55 票；T56–T60 为后续派生票，记录在本文件与 `issues/`）
- [审计处置](audit-disposition.md)
- [GitHub 发布及原生关系核查](publication.json)
- [T55 前置子票发布及原生关系核查](t55-followups-publication.json)
- [可恢复发布工具](publish-tickets.py)

只有 publication.json 的 verified 为 true 才表示发布关系已经回读核验。规划发布不表示产品实现或真实环境验收。

## 本轮回读结果

69 张新 Issue 的正文、状态、标签与计划一致；69 条父子关系和 102 条原生阻塞关系准确，无重复父归属。总规格仍 open，原有标签保留。当前可开始的实施集合为 [T01：建立隔离实例的持久接单与查询闭环](https://github.com/IceFireIcer/DS-SuperAgent/issues/29)，属于 [G01：本地接单与执行闭环](https://github.com/IceFireIcer/DS-SuperAgent/issues/15)。该集合会随实际实施状态变化，开工前重新核对。

## T55 前置子票回读结果（2026-11-12）

T56/T57/T58 已创建并回读：3 条 T55 原生父子关系、T55 的 9 条直接阻塞（含原有 6 条）以及三张子票的 26 条直接阻塞均与计划一致。三张新票均为 open、无 assignee、带 `ready-for-agent` 和 `enhancement`；T55 保持 open，作为最终验收票。

当前可开始集合是 [T56](https://github.com/IceFireIcer/DS-SuperAgent/issues/90) 与 [T57](https://github.com/IceFireIcer/DS-SuperAgent/issues/91)；[T58](https://github.com/IceFireIcer/DS-SuperAgent/issues/92) 阻塞于 T56/T57，T55 阻塞于 T56/T57/T58。完整机器回读见 [t55-followups-publication.json](t55-followups-publication.json)。

## T59/T60 本地票（2026-11-12）

T59/T60 已写入本地票与规格 D20，尚未发布到 GitHub；因此 `publication.json` 和 `t55-followups-publication.json` 不包含它们。发布后需要新增回读记录，并更新 T55/T58 的原生父子关系和 blocked-by 关系；发布时还要把票内的本地 `T59.md`/`T60.md` 链接替换成 GitHub issue URL。T56/T58 的本地正文也随 D20 更新，需要一并回读。T59 在 T56 发布关闭后可开始；T60 阻塞于 T59。
