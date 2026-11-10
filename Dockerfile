# syntax=docker/dockerfile:1
ARG BASE_IMAGE=pi-workbot-dev-toolchain:local
FROM oven/bun:1.4.4 AS bun

FROM ${BASE_IMAGE} AS downloads
USER root
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 || { echo 'This image currently supports linux/amd64 only' >&2; exit 1; }
ADD --checksum=sha256:b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4 \
    https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz /tmp/jdtls.tar.gz
ADD --checksum=sha256:8fe196b894ccf9072f98d4e1013a180306e17d244830b03986ee5e8eabeb6156 \
    https://github.com/tamasfe/taplo/releases/download/0.10.0/taplo-linux-x86_64.gz /tmp/taplo.gz
ADD --chmod=755 --checksum=sha256:be5098e8213219269c47fc0d916a66fa31ce0602ec967475c722260aabf26087 \
    https://github.com/artempyanykh/marksman/releases/download/2026-02-08/marksman-linux-x64 /opt/workbot-dev/bin/marksman
ADD --chmod=755 --checksum=sha256:129534601871538efe0ba4c5e62a34fb1d5f469bcb975c4fddeb467d82974973 \
    https://github.com/mikefarah/yq/releases/download/v4.54.3/yq_linux_amd64 /opt/workbot-dev/bin/yq
ADD --checksum=sha256:e3bafef96328d1a67de3a968bdfe1cc2ffd58cf6aba8b5e201356897ed06bb3d \
    https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_amd64.deb /packages/gh.deb
ADD --checksum=sha256:caf19cb4a842da7dbe4ecf146929f44e037fc733ab3f11945a1a48798497ed51 \
    https://gitlab.com/gitlab-org/cli/-/releases/v1.130.0/downloads/glab_1.130.0_linux_amd64.deb /packages/glab.deb
RUN mkdir -p /opt/workbot-dev/jdtls \
    && tar --extract --gzip --no-same-owner -f /tmp/jdtls.tar.gz -C /opt/workbot-dev/jdtls \
    && gzip -dc /tmp/taplo.gz > /opt/workbot-dev/bin/taplo \
    && chmod 755 /opt/workbot-dev/bin/taplo

FROM ${BASE_IMAGE} AS tools
USER root
ENV TZ=Asia/Shanghai
RUN --mount=type=bind,from=downloads,source=/packages,target=/tmp/packages \
    apt-get update \
    && apt-get purge -y git-lfs shfmt \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    /tmp/packages/gh.deb /tmp/packages/glab.deb \
    bash ca-certificates curl git jq ripgrep fd-find \
    gettext-base openssh-client perl rsync tzdata zip unzip xz-utils \
    file less procps lsof strace dnsutils netcat-openbsd \
    build-essential linux-libc-dev cmake pkg-config shellcheck clangd cppcheck \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && rm -f /etc/sudoers.d/vscode \
    && mkdir -p /workspace \
    && chown vscode:vscode /workspace
COPY --from=downloads /opt/workbot-dev /opt/workbot-dev
COPY --chmod=755 scripts/jdtls.sh /usr/local/bin/jdtls

# CMake LS 尚未迁移 pygls 2 API，保留兼容版本
RUN python3 -m venv /opt/workbot-dev/python-tools \
    && /opt/workbot-dev/python-tools/bin/pip install --no-cache-dir --only-binary=:all: \
    ruff==0.17.4 cmake-language-server==0.1.11 pygls==1.3.1
# Go 工具使用镜像工具链编译，统一更新内嵌标准库
RUN --mount=type=cache,target=/tmp/gopath --mount=type=cache,target=/tmp/go-build \
    export GOBIN=/usr/local/bin GOPATH=/tmp/gopath GOCACHE=/tmp/go-build GOTOOLCHAIN=local \
    && go install golang.org/x/tools/gopls@v0.24.0 \
    && go install -trimpath mvdan.cc/sh/v3/cmd/shfmt@v3.14.1 \
    && go install -trimpath github.com/git-lfs/git-lfs/v3@v3.8.1 \
    && install -Dm644 /tmp/gopath/pkg/mod/mvdan.cc/sh/v3@v3.14.1/LICENSE /usr/share/doc/shfmt/LICENSE \
    && install -Dm644 /tmp/gopath/pkg/mod/github.com/git-lfs/git-lfs/v3@v3.8.1/LICENSE.md /usr/share/doc/git-lfs/LICENSE.md \
    && git-lfs install --system --skip-repo

WORKDIR /opt/workbot-dev
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/tmp/bun-cache \
    BUN_INSTALL_CACHE_DIR=/tmp/bun-cache bun install --frozen-lockfile --production --ignore-scripts
ENV HOME=/home/vscode SHELL=/bin/bash
ENV PATH="/opt/workbot-dev/bin:/opt/workbot-dev/node_modules/.bin:/opt/workbot-dev/python-tools/bin:${PATH}"

FROM tools AS verification
WORKDIR /tmp/workbot-dev-check
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/tmp/bun-cache \
    BUN_INSTALL_CACHE_DIR=/tmp/bun-cache bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run check
USER vscode
WORKDIR /workspace
# Bun 启动前隔离 HOME，避免验收依赖已有用户状态
RUN --network=none home=$(mktemp -d) \
    && trap 'rm -rf "$home"' EXIT \
    && HOME="$home" timeout --kill-after=5s 600s bun /tmp/workbot-dev-check/scripts/verify.ts

FROM tools
COPY --from=verification /tmp/workbot-dev-verified.json /opt/workbot-dev/verified.json
COPY .devcontainer/devcontainer.json .devcontainer/devcontainer-lock.json /opt/workbot-dev/
RUN test ! -e node_modules/pi-lens/package.json \
    && test ! -e node_modules/@earendil-works/pi-coding-agent/package.json \
    && test ! -e node_modules/@devcontainers/cli/package.json
# 不向下游传播上游 Features 的编辑器配置
LABEL devcontainer.metadata='[{"remoteUser":"vscode"}]'
ENTRYPOINT []
CMD ["bash"]
USER vscode
WORKDIR /workspace
