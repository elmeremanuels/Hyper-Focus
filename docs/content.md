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

## Wat C3 doet

- **Beeld bij de middagbundel.** Claude kiest per post een beeld, in deze volgorde:
  1. **Een foto uit de fotomap** van de klant: een openbare Google Drive-map. Claude kiest op bestandsnaam en beschrijving, dus geef je foto's beschrijvende namen ("strand-ademsessie.jpg"). Foto's die de afgelopen twee weken zijn gebruikt, slaat hij over zolang er genoeg andere zijn. De app downloadt de foto (jpg, png, webp of gif, hooguit 8 MB) en zet hem op een eigen link: `APP_BASE_URL/media/…`, met een naam die niet te raden is.
  2. **Een meme van memegen.link**, als dat mag op de klantkaart en past bij de tone of voice. Claude kiest uit een vaste lijst bekende sjablonen.
  3. **Geen beeld.** Instagram heeft altijd een beeld nodig; daar laat Claude de post liever weg.

  In Telegram staat de link onder "Beeld:". Telegram toont het beeld als voorbeeld.
- **Statuscontrole:** elk uur vraagt de worker Buffer naar posts waarvan het moment minstens 10 minuten voorbij is. Geplaatst wordt *verstuurd*. Een fout wordt *mislukt*, en je krijgt een bericht met de reden van Buffer. Na een dag zonder antwoord geldt een post ook als mislukt.
- **Opruimen:** na de week waarin een post is verstuurd of overgeslagen, verwijdert de worker de gedownloade foto. Een mislukte post houdt zijn foto, zodat *Opnieuw* nog werkt. Verwijder je je account, dan gaan al je foto's mee.

## Op de VPS (Cowork, C3)

1. **Google API-sleutel**, alleen voor Drive, aan te maken door Elmer:
   - Google Cloud Console → nieuw project "hyperfocus" → *APIs & Services* → *Library* → **Google Drive API** inschakelen.
   - *Credentials* → *Create credentials* → *API key*.
   - Beperk de sleutel: *API restrictions* → alleen Google Drive API.
   - In `.env`: `GOOGLE_API_KEY=…` (Elmer plakt de sleutel zelf, niet in de chat).
2. **Map voor foto's:** standaard `~/hyperfocus/media`. Een andere plek kan met `MEDIA_DIR=` in `.env`. De map hoort niet in de back-up: de foto's staan ook in Drive.
3. **Deploy:** de vaste reeks uit `docs/deploy.md`, daarna `pm2 restart hyperfocus hyperfocus-worker --update-env`. Er komt geen migratie bij.
4. **Controle:** `curl -sI https://hyper-focus.pro/media/bestaat-niet.jpg` geeft `404` van de app (dus Nginx stuurt `/media` door).

## Live controleren (C3)

- [ ] Fotomap op de klantkaart ingevuld. De map is gedeeld als "Iedereen met de link".
- [ ] De volgende middagbundel heeft bij Instagram een foto uit die map. De link opent de foto.
- [ ] Na *Goed* staat de post met foto in Buffer.
- [ ] Een uur na het moment staat de post op *verstuurd* (zichtbaar in de database of de export).
- [ ] De maandag erna is de foto van die post weg uit `~/hyperfocus/media`.

