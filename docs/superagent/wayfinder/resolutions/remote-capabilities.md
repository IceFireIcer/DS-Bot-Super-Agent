## Resolution

已确认：远程执行使用配套的公开 fs 与 subprocess provider，在 Agent 的受控能力组合中绑定同一个 Environment；保留原生工具和 agent loop。单独远程化 shell 或替换文件后端不足以证明完整执行环境一致。

固定版本内置搜索经 subprocess 调用 Host 打包 ripgrep 的绝对路径，并使用 Host 路径语义；跨系统时须通过公开适配位置明确可执行文件与路径映射。jobs-local 的执行和输出是进程内状态，已保存的 Session 作业事件不代表 live 作业能跨重启续跑。

研究票以“公开扩展位置与边界已明确”结束。两个 Worker 的组合隔离、异构系统搜索/读写一致性、设备作业重连与取消确认继续由独立运行实验给出证据，不据文档研究宣称完整 daemon 已可用。

研究资料：[固定提交中的完整研究记录](https://github.com/IceFireIcer/DS-Bot-Super-Agent/blob/8d9cab2ac00d777b26814614a8a551349ed74eda/super-agent-references/analysis/wayfinder/remote-capabilities.md)。研究分支 docs/research-remote-capabilities 已推送，不建 PR、不合并。

证据固定到 DSH dsh-v0.2.1-rc.4 提交 504a01a9578abc2c6f1fb896b1dc322c9fe24f66。委派代理连接失败，本研究由主代理直接接回，未计为独立代理评审通过。

下一项运行验证：[验证远程路径与工具执行环境一致性](https://github.com/IceFireIcer/DS-Bot-Super-Agent/issues/12)。
