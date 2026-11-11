# #89：隔离 PostgreSQL 测试进程退出生命周期

- Issue：[Windows CI PostgreSQL 测试退出时崩溃](https://github.com/IceFireIcer/DS-SuperAgent/issues/89)。
- 基线：`66be66a`；2026-11-11，Windows / Node 24.22.2。

## 已复现的最小信号

`node --test --test-name-pattern="loading the PostgreSQL fixture" test/postgres-lifecycle.test.mjs` 在修复前失败，0 pass / 1 fail。仅导入原 fixture 后显式退出，stderr 已出现工单中的 `SYNCHRONOUS TERMINATION NOTICE`。该稳定信号约 300 ms，不需要凭据或实际数据库；本机没有重现 CI 的最终 `triggerUncaughtException: undefined`。

原因是原 fixture 顶层导入 embedded-postgres，其全局 asyncExitHook 存在于测试进程，进程退出时仍参与清理。候选还包括重复停止和 Windows 非等待 taskkill；修复不依赖调整第三方模块内部实例集或 DSH 安装。

## 实现

测试夹具改为 fork 一个受控 owner，通过 IPC 发送临时数据库配置；owner 只导入对应平台二进制包的公开 `initdb`、`pg_ctl` 路径。测试进程和 owner 都不导入注册退出钩子的包装模块。initdb 完成后删除临时密码文件；数据库仅 loopback、实际 fsync/synchronous_commit 保持 on。owner 以有界 `pg_ctl -w start/stop` 等待实际生命周期，不使用 fire-and-forget taskkill。

父级关闭先结束公开 Storage/Client，再等待 owner 退出；重复 close 复用同一 Promise。IPC 断开/信号触发 owner 停止，启动失败不冒充成功。递归删除前核对实际绝对目录位于临时根。fork 不继承仅适用于入口的 `--input-type` 等 execArgv。

测试 runner 默认文件并发在 Windows 为 1、其他平台为 2，调用方仍可显式覆盖；避免慢 Windows 上按 CPU 数同时启动大量原生进程/数据库夹具。不删除断言、不自动重跑失败。

## 当前验证

- 新生命周期回归：**2/2**。导入不再产生终止提示；真实数据库可查询/建库、关闭幂等，临时目录释放。
- 原先受影响的 PostgreSQL storage、Session provider、Host takeover 三文件：**35/35，退出 0**，含真实事务/死锁/COMMIT 丢响应、writer 租约和跨进程接管。
- 同一 lifecycle 当前最终代码在代表集 **2/2**；一个真实新集群曾耗时约 126 s，完整串行套件内约 184 s。原来的 60 秒测试时钟会在本机和 CI 满载时误报超时，现改为有界 240 秒；fixture 自身每步仍有 180 秒命令、240 秒 startup 和 180 秒 stop 上限。没有声称 PostgreSQL 启动时间是产品恢复 SLA。
- Windows Node 24.22.2 最终 Super-agent 全量：**515 项，513 pass / 0 fail / 2 既有平台 skip**，约 1,122.0 s，退出 0；日志无 `SYNCHRONOUS TERMINATION NOTICE`。
- App importer 集成测试已从 Super-agent npm 包移到 App 测试包，避免 core job 缺少 app/DSH 依赖；App 全量 **245 项，244 pass / 0 fail / 1 既有 skip**。
- 推送 `544fa5a` 后，Linux `Desktop app profile` 暴露两个生命周期测试使用了打包模式，因而先执行真实发布源检查并撞上测试窗口。`main-after-sleep` 与 `main-retry` 改由本地空更新源响应，继续覆盖“更新检查后重试宿主”，不再依赖外网；指定 Ubuntu 主机 Node 24.15.0 全量复验 **245 项，244 pass / 0 fail / 1 既有 skip**。
- 同时修正三处历史文档的本地目录术语，避免 scan 把说明文字误判为私有路径；不删除扫描规则或改变产品行为。

CI run [43040545053](https://github.com/IceFireIcer/DS-SuperAgent/actions/runs/43040545053) 的具体失败发生在 `main-after-sleep` 与 `main-retry`：打包 Linux 应用的发布源检查可占用 15 秒生产上限，使重试框超出测试等待窗口。修复在测试夹具中启动一个只监听 `127.0.0.1`、返回空 release 数组的 HTTP 源，并在 Linux 上等待至少一次真实请求。这样两个测试仍跨越“打包更新检查 → Host 失败 → 重试”接缝，同时 GitHub 不可达不会改变结果。

该复验使用 `544fa5a979e201c0c0c368d874c5584c60f1c094` 的 depth-one `dev` 克隆叠加以下三个工作区文件；本地与远端 SHA-256 一致：

| Path | SHA-256 |
| --- | --- |
| `app/test/helpers/app-harness.mjs` | `b009727bb9019a2bd32f2d0a1fd5bfaf877583d6492d88480c078eee0d4692f7` |
| `app/test/main-after-sleep.test.mjs` | `d540f0d09cba73b2cba55e157991f17f333c9f77075cd082a56a200db3fd3a92` |
| `app/test/main-retry.test.mjs` | `89d0515502d0033a85dd1d5cbb8a791a007f3f16b238a1dc4a527d0478e71228` |

Ubuntu / Node 24.15.0 / npm 11.12.1，锁定依赖安装后，两个生命周期文件 **4/4 pass**；App 全量 **245 项，244 pass / 0 fail / 1 既有 skip**，退出 0。本记录只给出工作区证据；后续推送头及其 CI 仍是最终权威。

CI run `43045825402` 在 `017f343` 上确认 Desktop app profile **success**、Windows/Linux DSH 矩阵和移动端类型检查通过；Linux x64 打包仅因 runner 无法解析 `security.ubuntu.com`、安装 `libfuse2t64` 失败，需重跑该环境作业。同日 `Super-agent core` 的首个 adapter 集成测试在 20 秒边界失败，完整套件仍为 **516 项，514 pass / 0 fail / 2 既有 skip**。压力复现把该旋转竞态稳定定位到 Outbox：前一个结果投递能在一个事务里关闭 Ticket，即使同一 Ticket 已有 pending 后续输入；后续 relay 随后只看到 `ended`，三次重试后耗尽预算。

修复把 `WorkInputs` 注入 `Outbox`，在“结果已投递且无 P/R 条件”的同一事务里同时要求没有 pending Inputs 才写入 `ended`。新增确定性回归先阻塞初始 Worker、写入后续输入，再放行前一个结果；RED 为 `ended !== open`，GREEN 后相关文件 **13/13**、adapter 压力 **80/80**，最终 Windows Node 24.22.2 Super-agent 全量 **516 项，514 pass / 0 fail / 2 既有 skip**。这一修复的提交头与重跑 CI 仍需在后续记录。

Windows 托管 CI 的最终结论须以本次推送头为准；本机通过不等于 windows-latest 已通过。工单中的 jobs/work-copy 失败分别复核，不与数据库进程退出混为同一个已证实根因。
