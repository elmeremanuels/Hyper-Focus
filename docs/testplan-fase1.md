# Testplan fase 1 (stap 1.2 t/m 1.8)

Elke stap staat in een eigen pull request, gestapeld op de vorige:

| Stap | PR | Basis |
|---|---|---|
| 1.2 Gesprekslaag | #7 | `main` |
| 1.3 Dagritme | #8 | `stap-1.2` |
| 1.4 Opknippen en body-double | #9 | `stap-1.3` |
| 1.5 Vangrails | #10 | `stap-1.4` |
| 1.6 Spraak | #11 | `stap-1.5` |
| 1.7 Weekreview | #12 | `stap-1.6` |
| 1.8 Agenda | #13 | `stap-1.7` |

## Werkwijze: één stap per keer

Zet de stappen één voor één live en test elke stap voordat je de volgende merget. Dan weet je bij een fout welke stap hem veroorzaakt, en terugdraaien raakt maar één stap.

Per stap:

1. Merge de PR naar `main`. Zet daarna in GitHub de volgende PR op basis `main` (*Edit* → *base*).
2. Op de VPS, als `app`:
   ```
   sudo -iu app
   cd ~/hyperfocus
   git pull
   npm ci
   npm run build
   npm run db:migrate
   pm2 restart hyperfocus
   ```
   Draait de worker al (vanaf 1.3), dan ook `pm2 restart hyperfocus-worker`.
3. Doe de live-checks van die stap (hieronder). Noteer per check ✔ of ✗ in `docs/voortgang.md`.
4. Lukt een check niet: stuur mij de regel uit `pm2 logs hyperfocus --lines 50` (of `hyperfocus-worker`) en wat je deed. Merge de volgende stap pas als deze werkt.

Tip: maak vóór stap 1.3 en vóór stap 1.8 een snapshot van de VPS bij Hostinger. Dat zijn de twee stappen met de meeste nieuwe onderdelen.

## Wat de automatische tests al dekken

`npm test` met `TEST_DATABASE_URL` draait 238 tests tegen een echte PostgreSQL, met nep-Telegram, nep-Brevo, nep-Claude, nep-transcriptie en een nep-agenda. Die tests bewijzen dat de logica klopt. De live-checks hieronder bewijzen dat de echte diensten meedoen: Claude, Telegram, Brevo, OpenAI en de agenda's.

Draai op de VPS ook één keer de tests, zonder database:

```
npm test
```

Verwacht: alles groen; de databasetests worden overgeslagen.

---

## 1.2 Gesprekslaag met tools

**Automatisch:** `tests/conversation-units.test.ts`, `tests/conversation.integration.test.ts`, `tests/channels.integration.test.ts`.

**Vooraf in `.env`:** `ANTHROPIC_API_KEY`, `CLAUDE_MODEL_FAST=claude-haiku-4-5-20251001`, `CLAUDE_MODEL_SMART=claude-opus-5-5`.

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Evaluatieset | `npm run eval` | ≥ 90% (exit 0). Bij minder: stuur mij de lijst met ✗ |
| 2 | Knop zonder AI | tik *Laat zien* | focuslijst; in `ai_usage` geen nieuwe rij |
| 3 | Taak bij klant | "bakkerij wil een banner voor vrijdag" (met een klant uit je eigen data) | taak onder het project van die klant, met deadline |
| 4 | Onduidelijke taak | "iets regelen voor de administratie" | taak in *Losse taken* met drie projectknoppen; een tik verplaatst hem |
| 5 | Idee | "idee: podcast over ondernemen" | "Staat in je ideeënbak. Zondag kijken we ernaar." |
| 6 | Klaar | "factuur is verstuurd" | taak op af, korte felicitatie |
| 7 | Overbelasting | "ik trek het niet meer" | vaste tekst; `paused_until` is morgen 00:00 |
| 8 | Kosten | `select purpose, model, sum(input_tokens), sum(output_tokens) from ai_usage group by 1,2;` | rijen met `router` en het Haiku-model |

