// Tal visas alltid med svenskt decimalkomma: "8,5 h".

// Tar emot "4,5", "4.5", " 4 " – returnerar tal eller null om texten inte är ett tal.
export function parseHours(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const text = String(input ?? "").trim().replace(",", ".");
  if (!/^\d{0,2}(\.\d{1,2})?$/.test(text) || text === "" || text === ".") return null;
  return Number(text);
}

// Heltal ≥ 0, t.ex. kilometer
export function parseWholeNumber(input) {
  const text = String(input ?? "").trim();
  if (text === "") return 0;
  if (!/^\d{1,6}$/.test(text)) return null;
  return Number(text);
}

// Belopp med upp till två decimaler, tomt = null
export function parseAmount(input) {
  const text = String(input ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (text === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text)) return NaN;
  return Number(text);
}

// Minst `min` och högst `max` decimaler, med komma
function decimal(value, min, max) {
  let text = Number(value || 0).toFixed(max);
  while (text.split(".")[1]?.length > min && text.endsWith("0")) text = text.slice(0, -1);
  if (text.endsWith(".")) text = text.slice(0, -1);
  return text.replace(".", ",");
}

// 4.5 → "4,5", 4 → "4,0", 4.25 → "4,25"
export function formatHours(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  const sign = rounded < 0 ? "−" : "";
  return sign + decimal(Math.abs(rounded), 1, 2);
}

export function formatHoursUnit(value) {
  return `${formatHours(value)} h`;
}

// Med tecken: "+1,5 h" / "−2,0 h"
export function formatHoursDiff(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  if (rounded === 0) return "±0 h";
  return `${rounded > 0 ? "+" : ""}${formatHours(rounded)} h`;
}

export function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "";
  return decimal(value, 2, 2);
}

// Heltal med mellanslag som tusentalsavgränsare: 1 234
export function formatInteger(value) {
  return String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatPercent(part, whole) {
  if (!whole) return "0 %";
  return `${Math.round((part / whole) * 100)} %`;
}

export function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

export function plural(count, one, many) {
  return `${formatInteger(count)} ${count === 1 ? one : many}`;
}

// Förslag på nästa lediga nummer (kund, projekt, anställd): det högsta talet i slutet av ett befintligt
// nummer plus 1, med samma början och lika många siffror. ["100", "200"] → "201", ["P-101", "P-099"] → "P-102",
// ["007"] → "008", [] → first. Nummer utan siffror i slutet räknas inte.
export function nextNumber(values, first = "1") {
  const taken = new Set(values.map((v) => String(v ?? "").trim().toLowerCase()));
  let best = null;
  for (const value of values) {
    const match = String(value ?? "").trim().match(/^(.*?)(\d+)$/);
    if (match && (!best || Number(match[2]) > Number(best[2]))) best = match;
  }
  if (!best) return taken.has(first.toLowerCase()) ? nextNumber([first]) : first;
  let number = Number(best[2]);
  let candidate;
  do {
    number += 1;
    candidate = `${best[1]}${String(number).padStart(best[2].length, "0")}`;
  } while (taken.has(candidate.toLowerCase()));
  return candidate;
}

// Enheter som böjs i plural. Förkortningar (st, kg, förp …) och "liter", "par" är samma i plural.
const UNIT_PLURALS = { rulle: "rullar", tub: "tuber", flaska: "flaskor", påse: "påsar", hink: "hinkar", burk: "burkar", låda: "lådor", rör: "rör" };

// 2 → "2 tuber", 1 → "1 tub", 0.5 → "0,5 tub", 2.5 → "2,5 kg" (enheten böjs när antalet är större än 1)
export function formatQuantity(quantity, unit) {
  const number = String(formatAmount(quantity)).replace(/,00$/, "").replace(/(,\d)0$/, "$1");
  const name = String(unit ?? "").trim();
  const plain = name.toLowerCase();
  const word = Number(quantity) > 1 && UNIT_PLURALS[plain] ? UNIT_PLURALS[plain] : name;
  return `${number} ${word}`.trim();
}
