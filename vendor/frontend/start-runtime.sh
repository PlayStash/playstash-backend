#!/bin/sh
set -eu
set -f
umask 077

mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
: > /tmp/nginx/trusted-geo.conf
: > /tmp/nginx/trusted-realip.conf

# An explicitly configured proxy may supply the public scheme and client IP.
# Validate characters before writing nginx directives; nginx validates each CIDR.
count=0
for cidr in ${PLAYSTASH_TRUSTED_PROXY_CIDRS:-}; do
    case "$cidr" in
        *[!0-9a-fA-F:./]*|'') echo "Invalid trusted proxy CIDR" >&2; exit 1 ;;
        *.*|*:*) ;;
        *) echo "Trusted proxies must use IP addresses or CIDRs" >&2; exit 1 ;;
    esac
    count=$((count + 1))
    if [ "$count" -gt 128 ] || [ "${#cidr}" -gt 64 ]; then
        echo "Too many or overlong trusted proxy CIDRs" >&2
        exit 1
    fi
    printf '%s 1;\n' "$cidr" >> /tmp/nginx/trusted-geo.conf
    printf 'set_real_ip_from %s;\n' "$cidr" >> /tmp/nginx/trusted-realip.conf
done

nginx -t
exec nginx -g 'daemon off;'

