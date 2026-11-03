# 本地与远端双模式的执行目标与切换协议：待决问题

对应决策：[确定本地与远端双模式的执行目标与 Assignment 切换协议](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/14)。

## 问题

系统需要同时支持纯本地执行，以及本地 Host/客户端控制远端设备执行，并允许在两种执行环境之间切换。应如何定义执行模式、执行目标和 Assignment 绑定，才能保持同一 Ticket、Session、授权和交付连续，同时避免本地与远端重复执行、共享目录冲突和未知外部副作用？

## 讨论范围

- 模式设置属于 Instance、Ticket、Assignment 还是单次命令；新工作与运行中工作如何分别处理。
- `local`、`remote`、`auto` 的选择规则、能力声明、权限范围和用户可见提示。
- 本地执行切换到远端、远端切换到本地的安全交接边界：何时可以 flush、停止、对账、换代，哪些 shell/PTY/设备 job 不能迁移。
- 设备离线、job 状态未知、目录或版本不一致、权限撤销时，是否允许自动回退或必须询问用户。
- 本地 Session/业务状态与远端 Environment/Device Daemon 的关系，以及如何沿用 Host epoch、Assignment generation、Environment incarnation 和稳定 jobId 防止旧回调生效。

## 约束与已知依据

- 纯本地和本地控制远端共用 Domain Engine、Ticket、Assignment、Session、Effects/Outbox 和用户交互模型。
- 本地与远端是执行适配和 Environment 的选择，不因此产生两套独立调度器。
- 每个正在执行的 Assignment 只能有一个有效执行目标；模式切换不得让本地与远端同时执行同一副作用。
- Host 断连不表示设备作业停止；远端作业以设备 incarnation 和稳定 job ID 对账。
- 人工 stop、暂停和权限撤销优先；未知外部结果需要先对账，不得盲目切换或重做。
- 正在运行任务的切换必须沿用已定 Host fencing、Assignment 代次、Session flush/replay 和设备停止确认边界。

本页记录待讨论的问题，不代表这些细节已经定案，也不授权实现 Local/Remote adapter。
