# Later

Ideeën en extra's die buiten de huidige bouwstap vallen.

- Agenda: een focusblok met één tik in de agenda zetten. Vraagt schrijfrechten en een aparte toestemming (BOUWPLAN.md, 11.8).
- Database: extensie `pg_trgm` en trigram-indexen toevoegen zodra de naamvergelijking nodig is (klanten bij agenda-afspraken, 11.8; dubbelcheck suggesties, 12.4).
- Database: de lenzen `swot`, `offer_pricing`, `retention`, `visibility` en `time_saving` toevoegen aan de enum `lens` als ze gebouwd worden.
- Telegram: de keuzeknop *Meer* bij lijsten van meer dan 8 regels (9.2). Nu weigert de code meer dan 8; bouwen bij de eerste lijst die het nodig heeft (afronden, 1.3; weekreview, 1.7).
- Telegram-fallback: één keer per week de vraag om Telegram opnieuw te koppelen als berichten per mail gaan (9, fallback). Hoort bij de proactieve laag (1.3/1.5).
- Ochtendbericht: nu een vaste tekst zonder AI. Het slimme model (10.4) kan de groet persoonlijker maken, bijvoorbeeld samen met het agenda-overzicht (1.8). Eerst kijken of de vaste tekst werkt.
- Middagbericht: de tijd (13:30) staat vast in de code. Een instelling `midday_time` vraagt een datamodelwijziging.
