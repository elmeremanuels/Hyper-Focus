# Deploy op de VPS

Voor stap 1.1 (BOUWPLAN.md, hoofdstuk 5, 9.1 en 14). Hostinger VPS met template *Claude Code* (Ubuntu 24.04).

## 1. Server beveiligen

1. Maak een eigen gebruiker met sudo en log daarna alleen nog met een SSH-sleutel in.
2. Zet in `/etc/ssh/sshd_config` `PasswordAuthentication no` en `PermitRootLogin no`, en herstart ssh.
3. Firewall: `ufw allow 22,80,443/tcp && ufw enable`.
4. Maak een snapshot in het Hostinger-paneel.

## 2. Software

```bash
# Node 20+ (Ubuntu 24.04 levert een oudere versie)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql-16 nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

PostgreSQL luistert standaard alleen op localhost. Laat dat zo.

```bash
sudo -u postgres createuser -P hyperfocus
sudo -u postgres createdb -O hyperfocus hyperfocus
```

## 3. App

```bash
git clone https://github.com/elmeremanuels/Hyper-Focus.git hyperfocus && cd hyperfocus
npm ci
cp .env.example .env   # vul in; zie hoofdstuk 17
npm run build
npm run db:migrate
npm run db:seed        # met je eigen src/db/seed/eigen-data.local.ts
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Zet `NODE_ENV=production`, `PORT=3000` en `WHATSAPP_ALLOWED_NUMBERS=<jouw nummer>` in `.env`. Controleer de actuele Graph API-versie bij Meta voor `WHATSAPP_GRAPH_VERSION`.

## 4. Nginx en HTTPS

`/etc/nginx/sites-available/hyperfocus`:

```nginx
server {
    server_name hyperfocus.example.nl;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hyperfocus /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hyperfocus.example.nl
```

## 5. Meta

1. In de app bij Meta for Developers: WhatsApp → Configuratie → Webhook.
2. Callback-URL: `https://hyperfocus.example.nl/webhooks/whatsapp`. Verify-token: de waarde van `WHATSAPP_VERIFY_TOKEN`.
3. Abonneer op het veld `messages`.
4. `WHATSAPP_APP_SECRET` is het app-geheim onder App-instellingen → Basis. Zonder dit geheim weigert de webhook elk bericht met 401.

## 6. Controleren (Definition of Done 1.1)

- Stuur vanaf je eigen nummer "hoi" naar het botnummer. Het antwoord komt binnen 3 seconden.
- `pm2 logs hyperfocus-web` toont een bericht van een ander nummer als "Ignored WhatsApp message from unknown number +316*****…".
- `curl -i -X POST https://hyperfocus.example.nl/webhooks/whatsapp -d '{}'` geeft `401`.
- Dubbele levering: in `messages` staat elk `wa_message_id` één keer.
