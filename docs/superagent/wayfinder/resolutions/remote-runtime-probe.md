## Resolution

选用每 Worker 固定 Environment 的配套 fs/subprocess/job 能力组合，独立服务 scope，无全局 currentEnvironment。路径由设备解析，targetKey 不当进程路径。首个异构方案用设备侧搜索工具适配，设备解析 executable/cwd 并返回相对路径、行号、内容，避免 Host 打包 rg 绝对路径或 Host node:path 盲转发。

设备持有稳定 job ID、daemon incarnation、状态和 byte-offset 输出。启动回执丢失先查原 ID，同 ID 不同参数拒绝；Host 重连只恢复观测与控制，不重复启动。设备身份变化或结果不可查保留 unknown。取消先记 stopping，确认相同 managed range 实际退出后才能报告停止。

### 实验

两个本机设备模拟进程、独立目录、真实 loopback HTTP、rg 与 Node 子进程，10 组断言通过：同名文件读写/搜索/命令/cwd/输出不串线；Host executable 和错误环境拒绝；发送前断开无启动；启动成功但丢响应可对账去重；运行断连后重连续读含多字节的 byte-offset 输出；结果丢失后非消费重读；取消等实际子进程退出且不影响另一环境；路径平台表；daemon 身份不匹配保持 unknown。另实际运行公共 Cordis 的 fs/subprocess 双 scope，以公共查询/读取子集连接设备客户端，父 Context 不被改变。

[报告](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/392c5e843c15e87519d73a0fadb6a83601dde247/super-agent-references/analysis/wayfinder/remote-runtime.md)、[主实验](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/392c5e843c15e87519d73a0fadb6a83601dde247/super-agent-references/analysis/wayfinder/remote-runtime/probe.mjs)、[设备模拟](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/392c5e843c15e87519d73a0fadb6a83601dde247/super-agent-references/analysis/wayfinder/remote-runtime/device.mjs)、[结果](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/392c5e843c15e87519d73a0fadb6a83601dde247/super-agent-references/analysis/wayfinder/remote-runtime/results.json) 已推送 docs/research-remote-runtime，无 PR/合并。

### 边界与后续

同平台本机进程不是第二台物理设备或异构 OS；平台路径表不是运行证据。公开 Fs/subprocess 仅查询/读取子集，命令/搜索/控制用原创 RPC，未实现完整同步 spawn 返回的代理 SubprocessHandle、PTY、spill、原生 DSH 工具调用或 Agent/子代理继承。取消只证明单个无后代子进程；job/output 为 daemon 内存 Map，只证明 Host 客户端重连，未证明 daemon 重启持久恢复。没有生产认证、加密、沙箱或跨机部署验收。

生产组合必须补齐原生公共 handle 形状与完整文件协议；异构组合未验证时不启用，不回退 Host 同名路径；附件、技能、MCP/浏览器/Office 逐项声明位置。既有执行所有权决定处理 job/daemon/Host 代次、失联、接管和未知结果；真实设备覆盖仍由 A19/A20 实施验收，无新增独立前置决定。

仓库基线：1431 通过、2 跳过、0 失败，生成一致性通过，lint 退出 0、有既有警告。产品代码未改，未跑 host smoke；测试服务、子进程与隔离数据已清理。
