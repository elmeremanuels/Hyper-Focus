# Telegram en mail aanzetten op de VPS

Voor stap 1.1 (BOUWPLAN.md, hoofdstuk 9). Doe dit op de VPS, niet in een cloud-sessie: hier staan de productiesleutels.

De app draait onder PM2 als `hyperfocus`, onder gebruiker `app`, in `/home/app/hyperfocus`. PM2 houdt per gebruiker een eigen proceslijst bij, dus voer alles uit als `app`:

```bash
sudo -iu app
cd ~/hyperfocus
```

## 1. Updaten

```bash
git pull && npm ci && npm run build
# Controleer dat alleen migratie 0000 is toegepast (verwacht: 1)
set -a; . ./.env; set +a
psql "$DATABASE_URL" -Atc 'select count(*) from drizzle.__drizzle_migrations'
npm run db:migrate
```

Migratie 0001 verwijdert `users.phone_e164` en `whatsapp_opt_in_at`, voegt de Telegram-velden toe en vervangt `messages.wa_message_id` door `external_id`. Pas `src/db/seed/eigen-data.local.ts` aan: `phoneE164` wordt `email` (verplicht).

## 2. `.env`

```bash
openssl rand -hex 24   # voor TELEGRAM_WEBHOOK_SECRET, EMAIL_INBOUND_SECRET en ACTION_LINK_SECRET (elk een eigen waarde)
```

| Variabele | Waarde |
|---|---|
| `APP_BASE_URL` | `https://hyper-focus.pro` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | van @BotFather (gebruikersnaam zonder `@`) |
| `TELEGRAM_WEBHOOK_SECRET` | willekeurig, 32+ tekens |
| `TELEGRAM_ALLOWED_USER_IDS` | je eigen Telegram-gebruikers-ID (bijvoorbeeld via @userinfobot) |
| `BREVO_API_KEY` | Brevo → SMTP & API → API-sleutels |
| `EMAIL_FROM` | `hallo@hyper-focus.pro` |
| `EMAIL_REPLY_TO` | `taken@in.hyper-focus.pro` |
| `EMAIL_INBOUND_SECRET` | willekeurig |
| `EMAIL_ALLOWED_SENDERS` | je eigen mailadres |
| `ACTION_LINK_SECRET` | willekeurig, 32+ tekens; ondertekent actielinks en Telegram-koppelcodes |

Herstart daarna: `pm2 restart hyperfocus`.

## 3. Telegram

```bash
npm run telegram:webhook   # registreert https://hyper-focus.pro/webhooks/telegram met de geheime token
npm run link:telegram      # print een koppellink, 30 minuten geldig
```

Open de koppellink op je telefoon en tik op *Start*. De bot antwoordt met "Gekoppeld".

## 4. Brevo

1. **Afzenderdomein:** Brevo → Afzenders, domeinen en speciale IP's → Domeinen → `hyper-focus.pro` toevoegen. Zet de records die Brevo geeft (Brevo-code, DKIM, DMARC) in Hostinger → Domeinen → DNS en laat Brevo ze verifiëren. Maak `hallo@hyper-focus.pro` aan als afzender.
2. **MX voor inkomende mail:** in Hostinger-DNS voor `in.hyper-focus.pro` twee MX-records: `inbound1.sendinblue.com` (prioriteit 10) en `inbound2.sendinblue.com` (prioriteit 20). Laat de MX-records van `hyper-focus.pro` zelf staan.
3. **Inbound-webhook:** `npm run brevo:inbound -- --domain in.hyper-focus.pro`. Die stuurt mail aan `*@in.hyper-focus.pro` door naar `https://hyper-focus.pro/webhooks/mail/{EMAIL_INBOUND_SECRET}`.

## 5. Controleren (Definition of Done 1.1)

| Punt | Hoe |
|---|---|
| Antwoord binnen 3 seconden | stuur "hoi" aan de bot |
| Knop-tik haalt knoppen weg, één keer verwerkt | tik op *Laat zien*; de knoppen verdwijnen |
| Dubbele levering één keer verwerkt | `select channel, external_id, count(*) from messages group by 1, 2 having count(*) > 1` geeft niets |
| Onjuiste geheime token geeft 401 | `curl -i -X POST https://hyper-focus.pro/webhooks/telegram -d '{}'` |
| Onbekende gebruiker genegeerd en gelogd | laat iemand anders de bot een bericht sturen; `pm2 logs hyperfocus` toont een gemaskeerd ID |
| Mail-antwoord binnen 1 minuut | antwoord op een mail van Hyper&Focus met "vandaag" |
| Actielink werkt één keer | tik in die mail op een knop, daarna nog eens: "Deze link is al gebruikt." |

Komt een mail-antwoord niet door, kijk dan in `pm2 logs hyperfocus`. Staat er "SPF not pass" of "DKIM not pass", dan zet Brevo de headers `Authentication-Results` of `Received-SPF` niet zoals verwacht. Meld dat; de controle staat in `src/channels/email/inbound.ts` (`authResults`).
