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

## Wat C2 doet

- **Elke werkdag om 17:00** schrijft Claude (het slimme model) per klant de posts tot en met de volgende werkdag. Op vrijdag zijn dat dus zaterdag, zondag en maandag.
  - Voor elk moment uit het ritme komt er één post. Kanalen zonder dagen krijgen geen vaste posts.
  - Claude gebruikt de klantkaart en de week: afgeronde taken van de projecten van de klant, de laatste notities, en je berichten waarin de klant voorkomt. Posts van de afgelopen twee weken herhaalt hij niet.
  - **Extra post:** alleen als er iets te delen valt. Hij komt morgen op de tijd van het kanaal, met de reden erbij ("Extra post: Je zette de nieuwe website live.").
  - Een moment dat al een post heeft, bijvoorbeeld een die je zelf schreef, slaat Claude over.
- **In Telegram** komt één bundel: een kop met *Alles goed*, daarna elke post met *Goed*, *Aanpassen* en *Overslaan*.
  - De bundel telt als één bericht van de dag, maar de daglimiet houdt hem niet tegen.
  - Stille uren, een pauze en vier dagen stilte houden hem wel tegen.
- *Alles goed* zet elke post die op akkoord wacht in Buffer.
- **Herinnering:** een uur voor het geplande moment, als de post nog niet is goedgekeurd.
- **Op het moment zelf** krijgt een post zonder akkoord de status *overgeslagen*. Goedkeuren daarna zet hem niet alsnog online.
- **AI even weg:** de bundel wordt elke 10 minuten opnieuw geprobeerd, tot 2 uur na 17:00.
- **Geen Telegram:** dan komt er geen bundel. Goedkeuren gaat alleen via de knoppen in Telegram.

## Live controleren (C2)

- [ ] Om 17:00 op een werkdag komt de bundel, met *Alles goed* bovenaan.
- [ ] Na een afgeronde taak bij de klant staat er soms een extra post met een reden. Als er niets gebeurde, komt er geen extra post.
- [ ] Een uur voor een post die nog wacht, komt de herinnering.
- [ ] Een post die je niet goedkeurt, staat na het moment op *overgeslagen* en verschijnt niet in Buffer.

## Volgende stap

- **C3:**
  - beeld uit de Drive-map (`GOOGLE_API_KEY` op de VPS) en van memegen.link;
  - een eigen mediaroute;
  - elk uur een statuscontrole bij Buffer, met een melding bij een fout;
  - aan het eind van de week de beelden van geslaagde posts verwijderen.
