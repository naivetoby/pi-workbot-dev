#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

image=${1:-pi-workbot-dev:check}
toolchain="pi-workbot-dev-toolchain:${CI_JOB_ID:-$$}"
base=$(node -p 'require("./.devcontainer/devcontainer.json").image')

# 临时标签隔离每次构建，BuildKit 缓存由 Docker 管理
trap 'docker image rm "$toolchain" >/dev/null 2>&1 || true' EXIT
docker pull "$base"
docker image inspect "$base" --format '{{json .RepoDigests}}'
devcontainer build --workspace-folder . --image-name "$toolchain" --frozen-lockfile \
    --skip-persisting-customizations-from-features
docker build --provenance=false --build-arg "BASE_IMAGE=$toolchain" -t "$image" .
