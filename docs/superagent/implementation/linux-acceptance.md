# T01–T36 Linux 实机验收审计

2026-11-09 使用临时 Ubuntu 云服务器复核 T01–T34 中尚未有 Linux 实机证据的部分。服务器为 Ubuntu 6.8 x86_64、2 vCPU、1.9 GiB 内存；Node 22.23.4 与 Node 24.22.2 分别安装在用户目录临时 runtime，没有用 sudo 修改系统 Node。T33/T34 跨机验收使用同一台服务器上的 Node 24.15.0 设备运行时。

## 全量回归

- Node 22.23.4：**269/269**，106.7 s；typecheck、lint 通过。
- Node 24.22.2：**269/269**，106.4 s；typecheck、lint 通过。
- 两轮覆盖 T01–T32 全部公开 Engine、存储、Session、Effects、来源、调度、交付、槽、job、子代理、预览、恢复、Host 租约和远端 Environment 测试；T33 的 Windows 全量 283/283 在 T33 节单独记录。

## Linux 脚本实测

| 票 | 缺口 | Linux 结果 |
| --- | --- | --- |
| T01 | 旧验收只有 Windows SQLite 延迟数据 | `dev/mock.mjs`：51 次接单、20 次并行重试复用 1 个 Ticket；串行 p50 8.00 ms、p95 11.77 ms、max 27.89 ms |
| T02 | `native-load` 原脚本固定 drain 5 次，在 Linux 上偶发只拿到 acknowledgement | 修复为有界等待结果投递后：Node 24 2033 ms、Node 22 2205 ms；11 个 Session、45 次模型边界调用、20 条确认/结果，重试不增加模型调用 |
| T04 | 来源负载只有 Windows 数据 | `dev/source-load.mjs`：150 个版本、20 次并行重试、3 页历史；p50 4.50 ms、p95 6.69 ms、max 22.07 ms |
| T05 | Effects 负载只有 Windows 数据 | `dev/effects.mjs`：100 条全部派发；enqueue p50 3.58 ms、p95 5.64 ms、max 6.19 ms；drain 631 ms |
| T11 | 槽负载只有 Windows 数据 | `dev/slots.mjs`：并发回合峰值 3（2 正常 + 1 人工优先），4 票排队；人工跟进 31.4 ms 启动，全部启动 p50/p95/max 2582.5/2584.5/2584.5 ms，低于 3600 ms 公平预算 |
| T12 | 验收只写了“真实 Windows 长命令” | `dev/jobs.mjs`：12 s 真实 Linux 子进程；回合 417.8 ms 返回、独立请求 433.9 ms 完成、取消确认 72.2 ms、槽归零、完成事件 514.1 ms 回原 Worker |
| T13 | 子代理负载只有 Windows 数据 | `dev/subagents.mjs`：4 个子代理、每个 3 步；父回合 357.5 ms 交出，峰值并发 4，432 ms 全部完成；工具集仍只有 5 项工作工具 |
| T28 | 真实计划运行只在 Windows 时区环境 | `dev/schedule-acceptance.mjs`：4 个连续 occurrence（1000 ms 间隔）、重启 0 重复、Gate 接受 1 个、暂停拒绝后恢复接受 |
| T32 | 第二设备已完成单次跨机，但未做设备重启、断连和授权变更 | 见下节 |
| T33 | 远端 command/job 只在本地测试和真实 Windows 单机验证 | 见下节 |
| T34 | PTY、进程组与离线 stop 只在本地测试 | 见下节 |
| T35 | daemon 重启的 live/log-only/identity/unqueryable 分类与 Host 接管缺少 Linux 证据 | 见下节 |

## T32 设备重启与授权变更

- Windows Host → Linux 设备 `linux-restart-1`，设备 incarnation `51042cef-6a22-4f56-8186-32442764fa13`。
- 首次配对后写入 `stage-one.txt`；停止设备进程，Host 请求返回 `DEVICE_UNAVAILABLE`。
- 用同一 `statePath` 和端口重启设备，incarnation 保持不变；Host 从 `snapshot()` 恢复后读到旧文件并写入 `after-restart.txt`。
- 设备重启为只读 grant 后，同一 Host 仍可读，但写入返回 `PERMISSION_DENIED`；移除该 Environment grant 后，prepare 返回 `GRANT_DENIED`。
- 在 grant 缺失状态下，Host 仍可撤销自己的 pairing；撤销后 prepare 与 snapshot 都返回 `DEVICE_REVOKED`，设备状态持久记录 `revokedAt`。
- 传输使用 SSH 本地端口转发，没有开放公网设备端口。

