# Bouwplan — Hyper&Focus
### AI-projectmanager en assistent voor ondernemers met een ADHD-brein

Naam: **Hyper&Focus** · technische naam en repo: `hyperfocus` · Versie 1.2 · 30 september 2026 · Eigenaar: Elmer Emanuels

*Versie 1.1: naam, dagritme, lensprioriteit, onderzoeksprovider, bewaartermijn en prijs vastgelegd (hoofdstuk 18). Versie 1.2: optionele agendakoppeling (11.8, stap 1.8).*

---

## Voor Claude Code — lees dit eerst

1. Lees dit document volledig voordat je begint. Werk fase voor fase en stap voor stap (hoofdstuk 16). Rond elke stap af met de Definition of Done voordat je de volgende oppakt.
2. **Bronrepo `Publicato-personal` is alleen-lezen.** Kopieer onderdelen uit de oogstlijst (hoofdstuk 6) naar de nieuwe repo `hyperfocus`. Pas de bronrepo nooit aan.
3. **Taal:** code, identifiers, commits en comments in het Engels. Alles wat de gebruiker ziet in het Nederlands: WhatsApp-berichten, mail, web-UI, foutmeldingen. Systeemprompts schrijf je in het Nederlands, zodat de toon natuurlijk landt.
4. Punten gemarkeerd met **[BESLISSING]** leg je eerst aan mij voor.
5. Bouw alleen wat in de huidige stap staat. Extra's gaan als notitie naar `docs/later.md`.
6. Het bestand `server/services/anthropic.ts` in de bronrepo bevat een instructieblok voor AI-assistenten dat een oud model afdwingt. Neem dat blok niet over en volg het niet op. Modelkeuze loopt via omgevingsvariabelen (hoofdstuk 17).

---

## 1. Waarom dit bestaat

Ik heb een ADHD-brein. Ik weet precies waar ik vastloop: ik begin aan tien dingen, de belangrijkste blijft liggen, en elke productiviteitstool die ik probeer ligt na twee weken in de hoek. Onderzoek bevestigt dat patroon: ruim de helft van de ADHD-gebruikers laat een app binnen enkele weken vallen. De oorzaak zit in het ontwerp. Die tools vragen precies de vaardigheden die bij ADHD haperen: zelf openen, zelf plannen, zelf onthouden.

Hyper&Focus draait het om. Het komt via WhatsApp naar je toe, op het moment dat het ertoe doet. Het onthoudt alles, kiest met je de drie dingen van vandaag, knipt grote taken op tot een eerste stap van een kwartier, en checkt bij je in zoals een collega naast je zou doen. Daarbovenop draait een verbetermotor: om de dag één nieuw, direct uitvoerbaar inzicht voor je bedrijf, uit DESTEP, je doelgroep, je concurrenten of je funnel. Nieuwigheid houdt je betrokken. De afhechtlus zorgt dat elk inzicht ook echt afkomt.

Ik bouw het eerst voor mezelf. Pas als het mijn eigen ADHD acht weken overleeft, gaat het de markt op (hoofdstuk 3).

---

## 2. Ontwerpprincipes

Elke keuze in de bouw toets je aan deze acht principes.

1. **Het systeem komt naar de gebruiker.** WhatsApp is de interface. De web-UI is een hulpmiddel voor instellingen en lange teksten.
2. **Vastleggen kost één bericht.** Een zin of een spraakbericht is genoeg. Hyper&Focus zoekt zelf uit bij welk project het hoort.
3. **Maximaal drie dingen tegelijk in beeld.** Eén hoofdtaak, één snelle winst, eventueel één extra.
4. **Elke taak heeft een kleinste volgende stap** van 5 tot 15 minuten, beginnend met een werkwoord.
5. **Nieuwigheid als haak, afhechting als ruggengraat.** De verbetermotor brengt steeds een verse invalshoek en checkt eerst of de vorige is afgerond.
6. **Aanwezigheid zonder oordeel.** Zachte statussen (mee bezig, geparkeerd, losgelaten), warme taal, successen worden gevierd. Laat streaks, achterstandstellers en rode markeringen weg.
7. **Rust is een functie.** Stille uren, een dagelijkse berichtenlimiet, pauze op commando, en een zachte herstart na een stille periode.
8. **Het product werkt zonder diagnose.** We vragen en bewaren nooit of iemand ADHD heeft (AVG, hoofdstuk 14).

---

## 3. Fasering en de verkooppoort

| Fase | Wat | Indicatie |
|---|---|---|
| 0 | Fundament: beveiliging, repo, oogsten, database, simulator | 2–3 dagen |
| 1 | Kern: WhatsApp in/uit, gesprekslaag, dagritme, opknippen, body-double, vangrails, spraak, ideeënbak | 1–2 weken |
| 2 | Verbetermotor + minimale web-UI | 2 weken |
| — | **Eigen gebruik (dogfooding): 8 weken** | start bij livegang fase 1 |
| 3 | Verkoopklaar: accounts, onboarding, abonnement, AVG, beta, positionering | 3–4 weken |

De commerciële architectuur zit er vanaf dag één in: elke tabel is per gebruiker afgeschermd, kosten worden per gebruiker gemeten, en tijdzone en instellingen zijn per gebruiker. Fase 3 bouwt daarop voort zonder iets te hoeven slopen.

### De verkooppoort (mijn voorstel)

Fase 3 start pas als na 8 weken eigen gebruik geldt:

1. In week 6 t/m 8 reageer ik op minimaal 5 van de 7 dagen.
2. Minimaal de helft van de suggesties uit de verbetermotor krijgt de status *mee bezig* of *gedaan*.
3. Ik ben minstens één keer na een stille periode teruggekomen en de zachte herstart werkte.
4. Ik zou het missen als het uitviel.

De verbetermotor moet minstens 5 van die 8 weken draaien. Punt 1 t/m 3 meet het systeem zelf (events, hoofdstuk 8). Punt 4 is mijn eigen oordeel.

---

## 4. Architectuur

```
        WhatsApp (Meta Cloud API)                        Mail (SendGrid)
          ▲                 │ webhook                        ▲ informerend
          │ uitgaand        ▼                                │
 ┌───────────────────────────────────────────────────────────────────────┐
 │ KANAALLAAG  verzenden · webhook · handtekening · knoppen · spraak→tekst │
 └───────────────────────────────────────────────────────────────────────┘
          ▲                 │
          │                 ▼
 ┌──────────────────┐   ┌───────────────────────────────────────────────┐
 │ PROACTIEVE LAAG  │   │ GESPREKSLAAG (router)                          │
 │ scheduler        │   │ knop → direct afgehandeld                      │
 │ dagritme         │   │ tekst/spraak → Claude met tools                │
 │ vangrails        │   └───────────────────────────────────────────────┘
 │ escalatieladder  │                     │
 └──────────────────┘                     ▼
          │          ┌───────────────────────────────────────────────┐
          └────────▶ │ KERN  taken · projecten · klanten · ideeën ·   │
                     │       focus · berichten · instellingen        │
                     └───────────────────────────────────────────────┘
                                        ▲
                     ┌──────────────────┴────────────────────────────┐
                     │ VERBETERMOTOR  onderzoek · lenzen · selectie ·  │
                     │                afhechtlus · feedback            │
                     └───────────────────────────────────────────────┘
                                        │
                              PostgreSQL 16 (Drizzle)
```

Twee processen onder PM2:

- **`hyperfocus-web`** — Express: webhook, web-UI (fase 2), health-endpoint.
- **`hyperfocus-worker`** — scheduler, planner, onderzoeksjobs. Altijd één instantie, zodat berichten nooit dubbel verstuurd worden.

### Een dag, van begin tot eind

