# Back-ups en bewaking (verbeterplan P0.2)

Voor Cowork, als gebruiker `app` in `~/hyperfocus`. Doe dit na de deploy van de PR met P0.2.

## 1. Vooraf: akkoord en opslag

De opslag buiten de VPS kost geld. Vraag Elmer eerst om akkoord; Elmer maakt het account aan.

- Een bucket in de EU, bijvoorbeeld Hetzner Object Storage (Falkenstein of Nuremberg) of Scaleway (Amsterdam of Parijs).
- Een toegangssleutel die alleen deze bucket mag lezen en schrijven.

## 2. Gereedschap op de VPS

```
sudo apt install -y rclone postgresql-client
rclone version
pg_dump --version   # moet 16 zijn, net als de database
```

`rclone config` en dan een remote `hfbackup` aanmaken:

- type `s3`, provider `Other` (Hetzner) of `Scaleway`;
- endpoint, access key en secret van Elmer (Elmer vult ze zelf in, of geeft ze via het wachtwoordbeheer);
- region volgens de provider.

Controle: `rclone lsd hfbackup:` toont de bucket.

## 3. Regels in `.env`

| Naam | Waarde |
| --- | --- |
| `BACKUP_REMOTE` | `hfbackup:<bucketnaam>/hyperfocus` |
| `BACKUP_PASSPHRASE` | Lange willekeurige zin: `openssl rand -base64 48`. Bewaar hem ook buiten de VPS, in Elmers wachtwoordbeheer. Zonder deze zin is geen enkele back-up te openen. |
| `RESTORE_ADMIN_URL` | Een databaseverbinding met een rol die databases mag maken, voor de hersteltest. Bijvoorbeeld de rol `hyperfocus` na `sudo -u postgres psql -c "ALTER ROLE hyperfocus CREATEDB"`, met database `postgres` in de URL. |
| `ALERT_TELEGRAM_CHAT_ID` | Elmers eigen chat-ID met de bot (een getal). Elmer stuurt de bot een bericht; het ID staat dan in `pm2 logs hyperfocus`, of in de tabel `users`, kolom `telegram_chat_id`. |
| `ALERT_EMAIL` | Het adres voor meldingen. |
| `WORKER_HEARTBEAT_FILE` | `/home/app/hyperfocus/worker.heartbeat` (absoluut pad, voor web en worker hetzelfde). |

Daarna `pm2 restart hyperfocus hyperfocus-worker --update-env`.

Proef: `npm run ops:alert -- test "Proefmelding"` geeft een bericht in Telegram en een mail.

## 4. Cron

`crontab -e` als gebruiker `app`:

```
CRON_TZ=Asia/Makassar
0 3 * * * /home/app/hyperfocus/scripts/ops/backup.sh >> /home/app/backups/backup.log 2>&1
30 4 1 * * /home/app/hyperfocus/scripts/ops/restore-test.sh >> /home/app/backups/restore-test.log 2>&1
```

Draait cron zonder `npm` in het pad (nvm)? Zet dan bovenaan ook `PATH=/home/app/.nvm/versions/node/<versie>/bin:/usr/local/bin:/usr/bin:/bin`.

Eerste keer met de hand, om te controleren:

```
mkdir -p ~/backups
~/hyperfocus/scripts/ops/backup.sh
rclone ls "$(grep ^BACKUP_REMOTE= ~/hyperfocus/.env | cut -d= -f2)/daily"
~/hyperfocus/scripts/ops/restore-test.sh
```

Verwacht: `backup ok: hyperfocus-<datum>.dump.enc` en `restore ok: ... (<n> users, <n> tasks)`.

Wat de scripts doen:

- `backup.sh`: `pg_dump` (gecomprimeerd formaat), versleuteld met AES-256 en `BACKUP_PASSPHRASE`, naar `daily/`. Op zondag ook naar `weekly/`. Ruimt op: dagelijks na 14 dagen, wekelijks na 8 weken. Lokaal blijven de laatste twee.
- `restore-test.sh`: haalt de nieuwste dagelijkse back-up op, ontsleutelt hem, zet hem terug in de tijdelijke database `hyperfocus_restore_test`, telt gebruikers en taken, en ruimt de database weer op.
- Gaat er iets mis, dan krijgt Elmer een melding via Telegram en mail.

Met de hand terugzetten:

```
rclone copyto hfbackup:<bucket>/hyperfocus/daily/<bestand> /tmp/b.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in /tmp/b.enc -out /tmp/b.dump
pg_restore --no-owner --no-privileges --clean -d "$DATABASE_URL" /tmp/b.dump
```

Alleen na overleg met Elmer, en met een snapshot in hPanel vooraf.

## 5. Externe check (UptimeRobot)

Gratis account op uptimerobot.com, op Elmers adres. Twee HTTP(s)-monitors, elke 5 minuten:

- `https://hyper-focus.pro/health`
- `https://<dashboarddomein>/health`

Meldingen: mail, en Telegram via de UptimeRobot-integratie. `/health` geeft 503 met `worker_down` als de worker langer dan 5 minuten geen hartslag gaf. UptimeRobot meldt dat als storing.

## 6. Wat de app zelf meldt

Via `ALERT_TELEGRAM_CHAT_ID` en `ALERT_EMAIL`; dezelfde melding hooguit één keer per 6 uur.

| Wat | Wanneer |
| --- | --- |
| Meer dan 5 fouten in een uur | per proces (`hyperfocus-web`, `hyperfocus-worker`) |
| Telegram-webhook | elk uur: geen URL, meer dan 10 berichten in de wacht, of een fout in het laatste uur |
| Tegoed of sleutel Anthropic en OpenAI | elke nacht om 09:00 WITA (01:00 UTC), en direct als een gesprek op tegoed stukloopt |
| Back-up of hersteltest mislukt | vanuit de scripts |

## 7. Klaar als

- [ ] Er staat elke ochtend een nieuwe back-up in `daily/`.
- [ ] De hersteltest is één keer geslaagd.
- [ ] `pm2 stop hyperfocus-worker` geeft binnen 10 minuten een melding van UptimeRobot. Daarna `pm2 start hyperfocus-worker`.
- [ ] Met een ongeldige `ANTHROPIC_API_KEY` (tijdelijk, daarna terugzetten en `--update-env`) antwoordt de bot met de wachttekst. Na herstel komt binnen 10 minuten alsnog het antwoord.
