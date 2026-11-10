# pi-workbot-dev

`pi-workbot` 是基于 Pi 的云端研发工作区，让团队通过聊天和浏览器讨论需求、分析代码并协作完成编码任务。

本仓库维护 `pi-workbot` 使用的研发基础镜像，集成多语言工具链、语言服务器和常用研发工具。镜像统一构建并发布到 Docker Hub，供 `chat` 与 `code` 角色共用。

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

这些工具供 Pi、插件和项目脚本调用，支持从阅读代码、定位问题到修改、检查和提交变更的日常研发流程。

## 运行环境

- 基于 Ubuntu 24.04，发布平台为 `linux/amd64`。
- 默认用户为 `vscode`，HOME 为 `/home/vscode`，工作目录为 `/workspace`，默认 Shell 为 Bash。
- Node.js、Python 和 TypeScript 分别使用 24、3.12 和 6.x 版本线。
- Java 默认使用 JDK 21，JDT LS 使用独立的 JDK 25，Java 环境由 SDKMAN 管理。

## 验证

构建过程完成格式、lint、类型检查和测试，并在普通用户、临时 HOME 和隔离网络环境中验证预装工具。

- **语言环境**：验证 Python 标准库与 venv/pip，以及 Java、Go、Rust 的错误识别、编译和运行。
- **研发工具**：检查命令入口与版本，用错误样例验证检查器和格式化工具的实际行为。
- **语言服务**：TypeScript、Bash、Dockerfile、Markdown、TOML、Rust、Svelte 验证错误诊断、修复后清空诊断和正常退出；其余预装语言服务验证入口或版本。

验收通过后生成最终镜像，`/opt/workbot-dev/verified.json` 保存验收时间、架构、已采集的工具版本和 Features 锁摘要，便于追踪环境变化。

`pi-workbot` 继续在角色镜像和实际项目中验证 Pi、插件以及完整研发流程。

## 升级与迭代

按实际项目需求补充共享工具，小步更新并同步维护验收样例。基础镜像验收通过后，再由 `pi-workbot` 构建并验证 `chat` / `code` 角色镜像。

语言工具链沿用官方 Dev Containers Features，额外工具优先采用官方发行物。版本选择兼顾稳定性与插件兼容性，通过版本声明、锁文件和下载校验记录构建输入，让环境持续更新、变更便于追溯。

发布到 Docker Hub 的镜像提供两类标签：

- `latest`：跟随 `main` 最近一次通过验收的发布。
- `sha-<完整提交 SHA>`：关联构建源码，便于查找对应变更。

固定镜像内容使用 digest；团队环境回退使用已经验证并保留的 `pi-workbot` 角色镜像。

### 后续方向

- 按项目需要扩展语言和框架支持，逐步补充对应工具链与语言服务。
- 为更多语言服务补充诊断、修复和退出验收。
- 持续优化构建缓存和镜像体积，提高升级与分发效率。
