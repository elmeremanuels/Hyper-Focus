# Agenda koppelen (stap 1.8)

De agenda is optioneel. Zonder koppeling werkt alles zoals na 1.7.

Hyper&Focus leest je agenda via de **geheime ICS-link** die elke grote agenda aanbiedt. Er zijn geen API-sleutels of app-registraties nodig. Bewaard worden alleen de tijden en titels van vandaag en morgen. De feed bevat ook deelnemers, beschrijvingen en locaties; die worden bij het inlezen weggegooid. Hyper&Focus schrijft nooit in je agenda. Een geplande sessie komt met een `.ics`-bestand, en met één tik zet je hem zelf in je agenda.

## Op de VPS (één keer)

1. Maak een sleutel aan en zet hem in `.env` (`nano .env`):
   ```
   openssl rand -base64 48
   ```
   Daarna: `ENCRYPTION_KEY=<de uitkomst>`. Bewaar hem ook in je wachtwoordmanager. **Raak je hem kwijt, dan moet je opnieuw koppelen.**
2. `ACTION_LINK_SECRET` en `APP_BASE_URL` staan er al (stap 1.1).
3. Zet de nieuwe code live:
   ```
   git pull
   npm ci
   npm run build
   npm run db:migrate
   pm2 restart hyperfocus hyperfocus-worker
   ```
   De migratie `0002_calendar_providers` voegt `ics`, `microsoft` en `apple` toe als agenda-aanbieders.

## Koppelen (in Telegram)

1. Stuur **"koppel agenda"**. Je krijgt een persoonlijke link die 15 minuten werkt.
2. Open de link en plak je ICS-link. Waar je die vindt:

De koppelpagina toont per agenda de stappen (tekst in `src/texts/agenda.nl.ts`, nagelopen op 4 oktober 2026). In het kort:

| Agenda | Waar | Intrekken |
|---|---|---|
| Apple (alleen een iCloud-agenda) | iPhone: Agenda-app → *Agenda's* → ⓘ naast de agenda onder iCloud → **Openbare agenda** aan → *Deel link…* → *Kopieer*. Mac: Agenda → deelsymbool bij de agenda (of rechtsklik → *Instellingen voor delen*) → **Openbare agenda** → deelsymbool → *Kopieer*. Anders: icloud.com/calendar → ⓘ. De `webcal://`-link mag zo geplakt worden. | *Openbare agenda* uit |
| Google (alleen op een computer) | calendar.google.com → tandwiel → *Instellingen* → links je agenda → *Agenda integreren* → **Geheim adres in iCal-indeling** | *Opnieuw instellen* |
| Outlook (web, Outlook.com, nieuwe Outlook) | *Agenda* → tandwiel → *Agenda → Gedeelde agenda's* → *Een agenda publiceren* → je agenda en *Kan alle details zien* → *Publiceren* → **ICS-link** | *Publicatie ongedaan maken* |

Iedereen met de link kan je afspraken zien. De koppelpagina weigert twee links die er goed uitzien maar niet werken: het openbare adres van Google (zonder `/private-`) en de HTML-link van Outlook.

3. In Telegram komt "Je agenda is gekoppeld."

Plak de link nooit in de chat; alleen op de koppelpagina wordt hij versleuteld opgeslagen.

**Ontkoppelen:** stuur "ontkoppel agenda". Hyper&Focus verwijdert de link en de afspraken. De link zelf trek je in bij je agenda (zie de kolom *Intrekken*).

## Bekende beperkingen

- Google en Outlook werken een gepubliceerde agenda soms pas na enkele uren bij. Een afspraak die je vandaag nog toevoegt, ziet Hyper&Focus daardoor mogelijk later.
- Eén ICS-link per gebruiker. Heb je meer agenda's, kies dan de agenda waar je werkafspraken in staan.

## Controle

| Wat | Hoe |
|---|---|
| Koppellink | "koppel agenda" → pagina met een invulveld en uitleg per agenda |
| Koppelen | link plakken → "Je agenda is gekoppeld." in Telegram |
| Ochtend | de volgende ochtend noemt het bericht je afspraken en de ruimte |
| Heads-up | afspraak met een klantnaam in de titel → 10 minuten vooraf een bericht met open punten |
| Bericht tijdens afspraak | het middagbericht tijdens een afspraak komt direct erna |
| Vrij blok + zet in agenda | "wanneer heb ik vandaag een uur?" → *Plan om …* → bericht met een `.ics`-bestand; tik erop en kies *Toevoegen* |
| Herhalende afspraak | een wekelijkse afspraak verschijnt op de juiste dag en tijd |
| Ontkoppelen | "ontkoppel agenda" → `select count(*) from calendar_connections;` geeft 0 voor jou |
| Fouten | `pm2 logs hyperfocus-worker` toont "Calendar sync failed"; het afrondbericht meldt het één keer |

## Directe koppelingen (standaard uit, voor later)

De code voor Google (OAuth), Outlook (Microsoft Graph) en Apple (CalDAV met app-specifiek wachtwoord) staat klaar. Ze verschijnen op de koppelpagina zodra hun waarden in `.env` staan:

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (Google Cloud Console, OAuth-client, scope `calendar.readonly`, toestemmingsscherm *In productie*).
- Outlook: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (Azure app-registratie, `Calendars.Read` + `offline_access`).
- Apple CalDAV: `CALENDAR_APPLE_CALDAV=true`.

Ze zijn sneller bij te werken dan een ICS-link, maar vragen per aanbieder een eigen inrichting.
