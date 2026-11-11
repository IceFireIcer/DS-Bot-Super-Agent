# T55：当前版本真实第二设备验收

2026-11-11（Asia/Shanghai），仅使用操作者指定的临时 Ubuntu。**T37 资产路径 10/10、T40 双向交接 2/2，两个 Windows 验收进程均退出 0。** 这是实际 Windows→Ubuntu 传输和执行证据，不是同机设备替身，也不是完整桌面、真实模型或托管 Host 验收。

## 环境与源码身份

- Windows 11 x64 `10.0.26200`，隔离 Node `v24.22.2`；Host 和所有本地子进程的 PATH 首位固定到该 Node 24 runtime。
- 指定 Ubuntu：Linux `6.8.0-101-generic`，Node `v24.15.0`，Git `2.43.0`。设备只监听 loopback，Host 经本轮 SSH 本地转发访问。
- 生产源码基线：`221c743544417623e00e14346bc5962550848b71`。复制当前工作副本中的 `superagent/package.json`、`package-lock.json`、`tsconfig.json`、`src/`、`scripts/`、`dev/` 的已跟踪文件；不复制用户 home、DSH 数据、node_modules 或本地 dist。
- 实际快照 95 文件：94 个基线文件的文本内容与基线一致（26 个逐字节相同、68 个仅 Windows CRLF/LF 不同）；另含父任务已加入暂存区的 `dev/t55-acceptance.mjs` 快照，**未调用该脚本**。该新增脚本后续仍由父任务修改，本报告的快照哈希仅代表当次部署，不能当作父任务最终 runner 身份。
- 远端在新建的隔离 `/tmp/<run-root>/package` 中解包，验证压缩包 SHA-256 和全部 95 个文件的 SHA-256 后独立 `npm ci --no-fund --no-audit`、`node scripts/build.mjs`，均退出 0。没有复用未验证的远端依赖或 dist；Windows 同一源快照也在临时副本内构建。

| 内容 | SHA-256 |
| --- | --- |
| 95 文件原始字节清单 | `ea5cd281ecf9a111bf1ed63dc303ae7460c4ef9153d0c6e1d03ca17523d0e6f2` |
| 94 个基线文件 LF 规范化清单 | `ff4c7876dcb1c2b377e771be3dbbd52cc02d40727ce4442fdae3648a61c28440` |
| 传输压缩包 | `a54ae35f0999e7fa2ebb0a214588f57e996fe4a8ff698e069f57a0da31054d17` |
| package.json | `c112e5eb3717f2df8304bae16180de66cc412919101e46c7ae73cfc1467c02d1` |
| package-lock.json | `f834cf52d9587a7633d560ee9f56fd2733f15a43778562e0ca18bacfac17e808` |
| dev/t37-acceptance.mjs | `1d34b5c01af74ecb39ae502284c46bcc9774936ab2253a1375d695001cf9b2c8` |
| dev/t40-acceptance.mjs | `734bf17d48d19ac0c5f6beaaa64c696b2f960efbc83f5eb783a049b8672cdd70` |
| 未运行的父任务 T55 runner 快照 | `6b4aa012e7bb523359bc4fa6a57b255fc0cf7c2ee522c0b4f083a92e3fe4442a` |

清单构造：按仓库相对路径升序，去掉 `superagent/` 前缀；每行是 `<file-sha256><two spaces><relative-path>\n`，将 UTF-8 全清单再做 SHA-256。规范化清单仅对 94 个基线文件先把 CRLF 转为 LF，再按同一格式计算。压缩包哈希与清单哈希不是同一对象。

## 入口与传输约束

命令从隔离 Windows 源码副本的 `superagent` 根执行，下面参数仅为占位符；设备根均在本轮新建、已 `realpath` 核验的同一 `/tmp/<run-root>` 下。

```text
<isolated-node24> scripts/build.mjs

<isolated-node24> dev/t37-acceptance.mjs \
  --host <designated-device> --key <protected-identity-file> \
  --package-root /tmp/<run-root>/package \
  --device-root /tmp/<run-root>/t37 --remote-port <free-device-port>

<isolated-node24> dev/t40-acceptance.mjs \
  --host <designated-device> --key <protected-identity-file> \
  --package-root /tmp/<run-root>/package \
  --device-root /tmp/<run-root>/t40 --remote-port <another-free-device-port>
```

