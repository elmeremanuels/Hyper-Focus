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

## Volgende stap

1.1 WhatsApp in en uit (9.3–9.5). Vraagt eerst de voorbereiding bij Meta (9.1) en een VPS met domein en HTTPS. In de cloud-sessie bouw en test ik met opgenomen Meta-payloads en zonder productiesleutels.

## Bouwplan v1.3 — Telegram en mail in plaats van WhatsApp

- **Datum:** 2026-10-01
- **Besluit (Elmer):** WhatsApp vervalt. Alle WhatsApp-accounts in de Meta-portfolio De GroeiFormule zijn door Meta uitgeschakeld en een nieuwe portfolio aanmaken lukt niet (limiet bereikt). Telegram wordt het dagelijkse kanaal, mail het tweede kanaal voor overzichten, concepten en invoer. Zie BOUWPLAN.md hoofdstuk 9 en beslissing 10.
- **Gevolgen:**
  - Branch `stap-1.1` (WhatsApp) vervalt. Stap 1.1 wordt opnieuw gebouwd als "Telegram en mail in en uit"; kanaalonafhankelijke delen uit die branch mogen worden overgenomen.
  - Datamodel (hoofdstuk 8): `users` krijgt Telegram-velden en `preferred_channel`, `phone_e164` en `whatsapp_opt_in_at` vervallen; `messages` krijgt `external_id` (uniek met `channel`) in plaats van `wa_message_id`; `wa_usage` vervalt. Nog te migreren in stap 1.1.
  - De huidige code op `main` bevat nog de WhatsApp-verify-webhook uit stap 0.3 en de `WHATSAPP_*`-variabelen in `env.ts`. Opruimen in stap 1.1.
- **Infrastructuur (klaar):** Hostinger VPS KVM 2 (Duitsland), `hyper-focus.pro` met HTTPS, app draait onder PM2, `/health` geeft ok, nachtelijke `pg_dump`, snapshot gemaakt. Installatie via `setup-vps.sh`.
- **Open:** Telegram-bot aanmaken bij @BotFather; SendGrid-domeinauthenticatie en Inbound Parse (MX `in.hyper-focus.pro`); SSH-sleutel op de VPS en daarna SSH-hardening; repo privé maken.
