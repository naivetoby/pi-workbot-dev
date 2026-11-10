#!/bin/sh
set -eu
# JDT LS 独立使用 JDK 25，不受业务 JAVA_HOME 影响
java_home=
for candidate in "${SDKMAN_DIR:?}/candidates/java"/25.*-tem; do
    if [ ! -x "$candidate/bin/java" ] || [ -n "$java_home" ]; then
        echo 'Expected exactly one SDKMAN Temurin 25 installation for JDT LS' >&2
        exit 1
    fi
    java_home=$candidate
done
exec python3 /opt/workbot-dev/jdtls/bin/jdtls --java-executable "$java_home/bin/java" --jvm-arg=-Xms128m --jvm-arg=-Xmx1g "$@"