现有验收脚本源码包含 `StrictHostKeyChecking=no`。本次没有编辑脚本：Windows 临时 Node preload 在 `child_process.spawn` 处将 ssh/scp 的该参数替换为 `StrictHostKeyChecking=yes`，并加 `BatchMode=yes`；通过 `syncBuiltinESMExports()` 使脚本导入的 `spawn` 使用同一约束。上传、命令和隧道均执行严格已知主机校验；未覆盖 known-host 数据。preload 也跟踪本轮隧道，在进程退出时终止它们。配对码由脚本在隔离目录中处理，未进入报告或命令输出。

远端工作预算限定 10 分钟；各传输、安装/构建及验收命令均设置有限期限，失败不无限重试。首次编排有引号错误，校验命令失败且尚未运行产品测试，临时根清理退出 0；随后一次编排 SSH 等待超时，独立只读探测仍退出 0。关闭编排层 SSH stdin 后完成下列运行。这些是本轮编排失败记录，没有修改生产源码，也没有据此建立产品行为修复。

## 实际结果

| 步骤 | 结果 | 计时范围 |
| --- | --- | --- |
| Windows 临时副本构建 | exit 0 | 4559 ms |
| 上传后远端 SHA-256 核验 | 95/95；exit 0 | 核验命令 679 ms |
| 远端隔离 npm ci + build | exit 0 | 21340 ms |
| T37 | **10/10；exit 0** | 脚本验收段 12.4 s；完整进程 15647 ms |
| T40 | **2/2；exit 0** | 脚本验收段 14.2 s；完整进程 50550 ms，含仓库准备和清理 |
| 最终远端目录/残留设备清理 | exit 0 | 路径复核通过；脚本清理后额外扫描发现本轮残留 daemon 0 个；隔离根已移除 |

T37 的十个断言按实际输出顺序：

1. 附件实际在第二设备落盘并内容寻址。
2. 分页可重建完整附件文本。
3. Host 与设备同名文件不能替换绑定引用。
4. 远端长输出形成 durable spill 引用。
5. 分页重建 200005 字节完整输出，超过 bounded tail。
6. 第二设备通过公开 provider 发现并加载技能。
7. daemon 断连时拒绝读取，不回退 Host 文件。
8. daemon 重启后原附件引用可续读。
9. 原 spill 按同一 job 身份恢复，长度和摘要保持。
10. 重启后技能目录恢复。

T40 两方向都在真实设备上执行：

- 本地→Ubuntu：交接 `completed`、当前 Assignment 唯一、目标为 remote、新 generation、原 Session 保留。
- Ubuntu→本地：交接 `completed`、当前 Assignment 唯一、目标回到 local、原 Session 保留。

T40 使用脚本生成的隔离 Git 仓库，包含 tracked 修改与 untracked 文件，按 T39 清单显式同步后再核验；没有自动同步、真实用户仓库或生产分支。Router/Worker 为 mock，保持实际 DSH Session loop，不产生真实模型请求。

## 清理与证据边界

创建隔离根后先确认其绝对 `realpath` 等于新建 `/tmp` 子目录且不是符号链接；T37/T40 每个设备目标也在调用脚本递归清理前校验其解析结果属于该根。结束时按原配置路径识别本轮 daemon，停止后再验证根路径并删除；最终清理退出 0，Windows 检查无剩余 SSH 转发进程。本轮未读写用户 DSH 数据、生产服务或生产仓库，未调用真实模型、GitHub 写入或 WSL。

本报告补充 T37/#65、T39/#67、T40/#68 的当前实机证据，对应 A28 的两方向与部分 A29/资产恢复边界；**不覆盖** A29 各切换窗口真实故障、A30 真实离线 stop 全链、T35 Host 接管作业取消、T45/T46 新核心 Electron 绑定，或 A36 真正 hosted 服务器恢复。设备 daemon 不是托管 Host。