## T33 远端命令与作业

- Windows 11 `10.0.26200` / Node 25.4.0 Host → Linux `6.8.0-101-generic` x86_64 / Node 24.15.0 设备；设备 ID `linux-t33`，最终代码公钥指纹 `33373a1ff1521fdf5a456948187a90761321e14cb37b8b940b6ef25026ead74c`，设备只监听 `127.0.0.1` 并经 SSH 本地端口转发访问。
- 最终代码 9/9 通过：设备解析 executable 为 `$HOME/.local/node/bin/node`，不是 Host 目标键；`run_command` 输出设备 cwd（Host 显示 `<device-workdir>`）、显式环境、设备文件内容和 `多字节✓`，前台 162 ms。
- 一个 UTF-8 字符跨两次字节写入；1.5 s 传输中断后重连按字节偏移重建 `-✓\n`，总观测 2996 ms，无替换字符；同一作业重复读取结果一致。
- 启动响应被代理丢弃后，1190 ms 内用原 job ID 对账，设备 `starts.txt` 只记录一次启动；同 ID 异参返回 `IDENTITY_CONFLICT`，错误前缀返回 `JOB_IDENTITY_MISMATCH`。
- 立即取消在启动后排队，等待真实子进程退出后才报告 `cancelled`；初验还覆盖两作业隔离。新 Host 可从 `snapshot()` 恢复并按稳定 job ID 接回同一作业。
- 设备正常重启后，终态作业的输出和退出码仍可查询；设备被 `SIGKILL` 时处于运行中的作业在重启后为 `COMMAND_UNKNOWN`，保留已收到输出但不伪报结果。撤销后 `prepare` 返回 `DEVICE_REVOKED`。
- 全部验收 15.4 s。结束后停止设备、遗留子进程和 SSH 隧道，删除服务器临时目录、临时密钥副本与配对码文件。

## T34 远端 PTY 与进程组

- Windows 11 `10.0.26200` / Node 25.4.0 Host → Linux `6.8.0-101-generic` x86_64 / Node 24.15.0 设备；设备 ID `linux-t34`，公钥指纹 `05df84fe8c842cc14e5f14cb9fbe65cdfdc75f4271e3b4e2c498dcbccaee9448`；设备只监听 `127.0.0.1`，经 SSH 本地端口转发访问，设备侧安装 `node-pty@1.2.0-beta.15`。
- 真实 PTY 2/2：终端输出 `pty-ready`、写入回显、`resize`、`terminate` 后设备子进程为 `gone`，632 ms；普通命令以独立进程组启动，`terminate` 后子进程为 `gone`，549 ms。
- 取消只有根进程退出不算完成：设备范围通过进程组为空确认 `settled` 后才报告 `cancelled`；Windows 使用 `taskkill /T` 并声明 ConPTY pid 0 的最低范围，Linux 使用进程组证明。
- Windows 单测还覆盖：传输中断期间 stop 保持 `stopping`、`pendingDeviceConfirmation = true`、job `unknown`，恢复被 `STOPPING` 拒绝，不伪报 cancelled。
- 验收后停止终端、设备、隧道并删除服务器临时目录、临时密钥副本和配对码文件。

## T35 设备断连与 daemon 重启

- Ubuntu `6.8.0-101-generic` x86_64 / Node 24.15.0 上运行 `test/remote-recovery.test.mjs`：**8 通过 / 1 Windows-only 跳过**，50.2 s。覆盖真实 daemon SIGKILL 后的 POSIX live-process 进程身份与进程组匹配、log-only、记录删除后的 unqueryable、完成作业 exit code/输出、未知问题去重、Host 接管、离线 stop 日志恢复确认和前台 starting intent。
- Windows 11 / Node 25.4.0 Host → 同一台 Ubuntu 设备跨机验收：设备 ID `linux-t35`，incarnation `3d2b5ac3-860c-4d10-b4fb-857236ebbf3c`，签名公钥指纹 `b4d873f9b9bc9b6b0083e688cab6bd41899f85724a78810fbc805ca6f3958394`，设备只监听 `127.0.0.1` 并经 SSH 本地转发。`dev/t35-acceptance.mjs` **26/26**，29.3 s。
- 跨机逐项覆盖：daemon 强杀后 live-process 仍由原 POSIX start time/进程组证明并可按原 ID 取消；另一个已退出作业只保留 log-only 和 unknown exit；超过设备本地 deadline 的恢复进程被停止；删除 job 记录后保持 unknown 且不能 attach；完成作业保留 exit code 0 和 `finished\n`；所有停止后进程实际消失。
- 设备状态和 Host 连接状态使用协议 v2；旧 v1 saved connection 由单测明确拒绝。验收后停止设备、命令子进程和 SSH 隧道。