- **00:05 lokale tijd** — de planner maakt de berichten van vandaag aan in `scheduled_nudges`.
- **08:30** — ochtendtemplate: *"Goedemorgen Elmer. Je focus voor vandaag staat klaar."* Knop *Laat zien*. Die tik opent het 24-uursvenster van WhatsApp.
- **08:31** — de focuslijst van drie, met knoppen *Start 1 · Start snelle winst · Aanpassen*.
- **08:32** — ik tik *Start*. Hyper&Focus geeft de eerste stap en plant een check-in over 25 minuten.
- **10:30** — het venster staat open, dus de verbetermotor stuurt de suggestie van vandaag (of eerst de afhechtvraag over de vorige).
- **Overdag** — ik app losse dingen: *"klant wil banner voor vrijdag"*, een spraakbericht met een idee. Hyper&Focus zet alles op de juiste plek.
- **16:00** — de dag afronden. Wat af is wordt gevierd, de rest gaat naar morgen, wordt opgeknipt of geparkeerd.

---

## 5. Techstack

| Onderdeel | Keuze | Opmerking |
|---|---|---|
| Runtime | Node.js 20+, TypeScript (strict) | gelijk aan Publicato |
| Server | Express 4 | geoogst patroon |
| Database | PostgreSQL 16 + Drizzle ORM | **driver `drizzle-orm/node-postgres` met `pg`**; Publicato gebruikt de Neon-serverless-driver, die past niet bij een lokale Postgres op de VPS |
| Validatie | zod | ook voor omgevingsvariabelen |
| Planning | node-cron (tick) + Luxon (tijdzones) | tijdzone per gebruiker |
| AI | `@anthropic-ai/sdk`, laatste versie | Publicato zit op ^0.37; upgraden |
| Transcriptie | OpenAI-SDK (al in Publicato) | alleen voor spraakberichten |
| WhatsApp | Meta WhatsApp Cloud API | Graph-versie via env |
| Mail | SendGrid | alleen informerend |
| Web-UI (fase 2) | React + Vite + Tailwind | mobile-first |
| Tests | Vitest | plus eigen eval-script |
| Hosting | Hostinger VPS met template *Claude Code* (Ubuntu 24.04), PM2, Nginx, Let's Encrypt | Meta vereist HTTPS voor de webhook; Node 20+ apart installeren, Ubuntu 24.04 levert een oudere versie |
| Agenda (optioneel) | Google Agenda-API, OAuth 2.0 | alleen lezen; tokens versleuteld |

---

## 6. Oogstlijst

### Overnemen en aanpassen

| Bron in `Publicato-personal` | Doel in `hyperfocus` | Aanpassing |
|---|---|---|
| `server/services/whatsappService.ts` | `src/channels/whatsapp/client.ts` | taalcode template van `en_US` naar `nl`; interactieve knoppen en lijstberichten toevoegen; media ophalen voor spraak |
| verify-token-deel uit `server/routes/engagementRoutes.ts` | `src/channels/whatsapp/webhook.ts` | handtekeningcontrole `X-Hub-Signature-256` toevoegen (ontbreekt nu), idempotentie, direct 200 teruggeven en asynchroon verwerken |
| `server/services/anthropic.ts` | `src/ai/claude.ts` | SDK upgraden; instructieblok en hardcoded modellen verwijderen; modellen via env; helper voor tool use |
| `server/services/openai.ts` | `src/ai/transcribe.ts` | alleen transcriptie behouden |
| `server/utils/ai-json.ts`, `server/utils/jsonrepair.ts` | `src/ai/json.ts` | ongewijzigd |
| `server/cron/aiAutopilotRunner.ts` | `src/proactive/scheduler.ts` | patroon overnemen: per gebruiker `nextRun`, run-registratie, retry. Vaste `Europe/Amsterdam` vervangen door tijdzone per gebruiker |
| `runJobWithMetrics` uit `server/services/cronService.ts` | `src/proactive/scheduler.ts` | ongewijzigd |
| `server/utils/telemetry.ts` | `src/lib/telemetry.ts` | aanvullen met schrijven naar `events` |
| `server/services/bandit.ts` | `src/engine/selector.ts` | koude-startdrempel van 50 naar 3 vertoningen per lens; beloning op schaal 0–1 |
| `server/sectorNewsService.ts` | `src/engine/research/news.ts` | Nederlandse bronnen behouden |
| `server/services/websiteContentScraper.ts`, `advancedWebsiteScanner.ts` | `src/engine/research/website.ts` | alleen tekst, structuur en CTA's; beeldverwerking eruit |
| `server/services/perplexity.ts` | `src/engine/research/providers/perplexity.ts` | alternatieve onderzoeksprovider |
| `server/autoGPTAgent.ts` | patroon voor `src/engine/generate.ts` | alleen het doel-stappen-redenering-patroon; OpenAI vervangen door Claude |
| `strategic-context-enhancer.ts`, `aiSuggestionsService.ts`, `aiHints.ts` | referentie | lezen als inspiratie voor prompts; herschrijven |
| schema's `businessProfiles`, `customerPersonas`, `competitorIntelligence`, `swotAnalysis`, `businessGoals`, `brainstormIdeas` | `src/db/schema/` | afslanken volgens hoofdstuk 8 |
| `server/services/emailService.ts` / `sendgridService.ts` | `src/channels/email/` | alleen versturen en één template (weekoverzicht) |
| `server/auth.ts`, `server/middleware/auth.ts` | fase 2 | omzetten naar magic-link login |
| `server/services/googleOAuthService.ts` | `src/integrations/calendar/oauth.ts` | alleen de scope `calendar.readonly`; scopes voor Drive, Ads, Analytics en Business Profile eruit |
| `server/utils/tokenEncryption.ts` | `src/lib/crypto.ts` | nodig vanaf stap 1.8 voor agendatokens |
| `mollieService.ts`, schema's `subscriptions`, `paymentHistory` | fase 3 | alleen abonnementen |
| `tenantUsageService.ts`, tenant-migraties | fase 3 | kostenmeting per gebruiker |

### Achterlaten

Leonardo en alle beeld-, media- en videodiensten · alle publishers (social media, TikTok, Pinterest, WordPress, Shopify) · content items, pillars, drafts, published content · het vertaalsysteem · Google Ads, Analytics, Search Console, Business Profile · Klaviyo, Mailchimp · het creditsysteem (fase 3 gebruikt abonnementen) · de agency-structuur (fase 3 herbekijken) · alle `*-backup`, `*-old`, `temp_*`, `test-*.js`, `*cookies*.txt`, `*.tar.gz` en `attached_assets`.

---

## 7. Repo-structuur

```
hyperfocus/
├── .env.example
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── docs/
│   └── later.md
├── scripts/
│   ├── sim.ts                  # terminal-chat via dezelfde router als WhatsApp
│   ├── sim-day.ts              # speelt een dag versneld af
│   └── eval.ts                 # evaluatieset gesprekslaag
├── src/
│   ├── server.ts               # hyperfocus-web
│   ├── worker.ts               # hyperfocus-worker
│   ├── config/env.ts           # zod-gevalideerde env
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/*.ts
│   │   └── seed/
│   │       ├── example.ts
│   │       └── eigen-data.local.ts   # in .gitignore
│   ├── channels/
│   │   ├── whatsapp/ client.ts · webhook.ts · signature.ts · interactive.ts · templates.ts · media.ts
│   │   └── email/ sendgrid.ts · weekoverzicht.ts
│   ├── ai/
│   │   ├── claude.ts · transcribe.ts · json.ts
│   │   └── prompts/ systeem.nl.md · router.nl.md · ochtend.nl.md · afronden.nl.md · opknippen.nl.md · suggestie.nl.md
│   ├── conversation/ router.ts · buttons.ts · tools.ts · context.ts · state.ts
│   ├── core/ tasks.ts · projects.ts · clients.ts · ideas.ts · focus.ts · settings.ts
│   ├── proactive/ scheduler.ts · planner.ts · rhythm.ts · bodydouble.ts · escalation.ts · guardrails.ts · reentry.ts · weekly.ts
│   ├── engine/
│   │   ├── intake.ts · generate.ts · selector.ts · closure.ts · feedback.ts
│   │   ├── lenses/ index.ts · destep.ts · audience.ts · competitor.ts · funnel.ts
│   │   └── research/ index.ts · website.ts · news.ts · competitors.ts · providers/claude.ts · providers/perplexity.ts
│   ├── integrations/calendar/ provider.ts · google.ts · oauth.ts · sync.ts · matcher.ts   # optioneel, stap 1.8
│   ├── web/                    # fase 2
│   ├── billing/                # fase 3
│   └── lib/ telemetry.ts · time.ts · errors.ts · crypto.ts
└── tests/
```

