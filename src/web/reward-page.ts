// The page of the reward minute. Inline CSS and JS, no framework (brief 1.9): off-white base,
// 2 px borders, one accent colour, a hard 4 px shadow on the plant, 16–18 px text. Sound off.
// Space Grotesk is named but not loaded from an external font service.
import { escapeHtml } from '../channels/actions/page.js';

export function rewardPage(endText: string): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>Je minuut · Hyper&amp;Focus</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { --bg: #f6f2e8; --ink: #1c1b19; --accent: #2e7d4f; --soft: #e8e1d0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body { font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 20px 16px; }
  h1 { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .clock { font-family: "Space Grotesk", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 18px; border: 2px solid var(--ink); padding: 4px 12px; border-radius: 999px; margin: 8px 0 16px; }
  .pot { width: min(320px, 90vw); aspect-ratio: 1; border: 2px solid var(--ink); border-radius: 16px; background: #fffdf8; box-shadow: 4px 4px 0 var(--ink); position: relative; overflow: hidden; touch-action: manipulation; cursor: pointer; }
  .pot svg { width: 100%; height: 100%; display: block; }
  .drop { position: absolute; width: 12px; height: 16px; background: var(--accent); border: 2px solid var(--ink); border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; animation: fall 700ms ease-in forwards; pointer-events: none; }
  @keyframes fall { from { transform: translateY(-40px); opacity: 1; } to { transform: translateY(60px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .drop { animation: none; opacity: 0.9; } }
  p { margin: 12px 0; text-align: center; max-width: 32rem; }
  button { font: inherit; font-weight: 600; background: var(--accent); color: #fff; border: 2px solid var(--ink); border-radius: 12px; padding: 10px 20px; box-shadow: 3px 3px 0 var(--ink); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<h1 id="title">Je minuut</h1>
<div class="clock" id="clock" hidden>1:00</div>
<div class="pot" id="pot" role="button" aria-label="Geef je plant water"><svg id="garden" viewBox="0 0 200 200" aria-hidden="true"></svg></div>
<p id="hint" hidden>Tik op je plant om hem water te geven.</p>
<p id="end" hidden>${escapeHtml(endText)}</p>
<p id="gone" hidden>Deze minuut is niet meer beschikbaar. Je tuin blijft staan.</p>
<button id="close" type="button" hidden>Sluiten</button>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var token = new URLSearchParams(location.search).get('t') || '';
  var initData = (tg && tg.initData) || '';
  var $ = function (id) { return document.getElementById(id); };
  var running = false;

  function drawGarden(leaves) {
    // A new plant starts as a seedling with two leaves.
    var n = Math.max(2, Math.min(leaves || 0, 40));
    var height = 40 + Math.min(n, 20) * 5;
    var svg = '<rect x="70" y="160" width="60" height="32" rx="6" fill="#c9733f" stroke="#1c1b19" stroke-width="2"/>' +
      '<path d="M100 160 C100 ' + (160 - height / 2) + ' 104 ' + (160 - height * 0.8) + ' 100 ' + (160 - height) + '" stroke="#2e7d4f" stroke-width="4" fill="none"/>';
    for (var i = 0; i < n; i++) {
      var y = 155 - (i % 20 + 1) * (height / 22);
      var side = i % 2 === 0 ? 1 : -1;
      var x = 100 + side * (10 + (i >= 20 ? 14 : 0));
      svg += '<ellipse cx="' + x + '" cy="' + y + '" rx="11" ry="6" transform="rotate(' + (side * -25) + ' ' + x + ' ' + y + ')" fill="#2e7d4f" stroke="#1c1b19" stroke-width="1.5"/>';
    }
    $('garden').innerHTML = svg;
  }

  function post(path) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, initData: initData }) })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); });
  }

  function finish() {
    running = false;
    $('clock').hidden = true; $('hint').hidden = true;
    $('end').hidden = false; $('close').hidden = false;
    post('/app/beloning/finish');
    setTimeout(function () { if (tg) tg.close(); }, 3000);
  }

  function start(seconds) {
    running = true;
    $('clock').hidden = false; $('hint').hidden = false;
    var endAt = Date.now() + seconds * 1000;
    (function tick() {
      var left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      $('clock').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) return finish();
      setTimeout(tick, 250);
    })();
  }

  $('pot').addEventListener('click', function () {
    if (!running) return;
    var box = $('pot').getBoundingClientRect();
    var d = document.createElement('div');
    d.className = 'drop';
    // Drops fall onto the plant, wherever you tap.
    d.style.left = (box.width / 2 - 6 + (Math.random() * 40 - 20)) + 'px';
    d.style.top = (box.height * 0.2) + 'px';
    $('pot').appendChild(d);
    setTimeout(function () { d.remove(); }, 800);
  });
  $('close').addEventListener('click', function () { if (tg) tg.close(); else window.close(); });

  post('/app/beloning/start').then(function (res) {
    drawGarden(res.body.garden);
    if (!res.ok) { $('gone').hidden = false; $('title').textContent = 'Je tuin'; return; }
    if (res.body.finished) { $('title').textContent = 'Je tuin'; return; }
    start(res.body.remaining);
  }).catch(function () { $('gone').hidden = false; });
})();
</script>
</body>
</html>`;
}
