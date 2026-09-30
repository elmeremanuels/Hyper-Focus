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

## Volgende stap

0.3 Oogsten uit `Publicato-personal`. Daarvoor moet de bronrepo in de sessie beschikbaar zijn.