---

## 8. Datamodel

Alle tabellen hebben `id`, `user_id` (behalve `users`), `created_at` en `updated_at`. Statussen zijn Engelse enum-waarden in de code met Nederlandse labels in de UI.

### Enums

| Enum | Waarden (code) | Labels (UI) |
|---|---|---|
| `task_status` | `open`, `in_progress`, `parked`, `done`, `released` | open, mee bezig, geparkeerd, gedaan, losgelaten |
| `suggestion_status` | `new`, `in_progress`, `done`, `parked`, `skipped`, `not_relevant` | nieuw, mee bezig, gedaan, geparkeerd, overgeslagen, niet relevant |
| `nudge_kind` | `morning`, `midday`, `wrapup`, `engine`, `followup`, `session_checkin`, `escalation`, `weekly_review`, `reentry`, `meeting_heads_up`, `meeting_followup` | — |
| `lens` | `destep`, `audience`, `competitor`, `funnel` (fase 2); later `swot`, `offer_pricing`, `retention`, `visibility`, `time_saving` | DESTEP, Doelgroep, Concurrent, Funnel, … |

### Tabellen

**users** — `name`, `phone_e164` (uniek), `email`, `timezone` (IANA, standaard `Europe/Amsterdam`; voor mij nu `Asia/Makassar`), `locale` (`nl-NL`), `whatsapp_opt_in_at`, `status` (`active` | `paused`), `last_inbound_at` (voor het 24-uursvenster).

**user_settings** — `morning_time` (08:30), `midday_enabled` (true), `wrapup_time` (16:00), `weekly_review_day` (zondag), `weekly_review_time` (19:30), `quiet_start` (21:00), `quiet_end` (08:00), `max_proactive_per_day` (4), `session_minutes` (25), `engine_frequency` (`every_other_day` | `daily` | `twice_weekly`), `engine_time` (10:30), `enabled_lenses` (text[]), `paused_until`, `calendar_enabled` (false), `meeting_heads_up` (true), `meeting_followup` (true), `max_calendar_nudges_per_day` (2).

**businesses** — het bedrijf dat de verbetermotor verbetert. `name`, `website`, `sector`, `description`, `audience`, `offer`, `pricing_note`, `competitors` (jsonb: `[{name, url}]`), `goals`, `is_focus` (maximaal één per gebruiker), `profile` (jsonb met overige velden uit het Publicato-profiel), `last_researched_at`.

**clients** — klanten die de gebruiker bedient. `business_id`, `name`, `contact_name`, `notes`, `status` (`active` | `paused` | `ended`).

**projects** — `business_id` (optioneel), `client_id` (optioneel), `title`, `goal`, `status` (`active` | `parked` | `done`), `deadline`, `priority` (1–3), `is_weekly_focus`. Elke gebruiker krijgt automatisch een project *Losse taken*.

**tasks** — `project_id`, `parent_task_id` (voor microstappen), `title`, `notes`, `status` (`task_status`), `estimated_minutes` (5/15/30/60/120), `due_date`, `snoozed_until`, `carry_over` (bool, "morgen verder"), `source` (`whatsapp` | `voice` | `engine` | `web` | `seed`), `stuck_since`, `last_escalation_level` (0–3), `completed_at`.

**ideas** — de ideeënbak. `business_id` (optioneel), `text`, `source`, `status` (`inbox` | `promoted` | `archived`), `promoted_to_project_id`, `reviewed_at`.

**daily_focus** — `local_date`, `task_ids` (int[], max 3, in volgorde), `quick_win_task_id`, `wrapup_done_at`.

**suggestions** — `business_id`, `lens`, `sub_lens` (bijv. DESTEP `technologisch`), `title`, `why`, `action`, `estimated_minutes`, `asset` (jsonb: `{type, content}`), `sources` (jsonb), `status` (`suggestion_status`), `status_reason` (optioneel), `delivered_at`, `followup_due_at`, `responded_at`, `builds_on_suggestion_id`, `dedupe_key`.

**research_cache** — `business_id`, `kind` (`website` | `competitor` | `news` | `web`), `payload` (jsonb), `fetched_at`, `expires_at` (standaard +7 dagen).

**messages** (verwijderd na 30 dagen) — `direction` (`in` | `out`), `channel` (`whatsapp` | `email` | `web`), `wa_message_id` (uniek, voor idempotentie), `type` (`text` | `button` | `list` | `audio` | `template`), `body`, `transcript`, `intent`, `task_id`, `suggestion_id`, `nudge_id`.

**scheduled_nudges** — `kind` (`nudge_kind`), `scheduled_for_utc`, `payload` (jsonb), `status` (`pending` | `sent` | `skipped` | `failed`), `skip_reason`, `sent_message_id`.

