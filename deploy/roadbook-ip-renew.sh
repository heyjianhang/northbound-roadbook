#!/usr/bin/env bash
# 安装到 /usr/local/sbin/roadbook-ip-renew，归 root 所有。
set -euo pipefail
exec 9>/run/lock/roadbook-ip-renew.lock
flock -n 9 || exit 0

image=certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20
docker run --rm --name roadbook-certbot-renew \
  --mount type=bind,src=/etc/letsencrypt-roadbook-ip,dst=/etc/letsencrypt \
  --mount type=bind,src=/var/lib/letsencrypt-roadbook-ip,dst=/var/lib/letsencrypt \
  --mount type=bind,src=/var/log/letsencrypt-roadbook-ip,dst=/var/log/letsencrypt \
  --mount type=bind,src=/var/lib/letsencrypt,dst=/var/www/acme \
  "$image" renew --cert-name roadbook-ip --quiet --non-interactive \
  --no-random-sleep-on-renew \
  --deploy-hook 'touch /var/lib/letsencrypt/reload-required' "$@"

marker=/var/lib/letsencrypt-roadbook-ip/reload-required
if test -e "$marker"; then
  /usr/sbin/nginx -t
  /usr/bin/systemctl reload nginx
  rm -- "$marker"
fi
