# Voortgang

Geheugen tussen sessies. Werk dit bij aan het eind van elke bouwstap.

## Stap 0.1 — Beveiliging bronrepo

- **Status:** door Elmer, buiten de repo
- **Open:** bevestigen dat `Publicato-personal` privé is en alle gevonden sleutels vernieuwd zijn.

## Stap 0.2 — Nieuwe repo

- **Status:** klaar
- **Datum:** 2026-09-30
- **Gebouwd:**
  - `package.json` (ESM, Node 20+), TypeScript strict (`tsconfig.json`, `tsconfig.build.json`)
  - ESLint (flat config met `typescript-eslint` strict), Vitest
  - `src/config/env.ts`: alle variabelen uit hoofdstuk 17, gevalideerd met zod. Lege waarden tellen als niet ingesteld. Geen standaardwaarden voor modelnamen.
  - `src/app.ts` en `src/server.ts`: Express 4 met `GET /health`
  - `.env.example` met alleen namen, `.gitignore` met `.env`, `*.local.ts`, cookiebestanden en archieven
  - `BOUWPLAN.md` en `CLAUDE.md` in de repo
- **Controle Definition of Done:**
  - `npm run dev` start de server; `curl localhost:3999/health` geeft `{"status":"ok"}`
  - `npm test`: 2 testbestanden, 9 tests groen (env-validatie en health-endpoint)
  - Ook groen: `npm run typecheck`, `npm run lint`, `npm run build`
- **Open punten:**
  - `DATABASE_URL`, API-sleutels en modelnamen zijn nu optioneel. De stap die ze gebruikt maakt ze verplicht (0.4 voor de database, 0.3/1.2 voor Claude).
  - `PORT` (standaard 3000) is toegevoegd; die staat niet in hoofdstuk 17.
  - De repo heeft nog geen `main`-branch, dus een pull request naar `main` kan pas als die bestaat.

## Stap 0.3 — Oogsten

- **Status:** klaar
- **Datum:** 2026-09-30
- **Bron:** `elmeremanuels/Publicato-personal`, commit `b371ab3`, alleen gelezen.
- **Geoogst (fase 0 en 1):**

| Bron | Doel | Aanpassing |
|---|---|---|
| `server/services/whatsappService.ts` | `src/channels/whatsapp/client.ts` | config geïnjecteerd, Graph-versie via env, templatetaal `nl` |
| `server/routes/engagementRoutes.ts` (verify-token) | `src/channels/whatsapp/webhook.ts` | `GET /webhooks/whatsapp`, 403 zonder geldige token |
| `server/services/anthropic.ts` | `src/ai/claude.ts` | SDK 0.129, instructieblok en hardcoded modellen weg, modellen via env, tool-use-helper, gebruik per aanroep gemeld |
| `server/services/openai.ts` | `src/ai/transcribe.ts` | alleen transcriptie; instructieblok en hardcoded model weg; model via `TRANSCRIBE_MODEL` |
| `server/utils/ai-json.ts`, `jsonrepair.ts` | `src/ai/json.ts` | samengevoegd, alleen typefixes voor strict mode |
| `server/cron/aiAutopilotRunner.ts`, `runJobWithMetrics` | `src/proactive/scheduler.ts` | tijdzone per gebruiker met Luxon, storage als interface, tick van één minuut |
| `server/utils/telemetry.ts` | `src/lib/telemetry.ts` | alleen jobtelemetrie, plus een event-sink voor de tabel `events` |
| `server/services/sendgridService.ts` | `src/channels/email/sendgrid.ts` | alleen versturen; tenants en templates weg |
| `server/services/googleOAuthService.ts` | `src/integrations/calendar/oauth.ts` | alleen scope `calendar.readonly` |
| `server/utils/tokenEncryption.ts` | `src/lib/crypto.ts` | sleutel alleen uit `ENCRYPTION_KEY`; de hardcoded reservesleutel is weg |

- **Controle Definition of Done:**
  - `npm run typecheck` en `npm run build` slagen: elk geoogst bestand compileert.
  - Imports in `src/` komen alleen uit npm-pakketten en eigen bestanden. Een grep op Publicato-onderdelen (storage, tenants, branding, credits, publishers) en op hardcoded modelnamen vindt niets.
  - `npm test`: 9 testbestanden, 38 tests groen, waaronder tijdzones (`Asia/Makassar`, `Europe/Amsterdam`, zomertijdwissel op 25 oktober 2026).
  - `npm run dev` start; de verify-challenge op `/webhooks/whatsapp` komt terug.
- **Bewust niet in deze stap:**
  - Hoort bij stap 1.1: interactieve knoppen, lijsten, media ophalen, handtekeningcontrole, idempotentie en de POST-webhook.
  - Hoort bij stap 0.4: de schema's uit Publicato. Hoofdstuk 8 beschrijft het datamodel volledig.
  - Fase 2 en 3: bandit, nieuws, website-scan, Perplexity, auth, Mollie en tenantkosten.
  - Weekoverzicht-template (stap 1.7).
- **Open punten:**
  - `main` bestaat nog niet. Maak `main` aan op GitHub, dan kan de pull request open.
  - De geoogste bestanden bevatten twee instructieblokken voor AI-assistenten (`anthropic.ts` en `openai.ts`). Die zijn niet overgenomen.
  - `tokenEncryption.ts` in Publicato valt terug op een hardcoded geheim als de sleutel ontbreekt. Controleer of dat daar ergens in productie gebeurt.

## Stap 0.4 — Database

- **Status:** klaar
- **Datum:** 2026-09-30
- **Gebouwd:**
  - `src/db/client.ts`: Drizzle met `drizzle-orm/node-postgres` en `pg`.
  - `src/db/schema/`: alle 18 tabellen en de enums uit hoofdstuk 8. Elke tabel behalve `users` heeft `user_id` met `ON DELETE CASCADE`. Tijden in `timestamptz`.
  - Afdwinging in de database: maximaal één focusbedrijf per gebruiker, maximaal drie focustaken per dag, schattingen alleen 5/15/30/60/120, prioriteit 1–3, escalatieniveau 0–3, `wa_message_id` uniek.
  - `src/db/labels.ts`: Nederlandse labels bij de statussen en lenzen.
  - Migratie `drizzle/0000_init.sql`, gegenereerd met `npm run db:generate`; `npm run db:migrate` voert hem uit.
  - Seed: `example.ts` met een fictief bedrijf en drie klanten. `eigen-data.local.ts` wordt geladen als die bestaat (staat in `.gitignore`). Elke gebruiker krijgt het project *Losse taken*, instellingen met de standaardwaarden en een `conversation_state`. Een tweede run slaat bestaande gebruikers over.