**calendar_connections** (optioneel) — `provider` (`google`), `calendar_ids` (text[], standaard alleen de hoofdagenda), `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `sync_token`, `status` (`active` | `error` | `revoked`), `last_synced_at`.

**calendar_events** (optioneel, alleen vandaag en morgen) — `connection_id`, `external_id`, `starts_at_utc`, `ends_at_utc`, `title`, `is_busy`, `is_all_day`, `client_id`, `project_id`. We bewaren alleen deze velden.

**conversation_state** — één rij per gebruiker. `mode` (`idle` | `session` | `wrapup` | `weekly_review` | `intake` | `onboarding`), `data` (jsonb), `expires_at`.

**events** — `name`, `props` (jsonb). Minimaal: `inbound_message`, `task_created`, `task_status_changed`, `focus_item_done`, `suggestion_delivered`, `suggestion_status_changed`, `session_started`, `session_completed`, `reentry`, `overwhelm`, `nudge_skipped`.

**ai_usage** — `purpose` (`router` | `morning` | `breakdown` | `engine` | `research` | …), `model`, `input_tokens`, `output_tokens`. Plus **wa_usage** — `template_name`, `category`, `sent_at`. Beide nodig voor de prijsbepaling in fase 3.

### Seed

`src/db/seed/example.ts` bevat fictieve voorbeelddata (een fictief bedrijf met drie klanten). `eigen-data.local.ts` vul ik zelf met mijn bedrijven, klanten en lopende projecten; dat bestand staat in `.gitignore`.

---

## 9. WhatsApp-laag

### 9.1 Voorbereiding bij Meta (door mij, vóór stap 1.1)

1. App in Meta for Developers met het WhatsApp-product.
2. Testnummer voor ontwikkeling. Voor productie een apart nummer: een nummer op het WhatsApp Business Platform kan niet tegelijk in de gewone WhatsApp-app draaien.
3. Bedrijfsverificatie voor productie.
4. Permanente system-user-token.
5. Webhook-URL en verify-token instellen, abonneren op `messages`.
6. **Templates vroeg indienen** (goedkeuring kost tijd), in het Nederlands, categorie *utility*: `ochtend_focus`, `dag_afronden`, `weekreview`, `herstart`. Houd ze zakelijk en gekoppeld aan de eigen planning van de gebruiker; Meta beoordeelt de categorie.

### 9.2 Het 24-uursvenster bepaalt het ontwerp

WhatsApp staat vrije berichten alleen toe binnen 24 uur na het laatste bericht van de gebruiker. Daarbuiten mag alleen een goedgekeurde template, en templates kosten per bericht (controleer de actuele tarieven bij Meta). Daarom:

- **De ochtendtemplate is de deurbel.** Eén korte template met een knop. De tik van de gebruiker opent het venster, daarna gaat alles gratis en vrij.
- **Venster-bewuste planning.** `guardrails.ts` controleert per bericht of het venster open is (`users.last_inbound_at` < 24 uur). Bij een open venster gaat het bericht vrij uit. Bij een gesloten venster gaan alleen de vier templates uit; de rest wordt overgeslagen met `skip_reason = window_closed`.
- **De verbetermotor rijdt mee op het venster.** Suggesties gaan alleen uit binnen een open venster. Wie niet reageert, krijgt minder berichten. Dat verlaagt kosten en past bij principe 7.

### 9.3 Webhook

- `GET /webhooks/whatsapp` — verify-token-challenge (patroon uit `engagementRoutes.ts`).
- `POST /webhooks/whatsapp` — controleer `X-Hub-Signature-256` met `WHATSAPP_APP_SECRET` op de ruwe body; bij een ongeldige handtekening 401.
- Geef direct 200 terug en verwerk asynchroon.
- **Idempotentie:** schrijf elk inkomend bericht naar `messages` met `INSERT … ON CONFLICT (wa_message_id) DO NOTHING`. Bij een conflict: stoppen, want Meta levert soms dubbel.
- **Toegestane nummers:** in fase 1 alleen mijn eigen nummer, via `WHATSAPP_ALLOWED_NUMBERS` in `.env`. Meta levert het afzendernummer zonder plusteken aan (bijv. `316…`); normaliseer naar E.164 voordat je vergelijkt. Onbekende nummers worden gelogd en genegeerd.
- Statusupdates (`delivered`, `read`, `failed`) bijwerken op het bijbehorende uitgaande bericht.

### 9.4 Berichttypes

- **Tekst** — vrije invoer, naar de router.
- **Knoppen (interactive reply buttons)** — maximaal 3 per bericht, maximaal 20 tekens per knop. De standaard voor elke keuze.
- **Lijst (interactive list)** — maximaal 10 regels. Voor het afronden per taak, de weekreview en de ideeënbak.
- **Spraak** — media-ID ophalen via de Graph API, downloaden met de token, transcriberen, daarna dezelfde route als tekst. Transcript opslaan in `messages.transcript`.

### 9.5 Knop-ID-conventie

Knoppen worden afgehandeld zonder AI-aanroep: snel en goedkoop.

```
t:{taskId}:done | t:{taskId}:tomorrow | t:{taskId}:split | t:{taskId}:park | t:{taskId}:release | t:{taskId}:start
s:{suggestionId}:in_progress | s:{suggestionId}:later | s:{suggestionId}:done | s:{suggestionId}:not_relevant
f:show | f:dayoff | f:adjust
sess:{taskId}:done | sess:{taskId}:plus10 | sess:{taskId}:stuck
wr:{step}:{value}
```

---

## 10. Gesprekslaag

### 10.1 Stroom

1. Knop of lijstkeuze → `buttons.ts` handelt deterministisch af.
2. Staat `conversation_state.mode` op iets anders dan `idle` → de handler van die modus krijgt het bericht eerst (bijv. afronden, sessie).
3. Tekst of transcript → Claude (snel model) met tools en context. Claude kiest één of meer tools en schrijft het antwoord.
4. Antwoord uit met passende knoppen.

De router stelt maximaal één verduidelijkingsvraag. Is het project onduidelijk, dan gaat de taak naar *Losse taken* met de vraag waar hij hoort, met knoppen voor de drie meest waarschijnlijke projecten.

### 10.2 Tools

| Tool | Voorbeeldinvoer | Effect |
|---|---|---|
| `add_task` | "klant wil banner voor vrijdag" | taak onder het juiste project of de juiste klant, met deadline en schatting |
| `add_idea` | "idee: podcast over ADHD en ondernemen" | naar de ideeënbak; komt nooit direct in de focus |
| `set_task_status` | "offerte is de deur uit" | status bijwerken en kort vieren |
| `set_suggestion_status` | "die concurrenttip heb ik gedaan" | status bijwerken, afhechtlus bijwerken |
| `break_down` | "help me starten met de jaarplanning" | 3–5 microstappen, de eerste ≤ 10 minuten |
| `start_session` | "start" / "ik ga nu aan de offerte" | body-double-modus (11.4) |
| `snooze` | "doe ik donderdag" | `snoozed_until` |
| `log_note` | "klant belde, deadline wordt vrijdag" | notitie bij project, deadline bijwerken |
| `show_today` | "wat stond er ook alweer" | focuslijst met knoppen, plus de afspraken als de agenda gekoppeld is |
| `show_parking` | "parkeerplaats" | geparkeerde taken, max 10, met knoppen |
| `pause` | "laat me vandaag met rust" / "vakantie tot maandag" | `paused_until` |
| `update_settings` | "stuur 's ochtends pas om 9 uur" | instelling bijwerken en bevestigen |
| `connect_calendar` | "koppel agenda" | persoonlijke koppellink (11.8) |
| `disconnect_calendar` | "ontkoppel agenda" | toegang intrekken, tokens en afspraken verwijderen |
| `find_free_slot` | "wanneer heb ik vandaag een uur?" | eerste vrije blok van de gevraagde lengte, met een knop om daar een sessie te plannen |
| `overwhelm` | signalen van overbelasting | dag stilzetten (11.6) |

### 10.3 Context voor Claude

Maximaal ongeveer 3.000 tokens: instellingen, lokale datum en tijd, de focus van vandaag, de 10 belangrijkste open taken met id en projectnaam, open suggesties (max 3), namen van actieve klanten en projecten (om "de bakker" of "Boho" te herkennen), de laatste 12 berichten.

### 10.4 Modellen

Twee modellen via env:

- `CLAUDE_MODEL_FAST` — router, opknippen, korte antwoorden.
- `CLAUDE_MODEL_SMART` — ochtendbericht, verbetermotor, weekreview.

Gebruik tool use met een vast schema voor alles wat de database raakt. Log elke aanroep in `ai_usage`.

---

## 11. Proactieve laag

### 11.1 Scheduler

- `hyperfocus-worker` draait elke minuut een tick (node-cron).
- **Planner:** per gebruiker om 00:05 lokale tijd de berichten van de dag aanmaken in `scheduled_nudges`, omgerekend naar UTC met Luxon.
- **Verzender:** haalt berichten op met `scheduled_for_utc <= now()` en `status = pending` (`SELECT … FOR UPDATE SKIP LOCKED`), laat ze door `guardrails.ts` lopen, verstuurt of slaat over met reden.
- Tijdzones testen op `Asia/Makassar` (Bali, UTC+8) en `Europe/Amsterdam` inclusief zomertijdwissel. Ik verhuis tijdens het gebruik van Bali naar Nederland; een tijdzonewissel moet de planning van de volgende dag direct goed zetten.

### 11.2 Dagritme

| Moment | Standaard | Inhoud | Knoppen | Soort |
|---|---|---|---|---|
| Ochtend | 08:30 | deurbel, daarna focuslijst van max 3 | Laat zien · Vandaag vrij | template → vrij |
| Middag | 13:30 | alleen als de hoofdtaak nog niet gestart is: aanbod om samen te beginnen | Starten · Later | alleen binnen venster |
| Verbetermotor | om de dag, 10:30 | één suggestie, of eerst de afhechtvraag | Pak ik op · Later · Niet relevant | alleen binnen venster |
| Afronden | 16:00 | de dag afronden: wat is af, wat gaat naar morgen | Alles gedaan · Deels · Morgen verder | vrij of template |
| Weekreview | zondag 19:30 | drie korte stappen (11.7) | lijsten | template → vrij |
| Weekoverzicht | maandag 08:00 | wat is gedaan, focusproject, open suggesties | — | mail |

### 11.3 Focus samenstellen

- **Kandidaten:** taken met status `open` of `in_progress`, niet gesnoozed, uit actieve projecten.
- **Score:** deadline binnen 2 dagen +3 · `carry_over` +2 · project is weekfocus +2 · projectprioriteit +0 tot +2 · ouder dan 7 dagen +1.
- **Samenstelling:** één hoofdtaak (hoogste score), één snelle winst (≤ 10 minuten), een derde alleen als de totale geschatte tijd ≤ 3 uur blijft.
- **Grote hoofdtaak (> 60 min):** toon de eerste microstap, met de hele taak eronder. Bestaan er nog geen microstappen, dan maakt `break_down` ze aan.
- Taken zonder schatting krijgen bij het aanmaken een schatting van Claude (5/15/30/60/120).

### 11.4 Body-double-modus

1. *Start* → Hyper&Focus noemt één stap en plant een `session_checkin` na `session_minutes`.
2. Check-in: *"Hoe ging het?"* → Gedaan · Nog 10 min · Vastgelopen.
3. *Vastgelopen* → *"Waar zit het? Stuur een paar woorden of een spraakbericht, dan maken we de stap kleiner."*
4. Na drie sessies op één dag: een kort compliment en de vraag of het tijd is voor pauze.

### 11.5 Escalatieladder voor vastgelopen taken

Geldt voor taken in de focus of met een deadline. Maximaal één escalatiebericht per dag, over maximaal één taak.

| Niveau | Wanneer | Bericht | Knoppen |
|---|---|---|---|
| 1 | 2 dagen in focus zonder beweging | aanbod om op te knippen | Opknippen · Morgen |
| 2 | 4 dagen | "Blijft liggen. Vaak is hij dan te groot of te vaag. Wat helpt?" | Opknippen · Parkeren · Loslaten |
| 3 | 7 dagen | automatisch naar de parkeerplaats, met een kort bericht waar hij te vinden is | Terughalen |

### 11.6 Vangrails

- **Limiet:** maximaal `max_proactive_per_day` proactieve berichten (standaard 4). Sessie-check-ins en antwoorden op de gebruiker tellen niet mee.
- **Stille uren:** 21:00–08:00 lokale tijd.
- **Adem:** minimaal 45 minuten tussen twee proactieve berichten, sessie-check-ins uitgezonderd.
- **Pauze:** "pauze", "vrij tot maandag", "vakantie" → `paused_until`. Tijdens een pauze alleen een bericht op de dag van terugkeer.
- **Terugtrekken bij stilte:** 2 dagen geen reactie → alleen nog de ochtend · 4 dagen → stil · dag 7 → één `herstart`-template · daarna stilte tot de gebruiker zelf schrijft.
- **Zachte herstart:** het eerste bericht na ≥ 3 dagen stilte krijgt een welkom terug en één kleinste taak. Taken die ≥ 14 dagen stilstonden gaan naar de parkeerplaats. De lijst van open werk verschijnt alleen op verzoek.
- **Overbelasting:** herkent de router signalen van overbelasting ("ik trek het niet", "alles loopt vast", "te veel"), dan zet `overwhelm` de dag stil, reageert Hyper&Focus met begrip en stuurt de volgende dag maximaal één bericht.
- **Crisis:** bij signalen van wanhoop of zelfbeschadiging stopt Hyper&Focus alle productiviteitsberichten, reageert met zorg en verwijst naar 113 Zelfmoordpreventie (bel 113 of gratis 0800-0113, of chat via 113.nl) en de huisarts. Het gesprek krijgt een markering voor handmatige opvolging.

### 11.7 Ideeënbak en weekreview

- Elk idee gaat naar `ideas` met een korte bevestiging: *"Staat in je ideeënbak. Zondag kijken we ernaar."* Ideeën komen nooit direct in de focus. Zo kan je hoofd het loslaten zonder dat het je dag kaapt.
- **Weekreview** (drie stappen, elk één tik of een paar woorden):
  1. *"Deze week af: [3 dingen]. Wat ging goed?"*
  2. *"Welk project krijgt volgende week voorrang?"* (lijst van actieve projecten → `is_weekly_focus`)
  3. *"In je ideeënbak staan 6 ideeën. Eén promoveren tot project, of laten staan?"* (lijst, maximaal één promotie per week)
- **Weekoverzicht per mail** op maandag: wat is gedaan, het focusproject, open suggesties. Alleen informerend.

### 11.8 Agendakoppeling (optioneel)

Standaard uit. De gebruiker zet hem aan in de instellingen of met het bericht *"koppel agenda"*. Hyper&Focus stuurt dan een persoonlijke koppellink: 15 minuten geldig, met de gebruiker ondertekend in de `state`-parameter. *"Ontkoppel agenda"* trekt de toegang in bij Google en verwijdert tokens en opgeslagen afspraken. Zonder koppeling werkt alles zoals in 11.1–11.7.

**Wat de koppeling toevoegt**

1. **Focus die past bij de dag.** De planner rekent de vrije tijd uit tussen `morning_time` en `wrapup_time`, min de afspraken. Past de geschatte tijd van de focus niet, dan vervalt eerst de derde taak. Is er dan nog te weinig ruimte, dan wordt de hoofdtaak teruggebracht tot de eerste microstap. Het ochtendbericht vat de dag samen in één regel: *"Twee afspraken vandaag, de eerste om 10:00. Tussen 13:00 en 15:00 heb je ruimte."*
2. **Berichten wachten tot je vrij bent.** Valt een proactief bericht in een afspraak, dan schuift het naar direct na die afspraak. Lukt dat niet binnen 90 minuten, dan vervalt het met `skip_reason = in_meeting`. Sessie-check-ins schuiven mee.
3. **Een sessie in een vrij blok.** De middag-check-in zoekt het eerste vrije blok van minimaal 30 minuten: *"Om 14:00 heb je een vrij uur. Zullen we dan de offerte doen?"* [Ja, om 14:00] [Nu] [Later].
4. **Overgangen.** Tien minuten voor een afspraak die aan een klant of project gekoppeld is, volgt een korte heads-up met de open punten: *"Om 11:00 bel je met Bakkerij De Vries. Open: offerte, banner."*
5. **Na de afspraak.** Direct na een gekoppelde afspraak, binnen het venster: *"Hoe ging het met Bakkerij De Vries? Stuur een spraakbericht met de actiepunten, dan zet ik ze klaar."* De actiepunten worden taken onder die klant.

Heads-ups en nabesprekingen hebben een eigen limiet: maximaal `max_calendar_nudges_per_day` (standaard 2), alleen voor gekoppelde afspraken, en ze volgen de stille uren en de pauze.

**Afspraak koppelen aan een klant.** Eerst een naamvergelijking van de afspraaktitel met klant- en projectnamen (`pg_trgm`). Alleen bij twijfel volgt een aanroep van het snelle model. De gebruiker corrigeert een koppeling met één bericht.

**Wat telt als bezet**
- Afspraken met begin- en eindtijd en de status *bezet*.
- Hele-dag-afspraken en afspraken op *beschikbaar* laten de tijd vrij; hele-dag-afspraken noemt het ochtendbericht wel.
- Afgeslagen uitnodigingen tellen niet mee.

**Techniek**
- Google Agenda-API met OAuth 2.0 en refresh token, scope `calendar.readonly`. Oogst `server/services/googleOAuthService.ts`.
- De planner haalt om 00:05 vandaag en morgen op; de worker ververst elke 15 minuten met een `syncToken`. Terugkerende afspraken uitgevouwen ophalen (`singleEvents`).
- Afspraken in UTC opslaan, tonen in de tijdzone van de gebruiker.
- Mislukt de synchronisatie, dan plant de planner zoals zonder agenda en meldt dat één keer per dag in het afrondbericht.
- `CalendarProvider`-interface (`listEvents`, `revoke`), zodat Outlook en een ICS-link in fase 3 kunnen aansluiten.
- Google Cloud: zet het OAuth-toestemmingsscherm op *In productie*, ook voor eigen gebruik. In testmodus verlopen refresh tokens na 7 dagen en moet je elke week opnieuw koppelen.

**Later** (naar `docs/later.md`): een focusblok met één tik in de agenda zetten. Dat vraagt schrijfrechten en wordt een aparte toestemming.

---

## 12. Verbetermotor

### 12.1 Bedrijfsintake

1. De gebruiker stuurt de website-URL.
2. `research/website.ts` scant de site.
3. Claude vult een slank profiel: wat het bedrijf doet, voor wie, aanbod, prijsindicatie, concurrenten die het tegenkomt.
4. De gebruiker bevestigt in drie knopvragen: doelgroep klopt? aanbod klopt? dit zijn je drie concurrenten? Aanpassen kan met een paar woorden.
5. Eén focusbedrijf tegelijk (`is_focus`). Wisselen gaat met een commando.

### 12.2 Onderzoekslaag

- Wekelijkse job per focusbedrijf, resultaat in `research_cache` (7 dagen geldig).
- Bronnen: eigen site (wijzigingen), sites van concurrenten (nieuwe pagina's, aanbiedingen, prijzen), Nederlands sectornieuws (`SectorNewsService`), en webonderzoek via een `ResearchProvider`.
- `ResearchProvider` heeft twee implementaties. **Standaard: Claude met de web-search-tool** (één leverancier, één rekening, en hetzelfde model onderzoekt en schrijft). De geoogste `PerplexityService` blijft schakelbaar via `RESEARCH_PROVIDER`.
- Maximaal één volledige onderzoeksrun per bedrijf per week; losse verversing alleen bij een lege cache. Log alles in `ai_usage`.

### 12.3 Lenzen (fase 2)

| Lens | De vraag van de lens | Invoer | Voorbeeldsuggestie |
|---|---|---|---|
| Doelgroep | Wat wil je klant weten dat nu ontbreekt? | profiel, persona's, site | "Zet de drie vragen die je het vaakst krijgt boven je offerteknop." |
| Concurrent | Wat doet een concurrent dat jij sneller of beter kunt? | concurrentscans | "Concurrent X biedt sinds kort een gratis kennismaking aan. Zet een knop 'Plan een kennismaking' boven de vouw." |
| Funnel | Waar lekt je funnel? | mijn 42 vragen uit de Roast My Funnel-checklijst, één per keer, getoetst aan de sitescan | "Je knop zegt 'Verstuur'. Maak er 'Plan mijn gratis kennismaking' van." |
| DESTEP (6 sublenzen, roterend) | Welke verandering buiten je bedrijf kun je deze week benutten? | sectornieuws, webonderzoek | "Nieuwe regeling voor zzp'ers: zet één alinea op je dienstenpagina die uitlegt wat het voor je klant betekent." |

**Prioriteit:** Doelgroep, Concurrent en Funnel eerst. DESTEP heeft de laagste prioriteit: je bouwt hem als laatste en hij komt maximaal één keer per vier suggesties aan de beurt.

Later: SWOT-synthese (maandelijks), Aanbod & prijs, Klantbehoud, Zichtbaarheid, Tijdwinst & automatisering. Elke lens is een module met dezelfde interface: `gatherInputs(business)`, `promptFile`, `isAvailable(cache)`.

### 12.4 Selectie en rotatie

1. Beschikbare lenzen: aan in de instellingen én met verse onderzoeksdata.
2. Sluit de lens van de vorige suggestie uit.
3. Kies met de geoogste bandit: epsilon 0,2, koude start bij minder dan 3 vertoningen per lens. Beloning: gedaan 1 · mee bezig 0,6 · geparkeerd 0,2 · overgeslagen en niet relevant 0.
4. DESTEP: maximaal één keer per vier suggesties; kies dan de minst recent gebruikte sublens.
5. Genereer met `CLAUDE_MODEL_SMART` via tool use met het schema uit 12.6. Invoer: profiel, onderzoek, actieve projecten, doelen, de laatste 15 suggesties met status.
6. Dubbelcheck: vergelijk de genormaliseerde titel met eerdere suggesties (`pg_trgm`, gelijkenis > 0,6 → één keer opnieuw genereren).

### 12.5 De afhechtlus

Vóór elke nieuwe suggestie gelden deze regels, in volgorde:

- **R1 — Eerst terugvragen.** Heeft de vorige suggestie nog geen reactie, dan gaat eerst de vraag *"Eergisteren tipte ik je [titel]. Hoe staat het?"* uit (Gedaan · Mee bezig · Laat maar). Na 48 uur zonder reactie krijgt die suggestie automatisch de status `parked`.
- **R2 — Opruimmoment.** Staan er 3 of meer suggesties op `new`, `in_progress` of `parked`, dan komt er een opruimmoment in plaats van iets nieuws: een lijst met Gedaan · Wegstrepen · Nog mee bezig per suggestie.
- **R3 — Drukte telt mee.** Staan er 2 of meer focustaken van gisteren nog open, is de gebruiker gepauzeerd of zit de dag in overbelastingsmodus, dan slaat de verbetermotor vandaag over.
- **R4 — De draad vasthouden.** Na een suggestie met status `done` krijgt de volgende de voorkeur om daarop voort te bouwen (`builds_on_suggestion_id`), of op een actief doel of project. Zo ontstaat samenhang in plaats van losse ideeën.

### 12.6 Kwaliteitseisen en uitvoerschema

Elke suggestie:

- is specifiek voor dit bedrijf, met een verwijzing naar de bron;
- heeft één actie, uitvoerbaar in 5–30 minuten, beginnend met een werkwoord;
- herhaalt niets uit de geschiedenis;
- levert een concept mee als de actie schrijfwerk is (tekst, mail, post, knoptekst). Hyper&Focus is ook assistent: het werk ligt klaar.

```json
{
  "lens": "competitor",
  "sub_lens": null,
  "title": "maximaal 8 woorden",
  "why": "één zin, met verwijzing naar de bron",
  "action": "één concrete stap, begint met een werkwoord",
  "estimated_minutes": 20,
  "asset": { "type": "tekst | mail | post | checklist", "content": "…" },
  "builds_on_suggestion_id": null,
  "sources": ["https://…"]
}
```

In WhatsApp maximaal 600 tekens. Een lang concept komt als apart bericht, of in fase 2 als link naar de web-UI.

### 12.7 Feedback

- Knoppen onder elke suggestie: Pak ik op · Later · Niet relevant.
- *Niet relevant* → één optionele lijstvraag: Past niet bij mijn bedrijf · Heb ik al · Te groot · Andere reden. De reden gaat mee in de volgende prompt.
- Alle statuswijzigingen voeden de bandit en de events voor de verkooppoort.

---

## 13. Toon en teksten

### Regels

- Kort: ochtend ≤ 400 tekens, suggestie ≤ 600, overige berichten ≤ 300.
- Je-vorm, spreektaal, actieve zinnen.
- Maximaal één emoji per bericht, alleen als markering (💡 bij een suggestie, ✔ bij gedaan).
- Elk bericht eindigt met knoppen of met één vraag.
- Vier afgerond werk kort en concreet.
- Benoem open werk neutraal: *"staat nog open"*.
- Woorden die Hyper&Focus weglaat: achterstand, te laat, vergeten, alweer, nog steeds, je moet, je had.

### Voorbeeldberichten

**Ochtend (template)**
> Goedemorgen Elmer. Je focus voor vandaag staat klaar.
> [Laat zien] [Vandaag vrij]

**Focuslijst**
> Vandaag, in deze volgorde:
> 1. Offerte bakkerij afmaken · 45 min
> 2. Onderwerpregels nieuwsbrief kiezen · 15 min
> 3. Factuur september versturen · 5 min
> Beginnen met de factuur? Een snelle winst om op te warmen.
> [Start factuur] [Start offerte] [Aanpassen]

**Sessie**
> Top. Eén stap: open het offertebestand en schrijf de eerste alinea. Ik check over 25 minuten bij je.

**Afronden (16:00)**
> Tijd om de dag af te ronden. Twee van de drie zijn af: de factuur en de onderwerpregels ✔ Wat doen we met de offerte?
> [Morgen verder] [Opknippen] [Parkeren]

**Verbetermotor**
> 💡 Concurrent · 20 min
> Bakkerij Jansen biedt sinds deze maand een gratis proeverij aan.
> Waarom: bezoekers vergelijken, en jouw site vraagt nu meteen om een bestelling.
> Doe dit: zet een knop "Kom proeven" bovenaan je homepage.
> Ik heb de knoptekst en een korte alinea alvast geschreven.
> [Pak ik op] [Later] [Niet relevant]

**Afhechtvraag**
> Eergisteren tipte ik je die proeverij-knop. Hoe staat het?
> [Gedaan] [Mee bezig] [Laat maar]

**Escalatie niveau 3**
> Ik heb de offerte in je parkeerplaats gezet. Dan hoeft hij niet meer door je hoofd te spoken. Je haalt hem terug met "parkeerplaats".

**Zachte herstart**
> Welkom terug. Ik heb alles even stilgezet. Eén ding om mee te beginnen: de factuur versturen, 5 minuten. Zullen we?
> [Ja] [Morgen]

**Overbelasting**
> Dank dat je het zegt. Ik zet vandaag alles stil. Morgen om 9 uur stuur ik één bericht.

### Skelet systeemprompt (`prompts/systeem.nl.md`)

```
Je bent Hyper&Focus, de projectmanager en assistent van {naam}. {naam} is ondernemer ({bedrijf}). Je werkt via WhatsApp.

