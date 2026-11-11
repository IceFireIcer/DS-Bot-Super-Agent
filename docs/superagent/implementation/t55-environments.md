# T55：环境证据与运行前提

核对时间：2026-11-11（Asia/Shanghai）；源码基线 `221c743544417623e00e14346bc5962550848b71`，`dev`。工单：[T55 / #83：验收四目标的完整产品协作场景](https://github.com/IceFireIcer/DS-SuperAgent/issues/83)。本报告仅核验入口、环境与证据，不实现产品功能、不关闭验收项。

## 当前结论

**完整产品未验收。** T25–T54 的分层记录提供了真实信道、真实第二设备和故障实验，但不是同一条桌面→GitHub→设备→托管 Host→Watchdog 场景。2026-11-11 只读查询显示 T25–T29、T32–T54 已关闭，T30/#58、T31/#59 和 T55/#83 仍 open；历史实施文档里的“仍 open”属于当时状态。关闭状态不补足真实环境证据。

最先需要解决的是 **T45/#73、T46/#74 的最小真实桌面绑定缺失**。T55 应记录或回报给行为票，不把它实现进最终验证脚本：

- [app/src/profile.mjs](../../../app/src/profile.mjs) 的 `BUNDLES` 仅挂载 DSH base/web/voice 和 `ds-bot`；[app/package.json](../../../app/package.json) 依赖 `ds-bot`，没有 `ds-superagent`。
- [app/src/host.mjs](../../../app/src/host.mjs) 用公开 `runProfile()` 启动上述 profile；`app/src`/`app/scripts` 未发现新核心或 `createClientGateway` 绑定。[app/electron-builder.yml](../../../app/electron-builder.yml) 打包现有 `src`/assets；[app/vite.config.js](../../../app/vite.config.js) 仍取旧插件的 Bot views，构建它不会自动绑定新核心。
- T45 最小缺口：真实 Electron 客户端绑定认证的新核心网关，按 Instance 授权提交/读取、持久游标补读、原 command ID 重试及撤销；T46 最小缺口：实际运行或连接该 Host，关窗/重连保留工作，显式退出遵循部署的服务归属，休眠/唤醒按中断恢复。现有旧 Host 页面及其常驻检查无法证明这组新核心行为。参见 [t45.md](t45.md)、[t46.md](t46.md)。

## 可用环境及已有证据

| 层 | 本次直接核对 | 已有证据及限制 | 后续运行前提 |
| --- | --- | --- | --- |
| 原生 Windows | Windows 11 Pro x64，`10.0.26200`；默认 Node `25.4.0`；指定隔离 Node 24 runtime 的版本探测返回 `v24.22.2` | [T46](t46.md) 历史 lifecycle/resident；**父任务本轮** Node 24 + 真 Electron/DSH + 隔离 home 的 `check-resident.mjs` 五项通过并正常退出 `0`：真实 Host/团队、关窗同 Host、二次启动同 Host、Quit 停 Host、强停后同数据/端口恢复。无模型、无新核心绑定，未做真 OS 休眠/关机 | 固定 Node 24 可执行文件，并使其目录位于子进程 PATH 首位；独立 home/shell/workspace、空闲端口、桌面会话和退出清理；新核心桌面绑定先由 T45/T46 补齐 |
| 本机依赖/工具 | Git `2.52.0.windows.1`、gh `2.93.0`、npm `11.7.0`；ssh/scp/docker 可解析；psql 未在 PATH 找到。Electron `44.7.0` 文件存在，DSH Session/App `0.2.1-rc.4`、pg `8.23.1`、node-pty `1.2.0-beta.15`、embedded-postgres `17.11.0-beta.19` 可定位 | 仅包元数据和文件存在性；未由此宣称 native module、Docker daemon 或数据库运行通过 | 使用项目原生依赖；Docker/系统 psql 不是现有 embedded PG 配方的前提；当前 `dist` 存在不证明与源码一致 |
| 真实第二设备 | 首次 SSH 因身份文件继承了过宽 ACL 退出 `255`；获授权后仅收紧该文件 ACL。严格 known-host 探测退出 `0`：Linux `6.8.0-101-generic`、Node `v24.15.0`、Git `2.43.0`。**本轮 Windows Node24→指定 Ubuntu：T37 10/10、T40 双向 2/2，均退出 0** | 当前源码快照 95 文件逐一核验、远端独立 npm ci/build；清理退出 0。完整哈希、命令与边界见 [t55-second-device.md](t55-second-device.md)。历史 T32–T40 记录继续保留，不代替本轮结果 | 只用指定临时 Ubuntu，不用 WSL。实际为隔离设备 daemon，非托管 Host；仍缺各交接故障窗口、真实离线 stop、真实 Electron 新核心绑定及 hosted 全场景 |
| 真实 GitHub | 本次成功只读获取 #83 和实施票状态，证明这一读取可用；未探测写权限 | [T25–T27](t25.md)：隔离仓库 `IceFireIcer/SuperAgentTest` 的 Issue #13、PR #14、review `5820849029`、CI `128938483337` 及合并事件历史；模型为 mock | 明确隔离 checkout/repo、actor/授权范围、CI 与创建/评论/合并/清理授权。读取成功不能推出写/merge 权限；当前分工不做外部写入 |
| PostgreSQL / Host / Watchdog | **父任务报告本轮实际运行** `dev/t47-acceptance.mjs`（Windows / Node 24），正常退出 `0`：SQLite 和隔离 embedded PG 都恢复 epoch `1→2`、takeover `completed`、1 Ticket `resumed`、restart budget `1/2`。本 sidecar 未重跑 | [T42](t42.md)、[T43](t43.md)、[T44](t44.md)、[T47](t47.md)：本机真实 PG、writer/fencing、真实多进程恢复。当前 `hosted-postgres` 配方仍在同一 Windows 上，不是托管服务器 | 真实 hosted 需另有获授权服务器、隔离业务库及 Session 后端、受保护连接/TLS、认证客户端、唯一 Watchdog、状态/资产目录、合法 Host 租约与服务退出归属；没有当前服务器部署证据 |
| 真实模型 | 本次只检查进程环境的存在性：`POKEXIAO_API_KEY`、`OPENAI_API_KEY` 均 absent；未读取账号文件或配置内容 | [T29](t29.md)：一个 provider/model 的 4 次真实 HTTP 准备小样本。T48/T49 是真实 DSH loop + mock；[T54](t54.md) 同事件流 benchmark 为 mock，token 不可测 | 单独配置获授权 provider/model、凭据安全注入、调用/时间/token 预算；需覆盖跨信道指代、范围、主动误触发、Supervisor 语义及指令解析，不能借用 T29 四次样本代替 |

指定 SSH 路由及身份文件由操作者在受控本地环境提供；仓库报告不保存地址、登录身份、个人路径或凭据定位信息。本次只调整一个指定身份文件的 ACL，未修改父目录、其他文件权限或 known-host 记录。

## 可复用入口与执行条件

以下入口分别陈述执行归属：本轮 T47 和 resident 由父任务运行，均正常退出 `0`；本 sidecar 已运行 T37/T40 实机脚本，分别 10/10、2/2，均退出 `0`；其他条目仅核对源码。

| 入口（相对仓库根） | 作用与运行约束 |
| --- | --- |
| `app/scripts/check-lifecycle.mjs` | 真 Electron + 假 Host；固定使用 `app/.dsh-test-tray-lifecycle`，并行运行前确认目录无人使用；检查隐藏/重开/模拟 sleep 路径，不是 OS 真睡眠 |
| `app/scripts/check-resident.mjs` | 真 App + 旧 DSH Host；自动生成临时 `DS_BOT_HOME`、`DS_BOT_SHELL_DATA` 和 workspace，随机调试端口仍需确认空闲；无真实模型，不代表新核心 |
| `app/scripts/check-packed.mjs` | 隔离 packaged App + mock 模型入口；需已有对应平台包，测试复制到临时目录。安装/更新实验不在本次只读授权内 |
| `superagent/dev/remote-device.mjs` | `--config <absolute-json> --pairing-code-file <absolute-path>`；设备 root/state/jobs/assets/skills 独立配置，设备 ID/签名 pin、Instance/actor grant 与能力显式匹配；不能打印配对码、Host snapshot 或状态内容 |
| `superagent/dev/t35-acceptance.mjs`、`t37-acceptance.mjs`、`t39-acceptance.mjs`、`t40-acceptance.mjs` | 均接收 `--host`、`--key`、`--package-root`、`--device-root`、`--remote-port` 和可选 `--local-port`。会启动/强杀设备、传文件并清理远端目录，**不是可用性探针**；需确认获授权目标、隔离绝对目录和部署代码版本。脚本已有固定测试配对码、宽松 SSH host-key 参数，运行前需核验网络及信任边界，不应当作生产安全配方 |
| `superagent/dev/github-acceptance.mjs` | 会 checkout/pull、创建 issue/branch/PR/review、push、`gh pr merge --admin` 和删除分支；即使设置 `SUPERAGENT_EXISTING_*` 也可能 merge。`SUPERAGENT_TEST_REPO` 只覆盖 checkout 路径，GitHub repo 硬编码为 `IceFireIcer/SuperAgentTest`；必须单独授权后运行 |
| `superagent/dev/schedule-acceptance.mjs`、`proactive-model-acceptance.mjs` | 前者本地真实时钟 + 确定性 Gate；后者读取 `POKEXIAO_API_KEY`，可选 `PROACTIVE_MODEL_URL`/`PROACTIVE_MODEL`，会真实计费请求。源码有 25 s 单请求、网络重试及第二 token 档，不能把历史 4 次当作今后固定请求上限 |
| `superagent/dev/t47-acceptance.mjs` | 本机 SQLite + embedded PG 的真实 Host 子进程故障/接管，父任务已运行且退出 0；不是跨机 hosted。`t47-host.mjs` 的 native mock Session 使用本机目录，PG 配方不等于已组合 T43 的共享 Session 后端 |
| `superagent/dev/collaboration-bench.mjs` | 固定 mock 同事件流比较，历史 JSON 在 [t54-bench.json](t54-bench.json)；真实 token、managed/remote 负载及故障恢复另测，不能把 state reopen 当崩溃恢复 |

**A34 外发证据需要纠正范围。** `github-acceptance.mjs` 创建的两个 Engine 没有注入 `DeliveryOptions.channel`；[outbox.ts](../../../superagent/src/outbox.ts) 因此使用 [deliveries.ts](../../../superagent/src/deliveries.ts) 的 `localDeliveryChannel`，该 channel 仅返回本地 success。脚本检查 `result.destination`，没有发送结果评论到 GitHub。T27 的真实接收事件及目的地记录有效，但其“交付”不能当作真实 GitHub 外发回执；补验/适配责任属于 T27/#55（交付链与授权），来源输入属于 T25/#53，PR 完成条件属于 T26/#54。

## 规格缺项与归属

| 场景 | 当前可引用的部分 | 缺失的完整产品边界及责任票 |
| --- | --- | --- |
| A26 四目标完整场景 | T25–T54 的领域/契约/mock/局部真实记录；本轮 T47 本机恢复 | 缺一条同版本真实桌面、GitHub、设备与 hosted 连续轨迹；T55/#83 汇合。桌面绑定归 T45/#73、T46/#74；主动准备归 T28/#56、T29/#57；故障分类/语义提案归 T47/#75、T48/#76；真实配置解释归 T49/#77 |
| A27 双模式选择 | [T36](t36.md) 的 default/override/auto/remote-only 领域证据，T32–T40 历史设备记录 | 缺真实桌面内纯本地闭环与本地 Host 控制第二设备的本轮端到端选择，及变更全局策略不迁移在途任务的同场景证据；T36/#64、T45/#73、T46/#74。T38/#66 的远端 Browser/MCP/Office 仍明确 unverified，不得隐式启用 |
| A28 双向执行交接 | T39 manifest/哈希；**本轮 T40 Windows→Ubuntu→Windows 2/2，退出 0**，同 Session、新 generation，详见第二设备报告 | 没有本轮 UI+真实模型+长作业对账组合。同步仍需显式传输，不自动搬库/Session；T39/#67、T40/#68，旧回调/重启保护归 T41/#69 |
| A29 切换故障边界 | [T41](t41.md) 隔离 SQLite 中注入 requested/flushing/switching 并恢复；stop/unknown/撤权阻断 | 缺真实第二设备在各切换窗口中断的本轮组合，不把状态注入当实际网络故障；T41/#69、T35/#63；能力、同步证据分别 T38/#66、T39/#67 |
| A30 离线 stop 与明确 resume | T34/T35 原 job/range 对账及本机测试；T35 历史第二设备恢复 | T34 的真机 PTY 2/2 不含真机断连 stop 全轨迹；缺本轮桌面 stop→离线 pending→回连不自启→同范围静止→明确 resume 证据。T34/#62、T35/#63、T41/#69；UI 绑定 T45/#73、T46/#74 |
| A34 跨信道交付 | 真实 GitHub 输入/PR 生命周期、目标决策；无权限/失败不改投为契约测试 | 缺真实 GitHub 外发传输、平台消息 ID/回执及同 Ticket 指代和问题就地回答的完整真实模型轨迹；T27/#55、T25/#53、T26/#54。飞书 T30/#58、T31/#59 的真实租户仍明确暂缓，不能借协议夹具补成通过 |
| A36 托管与客户端生命周期 | T45 独立客户端进程补读，T46 旧 App 常驻，T42–T44 共享 PG 契约，本轮 T47 本机 PG 恢复 | 缺真实服务器 Host + 认证 Electron 关闭/断连补读、远端 Watchdog 服务恢复、真 OS 休眠/关机中断；T42/#70、T43/#71、T44/#72、T45/#73、T46/#74、T47/#75。T47 尚无 Windows Service/开机自启安装；该部署责任需显式回报，不能在 T55 暗中补功能 |

迁移相关的 [T50](t50.md)–[T53](t53.md) 仅证明虚构隔离数据/真实夹具进程。真实旧产品的 `LegacyCore`、`ReverseControl`、旧自启动停用与安全逆向接入仍应归 T51/#79、T52/#80、T53/#81；缺少设置/迁移 UI 不能借“留 T55”变成在 T55 添加功能。未经授权不接触用户 DSH 或真实团队数据。

## 父任务开跑前的判定

本轮指定 Ubuntu 的 T37 资产和 T40 双向交接已实际运行并清理；T55 新脚本与全量测试由父任务负责，其失败仍按 [T55 核心验收报告](t55.md) 保留，不被本轮实机通过抵消。完整产品 acceptance 仍缺 T45/T46 真实桌面最小绑定及获授权真实 hosted/模型/信道外发配置。对应前提未满足的格子保持“未验收”。记录版本/命令/环境、Ticket/Session/generation/job 身份、预算与结果、退出码/清理；真实信道另保留可核查平台回执。领域、mock、历史实机、本轮本机与真正 hosted 的结果分别陈述，不能合并成全绿。
