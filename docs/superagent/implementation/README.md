# Super-agent 实施记录

本记录对应用户在 2026-11-03 明确调用的 `implement-spec` 工作流。

- 规格：[v2.1](../spec.md)，总体 Issue #1；实施图：[T01—T55](../tickets.md)。
- 集成基线：`dev` 的 `14a692d`；集成分支：`feat/1-superagent-integration`。
- 逐票使用独立分支和工作树，以已确认的公开 Engine 命令/查询及适配器契约执行 TDD，再合入集成分支。
- 本次实施 frontier 以具体前置的实现已合入、必要验证通过且证据可查为依据。GitHub Issue 的 OPEN/CLOSED 仍表示仓库规定的发布状态；保留原生依赖，不将未发布误报为已关闭，也不因完成代码而创建发布。
- `maintainer` 限制、他人占用、设计决定、真实环境前提及各票验收仍然有效。实现证据不能代替真实模型、外部信道、第二设备或正式部署验收。
- 只有已完成范围有对应证据时才记录为完成；总体规格尚未实现。

## 当前进展

| 实施票 | 实现状态 | 证据与边界 |
| --- | --- | --- |
| T01 / #29 | 已实现并合入；未发布 | `c7cfbaf`，集成提交 `e1322b7`；[验收记录](t01.md)：新核心 15/15，Windows Node 22.19 / 24 / 25；不启动 Worker |
| T02 / #30 | 已实现并提交；未发布 | `0d28b87`、审查修复 `1fb556c`；[验收记录](t02.md)：原生 DSH Router/Worker、独立 Session/Assignment/report、ready 依据与隔离统一聊天入口；39/39，双轴复审剩余 0/0 |
| T03 / #31 | 已实现并提交；未发布 | `6ccabff`、审查修复 `2676092` 及收尾修复；[验收记录](t03.md)：绑定本地 Environment、真实文件/search/command、setup retry、artifact/toolFacts；当前 Node 25 全量 48/48，双轴复审剩余 0/0 |
| T04 / #32 | 已实现并提交；未发布 | `aa2c645`、`c31aad2` 及旧 direct 兼容收尾；[验收记录](t04.md)：受信 source intake、版本投影、冲突/unknown、tombstone、接单隔离与 Thread 交付；Node 22/24.22/25 各 62/62，双轴复审剩余 0/0 |
| T05 / #33 | 已实现并提交；未发布 | `50d9ad2`、真实派发修复 `f6eff3c`；[验收记录](t05.md)与[复盘改进](retro-t05.md)：全量 91/91、脚本 7/7，真实 Effects 派发合并、逐项重试及双轴复审通过 |
| T06 / #34 | 已实现并提交；未发布 | `5a52400`；[验收记录](t06.md)：全量 96/96，Thread fan-out、稳定 Input、方向版本、自然结束恢复、同 Session 跟进、恢复与历史查询；双轴复审 0/0 |
| T07 / #35 | 已实现并提交；未发布 | `1354e13`；[验收记录](t07.md)：全量 106/106，多订阅、context-only、handback/重评、Worker 订阅管理、note 与 unavailable dismiss；双轴复审 0/0 |
| T08 / #36 | 已实现并提交；未发布 | `c5ff37e`；[验收记录](t08.md)：全量 112/112，结构化 Attention、waiting-human、授权回答、stale Outbox dropped 与 chat 回答入口；双轴复审 0/0 |
| T09 / #37 | 已实现并提交；未发布 | `a0436b6`；[验收记录](t09.md)：全量 116/116，持久 stop、取消确认、显式 resume、Assignment 换代与 UI；双轴复审 0/0 |
| T10 / #38 | 已实现并提交；未发布 | `85fd312`；[验收记录](t10.md)：全量 122/122，版本化 Policy、来源隔离、在途 Eval 重排、全局暂停与停止/等待状态区分；双轴复审 0/0 |
| T11 / #39 | 已实现并提交；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t11.md)：全量 130/130，持久执行槽、人工优先的有界额外槽、按 lane 派发、受限状态命令与声明负载实测；双轴复审见 [t11](reviews/t11.md) |
| T12 / #40 | 已实现并提交；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t12.md)：全量 142/142，后台 job 身份与有界输出、完成事件回原 Worker、占用槽预算与按归属清理、真实 Windows 长命令实测；双轴复审见 [t12](reviews/t12.md) |
| T13 / #41 | 已实现并提交；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t13.md)：全量 152/152，DSH 公开 `parentAgent` 子 Agent、受限工具与环境继承、按 `turn/end` 判定成功/失败、完成事件回原 Worker、按归属清理与声明期限；双轴复审见 [t13](reviews/t13.md) |
| T14 / #42 | 当前分支实现；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t14.md)：全量 165/165，显式托管预览与预算、ready/waiting-human 释放槽、普通 job/子 Agent 按归属清理、预览不占槽且退出不唤醒、未确认清理待确认并可解析、idle/draft/ready/Ticket-ended 分开查询；双轴复审见 [t14](reviews/t14.md) |
| T15 / #43 | 当前分支实现；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t15.md)：全量 187/187，公开 SessionPersistence/SessionHandle 的 SQLite 实现、连续序列/事件数/格式校验、fork 血缘与继承 cut、writer epoch 守卫（失败不确认/不释放/不重获）、死 PID 崩溃接管、未物化创建不留残留而 flush 过的空 Session 保留、append 原子性、live 失败即停止、构造记录在 announce 前越过持久屏障、按 `stat()` 决定 resume、并发交错/取消/恢复/fork/服务替换实测；双轴复审见 [t15](reviews/t15.md) |
| T16 / #44 | 当前分支实现；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t16.md)：全量 194/194，Input 的 claim/sent/persisted/completed 分开记录、稳定 messageId、flush 后才确认持久投递、验收事实与完成同事务、未入历史按原 messageId 恢复、已入历史不重复追加而用编号恢复说明继续、idle 不算承接、分页 pending 索引与启动扫描先定未读/已读边界、ownership 核验拒绝 re-attach、重试新建 Assignment 代次、3 次恢复/5 次投递上限、真实子进程在 claim 前后/append 后/provider flush 失败/回执前后退出实测；双轴复审见 [t16](reviews/t16.md) |
| T17 / #45 | 当前分支实现，验收与审查见记录；未发布 | 按用户 `/implement` 在当前集成分支提交；[验收记录](t17.md)：显式事务扩展、提交对账、可靠副作用、relay/notice 顺序与 schema v2 |

