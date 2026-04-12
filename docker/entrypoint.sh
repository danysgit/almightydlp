#!/usr/bin/env bash
set -euo pipefail

APP_USER=app
APP_GROUP=app
APP_UID="${PUID:-99}"
APP_GID="${PGID:-100}"
APP_UMASK="${UMASK:-002}"

mkdir -p /app/data /app/downloads /tmp/allmightydlp

if getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupmod -o -g "${APP_GID}" "${APP_GROUP}"
else
  groupadd -o -g "${APP_GID}" "${APP_GROUP}"
fi

if id -u "${APP_USER}" >/dev/null 2>&1; then
  usermod -o -u "${APP_UID}" -g "${APP_GID}" "${APP_USER}"
else
  useradd -o -u "${APP_UID}" -g "${APP_GID}" -d /app -s /usr/sbin/nologin "${APP_USER}"
fi

chown -R "${APP_UID}:${APP_GID}" /app /tmp/allmightydlp
umask "${APP_UMASK}"

exec gosu "${APP_UID}:${APP_GID}" "$@"
