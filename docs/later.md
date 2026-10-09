# Later

Ideeën en extra's die buiten de huidige bouwstap vallen.

- Database: extensie `pg_trgm` en trigram-indexen toevoegen zodra de naamvergelijking nodig is (klanten bij agenda-afspraken, 11.8; dubbelcheck suggesties, 12.4).
- Database: de lenzen `swot`, `offer_pricing`, `retention`, `visibility` en `time_saving` toevoegen aan de enum `lens` als ze gebouwd worden.
- Telegram: de keuzeknop *Meer* bij lijsten van meer dan 8 regels (9.2). Nu weigert de code meer dan 8; bouwen bij de eerste lijst die het nodig heeft (afronden, 1.3; weekreview, 1.7).
- Telegram-fallback: één keer per week de vraag om Telegram opnieuw te koppelen als berichten per mail gaan (9, fallback). Hoort bij de proactieve laag (1.3/1.5).
- Ochtendbericht: nu een vaste tekst zonder AI. Het slimme model (10.4) kan de groet persoonlijker maken, bijvoorbeeld samen met het agenda-overzicht (1.8). Eerst kijken of de vaste tekst werkt.
- Middagbericht: de tijd (13:30) staat vast in de code. Een instelling `midday_time` vraagt een datamodelwijziging.
- Database: enumwaarde `weekly_mail` voor `nudge_kind`, zodat het weekoverzicht geen `payload.part` nodig heeft (1.7).
- Agenda: twijfel bij het koppelen van een afspraak aan een klant voorleggen aan het snelle model, en `pg_trgm` voor de naamvergelijking (11.8). Nu: woordvergelijking.
- Agenda: meer dan één ICS-link per gebruiker (werk en privé). Nu: één link; de directe koppelingen nemen elk hun eigen agenda's mee.
- Agenda: een ICS-link die iemand in de chat plakt herkennen en verwijzen naar de koppelpagina (de link zou anders 30 dagen in `messages` staan).
- Router: Haiku eerst, Sonnet 5.5 als vangnet wanneer Haiku bij een bericht van meer dan een paar woorden geen tool aanroept. Interessant zodra de kosten per klant tellen (fase 3).
- Werkplek-links: klikmeting via een getekende redirect `/go/<id>` met tabel `tool_clicks`, aan te zetten met een `.env`-vlag (brief 1.10). Wacht op akkoord voor de nieuwe variabele.
- **Bot-commando's "exporteer mijn gegevens" en "verwijder mijn gegevens" (BOUWPLAN 14).** De logica staat sinds 2a.6 in `src/core/privacy.ts`. Nog nodig: twee router-tools, een download via mail of een eenmalige link, en een bevestiging in twee stappen bij verwijderen.
- Dashboard: een weekoverzicht met het focuslog van de week en de opbrengst (nu alleen vandaag en de weekmail). Handig voor de demo.
- Contentmodule: AI-gegenereerde beelden als laatste bron na de Drive-map en memegen (keuze Elmer, C3).
- Contentmodule: OAuth van Buffer zodra Buffer dat voor apps van derden opent; dan hoeft niemand een API-sleutel te plakken.
