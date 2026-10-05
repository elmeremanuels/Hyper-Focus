# Deployen (vaste reeks)

Voor Cowork, als gebruiker `app` in `~/hyperfocus`. Altijd dezelfde reeks, ook voor een kleine wijziging.

## 1. Vooraf

- Maak een snapshot in hPanel (VPS → Snapshots), zodat je kunt terugrollen.
- Bevat de PR een migratie die data verwijdert? Maak dan eerst een verse back-up:
  ```
  pg_dump "$DATABASE_URL" | gzip > ~/backup-$(date +%F-%H%M).sql.gz
  ```

## 2. De reeks

```
cd ~/hyperfocus
git pull
npm ci --include=dev
npm run build
npm run db:migrate
```

`--include=dev` is nodig: de build gebruikt TypeScript en Vite, en die zijn dev-dependencies.

## 3. Controle na de build, vóór de herstart

```
test -f dist/server.js && test -f dist/worker.js && test -f dist/web/reward.js \
  && test -f dist/dashboard/index.html && test -f dist/site/index.html \
  && echo "build compleet" || echo "BUILD ONVOLLEDIG — niet herstarten"
```

Staat er "BUILD ONVOLLEDIG", herstart dan niet. Kijk eerst naar de uitvoer van `npm run build`.

## 4. Herstarten en nakijken

```
pm2 restart hyperfocus hyperfocus-worker
sleep 5
curl -s localhost:${PORT:-3000}/health
pm2 logs --lines 30 --nostream
```

- `/health` geeft `{"status":"ok"}`.
- In de logs staan geen fouten na de herstart.
- Stuur de bot een bericht en kijk of er antwoord komt.

## 5. Terug bij een probleem

```
git log --oneline -3
git checkout <vorige commit>
npm ci --include=dev && npm run build
pm2 restart hyperfocus hyperfocus-worker
```

Een migratie gaat niet vanzelf terug. Is er een gedraaid, zet dan de back-up of de snapshot terug.
