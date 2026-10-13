#!/bin/sh
echo "========================================"
echo "               PlayStash"
echo "  Original authors: Phalcode contributors"
echo "========================================"
set -e

echo "Starting container with PUID=${PUID} and PGID=${PGID}"
echo "Effective UID: $(id -u), GID: $(id -g)"

# If running as root, assign writable data to PUID/PGID and drop privileges.
if [ "$(id -u)" = "0" ]; then
    # Writable data belongs to the service user, not every user in the container.
    echo "Attempting to set ownership and permissions..."
    for dir in /app/dist /config /files /media /logs /db /plugins /savefiles; do
        if ! chown -R "${PUID}:${PGID}" "$dir" 2>/dev/null; then
            echo "Warning: chown failed on $dir (possibly due to missing permissions)"
        fi
        if ! chmod -R u=rwX,g=rX,o=rX "$dir" 2>/dev/null; then
            echo "Warning: chmod failed on $dir (possibly due to missing permissions)"
        fi
    done
    # Drop privileges and run the command.
    exec su-exec "${PUID}:${PGID}" node "$@"
else
    # Explicit non-root deployments manage their own mounted volume permissions.
    echo "Running as non-root user: $(id -u)"
    exec node "$@"
fi