## 1.3 Dagritme

**Automatisch:** `tests/focus.test.ts`, `tests/proactive.integration.test.ts`.

**Vooraf:** `pm2 start dist/worker.js --name hyperfocus-worker && pm2 save`.

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Worker draait | `pm2 logs hyperfocus-worker` | "hyperfocus-worker started" |
| 2 | Planning | de volgende ochtend: `select kind, scheduled_for_utc, status from scheduled_nudges order by id desc limit 5;` | ochtend, middag en afronden op jouw lokale tijden, omgerekend naar UTC |
| 3 | Ochtend | 08:30 | "Goedemorgen …" met *Laat zien · Vandaag vrij* |
| 4 | Focus | tik *Laat zien* | maximaal drie taken, één snelle winst |
| 5 | Afronden | 16:00 | afrondbericht met knoppen |
| 6 | Mail bij geblokkeerde bot | blokkeer de bot in Telegram, wacht op het volgende bericht, deblokkeer daarna | het bericht komt per mail |
| 7 | Tijdzone | `update users set timezone='Asia/Makassar' where id=…;` en de dag erna terug | planning volgt de nieuwe tijdzone vanaf de volgende dag |

## 1.4 Opknippen en body-double

**Automatisch:** `tests/session.integration.test.ts`.

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Opknippen | "help me starten met de jaarplanning" | 3–5 stappen, de eerste 5 minuten, knop *Start stap 1* |
| 2 | Sessie | tik *Start* | "Top. Eén stap: … Ik check over 25 minuten bij je." |
| 3 | Check-in | wacht 25 minuten | "Hoe ging het met …?" met *Gedaan · Nog 10 min · Vastgelopen* |
| 4 | Vastgelopen | tik *Vastgelopen*, stuur "ik weet niet hoe ik moet beginnen" | kleinere stappen en een nieuwe sessie |
| 5 | Drie sessies | rond drie sessies af op één dag | compliment en de vraag of het tijd is voor pauze |

## 1.5 Vangrails, escalatie, herstart, overbelasting

**Automatisch:** `tests/guardrails.test.ts`, `tests/wellbeing.integration.test.ts`.

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Dagsimulatie | `npm run sim:day -- --date <volgende maandag> --days 8 --silent` | dag 1 normaal · dag 2 alleen ochtend · dag 3 welkom terug · dag 4–6 niets · dag 7 herstart in Telegram én mail · dag 8 niets. Er wordt niets opgeslagen of verstuurd |
| 2 | Actieve week | dezelfde simulatie zonder `--silent` | maximaal 4 berichten per dag, escalaties niveau 1 → 2 → 3 |
| 3 | Stille uren | `select kind, skip_reason from scheduled_nudges where status='skipped' order by id desc limit 10;` na een paar dagen | redenen zoals `main_task_started`, nooit een bericht tussen 21:00 en 08:00 |
| 4 | Crisis (alleen als je dit wilt testen) | "ik wil er niet meer zijn" | zorgzame tekst met 113 en de huisarts; `users.status = 'paused'`; daarna terugzetten met `update users set status='active' where id=…;` |

## 1.6 Spraakberichten

**Automatisch:** `tests/telegram-processor.test.ts`, `tests/voice.integration.test.ts`.

**Vooraf in `.env`:** `OPENAI_API_KEY`, `TRANSCRIBE_MODEL` (bijvoorbeeld `gpt-4o-mini-transcribe`).

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Spraak → taak | spreek 30 seconden in: een taak voor een klant | binnen 8 seconden een bevestiging; taak onder de klant met bron `voice` |
| 2 | Transcript, geen audio | `select type, body, transcript from messages where type='audio' order by id desc limit 1;` | `body` leeg, `transcript` gevuld; op de VPS staat geen audiobestand (`ls /tmp`) |
| 3 | Te lang | spraakbericht van meer dan 5 minuten | vraag om kortere stukken |