- **Controle Definition of Done:**
  - Lege PostgreSQL 16-database: `npm run db:migrate` geeft "Migrations applied"; `npm run db:seed` maakt de gebruiker aan (1 gebruiker, 3 klanten, 4 projecten, 8 taken, 1 idee).
  - Tweede `npm run db:seed`: "already exists, skipped".
  - Met een tijdelijk `eigen-data.local.ts` laadt de seed ook die gebruiker; `git check-ignore` bevestigt dat het bestand genegeerd wordt.
  - `tests/db.integration.test.ts` maakt een lege database, migreert, seedt en test de constraints, de idempotentie van `wa_message_id` en UTC-opslag. Met `TEST_DATABASE_URL`: 46 tests groen. Zonder: 38 groen, 8 overgeslagen.
- **Keuzes binnen het bouwplan:**
  - `weekly_review_day` is een ISO-weekdag (1 = maandag, 7 = zondag; standaard 7).
  - `enabled_lenses` staat standaard op de vier lenzen van fase 2.
  - `calendar_ids` staat standaard op `primary` (de hoofdagenda).
  - `scheduled_nudges.sent_message_id` heeft geen foreign key, omdat berichten na 30 dagen verdwijnen.
  - Voor de overige statuskolommen (gebruiker, klant, project, idee, bericht) zijn ook Postgres-enums gemaakt, met de waarden uit hoofdstuk 8.
- **Open punten:**
  - `pg_trgm` volgt bij de stap die hem gebruikt (zie `docs/later.md`).

## Stap 0.5 — Simulator

- **Status:** klaar
- **Datum:** 2026-09-30
- **Gebouwd:**
  - `src/conversation/types.ts`: kanaalonafhankelijke berichten (tekst, knop) en de interface `OutboundChannel`.
  - `src/conversation/router.ts`: eenvoudige router. Herkent begroeting, "vandaag" en "help", toont maximaal drie open taken met Start-knoppen, en handelt de knoppen `f:show`, `help` en `t:{id}:start` af. Onbekende nummers krijgen één kort antwoord.
  - `src/conversation/deps.ts`: gegevens uit de database, of uit het geheugen als er geen database is.
  - `src/channels/console/channel.ts`: toont uitgaande berichten in de terminal, met genummerde knoppen.
  - `scripts/sim.ts` en `npm run sim` (optie `--phone`). Werkt interactief en met invoer via een pipe.
- **Controle Definition of Done:**
  - `printf 'goedemorgen\n1\n1\nklant belde\n' | npm run sim` geeft op elk bericht een antwoord, met de taken uit de seed. Zonder `DATABASE_URL` werkt hij met voorbeeldtaken in het geheugen.
  - `npm test`: 47 groen (9 databasetests overgeslagen). Met `TEST_DATABASE_URL`: 56 groen. De routertest controleert ook maximaal 300 tekens, 3 knoppen, 20 tekens per knop en de woorden die Hyper&Focus weglaat.
- **Open punten:**
  - De router slaat berichten nog niet op en legt nog geen taken vast. Dat komt in 1.1 (berichten) en 1.2 (Claude met tools).
  - De Start-knop plant nog geen check-in; die komt in 1.4.

## Stap 0.1 — Beveiliging bronrepo (update)

- 2026-09-30: een scan van de huidige bestanden vond een Meta-token in `attached_assets/`, 9 cookiebestanden, 4 `.tar.gz`-archieven, database-URL's met wachtwoord en Mollie-achtige sleutels.
- 2026-09-30: `Publicato-personal` staat weer op privé (bevestigd).
- **Open:** sleutels intrekken en vernieuwen, cookiebestanden en `attached_assets` verwijderen (door Elmer).

## Fase 0

Afgerond, op het intrekken van de gelekte sleutels na (0.1). `main` bestaat sinds 2026-09-30 en bevat 0.2 t/m 0.4.


## Bouwplan v1.3 — Telegram en mail in plaats van WhatsApp

- **Datum:** 2026-10-01
- **Besluit (Elmer):** WhatsApp vervalt. Alle WhatsApp-accounts in de Meta-portfolio De GroeiFormule zijn door Meta uitgeschakeld en een nieuwe portfolio aanmaken lukt niet (limiet bereikt). Telegram wordt het dagelijkse kanaal, mail het tweede kanaal voor overzichten, concepten en invoer. Zie BOUWPLAN.md hoofdstuk 9 en beslissing 10.
- **Gevolgen:**
  - Branch `stap-1.1` (WhatsApp) vervalt. Stap 1.1 wordt opnieuw gebouwd als "Telegram en mail in en uit"; kanaalonafhankelijke delen uit die branch mogen worden overgenomen.
  - Datamodel (hoofdstuk 8): `users` krijgt Telegram-velden en `preferred_channel`, `phone_e164` en `whatsapp_opt_in_at` vervallen; `messages` krijgt `external_id` (uniek met `channel`) in plaats van `wa_message_id`; `wa_usage` vervalt. Nog te migreren in stap 1.1.
  - De huidige code op `main` bevat nog de WhatsApp-verify-webhook uit stap 0.3 en de `WHATSAPP_*`-variabelen in `env.ts`. Opruimen in stap 1.1.
- **Infrastructuur (klaar):** Hostinger VPS KVM 2 (Duitsland), `hyper-focus.pro` met HTTPS, app draait onder PM2, `/health` geeft ok, nachtelijke `pg_dump`, snapshot gemaakt. Installatie via `setup-vps.sh`.
- **Open:** Telegram-bot aanmaken bij @BotFather; SendGrid-domeinauthenticatie en Inbound Parse (MX `in.hyper-focus.pro`); SSH-sleutel op de VPS en daarna SSH-hardening; repo privé maken.

## Stap 1.1 — Telegram en mail in en uit

