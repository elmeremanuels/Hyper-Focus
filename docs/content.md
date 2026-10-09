# Contentmodule (stappen C1–C3)

Posts voor social media per klant. Buffer zet ze live, goedkeuren gaat in Telegram. Zonder *Goed* gaat er niets live.

## Wat C1 doet

- **Aan en uit:** Instellingen → *Contentmodule*. Uit betekent: nergens iets over social media, ook niet op de klantkaarten.
- **Klantkaart** (Projecten → Klanten): vrije velden met een kop en een tekst, met suggesties als *Doelgroep*, *Tone of voice* en *Doelstellingen*.
- **Socials koppelen:** per klant een Buffer API-sleutel. De app controleert de sleutel bij Buffer en bewaart hem versleuteld met `ENCRYPTION_KEY`. Daarna kies je maximaal 3 kanalen, elk met een eigen ritme (dagen en tijd). Zonder dagen gaat een post naar de volgende vrije plek in de Buffer-wachtrij.
- **In Telegram:** "post voor Studio Rust: …" zet per kanaal een post klaar met *Goed*, *Aanpassen* en *Overslaan*.
  - *Goed*: de post gaat naar Buffer op het volgende moment uit het ritme (minstens een kwartier vooruit).
  - *Aanpassen*: het volgende bericht is de wens. Claude herschrijft de post met de klantkaart erbij en toont hem opnieuw.
  - Weigert Buffer de post, dan staat hij op *mislukt* met de knop *Opnieuw*.

## Op de VPS

- `ENCRYPTION_KEY` moet gezet zijn (staat er al voor de agenda).
- Buffer-sleutels komen niet in `.env`: die plak je per klant in het dashboard.
- Na de deploy: `npm run db:migrate` (migratie `0013_content_module`).

## Live controleren

- [ ] Instellingen → Contentmodule aan. De klantkaarten tonen *Klantkaart* en *Socials koppelen*.
- [ ] Bij Studio Rust: Socials aan, Buffer-sleutel plakken, *Verbind 3 kanalen*, Instagram kiezen met een ritme.
- [ ] In Telegram: "post voor Studio Rust: test, niet plaatsen". De post verschijnt met drie knoppen en de geplande tijd.
- [ ] *Aanpassen* met "korter" geeft een kortere versie.
- [ ] *Goed* zet de post in Buffer op de geplande tijd. Verwijder hem daarna in Buffer, of gebruik *Overslaan* voor de test.

## Volgende stappen

- **C2:** elke middag kijkt Claude per klant naar de week en de klantkaart en zet de posts voor morgen klaar, met een eventuele extra post en de reden. In Telegram komt één bundel met *Alles goed*. Zonder akkoord: één herinnering een uur voor de geplande tijd, daarna *overgeslagen*.
- **C3:** beeld uit de Drive-map (`GOOGLE_API_KEY` op de VPS) en memegen.link, een eigen mediaroute, elk uur een statuscontrole bij Buffer met een melding bij een fout, en aan het eind van de week het verwijderen van de beelden van geslaagde posts.
