# DSH 远程能力与作用域合约研究

- 日期：2026-11-02。决策：[确认 DSH 远程执行能力与作用域合约](https://github.com/IceFireIcer/DS-SuperAgent/issues/4)。
- 固定 DSH：`dsh-v0.2.1-rc.4`，提交 `504a01a9578abc2c6f1fb896b1dc322c9fe24f66`。链接固定到该提交，避免 master 漂移。
- 本项为官方文档与源码研究，未运行远程设备、daemon、DSH 或跨操作系统工具实验。委派研究代理连接失败后由主代理接回完成。

## 结论与选用方向

采用配套的 fs 与 subprocess provider 适配同一 Environment，保留原生工具与 agent loop 的职责；在 Agent 组合/作用域内绑定整套能力，而不是只给 shell 添加远程参数。

公开合约提供扩展基础，但没有证明原型或 DSH 默认配置已经提供完整跨设备运行。来源轮询、Agent loop、消息状态留在 Host；文件和命令执行进入选定设备。后台作业跨重启续接需要设备作业身份与对账协议，默认 jobs-local 不具备这项保证。

特别需要运行验证：内置搜索把 Host 的打包 ripgrep 绝对路径传给 subprocess，并使用 Host 平台路径语义。远程 provider 不能盲目把这个绝对路径原样传到另一操作系统；替换 fs 一个服务也不会改变搜索行为。

## 能力矩阵

| 能力 | 公开扩展依据 | 必须由本项目提供或验证 |
| --- | --- | --- |
| 文件 | ctx.fs 的 resolve、read、write/edit、stat、list 和目标身份 | 同一 Environment 下路径解析、目标身份、版本保护和有界读取 |
| 路径映射 | processPath、fileUrl、contains；Host 路径映射默认不保证存在 | 设备平台路径、Host/设备附件映射，禁止猜测本地路径在远端同名存在 |
| 普通命令 | ctx.subprocess.resolveExecutable、spawn，argv/cwd/env 显式 | 远程可执行文件解析、作业 ID、传输与结果保存 |
| 输出 | offset-based 非消费读取、raw pipe、有界 collect 与 spill | 断连重读、截断与完整输出入口的位置及权限 |
| 取消 | terminate 与 waitForExit 管同一 managed range | 返回已确认静止或明确未知，不能只取消 Host promise |
| PTY | spawnTerminal、foreground/activity、终止整会话 | 目标平台终端与进程组可观察范围、输入/resize/终止协议 |
| glob/grep | 内置工具经 subprocess 执行打包 ripgrep，不经 ctx.fs | Host 二进制路径到设备可执行文件的映射，目标 cwd 与结果路径一致 |
| 后台 jobs | JobRegistry 分 owner 记录，完成通过 Agent 通知 | jobs-local 生命周期与设备长期作业的身份衔接、重启后对账 |
| Agent scope | Agent setup/ctx 支持 scoped 注册，provider 在 context 中唯一 | 多 Worker 的组合隔离、同一组 fs/subprocess/job 控制能否正确选择 |
| 附件/spill/技能 | 原型通过相关 DSH 能力与资源读取组装 | 逐项定义 Host/设备位置、传输和续读，不能由文件 provider 存在推导全部可用 |

依据：[fs 公开服务](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/fs/src/index.ts#L87)、[subprocess 公开服务](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/subprocess/subprocess/src/index.ts#L89)、[进程与终端类型](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/subprocess/subprocess/src/types.ts)、[Agent scope](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/core/agent/README.md#L61)。

## 源码确认的四个关键限制

### 1. fs 与 subprocess 共享执行世界

fs.processPath 返回的是对应文件在 subprocess 所在环境可打开的绝对路径；targetKey 是不透明身份，不能直接拿去当文件路径。Host 映射接口默认返回 undefined。subprocess 文档要求 executable 和文件 provider 在同一执行世界。

证据：[fs L134–173](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/fs/src/index.ts#L134)、[subprocess L89–115](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/subprocess/subprocess/src/index.ts#L89)。

### 2. 搜索使用 Host 的二进制与路径假设

搜索注入 tools/systemPrompt/subprocess/workingDirectory，特意不注入 fs。resolveRgPath 按 process.platform 和 Host 依赖解析二进制；runRipgrep 把此路径放入 argv[0]，cwd 来自工作目录服务。输出转相对路径使用 Host 的 node:path。

因此单纯替换 fs 不会远程化搜索；单纯转发 subprocess 也不能证明 Host 与目标设备异构时正确。可以在公开 provider 实现中定义支持的可执行文件映射或提供自有工具适配，但具体选择需由最小运行实验决定，不能 patch DSH 安装文件。

证据：[搜索注入和部署要求 L7–24](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/tool-fs-search/src/index.ts#L7)、[resolveRgPath L171](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/tool-fs-search/src/search-core.ts#L171)、[runRipgrep L234](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/tool-fs-search/src/search-core.ts#L234)、[结果路径 L301](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/fs/tool-fs-search/src/search-core.ts#L301)。

### 3. 作业日志持久不等于作业执行可恢复

jobs-local 在进程内保存记录和输出环，随 owner 或 Host 结束清理。已写入的 job lifecycle 事件可保留，但 live jobs/output 不会因恢复 Session 自动续跑；终止期间也不保证最后 settlement 一定写入。JobRegistry 合约本身含进程内回调，跨进程后端不能只存一行状态就视作符合。

首个远程实现需要区分 Host 中的通知/工具对象和设备上的实际作业。设备维护稳定 jobId 与状态/输出，Host 恢复后查询并决定重连、取消或报告未知。具体租约与所有权由下一项决定制定。

证据：[jobs L57、L128](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/jobs/jobs/README.md#L57)、[jobs-local 的生命周期与限制](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/jobs/jobs-local/README.md#L144)。

### 4. context 中服务唯一不等于已证明任意 per-call 切换

公开 Agent setup/ctx 支持 scope，subprocess 服务在同一 context 重复 provider 会报错。实际每个 Environment 的能力组合要在创建 Agent/预设时正确挂载，并验证继承、子代理和 tool 注册。不能用一个未经验证的全局可变 currentEnvironment 作为多 Worker 路由。

证据：[Agent setup 与 scoped 注册](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/core/agent/README.md)、[subprocess 服务唯一说明](https://github.com/deepseek-ai/deepseek-harness/blob/504a01a9578abc2c6f1fb896b1dc322c9fe24f66/packages/subprocess/subprocess/src/index.ts#L89)。

## 下一步最小运行验证

公开扩展位置和边界已经查明，可结束本研究票；运行可行性继续通过独立任务给出证据：

1. 两个隔离 Environment 的同名文件，两个 Agent 分别读写、搜索、执行命令，确认无串线。
2. Host 与设备采用不同操作系统路径时，检验 executable/cwd/搜索结果/文件读取的一致性；仅同平台成功需明确限制。
3. 后台命令执行后断开传输，重新连接按 jobId 读输出并确认进程状态；取消收到终止请求但未静止时保持 unknown/stopping。
4. 核对 Agent、子代理和工具 scope 的 provider 绑定，避免一次切换影响其他 Worker。
5. 为附件、spill 与技能建立最小位置清单，只声明实际通过实验的能力。

实验可先用受控替身和本地分进程设备模拟验证协议；不能把该结果等同于真实第二台设备、生产网络安全或全部目标平台验收。
