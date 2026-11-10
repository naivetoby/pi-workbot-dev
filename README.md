# pi-workbot-dev

为 `pi-workbot` 提供统一的多语言研发环境，支撑团队云端工作区中的代码分析、编译、测试与协作

## 在 pi-workbot 中的作用

`pi-workbot` 将 Pi 研发实践整理成团队共享的云端工作区：`chat` 用于需求讨论、方案制定和代码 Review，`code` 在 GitLab CI 中执行编码任务并交付 MR

`pi-workbot-dev` 为两个角色提供共用的研发工具，`pi-workbot` 在此基础上组织 Pi、插件、Skills、模型和角色工作约定，组成完整的研发环境

```text
Dev Containers Base + 官方 Features
  └─ pi-workbot-dev：语言工具链、语言服务与研发工具
       ├─ pi-workbot chat：讨论、分析与 Review
       └─ pi-workbot code：编码、检查与 MR 交付
```

## 内置能力

| 类别               | 工具                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 语言与构建         | Bun、Node.js / npm、Python / venv / pip、Java / Maven、Go、Rust / Cargo、C/C++ 编译工具、CMake                      |
| 编程语言服务       | TypeScript Language Server、Pyright、JDT LS、gopls、clangd、rust-analyzer                                           |
| Web 与配置语言服务 | JSON、YAML、HTML、CSS、Svelte、Bash、Dockerfile、Markdown（Marksman）、TOML（Taplo）、CMake                         |
| 检查与格式化       | Oxlint、Oxfmt、Prettier、Ruff、HTMLHint、markdownlint-cli2、Stylelint、cppcheck、rustfmt、Clippy、ShellCheck、shfmt |
| 代码协作与搜索     | Git、Git LFS、GitLab CLI（glab）、GitHub CLI（gh）、ast-grep、ripgrep、fd-find                                      |
| 文件处理与排障     | jq、yq、SSH、rsync、envsubst、Perl、curl、归档解压工具，以及进程、网络和系统调用排障命令                            |

这些工具供 Pi、插件和项目脚本调用，支持从阅读代码、定位问题到修改、检查和提交变更的日常研发流程

## 运行环境

- Ubuntu 24.04，发布平台为 `linux/amd64`
- 默认用户 `vscode`，HOME 为 `/home/vscode`，工作目录为 `/workspace`，默认 Shell 为 Bash
- Node.js 24、Python 3.12、TypeScript 6.x
- Java 默认使用 JDK 21，JDT LS 使用独立的 JDK 25，Java 环境由 SDKMAN 管理

## 验证

构建过程先完成格式、lint、类型检查和测试，再以普通用户、临时 HOME 和隔离网络执行镜像内验收

- **语言环境**：验证 Python 标准库与 venv/pip，以及 Java、Go、Rust 的错误识别、编译和运行
- **研发工具**：检查命令入口与版本，用错误样例验证检查器和格式化工具的实际行为
- **语言服务**：TypeScript、Bash、Dockerfile、Markdown、TOML、Rust、Svelte 验证错误诊断、修复后清空诊断和正常退出；其余预装语言服务验证入口或版本

验收通过后生成最终镜像，`/opt/workbot-dev/verified.json` 保存验收时间、架构、已采集的工具版本和 Features 锁摘要，便于追踪环境变化

`pi-workbot` 继续在角色镜像和实际项目中验证 Pi、插件以及完整研发流程

## 升级与迭代

随着 `pi-workbot` 承接更多项目，按实际需要补充共享工具。每次升级围绕一组相关变更，同步维护验收样例，通过验证后发布基础镜像，再由 `pi-workbot` 重建并验证 `chat` / `code` 角色镜像，将新的研发环境交付给团队

语言工具链沿用官方 Dev Containers Features，额外工具优先采用官方发行物。版本选择兼顾稳定性与插件兼容性，通过版本声明、锁文件和下载校验记录构建输入，让环境持续更新、变更便于追溯

发布到 Docker Hub 的镜像提供两类标签：

- `latest`：跟随 `main` 最近一次通过验收的发布
- `sha-<完整提交 SHA>`：关联构建源码，便于查找对应变更

固定镜像内容使用 digest；团队环境回退使用已经验证并保留的 `pi-workbot` 角色镜像
