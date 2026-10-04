// Where to find the secret calendar link, per calendar (step 1.8; checked by Elmer on 4 October
// 2026). HTML for the connect page. The button names are Dutch as on a Dutch iPhone and Mac.

export interface CalendarGuide {
  title: string;
  html: string;
}

/** Everyone with the link can see the appointments; each guide says how to revoke it. */
export const LINK_WARNING = 'Iedereen met de link kan je afspraken zien.';

export const CALENDAR_GUIDES: CalendarGuide[] = [
  {
    title: 'Apple (iCloud-agenda)',
    html: `<p><strong>Let op:</strong> dit werkt alleen met een iCloud-agenda. Staat je agenda onder <em>Op mijn iPhone</em>, Gmail of Exchange, dan zie je de optie <em>Openbare agenda</em> niet. Gebruik dan de stappen voor Google of Outlook.</p>
<p><strong>iPhone of iPad</strong></p>
<ol>
<li>Open de Agenda-app en tik onderaan op <em>Agenda's</em>.</li>
<li>Tik op ⓘ naast de agenda die je wilt koppelen. Die moet onder het kopje iCloud staan.</li>
<li>Scrol naar beneden en zet <em>Openbare agenda</em> aan.</li>
<li>Tik op <em>Deel link…</em> en dan op <em>Kopieer</em>.</li>
</ol>
<p><strong>Mac</strong></p>
<ol>
<li>Open Agenda en zoek je agenda in de lijst links. Zie je de lijst niet, kies dan <em>Weergave → Toon agendalijst</em>.</li>
<li>Houd de muis op de agenda en klik op het deelsymbool dat verschijnt. Of klik met rechts en kies <em>Instellingen voor delen</em>.</li>
<li>Vink <em>Openbare agenda</em> aan.</li>
<li>Klik op het deelsymbool naast de link en kies <em>Kopieer</em>.</li>
</ol>
<p>Lukt het op geen van beide: ga op een computer naar icloud.com/calendar. Klik op ⓘ naast je agenda, zet <em>Openbare agenda</em> aan en kies <em>Kopieer</em>.</p>
<p>De link begint met <code>webcal://</code>. Plak hem gewoon zo; Hyper&amp;Focus zet hem zelf om.</p>
<p>${LINK_WARNING} Intrekken: zet <em>Openbare agenda</em> weer uit.</p>`,
  },
  {
    title: 'Google Agenda',
    html: `<p>Dit werkt alleen op een computer. De app heeft deze optie niet.</p>
<ol>
<li>Ga naar calendar.google.com.</li>
<li>Klik rechtsboven op het tandwiel en dan op <em>Instellingen</em>.</li>
<li>Klik links onder <em>Instellingen voor mijn agenda's</em> op je agenda.</li>
<li>Klik op <em>Agenda integreren</em>.</li>
<li>Kopieer de link onder <em>Geheim adres in iCal-indeling</em>.</li>
</ol>
<p>Gebruik het geheime adres. Het openbare adres werkt alleen als je agenda voor iedereen zichtbaar is. Zie je het geheime adres niet en heb je een werkaccount, dan heeft je beheerder het uitgezet.</p>
<p>${LINK_WARNING} Intrekken: klik bij <em>Geheim adres in iCal-indeling</em> op <em>Opnieuw instellen</em>.</p>`,
  },
  {
    title: 'Outlook (Outlook.com, Outlook op het web, nieuwe Outlook)',
    html: `<ol>
<li>Open Outlook in de browser en ga naar <em>Agenda</em>.</li>
<li>Klik op het tandwiel (<em>Instellingen</em>) en kies <em>Agenda → Gedeelde agenda's</em>.</li>
<li>Kies onder <em>Een agenda publiceren</em> je agenda en <em>Kan alle details zien</em>.</li>
<li>Klik op <em>Publiceren</em>.</li>
<li>Kopieer de ICS-link. De HTML-link werkt niet.</li>
</ol>
<p>Heb je een werkaccount en zie je <em>Publiceren</em> niet, dan staat het bij je organisatie uit.</p>
<p>${LINK_WARNING} Intrekken: kies bij je agenda <em>Publicatie ongedaan maken</em>.</p>`,
  },
];

/** After "ontkoppel agenda" with an ICS link: how to make the link itself useless. */
export const REVOKE_HINT =
  ' Wil je ook de link zelf intrekken: zet bij Apple Openbare agenda uit, kies bij Google Opnieuw instellen of bij Outlook Publicatie ongedaan maken.';
