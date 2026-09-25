// Kontrasttest enligt WCAG 2.2 nivå AA för båda temana. Körs med:  node tests/contrast.test.mjs
//
// Färgerna läses direkt ur css/tidla.css, så testet följer med när färgerna ändras.
//   Text                        4,5:1   (1.4.3)  – stor text (≥24px, eller ≥18,66px fetstil) 3:1
//   Grafik och gränssnittsdelar 3:1     (1.4.11) – fältkanter, fokusring, förlopp, markeringar
// Inaktiva knappar/fält är undantagna i WCAG och visas bara som information.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/tidla.css", import.meta.url), "utf8");

/* ---------- Läs ut variablerna ---------- */

function block(startPattern) {
  const start = css.search(startPattern);
  if (start < 0) throw new Error(`Hittar inte ${startPattern}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("Oavslutat block");
}

function tokens(text) {
  const out = {};
  for (const [, name, value] of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const light = tokens(block(/:root \{\s*color-scheme: light;/));
const darkAttr = tokens(block(/:root\[data-theme="dark"\] \{/));
const darkMedia = tokens(block(/:root:not\(\[data-theme="light"\]\) \{/));
const themes = { Ljust: light, Mörkt: { ...light, ...darkAttr } };

/* ---------- Färgmatematik (WCAG 2.x) ---------- */

function parse(color) {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(",").map((v) => Number(v.trim()));
    return [r, g, b, a];
  }
  throw new Error(`Okänd färg: ${color}`);
}

// Halvgenomskinlig färg läggs ovanpå bakgrunden
function flatten(color, background) {
  const [r, g, b, a] = parse(color);
  if (a === 1) return [r, g, b];
  const [br, bg, bb] = flatten(background, "#FFFFFF");
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground, background, base) {
  const bg = flatten(background, base ?? "#FFFFFF");
  const fg = flatten(foreground, background.startsWith("rgba") ? base : background);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* ---------- Färgpar som används i gränssnittet ---------- */
// [förgrund, bakgrund, typ, beskrivning, (bas under en halvgenomskinlig bakgrund)]
// typ: text | large (stor text) | ui (grafik 3:1) | exempt (undantagen) | extra (kompletterande markering, inget krav)
const PAIRS = [
  // Brödtext och hjälptext
  ["text", "bg", "text", "Text på sidbakgrund"],
  ["text", "surface", "text", "Text på kort och fält"],
  ["text", "surface-2", "text", "Text på nästlad yta"],
  ["text-muted", "bg", "text", "Hjälptext på sidbakgrund"],
  ["text-muted", "surface", "text", "Hjälptext och platshållare på kort/fält"],
  ["text-muted", "surface-2", "text", "Hjälptext på nästlad yta"],
  ["link", "bg", "text", "Länk/textknapp på sidbakgrund"],
  ["link", "surface", "text", "Länk/textknapp/ikon på kort"],
  ["link", "info-soft", "text", "Segmentknapp (flikar i vy)"],
  ["danger", "surface", "text", "Felmeddelande vid fält"],
  ["danger", "bg", "text", "Felmeddelande på sidbakgrund"],

  // Knappar
  ["on-primary", "primary", "text", "Primärknapp"],
  ["on-primary", "primary-hover", "text", "Primärknapp, hover"],
  ["accent-btn-text", "accent-btn-bg", "text", "Accentknapp"],
  ["accent-btn-text", "accent-btn-hover", "text", "Accentknapp, hover"],
  ["on-danger", "danger-btn", "text", "Fara-knapp"],
  ["on-danger", "danger-btn-hover", "text", "Fara-knapp, hover"],
  ["disabled-text", "disabled-bg", "exempt", "Inaktiv knapp"],
  ["field-disabled-text", "field-disabled-bg", "exempt", "Inaktivt fält"],

  // Statuspiller, statistik och räknare
  ["on-info-soft", "info-soft", "text", "Radikon, ikon i tomt läge"],
  ["on-accent-soft", "accent-soft", "text", "Piller Väntar, rosa ikon"],
  ["danger", "danger-soft", "text", "Piller Nekad, felruta"],
  ["draft-text", "draft-bg", "text", "Piller Utkast, Inaktiv, Arkiverad"],
  ["status-godkand-text", "status-godkand-bg", "text", "Piller Godkänd, Aktiv"],
  ["status-pagaende-text", "status-pagaende-bg", "text", "Piller Pågående"],
  ["status-avslutat-text", "status-avslutat-bg", "text", "Piller Avslutat, Hanterad, Klar"],
  ["stat-label", "info-soft", "text", "Statistik: etikett (Programmerad)"],
  ["stat-label", "accent-soft", "text", "Statistik: etikett (Kvar att fördela)"],
  ["text", "info-soft", "large", "Statistik: värde 26/800"],
  ["text", "accent-soft", "large", "Statistik: värde 26/800"],
  ["on-accent", "accent", "text", "Räknare och avatar"],

  // Veckoremsa
  ["selected-text", "selected-bg", "text", "Vald dag: datum"],
  ["selected-muted", "selected-bg", "text", "Vald dag: veckodag", "selected-bg"],

  // Sidomeny (marin i båda temana)
  ["white", "sidebar", "text", "Sidomeny: namn och aktivt val"],
  ["on-dark-nav", "sidebar", "text", "Sidomeny: menyval", "sidebar"],
  ["on-dark-muted", "sidebar", "text", "Sidomeny: företagsnamn, befattning", "sidebar"],

  // Grafik och gränssnittsdelar (3:1)
  ["border-strong", "surface", "ui", "Fältkant mot kort"],
  ["border-strong", "bg", "ui", "Fältkant mot sidbakgrund"],
  ["focus-border", "surface", "ui", "Fältkant vid fokus"],
  ["focus-ring-inner", "surface", "ui", "Fokusring på knappar, inre ring (mot kort)"],
  ["focus-ring-inner", "bg", "ui", "Fokusring på knappar, inre ring (mot sidbakgrund)"],
  ["focus-ring", "surface", "extra", "Fokusring, yttre rosa ring (dekor)"],
  ["focus-ring", "sidebar", "ui", "Fokusring i sidomenyn"],
  ["progress", "info-soft", "ui", "Förloppsbar mot spåret"],
  ["selected-bg", "surface", "ui", "Vald dag mot övriga dagar"],
  ["selected-dot", "selected-bg", "ui", "Prick på vald dag"],
  // Pricken är inte enda signalen: dagar med registreringar visar timmar i stället
  ["border-strong", "surface", "extra", "Grå prick: dag utan registrering (kompletterar timtexten)"],
  ["primary", "surface", "ui", "Kryssruta (ikryssad)"],
  ["link", "surface", "ui", "Ikoner (pilar, −/+)"],
  ["white", "sidebar", "ui", "Temareglage: knopp mot sidomenyn"],
];

/* ---------- Kör ---------- */

const REQUIRED = { text: 4.5, large: 3, ui: 3, exempt: 0, extra: 0 };
const fmt = (n) => n.toFixed(2).replace(".", ",");
let failures = 0;

for (const [themeName, theme] of Object.entries(themes)) {
  console.log(`\n${themeName} tema`);
  for (const [fgName, bgName, type, label, baseName] of PAIRS) {
    const fg = theme[fgName];
    const bg = theme[bgName];
    if (!fg || !bg) throw new Error(`Saknar --${fgName} eller --${bgName}`);
    const value = ratio(fg, bg, baseName ? theme[baseName] : undefined);
    const need = REQUIRED[type];
    const ok = value >= need;
    if (!ok) failures++;
    const info = type === "exempt" || type === "extra";
    const mark = info ? "·" : ok ? "✓" : "✗";
    const needText = type === "exempt" ? "undantag" : type === "extra" ? "inget krav" : `krav ${fmt(need)}`;
    console.log(`  ${mark} ${fmt(value).padStart(5)}:1  ${needText.padEnd(10)}  ${label}  (--${fgName} på --${bgName})`);
  }
}

// Mörkt tema finns i två identiska block (systemval och data-theme) – de får inte glida isär
const drift = Object.keys({ ...darkAttr, ...darkMedia }).filter((k) => darkAttr[k] !== darkMedia[k]);
if (drift.length) {
  failures++;
  console.log(`\n✗ Mörka blocken skiljer sig åt: ${drift.map((k) => `--${k}`).join(", ")}`);
} else {
  console.log("\n✓ Mörkt tema är likadant via systemval och temaknappen");
}

if (failures) {
  console.log(`\n${failures} kontroll(er) klarar inte WCAG 2.2 AA.`);
  process.exitCode = 1;
} else {
  console.log("\nAlla färgpar klarar WCAG 2.2 AA.");
}
