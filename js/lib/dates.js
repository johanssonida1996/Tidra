// Datum räknas alltid i lokal tid och lagras som "ÅÅÅÅ-MM-DD".
// Använd aldrig toISOString() för datum – den ger UTC och fel dag mellan 00:00 och 02:00 i Sverige.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABELS = {
  mon: "Måndag",
  tue: "Tisdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lördag",
  sun: "Söndag",
};
const DAY_SHORT = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
const DAY_LONG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTH_LONG = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

const pad = (n) => String(n).padStart(2, "0");
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today() {
  return toISODate(new Date());
}

export function currentMonth() {
  return today().slice(0, 7);
}

export function isValidISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// Klockan 12 för att sommartid aldrig ska flytta dagen
export function parseISODate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function weekdayKey(iso) {
  return WEEKDAYS[(parseISODate(iso).getDay() + 6) % 7];
}

export function startOfWeek(iso) {
  const offset = (parseISODate(iso).getDay() + 6) % 7;
  return addDays(iso, -offset);
}

export function weekDates(iso, count = 7) {
  const monday = startOfWeek(iso);
  return Array.from({ length: count }, (_, i) => addDays(monday, i));
}

// ISO-veckonummer (vecka 1 innehåller årets första torsdag)
export function isoWeek(iso) {
  const date = parseISODate(iso);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4, 12);
  const week = 1 + Math.round(((thursday - firstThursday) / 864e5 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return { year: thursday.getFullYear(), week };
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function addMonths(month, count) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + count, 1, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function datesInRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// "tor 24 sep"
export function formatShort(iso) {
  const d = parseISODate(iso);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

// "Torsdag 24 september"
export function formatLong(iso) {
  const d = parseISODate(iso);
  return `${capitalize(DAY_LONG[d.getDay()])} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

// "torsdag 24 september" (inne i meningar)
export function formatLongLower(iso) {
  return formatLong(iso).toLowerCase();
}

// "24 sep 2026"
export function formatDate(iso) {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// "Tor"
export function formatDayShort(iso) {
  return capitalize(DAY_SHORT[parseISODate(iso).getDay()]);
}

export function dayOfMonth(iso) {
  return parseISODate(iso).getDate();
}

// "september 2026"
export function formatMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

export function formatMonthCapital(month) {
  return capitalize(formatMonth(month));
}

// "24 sep 2026 14:05" från en tidsstämpel (ms)
export function formatTimestamp(ms) {
  const d = new Date(ms);
  return `${formatDate(toISODate(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