Je doel: {naam} elke dag laten beginnen aan wat telt, met zo min mogelijk denkwerk.

Werkwijze:
- Toon maximaal drie dingen tegelijk.
- Geef bij elke taak de kleinste volgende stap (5 tot 15 minuten), beginnend met een werkwoord.
- Schrijf kort, warm en direct, in de je-vorm. Maximaal één emoji.
- Vier voortgang concreet. Benoem open werk neutraal.
- Stel maximaal één vraag per bericht.
- Werk taken, ideeën en statussen bij via de tools. Verzin geen taken of feiten.
- Bij signalen van overbelasting: gebruik de tool overwhelm en stel niets nieuws voor.
- Bij signalen van wanhoop of zelfbeschadiging: stop met taken, reageer met zorg en verwijs naar 113 (bel 113 of gratis 0800-0113, of chat via 113.nl) en de huisarts.

Lokale tijd: {lokale_tijd} ({tijdzone})
Context:
{context}
```

---

## 14. Veiligheid, privacy en welzijn

**Techniek**
- Handtekeningcontrole op de webhook, toegestane nummers in fase 1, secrets alleen in `.env` (nooit in de repo), agendatokens (stap 1.8) en tokens van gebruikers (fase 3) versleuteld opslaan (`crypto.ts`).
- Nachtelijke `pg_dump` naar externe opslag.
- VPS: eigen gebruiker met sudo in plaats van root, inloggen met SSH-sleutel, wachtwoord- en rootlogin uit, firewall alleen open op 22, 80 en 443, PostgreSQL alleen lokaal bereikbaar, snapshot vóór grote wijzigingen. Claude Code op de VPS draait naast de productiesleutels: laat de toestemmingsvragen aan staan.

**AVG**
- Minimale data. Geen diagnose vragen of opslaan: het product werkt zonder.
- Verwerkersovereenkomsten met Anthropic, Meta, OpenAI, SendGrid, Hostinger en, bij een gekoppelde agenda, Google. Hosting in de EU.
- Commando's *"exporteer mijn gegevens"* en *"verwijder mijn gegevens"*, plus dezelfde knoppen in de web-UI (fase 2).
- **Bewaartermijn:** berichten, inclusief transcripties, worden na 30 dagen verwijderd door een nachtelijke job in de worker. Spraakopnames worden direct na transcriptie verwijderd en nooit opgeslagen. Taken, projecten, ideeën en suggesties blijven bestaan tot de gebruiker ze verwijdert. `events`, `ai_usage` en `wa_usage` bevatten alleen metadata zonder berichtinhoud en blijven 12 maanden bewaard; die zijn nodig voor de verkooppoort en de kostenmeting.
- **Agenda:** alleen de velden uit `calendar_events`, alleen voor vandaag en morgen; een nachtelijke job ruimt oudere afspraken op. Deelnemers, beschrijvingen en locaties van afspraken halen we nooit op.

**Welzijn**
- Overbelasting en crisis zoals beschreven in 11.6.

**Positionering**
- Hyper&Focus is een businesstool voor ondernemers met een ADHD-brein. Maak geen claims over het behandelen of verminderen van ADHD-symptomen: software met een medisch doel kan onder de Europese regels voor medische hulpmiddelen vallen. Laat de marketingteksten in fase 3 juridisch toetsen.

---

## 15. Testen

- **Unit (Vitest):** knop-ID-parser, vangrails, tijdzones (`Asia/Makassar` en `Europe/Amsterdam`, inclusief zomertijdwissel en een tijdzonewissel van de gebruiker), focussamenstelling, escalatieladder, afhechtregels R1–R4, lensselectie met koude start, idempotentie van de webhook.
- **Evaluatieset (`npm run eval`):** 50 echte Nederlandse voorbeeldberichten met de verwachte tool-aanroep. Inclusief typefouten, spraaktranscripties, mix van Nederlands en Engels, klantnamen, "done", "doe ik morgen", overbelastingszinnen. Doel: ≥ 90% correct.
- **Agenda:** vrije-tijdberekening, hele-dag- en afgeslagen afspraken, verschuiven van berichten, tijdzones, gedrag bij een mislukte synchronisatie. Gebruik een nep-`CalendarProvider` met vaste afspraken.
- **Simulator (`npm run sim`):** terminal-chat door dezelfde router als WhatsApp. In development gaan uitgaande berichten naar de console.
- **Dagsimulatie (`npm run sim:day -- --date 2026-10-06`):** speelt de planning van een dag versneld af, inclusief vangrails.
- **Webhooktests** met opgenomen Meta-payloads: tekst, knop, lijst, audio, status, dubbele levering, ongeldige handtekening.

---

## 16. Bouwvolgorde met Definition of Done

### Fase 0 — Fundament

**0.1 Beveiliging bronrepo (door mij, vandaag).** Repo `Publicato-personal` terug op privé, gelekte sleutels intrekken en vernieuwen, cookiebestanden en `attached_assets` verwijderen.
*Klaar als:* repo privé, alle gevonden sleutels vernieuwd.

**0.2 Nieuwe repo.** `hyperfocus` met TypeScript strict, ESLint, Vitest, zod-env, `.env.example`, `.gitignore` (inclusief `*.local.ts`, `.env`, cookiebestanden).
*Klaar als:* `npm run dev` en `npm test` draaien.

**0.3 Oogsten.** Alles uit hoofdstuk 6 "Overnemen en aanpassen" dat bij fase 0 en 1 hoort.
*Klaar als:* elk geoogst bestand compileert zonder verwijzingen naar achtergelaten code.

**0.4 Database.** `node-postgres`-client, schema uit hoofdstuk 8, migraties, seed.
*Klaar als:* migraties draaien schoon op een lege database en de seed laadt.

**0.5 Simulator.** `npm run sim` met een eenvoudige router.
*Klaar als:* ik in de terminal een bericht stuur en antwoord krijg.

### Fase 1 — Kern

**1.1 WhatsApp in en uit** (9.3–9.5). Maak bij deze stap de VPS aan (zie 5 en 14), met domein, HTTPS en de webhook-URL.
*Klaar als:* een bericht aan het botnummer binnen 3 seconden antwoord krijgt · dubbele levering leidt tot één verwerking · een ongeldige handtekening geeft 401 · een onbekend nummer wordt genegeerd en gelogd.

**1.2 Gesprekslaag met tools** (hoofdstuk 10).
*Klaar als:* de evaluatieset ≥ 90% haalt · knoppen werken zonder AI-aanroep · een taak over een klant komt onder het juiste project terecht.

**1.3 Dagritme en templates** (11.1–11.3).
*Klaar als:* de templates zijn goedgekeurd · ochtend en afronden komen op lokale tijd aan in beide testtijdzones · de focus telt maximaal drie taken met één snelle winst · bij een gesloten venster gaan alleen templates uit.

**1.4 Opknippen en body-double** (11.4, tool `break_down`).
*Klaar als:* "help me starten met X" 3–5 stappen oplevert met een eerste stap van ≤ 10 minuten · de check-in na de ingestelde minuten komt.

**1.5 Vangrails, escalatieladder, herstart, overbelasting** (11.5–11.6).
*Klaar als:* alle unit tests groen zijn · een dagsimulatie van 7 dagen stilte precies het afgesproken berichtenpatroon oplevert · een overbelastingszin de dag stilzet.

**1.6 Spraakberichten** (9.4).
*Klaar als:* een spraakbericht van 30 seconden binnen 8 seconden een taak of idee oplevert, met transcript opgeslagen en de audio verwijderd.

**1.7 Ideeënbak, weekreview, weekoverzicht** (11.7).
*Klaar als:* ideeën nooit in de focus verschijnen · de weekreview in maximaal drie tikken klaar is · de maandagmail binnenkomt.

→ **Start eigen gebruik.** Vanaf hier gebruik ik Hyper&Focus dagelijks. De verkooppoort-meting (hoofdstuk 3) loopt vanaf dit moment.

**1.8 Agendakoppeling, optioneel** (11.8). Bouw je in de eerste week van eigen gebruik.
*Klaar als:* met de agenda uit alles werkt zoals na 1.7 · een proactief bericht tijdens een afspraak direct erna komt · een dag met vijf uur afspraken maximaal twee focustaken telt · een klantafspraak tien minuten vooraf een heads-up met open punten geeft · *"ontkoppel agenda"* de toegang intrekt en tokens en afspraken verwijdert.

### Fase 2 — Verbetermotor en web

**2.1 Bedrijfsintake** (12.1).
*Klaar als:* een website-URL binnen 2 minuten een profiel oplevert dat ik met drie tikken bevestig.

**2.2 Onderzoekslaag** (12.2).
*Klaar als:* de wekelijkse job de cache vult voor alle vier de lenzen en de kosten in `ai_usage` staan.

**2.3 Vier lenzen** (12.3), in deze volgorde: Doelgroep, Concurrent, Funnel, DESTEP.
*Klaar als:* elke lens drie opeenvolgende suggesties levert die voldoen aan 12.6, zonder herhaling.

**2.4 Selectie en afhechtlus** (12.4–12.5).
*Klaar als:* unit tests voor R1–R4 groen zijn · de bandit na de koude start aantoonbaar vaker de lenzen kiest die ik oppak · suggesties alleen binnen een open venster uitgaan.

**2.5 Feedback** (12.7).
*Klaar als:* elke knop de juiste status zet en *Niet relevant* de reden meeneemt in de volgende generatie.

**2.6 Minimale web-UI.** Magic-link login. Schermen: Vandaag · Projecten & klanten · Parkeerplaats & ideeënbak · Suggesties (met concepten) · Instellingen. Mobile-first. Laat grafieken en statistieken weg.
*Klaar als:* ik alles uit WhatsApp ook op mijn telefoon in de browser kan bekijken en bijwerken, en instellingen direct effect hebben op de planning.

### Fase 3 — Verkoopklaar (na de verkooppoort)

**3.1 Accounts.** Meerdere gebruikers volledig gescheiden; tenant-laag voorbereiden voor white-label.
**3.2 Onboarding en opt-in.** Aanmelden via een webformulier met toestemming, daarna een wa.me-link waarmee de gebruiker zelf het eerste bericht stuurt. Intake in WhatsApp binnen 5 minuten: naam, woonplaats (→ tijdzone), ritmetijden, focusbedrijf met website, drie lopende projecten.
**3.3 Abonnement.** Mollie-abonnementen uit de geoogste code. Prijs **€26,88 per maand**, met een **proefmaand**. De machtiging leg je vast met een eerste betaling bij de start; het abonnement krijgt als startdatum het einde van de proefmaand. Drie dagen voor het einde van de proefmaand stuurt Hyper&Focus een WhatsApp-bericht met *Doorgaan · Stoppen*, zodat niemand ongemerkt gaat betalen.
**3.4 AVG-pakket.** Privacyverklaring, verwerkersovereenkomsten, export en verwijderen, bewaartermijnen.
**3.5 Kosten per gebruiker.** Rapport uit `ai_usage` en `wa_usage`: gemiddelde maandkosten per actieve gebruiker, afgezet tegen €26,88, inclusief de kosten van proefgebruikers die niet doorgaan.
**3.6 Beta.** 10 ondernemers, 4 weken. Meet dag-14- en dag-30-retentie (reageert nog op minimaal 3 dagen per week).
**3.7 Positionering en mijn verhaal.** Landingspagina met mijn eigen verhaal als ondernemer met een ADHD-brein, juridisch getoetste teksten (hoofdstuk 14).
**3.8 Optioneel: white-label** voor ADHD-coaches en businesscoaches, op basis van de tenant-branding uit Publicato.
**3.9 Meer agenda's.** Outlook via Microsoft Graph en een ICS-link voor overige agenda's. Vraag vóór de beta Google-verificatie aan voor de agenda-scope; daarvoor zijn een privacyverklaring en domeinverificatie nodig, en de beoordeling kost tijd.

---

## 17. Omgevingsvariabelen

```
# Algemeen
NODE_ENV=development
APP_BASE_URL=https://hyperfocus.example.nl
DATABASE_URL=postgres://…
DEFAULT_TIMEZONE=Europe/Amsterdam

