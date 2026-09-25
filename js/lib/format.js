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
