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

## Volgende stap

0.4 Database: `node-postgres`-client, schema uit hoofdstuk 8, migraties en seed.
