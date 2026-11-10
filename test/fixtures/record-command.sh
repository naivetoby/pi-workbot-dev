#!/usr/bin/env bash
set -euo pipefail
command=${0##*/}
printf '%s' "$command" >> "$TEST_LOG"
printf ' <%s>' "$@" >> "$TEST_LOG"
printf '\n' >> "$TEST_LOG"

case "$command:$1" in
    devcontainer:build)
        if [ "${TEST_FAIL:-}" = features ]; then exit 31; fi
        ;;
    docker:pull) ;;
    docker:image)
        if [ "$2" = inspect ]; then printf '["base@sha256:fixture"]\n'; fi
        ;;
    docker:build)
        if [ "${TEST_FAIL:-}" = image ]; then exit 32; fi
        ;;
    *) echo "Unexpected command: $command $*" >&2; exit 64 ;;
esac