## 1.7 Ideeënbak, weekreview, weekoverzicht

**Automatisch:** `tests/review.integration.test.ts`.

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Ideeën buiten de focus | voeg drie ideeën toe, kijk de volgende ochtend | geen idee in de focus |
| 2 | Weekreview | stuur "weekreview" (of wacht tot zondag 19:30) | drie tikken: wat ging goed → focusproject → idee promoveren; daarna "De weekreview is klaar" |
| 3 | Maandagmail | maandag 08:00 | mail "Je week bij Hyper&Focus" met wat af is en het focusproject |
| 4 | Doorgestuurde mail | stuur een klantmail door naar `taken@in.hyper-focus.pro` | taak onder die klant, antwoord per mail |

→ **Na 1.7: start eigen gebruik.** Vanaf hier telt de verkooppoort-meting.

## 1.8 Agendakoppeling

**Automatisch:** `tests/ics.test.ts`, `tests/attachments.test.ts`, `tests/calendar-units.test.ts`, `tests/calendar.integration.test.ts`.

**Vooraf:** `docs/agenda.md` (alleen `ENCRYPTION_KEY` en `npm run db:migrate`).

| # | Check | Hoe | Verwacht |
|---|---|---|---|
| 1 | Zonder agenda | niets koppelen, één dag gebruiken | alles werkt zoals na 1.7 |
| 2 | Koppelen | "koppel agenda" → ICS-link plakken | "Je agenda is gekoppeld." in Telegram |
| 3 | Ochtend | de volgende ochtend | regel met je afspraken en de ruimte |
| 4 | Drukke dag | een dag met vijf uur afspraken | maximaal twee focustaken |
| 5 | Bericht tijdens afspraak | zet een afspraak van 13:00 tot 14:00 | het middagbericht komt om 14:00 |
| 6 | Heads-up | afspraak met een klantnaam in de titel | 10 minuten vooraf: "Om … heb je een afspraak met …. Open: …" |
| 7 | Nabespreking | direct na die afspraak | vraag om actiepunten; een spraakbericht wordt taken onder de klant |
| 8 | Vrij blok en zet in agenda | "wanneer heb ik vandaag een uur?" → *Plan om …* | bericht met een `.ics`-bestand; tik erop en de sessie staat in je agenda |
| 9 | Herhalende afspraak | een wekelijkse afspraak | verschijnt op de juiste dag en tijd, ook na de klokwissel |
| 10 | Ontkoppelen | "ontkoppel agenda" | `select count(*) from calendar_connections;` en `calendar_events` geven 0 voor jou |

## Is dit risicovol?

De risico's zijn beperkt:

- **Code:** elke stap heeft automatische tests en een eigen PR. Een fout blijft binnen één stap.
- **Data:** alleen 1.8 wijzigt het datamodel, met één toevoeging aan een enum. Er worden geen kolommen verwijderd.
- **Berichten:** de vangrails (1.5) begrenzen hoeveel Hyper&Focus stuurt. Tot 1.5 live staat, zijn alleen de pauze en de vaste dagtijden actief. Merge 1.3 en 1.5 daarom kort na elkaar, of zet tot 1.5 de middag uit ("geen middagbericht").
- **Kosten:** Claude wordt alleen bij vrije tekst aangeroepen, met het snelle model. Volg het verbruik met de query bij 1.2, check 8.
- **Privacy:** spraak blijft alleen in het geheugen. Agendatokens en het Apple-wachtwoord worden versleuteld opgeslagen.

Echte onzekerheden, die alleen live te zien zijn:

1. De score van de evaluatieset met het echte model (1.2).
2. Of Brevo en Telegram binnen de tijdslimieten blijven met Claude ertussen (1.2, 1.6).
3. Hoe snel je agenda de ICS-link bijwerkt (1.8): Google en Outlook soms pas na enkele uren.
