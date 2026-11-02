#!/usr/bin/env bash
# HTTPS for DriveStream on a Linux server (Debian/Ubuntu) with nginx + a free Let's Encrypt certificate.
#
#   sudo apt install nginx certbot
#   bash deploy/setup-https.sh stream.example.com            # HTTPS on 443, DriveStream on 127.0.0.1:8080
#   bash deploy/setup-https.sh stream.example.com 8443 8090  # HTTPS on 8443, DriveStream on 127.0.0.1:8090
#   EMAIL=you@example.com bash deploy/setup-https.sh …       # optional: Let's Encrypt expiry emails
#
# Before running: point the domain's DNS at this server, and start DriveStream with
# HOST=127.0.0.1 and PORT=<app port> in .env. Afterwards set PUBLIC_URL=https://<domain>[:port].
#
# What it does:
#   1. nginx site on port 80 that only answers Let's Encrypt checks and redirects to HTTPS
#   2. opens ports 80 and the HTTPS port in ufw (if ufw is installed)
#   3. gets the certificate (auto-renews; nginx reloads after each renewal)
#   4. HTTPS site that proxies to DriveStream, passing byte ranges through unbuffered
# Every nginx change is checked with `nginx -t` before reloading, so other sites stay up.
set -euo pipefail
DOMAIN=${1:?usage: setup-https.sh <domain> [https-port] [app-port]}
HTTPS_PORT=${2:-443}
APP_PORT=${3:-8080}
SUFFIX=$([ "$HTTPS_PORT" = 443 ] && echo "" || echo ":$HTTPS_PORT")

sudo install -d -m 0755 /var/www/letsencrypt
sudo tee /etc/nginx/sites-available/drivestream >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$DOMAIN$SUFFIX\$request_uri; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/drivestream /etc/nginx/sites-enabled/drivestream
sudo nginx -t
sudo systemctl reload nginx

if command -v ufw >/dev/null; then
  sudo ufw allow 80/tcp comment 'http: LE checks + redirects'
  sudo ufw allow "$HTTPS_PORT/tcp" comment 'drivestream'
fi

if [ -n "${EMAIL:-}" ]; then ACCOUNT=(--email "$EMAIL"); else ACCOUNT=(--register-unsafely-without-email); fi
sudo certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --agree-tos "${ACCOUNT[@]}" --non-interactive
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

sudo tee -a /etc/nginx/sites-available/drivestream >/dev/null <<EOF

server {
    listen $HTTPS_PORT ssl http2;
    listen [::]:$HTTPS_PORT ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # Video: pass byte ranges through and don't buffer long streams
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
sudo nginx -t
sudo systemctl reload nginx

echo
echo "Done: https://$DOMAIN$SUFFIX  (set PUBLIC_URL=https://$DOMAIN$SUFFIX in .env)"
curl -s -o /dev/null -w "HTTPS check (expect 401 = sign-in required): %{http_code}\n" "https://$DOMAIN$SUFFIX/api/library"
