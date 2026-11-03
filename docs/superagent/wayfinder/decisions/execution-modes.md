## Question

系统需要同时支持纯本地执行，以及本地 Host/客户端控制远端设备执行，并允许在两种执行环境之间切换。应如何定义执行模式、执行目标和 Assignment 绑定，才能保持同一 Ticket、Session、授权和交付连续，同时避免本地与远端重复执行、共享目录冲突和未知外部副作用？

请在“确认跟进、停止与恢复的协作状态模型”确定后，通过人机讨论定案：

- 模式设置属于 Instance、Ticket、Assignment 还是单次命令；新工作与运行中工作如何分别处理。
- `local`、`remote`、`auto` 的选择规则、能力声明、权限范围和用户可见提示。
- 本地执行切换到远端、远端切换到本地的安全交接边界：何时可以 flush、停止、对账、换代，哪些 shell/PTY/设备 job 不能迁移。
- 设备离线、job 状态未知、目录或版本不一致、权限撤销时，是否允许自动回退或必须询问用户。
- 本地 Session/业务状态与远端 Environment/Device Daemon 的关系，以及如何沿用 Host epoch、Assignment generation、Environment incarnation 和稳定 jobId 防止旧回调生效。

产出是双模式与切换的行为协议、状态边界和验收场景，不实现 Local/Remote adapter。
