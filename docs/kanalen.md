# Telegram en mail aanzetten op de VPS

Voor stap 1.1 (BOUWPLAN.md, hoofdstuk 9). Doe dit op de VPS, niet in een cloud-sessie: hier staan de productiesleutels.

## 1. Updaten

```bash
cd ~/hyperfocus && git pull && npm ci && npm run build
# Controleer dat alleen migratie 0000 is toegepast (verwacht: 1)
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
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | van @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | willekeurig, 32+ tekens |
| `TELEGRAM_ALLOWED_USER_IDS` | je eigen Telegram-gebruikers-ID (bijvoorbeeld via @userinfobot) |
| `SENDGRID_API_KEY`, `EMAIL_FROM` | `hallo@hyper-focus.pro` |
| `EMAIL_REPLY_TO` | `taken@in.hyper-focus.pro` |
| `EMAIL_INBOUND_SECRET` | willekeurig |
| `EMAIL_ALLOWED_SENDERS` | je eigen mailadres |
| `ACTION_LINK_SECRET` | willekeurig, 32+ tekens; ondertekent actielinks en Telegram-koppelcodes |

Herstart daarna: `pm2 restart hyperfocus-web`.

## 3. Telegram

```bash
npm run telegram:webhook   # registreert https://hyper-focus.pro/webhooks/telegram met de geheime token
npm run link:telegram      # print een koppellink, 30 minuten geldig
```

Open de koppellink op je telefoon en tik op *Start*. De bot antwoordt met "Gekoppeld".

## 4. SendGrid

1. Domeinauthenticatie voor `hyper-focus.pro` (SPF, DKIM, DMARC als DNS-records).
2. Inbound Parse: MX-record `in.hyper-focus.pro` → `mx.sendgrid.net`. Host `in.hyper-focus.pro`, URL `https://hyper-focus.pro/webhooks/mail/{EMAIL_INBOUND_SECRET}`, *spam check* aan, *POST the raw, full MIME message* uit.

## 5. Controleren (Definition of Done 1.1)

| Punt | Hoe |
|---|---|
| Antwoord binnen 3 seconden | stuur "hoi" aan de bot |
| Knop-tik haalt knoppen weg, één keer verwerkt | tik op *Laat zien*; de knoppen verdwijnen |
| Dubbele levering één keer verwerkt | `select external_id, count(*) from messages group by 1 having count(*) > 1` geeft niets |
| Onjuiste geheime token geeft 401 | `curl -i -X POST https://hyper-focus.pro/webhooks/telegram -d '{}'` |
| Onbekende gebruiker genegeerd en gelogd | laat iemand anders de bot een bericht sturen; `pm2 logs` toont een gemaskeerd ID |
| Mail-antwoord binnen 1 minuut | antwoord op een mail van Hyper&Focus met "vandaag" |
| Actielink werkt één keer | tik in die mail op een knop, daarna nog eens: "Deze link is al gebruikt." |