- **Status:** code klaar; live-controle op de VPS volgt (door Elmer, zie `docs/kanalen.md`)
- **Datum:** 2026-10-01
- **Branch:** `stap-1.1-telegram` (vanaf de branch van PR #1). PR #2 (WhatsApp) is gesloten.
- **Datamodel:** migratie `0001_telegram_mail.sql` volgens hoofdstuk 8 van v1.3:
  - `users`: Telegram-velden, `email_verified_at` en `preferred_channel` erbij; `phone_e164` en `whatsapp_opt_in_at` eruit; `email` uniek.
  - `messages`: `external_id` (uniek met `channel`), `subject` en `delivery_status`; `wa_message_id` eruit.
  - `wa_usage` vervalt; event `email_sent` erbij.
  - Getest als upgrade: `main` met seed-data → migratie 0001 → gebruikers en taken blijven staan.
- **Gebouwd:**
  - `channels/channel.ts`: gedeelde interface `send(user, message)`, plus `createDelivery`. Kan Telegram de gebruiker niet bereiken (bot geblokkeerd, niet gekoppeld), dan gaat hetzelfde bericht per mail.
  - Telegram (`channels/telegram/`):
    - client via `fetch`;
    - inline-knoppen: 3 per rij, maximaal 3 rijen, keuzelijst tot 8 regels, `callback_data` ≤ 64 bytes;
    - webhook met `X-Telegram-Bot-Api-Secret-Token` (401 bij fout), direct 200, verwerking op de achtergrond.
  - Verwerking van Telegram-updates:
    - alleen `TELEGRAM_ALLOWED_USER_IDS`; anderen krijgen "Deze bot is nog besloten." en worden gemaskeerd gelogd;
    - idempotent op `update_id`; een knop-tik telt één keer per bericht, ook bij een tweede tik;
    - `answerCallbackQuery` en het weghalen van de knoppen;
    - commando's `/vandaag`, `/pauze`, `/parkeerplaats`, `/help`.
  - Koppelen: `/start {code}` met een eenmalige code (HMAC, 30 minuten geldig, ongeldig na de eerste koppeling). `npm run link:telegram` print de deeplink.
  - Mail (`channels/email/`):
    - versturen met `Reply-To` en threading-headers;
    - HTML plus tekst, knoppen als actielinks;
    - Inbound Parse-webhook (404 bij een verkeerd pad, bijlagen genegeerd);
    - afzendercontrole: bekende gebruiker, `EMAIL_ALLOWED_SENDERS`, SPF pass en DKIM pass voor het afzenderdomein;
    - idempotent op `Message-ID`;
    - `parse-reply.ts` voor Gmail, Outlook en Apple Mail, in het Nederlands en Engels;
    - een doorgestuurde mail gaat met afzender, onderwerp en de eerste 2.000 tekens naar de router.
  - Actielinks (`channels/actions/`): ondertekend, 7 dagen geldig, één keer bruikbaar. De nonce staat in `messages` (kanaal `web`, type `action_link`), dus er is geen extra tabel nodig.
  - `npm run telegram:webhook` registreert de webhook.
  - De WhatsApp-code uit stap 0.3 is verwijderd.
- **Afwijking van 9.3, ter beoordeling:** `GET /a/{token}` toont een bevestigingspagina die zichzelf meteen verstuurt; pas de `POST` voert de actie uit. Voor jou blijft het één tik. Mailscanners (bijvoorbeeld Outlook Safe Links) openen links vooraf; met een directe `GET` zouden zij de eenmalige link al opgebruiken.
- **Controle Definition of Done** (lokaal, met nep-Telegram en nep-SendGrid via HTTP en een echte database; `tests/channels.integration.test.ts`):
  - *Telegram-antwoord binnen 3 seconden:* de webhook antwoordt binnen 1 seconde en het antwoord gaat meteen uit. Live te controleren op de VPS.
  - *Knop-tik haalt knoppen weg en wordt één keer verwerkt:* `editMessageReplyMarkup` volgt, en een tweede tik op hetzelfde bericht geeft `duplicate`.
  - *Dubbele levering één keer verwerkt:* zelfde `update_id` en zelfde `Message-ID` geven `duplicate`, zonder tweede antwoord.
  - *Onjuiste geheime token geeft 401:* test, en curl op de draaiende server.
  - *Onbekende gebruiker genegeerd en gelogd:* niets opgeslagen, gemaskeerd ID in de log.
  - *Antwoord op een mail levert een mail op:* het antwoord gaat per mail terug in dezelfde thread. "Binnen 1 minuut" is live te controleren.
  - *Actielink werkt één keer:* eerste `POST` 200 met het antwoord, tweede `POST` 410 "Deze link is al gebruikt."
  - `npm test`: 105 groen en 17 overgeslagen zonder database; 122 groen met `TEST_DATABASE_URL`. Ook groen: typecheck, lint, build en de simulator.
- **Open punten:**
  - Op de VPS: `.env` aanvullen, migreren, `npm run telegram:webhook`, koppelen, SendGrid inrichten (`docs/kanalen.md`). Daarna de live-controle.
  - `eigen-data.local.ts` op de VPS: `phoneE164` wordt `email`.
  - Transcriptie van spraak volgt in 1.6. Een spraakbericht krijgt nu een kort antwoord.
  - Zie `docs/later.md`: de knop *Meer* bij lange lijsten en de wekelijkse herkoppelvraag.


## Stap 1.1 — aanvulling: Brevo in plaats van SendGrid

- **Datum:** 2026-10-02
- **Besluit (Elmer):** SendGrid wordt Brevo, voor versturen en inkomende mail. Bouwplan v1.4, beslissing 11.
- **Gebouwd:**
  - `email/send.ts`: Brevo-API (`POST /v3/smtp/email`) via `fetch`, met `Reply-To` en threading-headers. `@sendgrid/mail` en `busboy` zijn verwijderd.
  - `email/inbound.ts`: Brevo Inbound Parsing (JSON met `items`).
  - SPF en DKIM komen uit de headers `Authentication-Results` en `Received-SPF`; Brevo levert daar geen aparte velden voor. Zonder die headers wordt de mail genegeerd.
  - `npm run brevo:inbound -- --domain …` maakt de inbound-webhook aan.
  - Env: `SENDGRID_API_KEY` wordt `BREVO_API_KEY`.
- **Controle:** `npm test`: 111 groen en 17 overgeslagen zonder database; 128 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Open:**
  - Live controleren dat Brevo de headers `Authentication-Results` of `Received-SPF` doorgeeft. Zo niet, dan negeert de app elke mail met "SPF not pass" in de log.
  - `docs/kanalen.md` gebruikt nu `hyperfocus` als PM2-naam, onder gebruiker `app`.


## Stap 1.1 — aanvulling: inkomende mail via Brevo werkt zonder SPF/DKIM-headers

- **Datum:** 2026-10-02
- **Probleem (live, Elmer):** elke inkomende mail werd geweigerd met "SPF not pass". Brevo stuurt geen `Authentication-Results` of `Received-SPF` mee.
- **Bevestiging:** een echte, geanonimiseerde Brevo-payload (uit de tests van django-anymail, juli 2023) bevat in `Headers` alleen `Received`, `DKIM-Signature` en de gewone mailheaders, en de spamscore als `SpamScore` op het hoogste niveau. Op de VPS logt de app nu bij de eerste mail na een herstart eenmalig de headernamen (zonder waarden). Die regel uit `pm2 logs hyperfocus` is de bevestiging voor ons eigen account.
- **Nieuwe regel** (BOUWPLAN 9.3 en 14 bijgewerkt):
  - Basis: geheim webhookpad plus `EMAIL_ALLOWED_SENDERS` en een bekende gebruiker.
  - SPF/DKIM tellen alleen als die headers er zijn; een uitslag anders dan *pass* wijst af.
  - Nieuwe variabele `EMAIL_MAX_SPAM_SCORE` (standaard 5): een hogere `SpamScore` wijst af. `Spam.Score` uit Brevo's documentatie wordt ook gelezen.
- **Fixtures:** `tests/fixtures/mail/` volgt nu de structuur van die echte payload (`Uuid` als lijst, `Received` als lijst, `DKIM-Signature`, `SpamScore`, CRLF-regeleinden). Nieuw: `spam` en `auth-headers-fail`.
- **Controle:** `npm test`: 134 groen met `TEST_DATABASE_URL`; zonder database 117 groen en 17 overgeslagen. Typecheck, lint en build groen.
- **Open:** na de deploy één mail sturen, de headerregel in de log bekijken en het antwoord per mail controleren.

## Stap 1.2 — Gesprekslaag met tools

- **Datum:** 2026-10-02
- **Status:** klaar in code; de evaluatieset draait op de VPS (cloud-sessie heeft geen Anthropic-sleutel).
- **Besluit (Elmer):** slim model wordt `claude-opus-5-5`; snel blijft `claude-haiku-4-5-20251001` (BOUWPLAN 17).
- **Gebouwd:**
  - `conversation/assistant.ts`: de stroom uit 10.1. Knoppen en de woorden *vandaag*, *parkeerplaats* en *help* gaan zonder AI. Een actieve modus krijgt het bericht eerst. Daarna Claude (snel model) met tools, maximaal 3 toolrondes. Bij een fout van Claude volgt een kort excuus.
  - `conversation/tools.ts`: `add_task`, `add_idea`, `set_task_status`, `set_suggestion_status`, `snooze`, `log_note`, `show_today`, `show_parking`, `pause`, `update_settings`, `overwhelm`. Elke invoer gaat door zod.
  - `add_task`: een klantnaam ("de bakker") wijst het project van die klant aan. Zonder klant of project gaat de taak naar *Losse taken*, met knoppen `mv:{taak}:{project}` voor de drie belangrijkste projecten.
  - `conversation/buttons.ts`: alle knop-ID's uit 9.4, plus `mv:`, `t:{id}:unpark` en `help`. Sessie- en weekreviewknoppen volgen in 1.4 en 1.7.
  - `conversation/context.ts`: context van maximaal 12.000 tekens (~3.000 tokens). De oudste berichten vallen eerst weg.
  - Prompts in `src/ai/prompts/` (`systeem.nl.md`, `router.nl.md`). De build kopieert ze naar `dist/ai/prompts`.
  - Elke Claude-aanroep komt in `ai_usage` met gebruiker, doel en tokens.
  - `npm run eval`: 55 Nederlandse voorbeeldberichten met de verwachte tools, op vaste voorbeelddata. Voert nooit een tool uit en raakt de database niet. Exit 1 onder 90%.
  - Taken en ideeën krijgen de bron mee (`telegram`, `email`, `web`).
- **Controle (Definition of Done):**
  - *Knoppen zonder AI-aanroep:* test `handles buttons without calling Claude` (nep-Claude wordt niet aangeroepen).
  - *Taak over een klant onder het juiste project:* tests `puts a task about a client under that client's project` en `runs Claude's tool calls…` (Kees → Onderhoud Fietsenmaker Jansen).
  - *Evaluatieset ≥ 90%:* **nog te draaien op de VPS**: `sudo -iu app; cd ~/hyperfocus; npm run eval`.
  - `npm test`: 168 groen met `TEST_DATABASE_URL`. Typecheck, lint, build en de simulator groen.
- **[BESLISSING] `log_note`:** projecten hebben geen notitieveld. Een notitie gaat nu naar de taak of naar de klant van het project; een nieuwe deadline gaat naar het project. Wil je een kolom `projects.notes`, dan is dat een datamodelwijziging.
- **Open:**
  - Op de VPS in `.env`: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL_FAST=claude-haiku-4-5-20251001`, `CLAUDE_MODEL_SMART=claude-opus-5-5`. Zonder sleutel beantwoordt de bot alleen knoppen en vaste woorden.
  - Vervalste afzender bij inkomende mail (zonder SPF/DKIM): nog geen keuze gemaakt tussen een moeilijk te raden adres en een geheim woord.

## Stap 1.3 — Dagritme

- **Datum:** 2026-10-02
- **Status:** klaar in code.
- **Gebouwd:**
  - `src/worker.ts` (`npm run worker`): elke minuut een tick met planner en verzender. Draai precies één worker.
  - `proactive/planner.ts`: per gebruiker vanaf 00:05 lokale tijd één keer per dag de focus (`daily_focus`) en de berichten (`scheduled_nudges`): ochtend, middag (13:30, alleen als de middag aan staat) en afronden. De unieke rij per gebruiker en datum maakt het planner-idempotent. Een tijdzonewissel geldt vanaf de eerstvolgende dag.
  - `proactive/focus.ts`: score en samenstelling uit 11.3. Maximaal drie taken, één snelle winst (≤ 10 min), een derde alleen binnen 3 uur. *Morgen verder* telt één dag mee en vervalt zodra de taak in een focus staat.
  - `proactive/sender.ts`: één bericht per transactie met `FOR UPDATE SKIP LOCKED`. Langs de vangrails, dan via het voorkeurskanaal. Is de bot geblokkeerd, dan gaat het per mail. Meer dan 2 uur te laat (worker lag stil) → overgeslagen met `too_late`.
  - `proactive/guardrails.ts`: in deze stap alleen de pauze. De rest volgt in 1.5.
  - Berichten (`proactive/messages.ts`) zonder AI-aanroep: ochtend met *Laat zien · Vandaag vrij*; middag alleen als de hoofdtaak nog niet gestart is; afronden met *Morgen verder · Opknippen · Parkeren · Alles morgen · Alles gedaan*.
  - De focuslijst toont bij een hoofdtaak van meer dan 60 minuten de eerste microstap, en stelt de snelle winst voor als start.
- **Controle (Definition of Done):**
  - *Ochtend en afronden op lokale tijd in beide tijdzones:* `tests/proactive.integration.test.ts`. Amsterdam 08:30 = 06:30 UTC, na de klokwissel van 25 oktober 07:30 UTC. Bali 08:30 = 00:30 UTC. Na een verhuizing volgt de volgende dag de nieuwe tijdzone.
  - *Maximaal drie taken met één snelle winst:* `tests/focus.test.ts` en de integratietest op de voorbeelddata.
  - *Geblokkeerde bot → mail:* integratietest: Telegram geeft 403, het afrondbericht gaat per mail.
  - `npm test`: 179 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Op de VPS na de merge:** als gebruiker `app`: `npm run build`, dan `pm2 start dist/worker.js --name hyperfocus-worker && pm2 save`.
- **Open:** het ochtendbericht gebruikt nog geen slim model (zie `docs/later.md`).

## Stap 1.4 — Opknippen en body-double

- **Datum:** 2026-10-02
- **Status:** klaar in code.
- **Gebouwd:**
  - Tool `break_down` (`conversation/session.ts`): 3 tot 5 microstappen. De eerste stap duurt hooguit 10 minuten (5 min); zod weigert anders en Claude krijgt de fout terug. Werkt op een bestaande taak (`task_id`) of maakt een nieuwe aan (`title`, eventueel `client_name`).
  - Microstappen zijn subtaken. Bij *Vastgelopen* wordt de stap zelf weer opgeknipt; zo ontstaat een kleine boom. De volgende stap is altijd het eerste open blad. Zijn alle stappen af, dan is de taak erboven ook af.
  - Knop *Opknippen* (`t:{id}:split`): roept het snelle model aan met een vaste tool (`forceTool`) en prompt `opknippen.nl.md`. Bestaan er al stappen, dan toont hij die.
  - Tool `start_session` en knop *Start* (`t:{id}:start`): noemt één stap, zet de modus op `session` en plant een check-in na `session_minutes`. Een hoofdtaak van meer dan 60 minuten zonder stappen wordt eerst opgeknipt.
  - Check-in *"Hoe ging het met …?"* met *Gedaan · Nog 10 min · Vastgelopen* (`sess:`). Na de derde sessie op een dag volgt een compliment en de vraag of het tijd is voor pauze.
  - Check-ins gaan ook tijdens een pauze uit: de gebruiker startte de sessie zelf.
  - De context voor Claude noemt de lopende sessie. De router stopt na tools met een vaste tekst (lijsten, opknippen), zonder extra Claude-aanroep.
  - Evaluatieset: 6 nieuwe gevallen voor `break_down` en `start_session` (61 in totaal).
- **Controle (Definition of Done):**
  - *"Help me starten met X" levert 3–5 stappen op met een eerste stap van ≤ 10 minuten:* `tests/session.integration.test.ts` (opbouw en weigering van een te lange eerste stap). Of het model dat ook echt doet, meet `npm run eval` op de VPS.
  - *De check-in komt na de ingestelde minuten:* integratietest: niets om 08:54, de check-in om 08:55 na een start om 08:30 (25 minuten).
  - `npm test`: 186 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Open:** geen.

## Stap 1.2 — aanvulling: router en evaluatie (na de eerste live meting)

- **Datum:** 2026-10-03
- **Meting op de VPS (Haiku 4.5):** 52/61 (85%), doel 90%.
- **Oorzaken:**
  - De prompt liet Haiku een vraag stellen in plaats van een taak vast te leggen (4 van de 9 missers).
  - De context noemde geen contactpersonen (Kees, Anna).
  - De evaluatiecontext was dubbelzinnig: het laatste bericht suggereerde dat de offerte af was. Dat gaf de missers bij "doe ik morgen" en "ben nu met de banner bezig".
  - Eén geval had twee goede antwoorden (er bestaat al een bannertaak).
- **Aangepast:**
  - `router.nl.md`: altijd iets vastleggen; onduidelijk project → taak zonder project; "moet nog" is een taak; nieuws over een klant is een notitie; opknippen zonder vragen; alleen taken veranderen die genoemd zijn.
  - De context toont klanten met contactpersoon: "Bakkerij De Vries (Anna)".
  - De evaluatiecontext is eenduidig en accepteert het tweede goede antwoord.
  - Klaar voor Sonnet 5.5 en Opus 5.5: die weigeren een afgedwongen tool. De client biedt bij opknippen alleen `break_down` aan, met `tool_choice: auto` en de opdracht in de prompt. Nieuwe optionele variabelen `CLAUDE_EFFORT_FAST` en `CLAUDE_EFFORT_SMART`. `max_tokens` van de router naar 4096, voor denkstappen.
  - `npm run eval -- --model … --effort …` vergelijkt modellen zonder `.env` te wijzigen, en toont de tijd per bericht en de tokens.
- **Controle:** `npm test` 187 groen.
- **Meting op de VPS (2026-10-03, `afc7003`):**

  | Model | Score | Mediaan | Traagste 10% | Input per bericht |
  |---|---|---|---|---|
  | Haiku 4.5 | 58/61 (95%) | 1,0 s | 1,7 s | 4.680 tokens |
  | Sonnet 5.5, effort low | 60/61 (98%) | 1,6 s | 2,6 s | 5.715 tokens |

- **Besluit (Elmer, 2026-10-03):** Sonnet 5.5 met effort low wordt het snelle model (`CLAUDE_MODEL_FAST=claude-sonnet-5-5`, `CLAUDE_EFFORT_FAST=low`). Reden: hogere nauwkeurigheid voor ongeveer $6 per maand extra en 0,6 s langere reactietijd. Alleen `.env` verandert. Definition of Done van 1.2 (≥ 90%) is met beide modellen gehaald.
- **Later (fase 3):** Haiku eerst met Sonnet als vangnet bij berichten zonder tool, als de kosten per klant tellen (`docs/later.md`).
- **Restmissers Haiku:** "boho vraagt om een extra mailing" (notitie in plaats van taak), een spraakachtige zin over Jansen (geen tool), "help me starten met de jaarplanning" (geen tool). Sonnet 5.5 miste alleen "boho belde: ze willen de nieuwsbrief in een andere kleur" (taak in plaats van notitie).

## Stap 1.5 — Vangrails, escalatieladder, herstart, overbelasting

- **Datum:** 2026-10-02
- **Status:** klaar in code.
- **Gebouwd:**
  - `proactive/guardrails.ts` (puur): pauze · stille uren in lokale tijd · maximaal `max_proactive_per_day` · minimaal 45 minuten tussen twee berichten (het bericht schuift op) · terugtrekken bij stilte · na overbelasting de volgende dag één bericht. Sessie-check-ins zijn vrijgesteld.
  - Terugtrekken: 2 dagen stil → alleen de ochtend · 4 dagen → stil · dag 7 → één herstartbericht in Telegram én per mail · daarna stil tot de gebruiker schrijft.
  - Zachte herstart: na ≥ 3 stille dagen is het eerstvolgende bericht een welkom terug met één kleinste taak. Taken die ≥ 14 dagen stilstonden gaan eerst naar de parkeerplaats.
  - `proactive/escalation.ts`: de ladder uit 11.5. De klok (`stuck_since`) start als een taak in de focus komt of een deadline heeft; starten of afronden zet hem terug. Om 11:00 maximaal één escalatie per dag, over één taak. Niveau 3 parkeert de taak.
  - Crisis (`conversation/wellbeing.ts`): een vast patroon (werkt ook zonder Claude) en de tool `crisis`. Zet `users.status` op `paused`, annuleert openstaande berichten, logt een waarschuwing en het event `crisis_flagged`. Antwoord met zorg, 113, 0800-0113, 113.nl, de huisarts en 112.
  - `npm run sim:day -- --date 2026-10-06 [--days 7] [--silent]`: speelt dagen versneld af in een transactie die altijd wordt teruggedraaid. Er wordt niets opgeslagen of verstuurd.
- **Controle (Definition of Done):**
  - *Alle unit tests groen:* `tests/guardrails.test.ts` (vangrails, stille uren in Bali, klokwissel, ladderniveaus, crisispatronen) en `tests/focus.test.ts`.
  - *7 dagen stilte geeft precies het afgesproken patroon:* `tests/wellbeing.integration.test.ts`. Dag 1 normaal, dag 2 alleen ochtend, dag 3 ochtend als zachte herstart, dag 4–6 niets, dag 7 herstart in Telegram en per mail, dag 8 niets. Handmatig: `npm run sim:day -- --date 2026-10-06 --days 8 --silent`.
  - *Een overbelastingszin zet de dag stil:* test uit 1.2 (`stills the day on overwhelm`) plus de test dat de volgende dag één bericht komt.
  - `npm test`: 209 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Keuzes om na te lezen:**
  - Deadlinetaken doen mee met de ladder als de deadline binnen 14 dagen valt. Anders zou een taak met een deadline over drie maanden na een week geparkeerd worden.
  - Een bericht in de stille uren vervalt (het schuift niet op).
  - Na een crisismarkering hervat je handmatig: `update users set status = 'active' where id = …;`
- **Open:** geen.

## Stap 1.6 — Spraakberichten

- **Datum:** 2026-10-02
- **Status:** klaar in code.
- **Gebouwd:**
  - Telegram-processor: een spraakbericht wordt opgehaald (`getFile` + download, alleen in het geheugen), getranscribeerd (`Transcriber`, OpenAI, `TRANSCRIBE_MODEL`, taal `nl`) en als tekst met bron `voice` door de router gestuurd. Tijdens het transcriberen toont Telegram "aan het typen…".
  - Het transcript komt in `messages.transcript` bij het binnenkomende bericht. `body` blijft leeg. De audio wordt nergens opgeslagen.
  - Langer dan 5 minuten → vraag om kortere stukken. Mislukt de transcriptie, of staat hij niet ingesteld, dan volgt de vraag om te typen.
  - Taken en ideeën uit een spraakbericht krijgen bron `voice`.
- **Controle (Definition of Done):**
  - *Binnen 8 seconden een taak of idee, met transcript opgeslagen en audio verwijderd:* `tests/voice.integration.test.ts` (spraak → taak onder Boho, bron `voice`, transcript in de database, `body` leeg) en `tests/telegram-processor.test.ts`. De 8 seconden zijn hier gemeten met nep-diensten. Live meten op de VPS: een spraakbericht van 30 seconden sturen en de tijd tot het antwoord opnemen.
  - `npm test`: 213 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Op de VPS:** in `.env` `OPENAI_API_KEY` en `TRANSCRIBE_MODEL` invullen (bijvoorbeeld `gpt-4o-mini-transcribe`; controleer de actuele naam bij OpenAI). Daarna `pm2 restart hyperfocus`.
- **Open:** Telegram bewaart het spraakbestand zelf op zijn servers; dat kunnen wij niet verwijderen. Hoort in de privacyverklaring (BOUWPLAN 14, beslissing over Telegram vóór fase 3).

## Stap 1.7 — Ideeënbak, weekreview, weekoverzicht

- **Datum:** 2026-10-02
- **Status:** klaar in code.
- **Gebouwd:**
  - Ideeën staan in `ideas` en komen nooit in de focus: de planner kiest alleen uit `tasks`.
  - Weekreview (`conversation/review.ts`) op `weekly_review_day` om `weekly_review_time` (standaard zondag 19:30), of met het woord *weekreview*:
    1. Wat er deze week af is en "Wat ging goed?": één tik of een paar woorden.
    2. Keuzelijst met projecten → `is_weekly_focus`.
    3. Keuzelijst met ideeën → hooguit één promotie per week tot project. Daarna krijgen alle ideeën `reviewed_at`.
  - Op de reviewdag plant de planner geen escalatie, zodat de review binnen de daglimiet valt.
  - Weekoverzicht op maandag 08:00, alleen per mail: wat er af is, het focusproject en open suggesties met actielinks. Telt niet mee voor de daglimiet en de adempauze van Telegram. Een antwoord op de mail gaat naar de router.
  - Doorgestuurde mail: de mailverwerking herkende al afzender en onderwerp. De router maakt er nu een taak van onder de klant (op naam of maildomein) of legt een notitie vast. Twee nieuwe gevallen in de evaluatieset (63 in totaal).
- **Controle (Definition of Done):**
  - *Ideeën nooit in de focus:* `tests/review.integration.test.ts`, `never puts ideas in the focus`.
  - *Weekreview in maximaal drie tikken:* dezelfde testfile, `runs the weekly review in three taps`.
  - *De maandagmail komt binnen:* `sends the Monday overview by mail only`. Live: maandag 08:00 de inbox controleren.
  - *Doorgestuurde mail → taak onder de juiste klant:* `turns a forwarded mail into a task under the right client` (met de echte Brevo-fixture). Of het model de klant herkent, meet `npm run eval`.
  - `npm test`: 218 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Keuze om na te lezen:** het weekoverzicht gebruikt `scheduled_nudges.kind = weekly_review` met `payload.part = 'mail'`. Een eigen enumwaarde (`weekly_mail`) is een datamodelwijziging; zie `docs/later.md`.
- **Open:** geen.

→ **Start eigen gebruik** (BOUWPLAN 16) zodra 1.2 t/m 1.7 op de VPS staan en de evaluatieset ≥ 90% haalt.

## Stap 1.8 — Agendakoppeling via ICS-link

- **Datum:** 2026-10-02, herzien 2026-10-03.
- **Besluit (Elmer, 3 oktober):** lezen via de geheime ICS-link van de eigen agenda, schrijven via een `.ics`-bestand ("Zet in agenda"). Akkoord met de privacy-afweging: de feed bevat deelnemers, beschrijvingen en locaties; die worden bij het inlezen weggegooid en nooit bewaard. Bouwplan v1.5, beslissing 12.
- **Datamodel (akkoord):** enum `calendar_provider` krijgt `microsoft`, `apple` en `ics` (migratie `0002_calendar_providers`). Er komen geen nieuwe kolommen bij: de ICS-link staat versleuteld in `refresh_token_enc`.
- **Gebouwd:**
  - `integrations/calendar/ics.ts`:
    - eigen ICS-parser met herhalende afspraken (`rrule`), uitgevouwen in de tijdzone van de afspraak;
    - ondersteunt `EXDATE`, verplaatste afspraken (`RECURRENCE-ID`), Windows-zonenamen van Outlook, hele-dag-afspraken, geannuleerde afspraken en uitnodigingen die je hebt afgeslagen;
    - `IcsCalendarProvider` met een tijdslimiet (15 s) en een groottelimiet (10 MB);
    - alleen `https`/`webcal` naar publieke adressen, zodat de server geen interne adressen kan opvragen.
  - Koppelpagina: één invulveld voor de ICS-link, met uitleg voor Google, Outlook en Apple. Bij het koppelen wordt de link eerst getest.
  - **Zet in agenda:** de knop `ps:` (*Ja, om 14:00* of *Plan om …*) plant de sessie en stuurt een `.ics`-bestand mee. Bijlagen werken overal:
    - Telegram: `sendDocument`;
    - mail: Brevo-bijlage;
    - actiepagina: downloadlink;
    - simulator: een regel `[bijlage]`.
  - De directe koppelingen met Google, Outlook en Apple CalDAV blijven in de code, maar staan uit tot hun sleutels in `.env` staan (`CALENDAR_APPLE_CALDAV` voor Apple).
  - Verder als eerder gebouwd:
    - vrije tijd en focus passend bij de dag;
    - ochtendregel over de afspraken;
    - berichten schuiven op tot na een afspraak (maximaal 90 minuten);
    - heads-up en nabespreking bij klantafspraken;
    - tools `connect_calendar`, `disconnect_calendar` en `find_free_slot`.
- **Controle (Definition of Done)** in `tests/calendar.integration.test.ts`, met nep-agenda's:
  - Alle vijf DoD-punten uit 11.8, zoals eerder.
  - Nieuw: `connects any calendar with a secret ICS link and keeps only times and titles`. Ongeldige link → 400, geen agenda → 422, goede link → gekoppeld en versleuteld. Van een wekelijkse afspraak staat alleen het juiste exemplaar in de database, zonder beschrijving of locatie.
  - `tests/ics.test.ts`: herhaling over de klokwissel, `EXDATE` en verplaatsing, Outlook-zones, afgeslagen uitnodiging, tijden zonder zone in Bali, linkcontrole en private adressen, en `.ics`-bestanden schrijven en teruglezen.
  - `tests/attachments.test.ts`: het bestand gaat via Telegram als document en per mail als bijlage.
  - `npm test`: 251 groen met `TEST_DATABASE_URL`. Typecheck, lint en build groen.
- **Open:**
  - Live koppelen en de checks uit `docs/agenda.md` doen.
  - Meer dan één ICS-link per gebruiker staat in `docs/later.md`.

## Stap 1.10 — Werkplek-links

- **Datum:** 2026-10-03
- **Status:** klaar in code.
- **Datamodel (uit de brief):** enum `work_type` (`invoicing`, `email`, `calendar`, `content`, `website`, `docs`), tabel `user_tools` (uniek op gebruiker en werksoort) en kolom `tasks.work_type`. Migratie `0003_workplace_links`.
- **Gebouwd:**
  - `src/tools/catalog.ts`: 17 tools met hun standaardpagina. URL's zijn bevestigd via officiële hulppagina's en zoekresultaten. Jortt en WordPress hebben geen bevestigde startpagina; daar vraagt de bot om een link.
  - Linkcontrole: alleen `https://`, maximaal 2.048 tekens, een geldige hostnaam. Anders volgt de melding uit de brief. De server haalt een link nooit op.
  - `conversation/workplace.ts`: de vragenronde (één vraag per bericht, met *Overslaan* en *Anders: plak je link*), de vraag om een link van het startscherm, "mijn tools" met per regel *Wijzig* en *Verwijder*, en eens per week de vraag als een werksoort nog geen tool heeft.
  - Na het koppelen van Telegram start de vragenronde. `/help` noemt "mijn tools".
  - De knop *Open {tool} → {actie}* staat bij de bevestiging van een nieuwe taak, bij *Start* en in het ochtendbericht bij de bovenste taak. In de mail is het een gewone link. Elke getoonde knop wordt gelogd (`tool_button_shown`) voor de meting.
  - Router: `add_task` krijgt `work_type` (alleen bij een duidelijk werkwoord met object), plus de nieuwe tools `list_tools`, `set_tool` en `remove_tool`.
  - Evaluatieset: 4 nieuwe gevallen en 1 aangescherpt (71 in totaal).
- **Controle (Definition of Done)** in `tests/workplace.integration.test.ts` en `tests/workplace.test.ts`:
  - *"mijn tools" doorloopt de zes vragen; overslaan en een eigen link werken:* `walks through the six questions…`.
  - *De factuurtaak geeft [Open Moneybird → nieuwe factuur]:* `shows [Open Moneybird → nieuwe factuur]…`.
  - *Een taak zonder werksoort krijgt geen knop:* dezelfde test.
  - *Een `http://`-link wordt geweigerd:* in de vragenronde en in de unittests (ook `javascript:`, `data:`, `file:`, te lang, ongeldige host).
  - *Eval ≥ 90%:* nog te draaien op de VPS. `npm test`: 272 groen.
- **Niet gebouwd, eerst voorleggen:**
  - De klikmeting via `/go/<id>` vraagt een nieuwe `.env`-vlag. Die leg ik je eerst voor (zie `docs/later.md`).
  - Export van gegevens bestaat nog niet (BOUWPLAN 14, fase 2). Verwijderen werkt via de cascade op de gebruiker, dus `user_tools` gaat mee.

## Stap 1.9 — Werkblokken, pauze-opdrachten en de beloningsminuut

- **Datum:** 2026-10-03
- **Status:** klaar in code.
- **Datamodel (uit de brief):** tabellen `focus_blocks` en `garden_events`, kolommen `users.garden_growth` en `user_settings.rewards_enabled`, vier nudge-soorten (`block_end`, `return_reminder`, `pause_close`, `hyperfocus_break`). Migratie `0004_work_blocks`. Alles valt weg met de cascade op de gebruiker.
- **Gebouwd:**
  - *Start* vraagt 15, 25 of 45 minuten (standaard 15). De router geeft `minutes` mee; andere duren rond de code af naar de dichtstbijzijnde.
  - Einde van het blok met geluid: [Afgerond] [Nog 15 min] [Stoppen]. Zonder antwoord sluit het blok na 30 minuten stil.
  - *Afgerond* start een pauze-opdracht zonder geluid (water, strekken, toilet 3 min, ademen; nooit twee keer dezelfde achter elkaar). *Ik ben terug* of de tekst "ben terug" sluit de pauze. Op tijd: extra blaadje, [Je minuut] en [Volgende blok starten].
  - Pauzetijd voorbij: één keer "Terug naar je blok?" met geluid; 30 minuten later sluit de pauze stil.
  - Hyperfocus-vanger: 60 minuten of meer aaneengesloten werk (blokken zonder terugkeer uit de pauze, met minder dan 30 minuten ertussen) geeft één pauzebericht. Na *Nog 15 min* komt er nog één; daarna alleen de gewone vraag.
  - Stilte: tijdens een blok of pauze gaan antwoorden en berichten met `disable_notification`, behalve `block_end`, `return_reminder` en `hyperfocus_break`. Andere proactieve berichten wachten tot na de pauze. Stille uren en /pauze gaan voor.
  - Beloningsminuut: `/app/beloning?t=…`, een Telegram-mini-app. Eén ronde van 60 seconden, geteld op de server; herladen geeft geen extra tijd. Het token is eenmalig (alleen de hash staat in de database) en verloopt aan het eind van de lokale dag. `initData` wordt met HMAC gecontroleerd, maximaal 24 uur oud, en moet van de eigenaar zijn. In de mail is het een gewone link.
  - Tuin: +1 per afgerond blok en +1 per terugkeer op tijd. Krimpt nooit. De weekreview noemt de groei.
  - "zet beloningen uit"/"aan" en een knop in /help. Blokken en pauzes werken door.
  - Router: `start_session` krijgt `minutes`; nieuwe tools `return_from_pause` en `set_rewards`.
  - `npm run sim:day -- --date … --scenario blocks`: twee blokken achter elkaar en een late terugkeer, met "zonder geluid" per bericht.
  - `npm run stats:focus -- --days 14`: de meetpunten uit de brief per gebruiker.
  - Evaluatieset: 4 nieuwe gevallen (75 in totaal).
- **Controle (Definition of Done)** in `tests/blocks.integration.test.ts`, `tests/blocks.test.ts`, `tests/session.integration.test.ts`, `tests/telegram-processor.test.ts`:
  - *Start vraagt 15/25/45; het einde komt op tijd, met geluid:* `asks the length, starts a block…` en `runs a block, a silent pause…`.
  - *Pauze-opdracht zonder geluid; op tijd terug geeft de druppel en [Je minuut]:* `runs a block, a silent pause…` en de sim-test.
  - *Precies één "Terug naar je blok?", met geluid:* `sends one return reminder with sound…`.
  - *Mini-app 60 seconden:* `times one round of 60 seconds on the server…`, `expires at the end of the local day`, `stores only a hash of the token`. In Chromium gecontroleerd: de pagina laadt zonder fouten, telt af en toont de plant. Telegram Desktop en mobiel: live-check.
  - *Hyperfocus na 60+ minuten:* `catches hyperfocus once after 60+ minutes…` (15 + 25 + 25).
  - *"zet beloningen uit":* `keeps blocks and pauses working with rewards off…` (geen knop, geen tuinregel, /help toont *Beloningen aan*).
  - *sim:day toont de nieuwe nudges:* `plays two blocks and a late return in sim:day…`. `npm test`: 294 groen. Eval: op de VPS.
- **Afwijkingen en keuzes om voor te leggen:**
  - Vier teksten staan niet in de brief: "Eerste stap: {stap}." (onder de starttekst als de taak stappen heeft), "Prima, nog 15 minuten.", "Gestopt." en "Beloningen staan weer aan." Ze staan in `src/texts/werkblokken.nl.ts`.
  - *Afgerond* rondt de microstap af waaraan je werkte, niet de hele taak. Een taak zonder stappen blijft open.
  - Bij een late terugkeer blijft [Je minuut] staan, zonder extra blaadje.
  - Evalgeval "even 40 min aan de offerte voor Roos" heet hier "…voor de bakkerij": de evalcontext heeft geen offerte voor Roos.
  - Space Grotesk staat in de CSS, maar wordt niet extern geladen (geen extra dienst); de pagina valt terug op de systeemletter.
  - De oude knoppen uit stap 1.4 (*Gedaan*, *Nog 10 min*, *Vastgelopen*) blijven werken voor berichten die al verstuurd zijn.

## Volgende stap

Stap 1.8 live zetten (`docs/agenda.md`) en koppelen. Fase 1 is daarmee af; eigen gebruik en de meting voor de verkooppoort lopen.
