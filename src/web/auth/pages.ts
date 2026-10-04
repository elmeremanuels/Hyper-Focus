// Server-rendered pages for logging in (step 2a.1), in the house style of the mini-app:
// off-white base, 2 px borders, one accent colour, Space Grotesk headings.
import { escapeHtml } from '../../channels/actions/page.js';

export function authPage(title: string, body: string, head = ''): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${head}<title>${escapeHtml(title)} · Hyper&amp;Focus</title>
<style>
  @font-face { font-family: "Space Grotesk"; font-weight: 700; font-display: swap; src: url("/app/fonts/space-grotesk-700.woff2") format("woff2"); }
  :root { --bg: #f6f2e8; --ink: #1c1b19; --muted: #5d5a53; --accent: #2e7d4f; --card: #fffdf8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 48px 16px; }
  main { max-width: 26rem; margin: 0 auto; background: var(--card); border: 2px solid var(--ink); border-radius: 12px; padding: 24px; box-shadow: 4px 4px 0 var(--ink); }
  h1 { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 24px; margin: 0 0 8px; }
  p { margin: 8px 0 16px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; font: inherit; padding: 10px 12px; border: 2px solid var(--ink); border-radius: 10px; background: #fff; }
  button, .button { display: inline-block; margin-top: 16px; width: 100%; text-align: center; font: inherit; font-weight: 600; background: var(--accent); color: #fff; border: 2px solid var(--ink); border-radius: 12px; padding: 12px 20px; text-decoration: none; cursor: pointer; }
  .muted { color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`;
}

export { escapeHtml };
