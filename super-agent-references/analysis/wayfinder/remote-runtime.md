# 远程执行环境一致性实验

日期：2026-11-03。对应[验证远程路径与工具执行环境一致性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/12)。公共 DSH 包基线 0.2.1-rc.4。原创建图实验，不交付完整 daemon。

## 选定能力组合

- 每个 Worker 固定绑定一个 Environment 的 fs、subprocess 和作业控制能力，使用独立服务 scope，不共享全局 currentEnvironment。本轮真实 Cordis isolate 同时绑定两个 fs/subprocess 查询与读取子集，父 Context 不被改变；Agent preset、子代理继承仍须后续集成验收。
- 文件目标使用 Environment 范围内的不透明身份；processPath 由设备返回，不从 targetKey 猜测。进程的 cwd、可执行文件、文件目标、搜索和输出属于同一设备。Host 文件/附件路径没有显式映射时拒绝假定共享。
- 首个异构方案选择设备侧搜索适配：由设备运行匹配其平台的搜索程序，并返回相对路径、行号和内容的结构化结果，避免用 Host node:path 解释设备结果。原生 Host 打包 rg 绝对路径不能盲转发。实验用设备配置的 rg 与逻辑 executable 名称；不按任意 Host basename 猜可执行文件映射。
- 后台操作由设备维护稳定 job ID、daemon incarnation、状态及可按字节偏移重读的输出；Host 工具对象与实际作业分开。启动响应丢失后查询原 job ID，同 ID 不同参数拒绝；环境/daemon 身份不匹配时保留 unknown。
- cancel 应答只能表明请求已接收，先记录 stopping；只有设备对相同 managed range 确认退出才可标记停止。未知作业或传输不可用不能伪报已取消。实验 managed range 只有单个 Node 子进程，无后代/PTY 证明。

## 实验与结果

[主实验](remote-runtime/probe.mjs)、[设备模拟进程](remote-runtime/device.mjs)、[结构化结果](remote-runtime/results.json)。从根目录运行，需仓库 harness 公共包和 PATH 中的 rg；不需要模型、密钥或真实账号：

```powershell
node super-agent-references/analysis/wayfinder/remote-runtime/probe.mjs
```

Node v25.4.0 / Windows 下，两个独立设备模拟进程分别管理独立目录和子进程，经真实 127.0.0.1 HTTP RPC 连接。10 组通过：

1. 实际 Cordis 双 scope 注册公共 FileSystem / SubprocessRuntime 子类；resolve/processPath/readText 与 executable lookup 进入各自设备客户端，父服务不变，跨 scope target 被拒。
2. 两环境同名文件分别读写，真实 rg 搜索只返回本环境内容，搜索相对路径可回读；Node 命令的 cwd/文件/输出一致。
3. 不支持的 Host executable 身份、错误 Environment 与词法路径越界被拒。它不是完整路径沙箱测试，未验证 symlink/junction/TOCTOU。
4. 模拟传输在发送前断开：未增加设备启动计数。此窗口是客户端开关替身，不是物理网络抓包。
5. 设备已启动后主动断开响应 socket：新客户端按 job ID 查询到原作业；同参数重投不重复启动，改参数被拒。
6. 作业运行期间 Host 停止传输，新客户端重连仍可观察完成；按 byte offset 组合输出与完整输出相同，含多字节文本。
7. 已完成查询的响应丢失后可重复读取；输出非消费性，设备没有重跑作业。
8. cancel 先返回 stopping，实际子进程退出后为 cancelled；另一环境同名 job 继续并正常结束。
9. POSIX/Windows 路径表验证设备端构造语义；这是纯函数表，不是不同 OS 的运行证据。
10. daemon incarnation 不匹配时，Host 不把该结果视为原作业事实，查询保持 unknown。

结束时停止设备/子进程，关闭服务，再验证绝对目录位于实验根目录下并清理唯一 .dsh-test-remote-* 数据。没有使用用户 DSH 数据或实际工作目录。

## 支持范围及剩余验收

本轮证明同平台本机分进程协议与公开 Cordis 服务绑定子集。Fs 只实现 resolve/processPath/readText，subprocess 只实现 executable lookup；命令、搜索、输出、取消走原创协议，没有实现完整公共 SubprocessHandle 的同步 spawn、streams/collect/spill/PTY，也没有运行 DSH 原生工具或 Agent loop。不能声称完整 DSH provider conformance。

没有第二台物理设备、异构 OS、生产网络认证/加密、daemon 重启后的持久作业索引或进程树取消证据。daemon 中 job/output 为进程内 Map；只证明 Host 客户端重连，不保证设备 daemon 崩溃续接。daemon 实例变化、查不到作业时保持 unknown；生产需持久作业索引或可核查的 OS/设备状态，按执行所有权协议处理。

生产适配必须保留公开同步 spawn 返回本地代理 handle 的形状；terminate 和 waitForExit 对同 managed range 负责。不能把本实验 async HTTP start 直接称作完整 SubprocessRuntime.spawn。完整文件版本保护、限额、取消/并发与生命周期语义在对应适配切片验收。

支持范围初始只声明实测组合；异构组合在匹配平台搜索、执行程序、cwd、结果路径和停止范围全部通过前不启用，不回落到 Host 同名文件。附件、spill、技能和 MCP/浏览器/Office 未验证，不能因配套 fs/subprocess 存在就宣称远程可用。

Host/Session/设备 job 的授权、代次、失联接管和外部结果 unknown 仍由既有执行所有权决定收敛；本轮选择了具体能力组合与保守失败行为，没有发现需要新增独立架构问题。真实网络/平台覆盖属于已有 A19/A20 的实施验收，不预先交付完整 daemon。

## 参考与回归

固定 DSH 源码 504a01a9578abc2c6f1fb896b1dc322c9fe24f66 的公开 [fs](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/fs/src/index.ts)、[subprocess](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/subprocess/subprocess/src/index.ts)、[search](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/tool-fs-search/src/search-core.ts)；既有[远程合约研究](remote-capabilities.md)。只读复核实际验证了公开 Context 服务隔离与声明形状，未作为完整适配器认证。

仓库基线：npm test 1431 通过、2 跳过、0 失败，生成一致性通过，lint 退出 0、有既有警告。没有修改产品运行代码，未跑 host smoke；这些结果不代替远程产品验收。
