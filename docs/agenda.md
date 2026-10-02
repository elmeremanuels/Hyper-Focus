# Agenda koppelen (stap 1.8)

De agenda is optioneel. Zonder deze stappen werkt alles zoals na 1.7. Hyper&Focus leest alleen tijden en titels van vandaag en morgen en schrijft nooit in je agenda.

## Op de VPS: `.env`

- `ENCRYPTION_KEY`: willekeurig, 32+ tekens (`openssl rand -base64 48`). Versleutelt tokens en het Apple-wachtwoord. **Verlies je hem, dan moet je opnieuw koppelen.**
- `ACTION_LINK_SECRET` en `APP_BASE_URL` staan er al (stap 1.1).
- Google en Outlook hieronder zijn elk optioneel. Apple heeft geen extra sleutels nodig.

Daarna: `npm run build`, `npm run db:migrate` (migratie `0002_calendar_providers`), `pm2 restart hyperfocus hyperfocus-worker`.

## Google Agenda

1. Google Cloud Console → nieuw project → *APIs en services* → *Google Calendar API* inschakelen.
2. *OAuth-toestemmingsscherm*: extern, scope `.../auth/calendar.readonly`. Zet het op **In productie** (in testmodus verlopen refresh tokens na 7 dagen).
3. *Inloggegevens* → *OAuth-client-ID* → webapplicatie. Geautoriseerde omleidings-URI: `https://hyper-focus.pro/auth/google/callback`.
4. In `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://hyper-focus.pro/auth/google/callback`.

## Outlook (Microsoft 365 en Outlook.com)

1. portal.azure.com → *Microsoft Entra ID* → *App-registraties* → *Nieuwe registratie*.
2. Ondersteunde accounttypen: *Accounts in elke organisatiemap en persoonlijke Microsoft-accounts*.
3. Omleidings-URI (Web): `https://hyper-focus.pro/auth/microsoft/callback`.
4. *API-machtigingen* → Microsoft Graph → gedelegeerd: `Calendars.Read` en `offline_access`.
5. *Certificaten en geheimen* → nieuw clientgeheim. Noteer de **waarde** (niet de id) en de vervaldatum; zet een herinnering om hem te vernieuwen.
6. In `.env`: `MICROSOFT_CLIENT_ID` (de *Application (client) ID*), `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI=https://hyper-focus.pro/auth/microsoft/callback`.

## Apple iCloud

Geen inrichting op de server. De gebruiker:

1. Gaat naar account.apple.com → *Inloggen en beveiliging* → *App-specifieke wachtwoorden* en maakt er een aan (bijvoorbeeld "Hyper&Focus").
2. Stuurt de bot "koppel agenda", kiest *Apple iCloud-agenda* en vult Apple ID en dat wachtwoord in.

Het gewone Apple-wachtwoord werkt niet en wordt nooit gevraagd. Ontkoppelen: "ontkoppel agenda", en daarna het app-specifieke wachtwoord intrekken op account.apple.com.

## Controle na het inrichten

| Wat | Hoe |
|---|---|
| Koppellink | stuur "koppel agenda"; de link toont alleen de ingerichte agenda's en werkt 15 minuten |
| Koppelen | kies een agenda; daarna komt in Telegram "Je agenda is gekoppeld." |
| Ochtend | de volgende ochtend noemt het bericht je afspraken en de ruimte |
| Heads-up | zet een afspraak met een klantnaam in de titel (bijv. "Bakkerij De Vries"); 10 minuten vooraf komt een bericht met open punten |
| Bericht tijdens afspraak | een middagbericht tijdens een afspraak komt direct erna |
| Vrij blok | "wanneer heb ik vandaag een uur?" |
| Ontkoppelen | "ontkoppel agenda"; in de database staan daarna geen rijen meer in `calendar_connections` en `calendar_events` voor jou |
| Fouten | `pm2 logs hyperfocus-worker` toont "Calendar sync failed"; het afrondbericht meldt het één keer |