# Claude
ANTHROPIC_API_KEY=
CLAUDE_MODEL_FAST=claude-haiku-4-5-20251001
CLAUDE_MODEL_SMART=claude-sonnet-5-5

# Transcriptie
OPENAI_API_KEY=
TRANSCRIBE_MODEL=

# WhatsApp
WHATSAPP_GRAPH_VERSION=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ALLOWED_NUMBERS=+316…        # fase 1: alleen mijn eigen nummer

# Mail
SENDGRID_API_KEY=
EMAIL_FROM=hyperfocus@…

# Onderzoek
RESEARCH_PROVIDER=claude        # standaard; perplexity als alternatief
PERPLEXITY_API_KEY=

# Agenda (optioneel)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://hyperfocus.example.nl/auth/google/callback

# Fase 3
MOLLIE_API_KEY=
ENCRYPTION_KEY=
```

Controleer bij de start van de bouw de actuele modelnamen in de documentatie van Anthropic en de actuele Graph API-versie bij Meta.

---

## 18. Beslissingen

### Vastgelegd

| # | Onderwerp | Besluit |
|---|---|---|
| 1 | Naam | **Hyper&Focus** (technische naam `hyperfocus`) |
| 2 | Dagritme | 08:30 ochtend · 13:30 middag · 16:00 afronden · zondag 19:30 weekreview |
| 3 | Frequentie verbetermotor | om de dag |
| 4 | Lenzen fase 2 | Doelgroep, Concurrent, Funnel, DESTEP (laagste prioriteit) |
| 5 | Onderzoeksprovider | Claude met web search; Perplexity schakelbaar |
| 6 | Toegestaan nummer fase 1 | mijn eigen nummer, in `.env` |
| 7 | Bewaartermijn berichten | 30 dagen |
| 8 | Prijs | €26,88 per maand, proefmaand van 1 maand |
| 9 | Agenda | optioneel en standaard uit; Google Agenda eerst, alleen lezen |

### Nog open

1. Het WhatsApp-nummer voor de bot (apart van mijn eigen nummer).
2. Is €26,88 inclusief of exclusief btw?
3. Merk- en domeincheck voor Hyper&Focus vóór fase 3.
4. Welke agenda's tellen mee: alleen je hoofdagenda, of ook gedeelde agenda's?

---

*Bouwplan v1.2 — ik lees dit zelf na en pas aan waar nodig.*
