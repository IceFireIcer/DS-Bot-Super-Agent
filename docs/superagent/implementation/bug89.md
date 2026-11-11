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
- 同时修正三处历史文档的本地目录术语，避免 scan 把说明文字误判为私有路径；不删除扫描规则或改变产品行为。

Windows 托管 CI 的最终结论须以本次推送头为准；本机通过不等于 windows-latest 已通过。工单中的 jobs/work-copy 失败分别复核，不与数据库进程退出混为同一个已证实根因。
