## Question

固定 DSH 版本中，哪些公开扩展位置可以让同一 Worker 的文件、搜索、shell/PTY、后台作业、输出、取消和路径解析进入同一远程执行环境？

核对 fs、subprocess、jobs、Session/Agent scope、附件与 spill 的相互依赖，确认 per-Environment 选择和多 Worker 隔离需要满足的合约。明确已支持的机制、仍需实现的适配器和无法仅靠配置完成的部分；不把只远程执行 shell 等同于完整环境分离。

输出逐项能力证据与最小实验清单，供后续执行所有权决定使用。依据：[设备执行与客户端接入规格](https://github.com/IceFireIcer/DS-SuperAgent/issues/1)。
