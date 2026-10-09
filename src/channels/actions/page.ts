export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal mobile-first page for action-link results. */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Hyper&amp;Focus</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.25rem; }
  .button, button { display: inline-block; margin: .25rem 0; padding: .6rem 1rem; border-radius: .5rem; border: 0; background: #1a1a1a; color: #fff; text-decoration: none; font: inherit; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}
