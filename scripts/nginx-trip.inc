    # ---- 同路：/trip/  同步目录 /var/www/trip（规则源：trip/scripts/nginx-trip.inc）----
    location = /trip { return 301 /trip/; }
    location = /trip/ { add_header Cache-Control "no-cache"; try_files /trip/index.html =404; }
    location = /trip/index.html { add_header Cache-Control "no-cache"; }
    location = /trip/manifest.webmanifest { types { } default_type application/manifest+json; add_header Cache-Control "max-age=3600"; }
    location /trip/icons/ { add_header Cache-Control "max-age=86400"; }
    location /trip/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location /trip/ { try_files $uri =404; }
