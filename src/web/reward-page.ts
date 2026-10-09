// The page of the reward minute (step 1.12): today's focus log with a clock of 60 seconds.
// Inline CSS and JS, no framework: off-white base, 2 px borders, one accent colour, headings in
// Space Grotesk (self-hosted), tabular figures, no illustrations.
import { escapeHtml } from '../channels/actions/page.js';
import { BLOCK_BUTTONS, BLOCK_TEXTS } from '../texts/werkblokken.nl.js';

export function rewardPage(): string {
  const t = (value: string) => escapeHtml(value);
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>${t(BLOCK_TEXTS.miniAppTitle)} · Hyper&amp;Focus</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  @font-face { font-family: "Space Grotesk"; font-weight: 500; font-display: swap; src: url("/app/fonts/space-grotesk-500.woff2") format("woff2"); }
  @font-face { font-family: "Space Grotesk"; font-weight: 700; font-display: swap; src: url("/app/fonts/space-grotesk-700.woff2") format("woff2"); }
  :root { --bg: #f6f2e8; --ink: #1c1b19; --muted: #5d5a53; --accent: #2e7d4f; --card: #fffdf8; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body { font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100vh; padding: 20px 16px; display: flex; flex-direction: column; align-items: center; }
  main { width: 100%; max-width: 30rem; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h1 { font-family: "Space Grotesk", system-ui, sans-serif; font-weight: 700; font-size: 24px; margin: 0; letter-spacing: -0.01em; }
  .clock { font-family: "Space Grotesk", system-ui, sans-serif; font-weight: 500; font-variant-numeric: tabular-nums; font-size: 18px; border: 2px solid var(--ink); padding: 4px 12px; border-radius: 999px; min-width: 4.5ch; text-align: center; }
  ol { list-style: none; margin: 0; padding: 0; border: 2px solid var(--ink); border-radius: 12px; background: var(--card); }
  li { display: grid; grid-template-columns: auto auto 1fr; gap: 4px 12px; padding: 12px 14px; border-top: 2px solid var(--ink); font-variant-numeric: tabular-nums; }
  li:first-child { border-top: 0; }
  li .time, li .min { color: var(--muted); white-space: nowrap; }
  li.window { box-shadow: inset 4px 0 0 var(--accent); }
  li .what { overflow-wrap: anywhere; }
  .empty { border: 2px solid var(--ink); border-radius: 12px; background: var(--card); padding: 16px; margin: 0; }
  p { margin: 16px 0 0; }
  button { margin-top: 20px; width: 100%; font: inherit; font-weight: 600; background: var(--accent); color: #fff; border: 2px solid var(--ink); border-radius: 12px; padding: 12px 20px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
<header>
  <h1>${t(BLOCK_TEXTS.miniAppTitle)}</h1>
  <div class="clock" id="clock" aria-live="off">1:00</div>
</header>
<ol id="log" hidden></ol>
<p class="empty" id="empty" hidden>${t(BLOCK_TEXTS.focusLogEmpty)}</p>
<p id="end" hidden>${t(BLOCK_TEXTS.miniAppEnd)}</p>
<p id="gone" hidden>Deze minuut is niet meer beschikbaar.</p>
<button id="close" type="button">${t(BLOCK_BUTTONS.backToWork)}</button>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var token = new URLSearchParams(location.search).get('t') || '';
  var initData = (tg && tg.initData) || '';
  var $ = function (id) { return document.getElementById(id); };

  function close() { if (tg) tg.close(); else window.close(); }

  function post(path) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, initData: initData }) })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); });
  }

  // "■ Di 10:30 · 82 min · Offerte Boho af" becomes a row; ■ marks the focus window.
  function showLog(lines) {
    var list = $('log');
    list.textContent = '';
    if (!lines || lines.length === 0) { $('empty').hidden = false; return; }
    lines.forEach(function (line) {
      var inWindow = line.indexOf('■ ') === 0;
      var parts = line.replace(/^■ /, '').split(' · ');
      var li = document.createElement('li');
      if (inWindow) li.className = 'window';
      [['time', parts[0]], ['min', parts[1]], ['what', parts.slice(2).join(' · ')]].forEach(function (cell) {
        var span = document.createElement('span');
        span.className = cell[0];
        span.textContent = cell[1] || '';
        li.appendChild(span);
      });
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function finish() {
    $('clock').textContent = '0:00';
    $('end').hidden = false;
    post('/app/beloning/finish');
    setTimeout(close, 3000);
  }

  function start(seconds) {
    var endAt = Date.now() + seconds * 1000;
    (function tick() {
      var left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      $('clock').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) return finish();
      setTimeout(tick, 250);
    })();
  }

  $('close').addEventListener('click', close);
  post('/app/beloning/start').then(function (res) {
    if (!res.ok) { $('gone').hidden = false; $('clock').hidden = true; return; }
    showLog(res.body.log);
    if (res.body.finished) { $('clock').textContent = '0:00'; return; }
    start(res.body.remaining);
  }).catch(function () { $('gone').hidden = false; });
})();
</script>
</body>
</html>`;
}