父任务本轮本机全量仍有失败：Node24 串行 489 项为 486 pass / 2 fail / 1 skip，`remote-environment` 两处 pairing/restore `DEVICE_UNAVAILABLE`，同文件随后 9/9；首次固定 runner 72 项为 70 pass / 1 fail / 1 skip，失败是 T35 已接管 running job 取消得到 unknown 而非 cancelled。详见父任务 [T55 核心验收报告](t55.md)；[既有插件与 App 回归报告](t55-regressions.md) 单列未变更产品的回归。这些结果不由本报告的 12 个远端通过项抵消；T55 完整产品仍未验收。

## 补充：当前 CLI 的真实 POSIX 信号回归

上述 T37/T40 完成并清理后，在指定 Ubuntu 的全新 `/tmp/<cli-run-root>` 执行当前 CLI 测试；首次两分钟预算的运行 3/3。父任务随后仅补强测试 fixture teardown：即使某个清理失败，也尝试全部 callback、PID、等待关闭和删除目录，再聚合错误。按单独一分钟预算在另一个全新根复跑，最终内容仍为 3/3。此组 **3 个测试单独计数，不并入 T37 的 10 项或 T40 的 2 项，也不把两次重跑算成 6 个测试**。

仅上传以下两个当前文件，远端逐文件 SHA-256 校验 2/2，布局为 `superagent/dev` 与 `superagent/test`；不安装 npm 依赖，不复用此前设备目录：

| 当前文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| dev/t55-acceptance.mjs | 8891 | `61e4c1972c2e7a26f91a48fe5d2e272783e3a3dfffeb5050522e04696bb4916e` |
| test/t55-acceptance.test.mjs | 9694 | `1e00b08fd5b8db4841f9e85a52be36959fee82b4a2918eee8887eb4fba66ee55` |

这两个哈希是 CLI 补验的当前快照，区别于前面 95 文件压缩包中未运行的较早 T55 runner。所有传输及命令继续使用严格 known-host 校验与 batch authentication，不输出路由或凭据。

```text
cd /tmp/<cli-run-root>/superagent
TMPDIR=/tmp/<cli-run-root>/fixtures timeout 35s <device-node24> \
  --test test/t55-acceptance.test.mjs
```

最终内容的实际 Node `v24.15.0` / Linux 结果：**tests 3、pass 3、fail 0、cancelled 0、skipped 0、todo 0，退出 0**。测试器报告 637.389135 ms；含 SSH 的整条测试命令 1318 ms。runner 内容与首次补验相同，只有上述测试文件哈希更新。

| 实际测试名 | 结果与所证明的边界 |
| --- | --- |
| T55 preflight failure replaces a previous success and archives the failed attempt | pass；缺少前置时 CLI 退出 1，最新报告替换为 failed/not-accepted，失败 attempt 归档，旧成功归档保留 |
| T55 --plan needs no prerequisites and leaves prior evidence untouched | pass；无前置可查询固定计划，退出 0，不创建或改写运行证据 |
| T55 real SIGTERM aborts the report and terminates its build process tree | pass；向真实 runner 发 SIGTERM，runner 自行处理后退出 1，报告 aborted/not-accepted；构建子进程及孙进程均停止执行，日志和失败 attempt 保留 |

信号用例自行创建最小 Git/文档和构建夹具，不读取生产仓库或用户 DSH；`TMPDIR` 把全部夹具约束在本次根目录内。测试对 Linux zombie 视为不可执行，并非保证 PID 立即完全消失。它验证实际 POSIX 信号处理及构建进程组终止，**不扩展为 Windows SIGTERM、ConPTY 或任意脱离进程组的进程树证明**。Windows 该 CLI 文件的父任务结果为 2 pass / 1 skip，因为 Windows `child.kill(SIGTERM)` 会强制结束进程，不能等价覆盖 POSIX handler。

测试结束后，清理前 `realpath` 核验通过：本轮目录下残留进程 **0**、残留夹具 **0**；删除该隔离根，清理命令退出 **0**。没有新增远端实验。

父任务另报告最终本机固定 runner 为 **72 项：71 pass / 0 fail / 1 skip**；严格阶段完整性要求仍使该次 runner **退出 1**。本 CLI 补验不覆盖或消除上文较早全量的两项失败和首轮 runner 的失败，完整结论以 [T55 核心验收报告](t55.md) 为准。
