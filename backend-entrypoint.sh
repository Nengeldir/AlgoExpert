#!/bin/sh
set -e

# Railway mounts the persistent volume at /data root-owned. We run as root here
# (before dropping privileges) so we can create the dir if needed and hand it to
# the node user, which is what actually runs the app and writes the SQLite file.
mkdir -p /data
chown -R node:node /data

# Drop from root to the unprivileged node user and exec the real command
# (passed as CMD: node dist/index.js). exec replaces the shell so signals
# (SIGTERM on redeploy) reach the app cleanly.
exec gosu node "$@"
