# Website (fase 2b)

De site staat op `hyper-focus.pro`. Hij is statisch: HTML met Tailwind in `site/`, gebouwd naar `dist/site` en geserveerd door dezelfde server als de webhooks. Hij plaatst geen cookies en draait geen scripts.

## Op de VPS (Cowork, als `app` in `~/hyperfocus`)

1. Brevo, eenmalig, in het dashboard van Brevo:
   - Ga naar *Contacten → Lijsten* en maak een lijst, bijvoorbeeld "Wachtlijst Hyper&Focus". Noteer het id.
   - Maak een sjabloon voor de bevestigingsmail (double opt-in) met de link `{{ doubleoptin }}`. Noteer het id.
2. Zet de ids in `.env` (`nano .env`):
   ```
   BREVO_WAITLIST_LIST_ID=<id van de lijst>
   BREVO_DOI_TEMPLATE_ID=<id van het sjabloon>
   ```
   `BREVO_API_KEY` en `APP_BASE_URL=https://hyper-focus.pro` staan er al.
3. Zet de code live:
   ```
   git pull
   npm ci
   npm run build
   pm2 restart hyperfocus hyperfocus-worker
   ```
   Er zijn geen migraties nodig.
4. Voeg in nginx een serverblok toe dat `www.hyper-focus.pro` met een 301 doorstuurt naar `https://hyper-focus.pro`. Haal het certificaat op met `certbot --nginx -d www.hyper-focus.pro`.
5. Controleer dat `hallo@hyper-focus.pro` mail ontvangt. Het privacyblok verwijst ernaar.

## Controle

| Wat | Hoe |
|---|---|
| Voorpagina | `https://hyper-focus.pro/` toont de landingspagina |
| www | `https://www.hyper-focus.pro/` stuurt door naar `https://hyper-focus.pro/` |
| 404 | `https://hyper-focus.pro/bestaat-niet` toont "Deze pagina bestaat niet" |
| Server blijft werken | de Telegram-bot reageert, en "koppel agenda" opent de koppelpagina |
| Wachtlijst | vul je eigen adres in en vink het vakje aan. Je ziet "Check je mail" en krijgt de mail van Brevo. Na de klik sta je in de lijst |
| Fout | zonder de ids in `.env` toont het formulier "Dat lukte niet". De log meldt "Brevo is not set up" |
| Gedeelde link | plak `https://hyper-focus.pro` in Telegram of WhatsApp. Je ziet de titel en het beeld |
| robots en sitemap | `https://hyper-focus.pro/robots.txt` en `/sitemap.xml` |

## Bijwerken

- **Printscreens en het beeld voor gedeelde links:** `npm run site:shots`. Het script maakt het fictieve demo-account opnieuw aan, maakt de beelden en ruimt het account daarna op. Het vraagt een database, een gebouwd dashboard (`npm run build`) en Playwright met Chromium.
- **"Waarom ik dit bouw":** de tekst staat in de repo in `site/content/verhaal.html`, als gewone `<h2>` en `<p>`. De build zet hem in de opmaak van de site.
- **Bedrijfsregel in het privacyblok:** komt uit `site/content/bedrijf.local.html`. Dat bestand staat alleen op de server, want `*.local.html` staat in `.gitignore`. Inhoud: `<p>Hyper&amp;Focus · KvK 84318392</p>`. Zonder het bestand blijft de regel weg.
- **Build:** het dashboard bouwt naar `dist/dashboard`, de site naar `dist/site` en de servercode naar `dist/` (met `dist/web`). Vroeger bouwde het dashboard naar `dist/web` en wiste het daarbij de servercode. `tests/build-output.test.ts` voorkomt dat dit terugkomt.
- **Teksten:** in `site/index.html`, volgens de toonregels: kort, je-vorm, geen medische claims, geen prijs tot de beta.