## T36 目标选择与双模式绑定

- Ubuntu `6.8.0-101-generic` x86_64 / Node 24.15.0：`node --test test/execution-target.test.mjs` **7/7**，2.4 s。覆盖默认 local、Ticket 覆盖、策略 revision、remote-only 等待与 retry、allowlist/online/能力/目录/version/fingerprint/capacity 证据、真实 LocalEnvironment + paired RemoteEnvironment 双模式，以及固定 Assignment 的 fingerprint 变化拒绝。
- 远程协议与 Host saved connection state 为 v3，设备 status 返回 version、签名 fingerprint 与 64-job capacity。T36 测试只使用隔离临时目录、SQLite 与 loopback/真实本地 provider，不读取用户 DSH 数据。

## T37 远端附件、spill 与技能

- Ubuntu `6.8.0-101-generic` x86_64 / Node 24.15.0：`node --test test/environment-assets.test.mjs` **9/9**，2.5 s。覆盖本地附件内容寻址与多字节分页、本地无技能根缺口、资产命名空间隔离、本地 spill 全文分页、远端同名文件不替换、artifact 替换拒绝、远端 spill 在 Host 重连/daemon 重启后续读、无资产库设备缺口、公开 Engine 断连续查和子代理继承远端资产工具。
- Windows 11 / Node 25.4.0 Host → 临时 Ubuntu 设备跨机验收：设备 ID `linux-t37`，incarnation `d1ba579c-d7ca-4f89-a2a1-8c70f42fa46d`，签名公钥指纹 `4ef03b15818365d5d81416b3a4d34636e272ec960c3cacfa4dc26b3bbd5b8120`；设备只监听 loopback，经 SSH 本地转发。`dev/t37-acceptance.mjs` **10/10**，最终复跑 39.0 s（首次 8.0 s，差异来自 SSH 往返）。
- 跨机逐项覆盖：附件内容寻址落盘与多字节分页；设备工作目录和 Host 临时目录中的同名文件均不能替换引用；200005 字节设备输出在 bounded tail 之外完整分页；公开 `dsh-skill` provider 在设备上发现并加载 `office` 技能；daemon 断连后附件读取明确 `DEVICE_UNAVAILABLE`，不回落本地；daemon 重启后附件、spill 与技能目录按原引用/名字续查。
- 设备与 Host 的 `assetsPath`/`skillsPath` 使用隔离临时目录，不读取用户 DSH/agents 数据；验收后停止设备与 SSH 隧道并删除临时目录。

## 脚本修复

- `dev/native-load.mjs` 不再固定 drain 5 次，而是最多等待 15 s 直到 result delivery 出现；这修复了 Linux 上稳定复现的 harness 误报，不改变产品行为。
- `dev/subagents.mjs` 给每个子步骤增加 100 ms 声明延迟，使 Node 24 上不会在第一次 20 ms 轮询前就完成 4 个子任务；负载字段明确记录 `childStepDelayMs`。

## 不能由这台服务器补的项目

- T20 的“远程多机 Host 竞争”和 T15 的跨机共享 Session 后端需要 T42/T43 的 PostgreSQL/共享存储，目前未实现；SQLite 单机锁不能替代。
- T25–T27 的真实 GitHub 验收已经完成；这台服务器没有 `gh` 凭据，不需要重复证明。
- T29 的真实模型样本已经在 Windows 完成；Linux 网络不是该票的未验收前提，本轮没有再使用模型密钥。
- T30/T31 的真实飞书群仍缺应用凭据，维护者此前已明确暂缓；服务器本身不能补这个证据。
- T38–T44 的远端浏览器/MCP/Office 位置、双向交接、PTY 重启后重新挂回和跨 Host 共享存储尚未实现，不能用本地能力冒充。

## 结论

本轮没有发现 T01–T37 的产品行为回归；发现的 `native-load`/`subagents` 问题都在开发负载脚本的时序假设。Linux 上现有 T01–T37 功能可由全量测试、独立负载脚本、T32 真实跨机文件/搜索路径、T33 真实跨机命令/作业路径、T34 真实 PTY/进程组路径、T35 daemon 恢复矩阵、T36 目标选择测试和 T37 跨机附件/spill/技能验收复现。