上述已实现票的前置实现为 T01；实施状态与 GitHub 发布状态分别记录。2026-11-05 回查发现原 T02/T04/T17 工作树注册指向不存在的目录，不能用旧“实施中”记录证明实现进展。本轮 T17 交付共用的事务更新、删除、有界扫描与新连接契约；T04 已在该公开契约上恢复并完成。

集成 PR：[#86](https://github.com/IceFireIcer/DS-Bot-Super-Agent/pull/86)，当前为 Draft 状态。增量双轴审查见 [T01](reviews/t01.md)、[T17](reviews/t17.md)、[T02](reviews/t02.md)、[T03](reviews/t03.md)、[T04](reviews/t04.md)、[T05](reviews/t05.md)、[T06](reviews/t06.md)、[T07](reviews/t07.md)、[T08](reviews/t08.md)、[T09](reviews/t09.md)、[T10](reviews/t10.md)；这不是全部规格的最终审查。远程 CI 证据需以当前推送头为准。

## 初始回归基线

在原有 `14a692d` 上运行：`ds-bot` 单测 1431 通过、2 跳过、0 失败；生成一致性通过；lint 退出 0（保留既有警告）；已跟踪文件的泄漏扫描退出 0。此基线不是新核心或总体规格的验收结果。

## 分支与工作树核查

开始或结束一张实施票时，在目标仓库内执行只读检查：

```sh
node scripts/branch-status.mjs
node scripts/branch-status.mjs --base dev
```

默认比较本集成分支，也可通过 `--base` 指定本地分支。JSON 输出包含比较基线的提交、当前分支（detached HEAD 时为 null）、工作目录是否干净、各本地分支相对基线的独有提交数、是否已经合入、关联工作树路径及其存在/prunable 状态。有上游时显示本地记录的 ahead/behind；上游引用缺失时显示 upstreamMissing，不把缺失误报为零。

该工具只读取本地 Git 事实，不 fetch、不清理、不删除。远程计数取决于最后一次 fetch；没有独有提交不证明票已完成，也不证明不存在其他目录中的未提交工作。验收状态仍以逐票实现与审查证据为准，main/dev 等保留分支不会因已合入就成为删除对象。

2026-11-05 清理已完成：逐一确认 T01/T02/T04/T17 的旧分支均为当前集成提交的祖先，且四个原工作树目录不存在后，使用 `git worktree prune` 清除失效注册，再用 `git branch -d` 删除这四个本地分支。保留 main、dev 和当前集成分支；未删除远程分支或实际工作目录。后续票从最新集成提交创建实际需要的工作分支。

测试入口为 `node --test scripts/*.test.mjs`，与扫描器既有回归测试一起进入 CI 的 scan job。新核心 CI 同时验证 Windows Node 22.19.0 和 Node 24，仍纳入必需的 Test result 汇总门禁。

维护实施或审查记录时，运行 `node scripts/check-implementation-records.mjs --check-refs` 校验提交占位与本地 commit 引用。CI 使用不要求完整 Git 历史的占位检查。每轮审查标明实际目标版本；后续修复单独记录测试和复审结果，远端 CI 只为对应的推送 SHA 提供证据。跨模块验收应从实际调用入口覆盖相关模块；适配器测试只能证明该适配器的契约。
