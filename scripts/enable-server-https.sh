#!/usr/bin/env bash
# 供目标服务器 ubuntu 运维用户执行；配置规范见 /home/ubuntu/NGINX.md。
set -euo pipefail

site=roadbook.heyjianhang.top
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
template="$project_dir/deploy/nginx/roadbook.conf.template"
source_file="/home/ubuntu/nginx/sites-available/$site.conf"
published="/etc/nginx/conf.d/$site.conf"

test -f /home/ubuntu/NGINX.md
test -f "$template"
sudo -n true
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4173/api/accounts/session >/dev/null

# 失败会立即退出，保留正在使用的 HTTP 挑战入口，不发布缺少证书的配置。
sudo certbot certonly --webroot -w /var/lib/letsencrypt \
  --cert-name "$site" -d "$site" --non-interactive --agree-tos
sudo certbot certificates --cert-name "$site"

# 从 Certbot 实际续期配置读取路径，不假定 live 目录名称。
certificate_paths=$(sudo python3 - "$site" <<'PY'
import pathlib, sys
site = sys.argv[1]
values = {}
for line in pathlib.Path(f'/etc/letsencrypt/renewal/{site}.conf').read_text().splitlines():
    key, sep, value = line.partition('=')
    if sep:
        values[key.strip()] = value.strip()
for key in ('fullchain', 'privkey'):
    value = values[key]
    if not value.startswith('/etc/letsencrypt/') or any(c.isspace() for c in value):
        raise SystemExit('证书路径无效')
    if not pathlib.Path(value).is_file():
        raise SystemExit('证书文件不存在')
    print(value)
PY
)
fullchain=$(printf '%s\n' "$certificate_paths" | sed -n '1p')
privkey=$(printf '%s\n' "$certificate_paths" | sed -n '2p')
sudo openssl x509 -in "$fullchain" -noout -checkhost "$site"

backup=$(mktemp -d "/home/ubuntu/nginx/backups/$(date +%Y%m%d-%H%M%S)-roadbook-https-XXXXXX")
chmod 700 "$backup"
if test -f "$source_file"; then cp "$source_file" "$backup/source.conf"; fi
if sudo test -f "$published"; then sudo cp "$published" "$backup/published.conf"; fi

restore() {
  if test -f "$backup/source.conf"; then
    cp "$backup/source.conf" "$source_file"
  else
    mv "$source_file" "$backup/rejected-source.conf"
  fi
  if sudo test -f "$backup/published.conf"; then
    sudo install -o root -g root -m 0644 "$backup/published.conf" "$published"
  else
    sudo mv "$published" "$backup/rejected-published.conf"
  fi
  sudo nginx -t && sudo systemctl reload nginx
}

python3 - "$template" "$source_file" "$fullchain" "$privkey" <<'PY'
import pathlib, sys
template, target, fullchain, privkey = sys.argv[1:]
content = pathlib.Path(template).read_text().replace('__FULLCHAIN__', fullchain).replace('__PRIVKEY__', privkey)
pathlib.Path(target).write_text(content)
PY
if ! sudo install -o root -g root -m 0644 "$source_file" "$published"; then
  restore
  exit 1
fi
if ! sudo nginx -t || ! sudo systemctl reload nginx; then
  restore
  exit 1
fi
curl --fail --silent --show-error --retry 3 --retry-delay 1 \
  --resolve "$site:443:127.0.0.1" "https://$site/api/accounts/session"
printf '\nHTTPS 配置已发布。备份：%s\n' "$backup"
printf '还需从外部网络验收，执行目标证书续期演练，并更新 /home/ubuntu/NGINX.md 台账。\n'
