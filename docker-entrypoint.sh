#!/bin/sh
set -e

uid="${PUID:-1000}"
gid="${PGID:-1000}"

if [ "$(id -u)" = 0 ]; then
	for dir in "${DATA_DIR:-/data}" "$(dirname "${DATABASE_PATH:-/db/app.db}")"; do
		mkdir -p "$dir"
		if [ "$(stat -c %u:%g "$dir")" != "$uid:$gid" ]; then
			chown -R "$uid:$gid" "$dir" || echo "Could not give $dir to $uid:$gid; fix its permissions if writes fail" >&2
		fi
	done
	exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
fi

exec "$@"
