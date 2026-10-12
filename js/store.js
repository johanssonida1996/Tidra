// ==========================================================================
// Tidla – datalager (fas 1: localStorage)
//
// DET HÄR ÄR DEN ENDA FILEN SOM FÅR RÖRA localStorage / sessionStorage.
// I nästa fas byts innehållet ut mot fetch()-anrop till ett PHP/MySQL-API på one.com.
// Funktionsnamn, argument, returvärden och StoreError-koder ska då vara oförändrade.
// Alla funktioner är async för att vyerna redan nu ska fungera som mot en server.
//
// Behörighet och affärsregler kontrolleras HÄR (inte bara i gränssnittet), eftersom
// API:et ska göra samma sak.
//
// Nycklar: alla börjar med "tidla:". Prototypens nycklar (tk-u3, tk-s3, tk-c3, tk-p3,
// tk-d3-*, tk-session) läses, migreras och raderas aldrig.
// ==========================================================================

import { hashPassword, verifyPassword, createSalt, createOneTimePassword, MIN_PASSWORD_LENGTH } from "./auth.js";
import { WEEKDAYS, isValidISODate, isValidMonth, monthOf, weekdayKey, today, addDays } from "./lib/dates.js";
import { schedulePeriods, weekOn, withPeriod } from "./lib/schedule.js";

const PREFIX = "tidla:";
export const SCHEMA_VERSION = 1;
const COLLECTIONS = ["users", "customers", "projects", "entries", "monthLocks", "materials", "articles"];
// Samlingar som äldre säkerhetskopior kan sakna
const OPTIONAL_COLLECTIONS = ["articles"];

// Felkoder (samma som API:et ska använda): unauthenticated, forbidden, validation, duplicate,
// locked, in-use, invalid-state, not-found, storage
export class StoreError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.fields = fields;
  }
}

/* ==========================================================================
   Lagring
   ========================================================================== */

let localBackend = null;
let sessionBackend = null;

// Används av testerna för att köra mot minnet i stället för webbläsarens lagring
export function useStorage(local, session) {
  localBackend = local;
  sessionBackend = session;
}

const local = () => localBackend ?? globalThis.localStorage;
const session = () => sessionBackend ?? globalThis.sessionStorage;

function read(name, fallback) {
  try {
    const raw = local().getItem(PREFIX + name);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(name, value) {
  try {
    if (local().getItem(PREFIX + "schema") === null) {
      local().setItem(PREFIX + "schema", JSON.stringify(SCHEMA_VERSION));
    }
    local().setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    throw new StoreError("storage", "Det gick inte att spara. Webbläsarens lagring kan vara full eller avstängd.");
  }
  emitChange(name);
}

const all = (name) => read(name, []);
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/* ---------- Ändringar (för t.ex. räknaren för nya materialuttag) ---------- */

const listeners = new Set();

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(name) {
  listeners.forEach((listener) => {
    try {
      listener(name);
    } catch (error) {
      console.error(error);
    }
  });
}

let initialized = false;

// Frånvarotyper blev "typer av tid". Flyttar över inställningar och registreringar.
// (Bara under utvecklingen av fas 1 – kan tas bort när ingen har gammal data kvar.)
function migrateTimeTypes() {
  const saved = read("settings", null);
  if (saved && Array.isArray(saved.absenceTypes)) {
    const { absenceTypes, ...rest } = saved;
    const types = defaultTimeTypes();
    for (const old of absenceTypes) {
      const match = types.find((t) => t.id === old.id);
      if (match) Object.assign(match, { name: old.name, hidden: Boolean(old.hidden) });
      else types.push(type(old.id, old.name, "absence", { hidden: Boolean(old.hidden) }));
    }
    write("settings", { ...rest, timeTypes: rest.timeTypes ?? types });
  }
  const entries = read("entries", null);
  if (Array.isArray(entries) && entries.some((e) => !e.timeTypeId)) {
    write(
      "entries",
      entries.map(({ absenceTypeId, ...e }) => ({ ...e, timeTypeId: e.timeTypeId ?? (absenceTypeId || "normal") })),
    );
  }
}

// Restid och övertid var tidigare egna typer (restid-deb, ot-lon-15 …). Nu är restid en del av
// registreringen och övertid två typer: komptid och lön. Flyttar över inställningar och registreringar.
// (Bara under utvecklingen av fas 1 – kan tas bort när ingen har gammal data kvar.)
function migrateTravelAndOvertime() {
  const saved = read("settings", null);
  if (!saved || !Array.isArray(saved.timeTypes)) return;
  const oldTypes = saved.timeTypes;
  const isOld = oldTypes.some((t) => t.category === "travel" || (t.category === "overtime" && !["ot-komp", "ot-lon"].includes(t.id)));
  if (!isOld && saved.overtime && saved.travel) return;

  const byId = new Map(oldTypes.map((t) => [t.id, t]));
  const entries = read("entries", null);
  if (Array.isArray(entries)) {
    write(
      "entries",
      entries.map((e) => {
        const old = byId.get(e.timeTypeId);
        if (old?.category === "travel") {
          // Restid som egen rad blir restid på en arbetsrad
          return { ...e, timeTypeId: "normal", travelHours: e.hours, hours: 0, travelBillable: Boolean(old.billable) };
        }
        if (old?.category === "overtime" && !["ot-komp", "ot-lon"].includes(old.id)) {
          return { ...e, timeTypeId: old.compensation === "leave" ? "ot-komp" : "ot-lon", travelHours: e.travelHours ?? 0 };
        }
        return { ...e, travelHours: e.travelHours ?? 0, travelBillable: e.travelBillable ?? false };
      }),
    );
  }

  // Nya grundtyper, med de frånvarotyper (namn, dolda, egna) som redan fanns
  const types = defaultTimeTypes();
  for (const old of oldTypes.filter((t) => t.category === "absence")) {
    const match = types.find((t) => t.id === old.id);
    if (match) Object.assign(match, { name: old.name, hidden: Boolean(old.hidden) });
    else types.push(type(old.id, old.name, "absence", { hidden: Boolean(old.hidden) }));
  }
  const oldFactor = oldTypes.find((t) => t.category === "overtime" && t.factor)?.factor ?? null;
  write("settings", {
    ...saved,
    timeTypes: types,
    overtime: saved.overtime ?? { ...defaultOvertime(), factor: oldFactor },
    travel: saved.travel ?? defaultTravel(),
  });
}

// Uttag hade tidigare material och antal som fritext ("2 kg"). Flyttar till name/unit/quantity.
// (Bara under utvecklingen av fas 1 – kan tas bort när ingen har gammal data kvar.)
function migrateMaterials() {
  const materials = read("materials", null);
  if (!Array.isArray(materials) || !materials.some((m) => "material" in m)) return;
  write(
    "materials",
    materials.map(({ material, quantity, ...m }) => {
      const match = String(quantity ?? "").trim().replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
      return {
        ...m,
        articleId: m.articleId ?? null,
        name: m.name ?? material,
        quantity: match ? Number(match[1]) : 1,
        unit: m.unit ?? (match ? match[2] || "st" : String(quantity ?? "st")),
      };
    }),
  );
}

// Projektets nummer hette tidigare "littra". Flyttar över sparade projekt till projectNo.
// (Bara under utvecklingen av fas 1 – kan tas bort när ingen har gammal data kvar.)
function migrateProjectNumbers() {
  const projects = read("projects", null);
  if (!Array.isArray(projects) || !projects.some((p) => "littra" in p)) return;
  write(
    "projects",
    projects.map(({ littra, ...p }) => ({ ...p, projectNo: p.projectNo ?? littra })),
  );
}

// Fordon: förmånsbil bensin och diesel blev en rad ("Förmånsbil"), och Skatteverkets belopp är förval.
// - De gamla typerna finns kvar för äldre registreringar men markeras retired (dolda, kan inte väljas).
// - Fordon utan eget belopp får Skatteverkets aktuella förval (VEHICLE_RATES). Egna belopp rörs aldrig.
// Körs vid varje start, så att nya förval följer med när VEHICLE_RATES uppdateras.
function migrateVehicles() {
  const saved = read("settings", null);
  if (!saved || !Array.isArray(saved.vehicleTypes)) return;
  const before = JSON.stringify(saved.vehicleTypes);
  const types = saved.vehicleTypes.map((t) => ({ ...t }));

  const old = types.filter((t) => ["forman-bensin", "forman-diesel"].includes(t.id));
  if (old.length && !types.some((t) => t.id === "forman")) {
    const standard = STANDARD_VEHICLES.find((v) => v.id === "forman");
    // Ett gemensamt eget belopp följer med – annars gäller förvalet
    const ownRates = [...new Set(old.filter(isCustomRate).map((t) => t.ratePerMil))];
    const forman = { ...standard, ...defaultRate("forman"), hidden: old.every((t) => t.hidden) };
    if (ownRates.length === 1) Object.assign(forman, { ratePerMil: ownRates[0], rateYear: Number(today().slice(0, 4)), rateCustom: true });
    types.splice(types.indexOf(old[0]), 0, forman);
  }
  old.forEach((t) => Object.assign(t, { hidden: true, retired: true }));

  for (const t of types) {
    if (t.isCompanyCar) {
      Object.assign(t, { ratePerMil: null, rateYear: null, rateCustom: false });
      continue;
    }
    const custom = isCustomRate(t);
    const standard = VEHICLE_RATES.perMil[t.id];
    if (custom) {
      Object.assign(t, { rateCustom: true, rateYear: t.rateYear ?? (t.ratePerMil === null ? null : Number(today().slice(0, 4))) });
    } else if (standard !== undefined) {
      Object.assign(t, { ratePerMil: standard, rateYear: Math.max(t.rateYear ?? 0, VEHICLE_RATES.year), rateCustom: false });
    } else {
      Object.assign(t, { rateYear: t.rateYear ?? null, rateCustom: false });
    }
  }
  if (JSON.stringify(types) !== before) write("settings", { ...saved, vehicleTypes: types });
}

// Appen hette tidigare Tidra och nycklarna började med "tidra:". Flyttas en gång till "tidla:".
// Rör bara de egna nycklarna – aldrig prototypens tk-*.
const OLD_PREFIX = "tidra:";

function migrateOldPrefix() {
  for (const backend of [local(), session()]) {
    try {
      const keys = [];
      for (let i = 0; i < backend.length; i++) keys.push(backend.key(i));
      for (const key of keys.filter((k) => k?.startsWith(OLD_PREFIX))) {
        const newKey = PREFIX + key.slice(OLD_PREFIX.length);
        if (backend.getItem(newKey) === null) backend.setItem(newKey, backend.getItem(key));
        backend.removeItem(key);
      }
    } catch {
      /* Utan lagring finns inget att flytta */
    }
  }
}

// Testversionen hade tidigare exempelföretag. Deras användare har e-post på ".example",
// som inga riktiga adresser kan ha – finns en sådan raderas all data i webbläsaren.
async function removeDemoCompanies() {
  const users = read("users", []);
  if (Array.isArray(users) && users.some((u) => /\.example$/i.test(u?.email ?? ""))) await resetAllData();
}

// Anropas en gång vid start. Kontrollerar schemaversionen och lyssnar på ändringar från andra flikar.
export async function init() {
  migrateOldPrefix();
  await removeDemoCompanies();
  const version = read("schema", null);
  if (version !== null && version > SCHEMA_VERSION) {
    throw new StoreError("invalid-state", "Datan är sparad av en nyare version av Tidla. Ladda om sidan.");
  }
  migrateProjectNumbers();
  migrateTimeTypes();
  migrateTravelAndOvertime();
  migrateMaterials();
  migrateVehicles();
  if (!initialized && typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key?.startsWith(PREFIX)) emitChange(event.key.slice(PREFIX.length));
    });
  }
  initialized = true;
}

/* ==========================================================================
   Enhetsinställning: tema
   Gäller bara den här webbläsaren och ligger kvar i localStorage även i PHP-fasen.
   Synkrona funktioner, så att temat kan sättas innan sidan hinner ritas.
   ========================================================================== */

const THEMES = ["light", "dark"];

// "light", "dark" eller null (= följ systemets inställning)
export function getThemePreference() {
  try {
    const value = local().getItem(PREFIX + "theme");
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function setThemePreference(theme) {
  try {
    if (THEMES.includes(theme)) local().setItem(PREFIX + "theme", theme);
    else local().removeItem(PREFIX + "theme");
  } catch {
    /* Går det inte att spara gäller valet bara tills sidan laddas om */
  }
}

/* ==========================================================================
   Hjälpfunktioner för validering
   ========================================================================== */

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const sv = (a, b) => String(a).localeCompare(String(b), "sv", { numeric: true, sensitivity: "base" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hasTwoDecimals = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

function text(errors, field, value, { required = false, max = 200, label = "Fältet" } = {}) {
  const result = clean(value);
  if (required && !result) errors[field] = `${label} måste fyllas i.`;
  else if (result.length > max) errors[field] = `${label} får vara högst ${max} tecken.`;
  return result;
}

function email(errors, field, value, { required = false } = {}) {
  const result = lower(value);
  if (!result) {
    if (required) errors[field] = "Ange en e-postadress.";
  } else if (!EMAIL_RE.test(result) || result.length > 120) {
    errors[field] = "Ange en giltig e-postadress.";
  }
  return result;
}

// Organisationsnummer: 10 eller 12 siffror, sparas med bindestreck. Tomt är tillåtet.
function orgNumber(errors, field, value) {
  const raw = clean(value);
  if (!raw) return "";
  const digits = raw.replace(/[\s-]/g, "");
  if (/^\d{10}$/.test(digits)) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  if (/^\d{12}$/.test(digits)) return `${digits.slice(0, 8)}-${digits.slice(8)}`;
  errors[field] = "Ange 10 siffror, t.ex. 556677-8899.";
  return raw;
}

function workWeek(errors, field, week) {
  const result = {};
  for (const day of WEEKDAYS) {
    const hours = Number(week?.[day] ?? 0);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 || !hasTwoDecimals(hours)) {
      errors[`${field}.${day}`] = "Ange 0–24 timmar.";
    } else {
      result[day] = hours;
    }
  }
  return result;
}

function fail(errors, message = "Kontrollera de markerade fälten.") {
  if (Object.keys(errors).length) {
    const duplicate = Object.values(errors).some((m) => m.includes("används redan") || m.includes("finns redan"));
    throw new StoreError(duplicate ? "duplicate" : "validation", message, errors);
  }
}

const notFound = (what = "Posten") => new StoreError("not-found", `${what} finns inte längre.`);

/* ==========================================================================
   Session och behörighet
   ========================================================================== */

function readSession() {
  for (const backend of [session(), local()]) {
    try {
      const raw = backend.getItem(PREFIX + "session");
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignoreras */
    }
  }
  return null;
}

function clearSession() {
  for (const backend of [session(), local()]) {
    try {
      backend.removeItem(PREFIX + "session");
    } catch {
      /* ignoreras */
    }
  }
}

// "Kom ihåg mig" sparar sessionen i localStorage, annars i sessionStorage
function writeSession(userId, remember) {
  clearSession();
  try {
    (remember ? local() : session()).setItem(PREFIX + "session", JSON.stringify({ userId, createdAt: Date.now() }));
  } catch {
    throw new StoreError("storage", "Det gick inte att spara inloggningen i webbläsaren.");
  }
}

function currentUserRecord() {
  const current = readSession();
  if (!current) return null;
  const user = all("users").find((u) => u.id === current.userId);
  if (!user || user.status === "inactive") {
    clearSession();
    return null;
  }
  return user;
}

function requireUser({ allowPasswordChange = false } = {}) {
  const user = currentUserRecord();
  if (!user) throw new StoreError("unauthenticated", "Du är inte inloggad.");
  if (user.mustChangePassword && !allowPasswordChange) {
    throw new StoreError("forbidden", "Du måste välja ett eget lösenord först.");
  }
  return user;
}

function requireAdmin() {
  const user = requireUser();
  if (user.role !== "admin") throw new StoreError("forbidden", "Det här kräver administratörsbehörighet.");
  return user;
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...rest } = user;
  return copy(rest);
}

const activeAdmins = (users) => users.filter((u) => u.role === "admin" && u.status === "active");

/* ==========================================================================
   Inställningar
   ========================================================================== */

export const DEFAULT_WORK_WEEK = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
export const HOUR_STEPS = [0.25, 0.5, 1];

/* ---------- Typer av tid ----------
   Varje registrering har en typ:
     work     Arbete                              – kräver kund och projekt (bara kund om projekt är avstängt)
     overtime Övertid – komptid / Övertid – lön   – som arbete, räknas utöver schemat
     absence  frånvarotyper                       – ingen kund, inget projekt, ingen resa
   Restid och milersättning är en del av registreringen (travelHours, travelBillable, fordon).
   Vilka övertidsval som syns och hur restid fungerar styrs av admin (settings.overtime, settings.travel). */
export const TIME_CATEGORIES = {
  work: "Arbete",
  overtime: "Övertid",
  absence: "Frånvaro",
};
export const OVERTIME_MODES = {
  both: "Båda – medarbetaren väljer",
  pay: "Bara lön",
  leave: "Bara komptid",
  off: "Av",
};

const type = (id, name, category, extra = {}) => ({ id, name, category, compensation: null, hidden: false, ...extra });

function defaultTimeTypes() {
  return [
    type("normal", "Arbete", "work"),
    type("ot-komp", "Övertid – komptid", "overtime", { compensation: "leave" }),
    type("ot-lon", "Övertid – lön", "overtime", { compensation: "pay" }),
    type("semester", "Semester", "absence"),
    type("sjuk", "Sjukfrånvaro", "absence"),
    type("vab", "VAB", "absence"),
    type("foraldraledig", "Föräldraledig", "absence"),
    type("tio-dagar", "10 föräldradagar", "absence"),
    type("narstaende", "Vård av närstående", "absence"),
    type("tjanstledighet", "Tjänstledighet", "absence"),
    type("permission", "Permission", "absence"),
    type("helgdag", "Helgdag", "absence"),
  ];
}

// factor följer bara med i exporten som underlag – lönen räknas i lönesystemet
function defaultOvertime() {
  return { mode: "both", factor: null };
}

// Av: tid och uttag rapporteras direkt på en kund (customerId) i stället för på ett projekt
function defaultProjects() {
  return { enabled: true };
}

const projectsEnabled = (settings = settingsRecord()) => settings.projects?.enabled !== false;

function defaultTravel() {
  return { enabled: true, billableDefault: false, employeeCanChangeBilling: true, countsTowardSchedule: false };
}

// Typen som används när ingen typ anges
function defaultWorkType(settings) {
  return settings.timeTypes.find((t) => t.category === "work") ?? settings.timeTypes[0];
}

// Vilka övertidstyper som får väljas enligt admins inställning
function overtimeAllowed(settings, timeType) {
  if (timeType?.category !== "overtime") return true;
  const mode = settings.overtime?.mode ?? "both";
  if (mode === "off") return false;
  if (mode === "both") return true;
  return timeType.compensation === mode;
}

function defaultSettings() {
  return {
    companyName: "",
    orgNumber: "",
    workWeek: { ...DEFAULT_WORK_WEEK },
    hourStep: 0.5,
    retentionMonths: 36,
    timeTypes: defaultTimeTypes(),
    overtime: defaultOvertime(),
    travel: defaultTravel(),
    projects: defaultProjects(),
    materials: defaultMaterials(),
    // Senaste datum då admin kontrollerade milersättningen mot Skatteverket
    ratesCheckedAt: null,
    // Steg 1 i Kom igång. Nya konton börjar med false; äldre konton saknar nyckeln och räknas som klara.
    companyReviewed: true,
    vehicleTypes: STANDARD_VEHICLES.map((v) => ({ ...v, ...defaultRate(v.id) })),
  };
}

/* ---------- Fordon och milersättning ----------
   Skatteverkets skattefria belopp per mil. Ändra här när Skatteverket ändrar beloppen (vid årsskiftet).
   Förvalen följer med automatiskt till fordon där admin inte har skrivit ett eget belopp – egna belopp
   skrivs aldrig över (se migrateVehicles). Varje fordon sparar vilket år beloppet gäller (rateYear). */
export const VEHICLE_RATES = {
  year: 2026,
  url: "https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html",
  perMil: { "privat-bil": 25, forman: 12, "forman-el": 9.5 },
};

// Bara firmabil och privat bil syns från början – övriga lägger admin till under Inställningar.
// Förmånsbil (bensin, diesel, laddhybrid) har samma belopp och är därför en rad.
export const STANDARD_VEHICLES = [
  { id: "firmabil", name: "Firmabil", isCompanyCar: true, hidden: false },
  { id: "privat-bil", name: "Privat bil", isCompanyCar: false, hidden: false },
  { id: "forman", name: "Förmånsbil", isCompanyCar: false, hidden: true },
  { id: "forman-el", name: "Förmånsbil – el", isCompanyCar: false, hidden: true },
  { id: "motorcykel", name: "Motorcykel", isCompanyCar: false, hidden: true },
];

// Förvalt belopp (eller inget) för ett fordon. rateCustom = admin har skrivit ett eget belopp.
function defaultRate(id) {
  const rate = VEHICLE_RATES.perMil[id] ?? null;
  return { ratePerMil: rate, rateYear: rate === null ? null : VEHICLE_RATES.year, rateCustom: false };
}

// Är beloppet ett eget belopp? Äldre data saknar rateCustom – då är ett ifyllt belopp som skiljer sig från förvalet eget.
function isCustomRate(vehicle) {
  if (typeof vehicle.rateCustom === "boolean") return vehicle.rateCustom;
  const standard = VEHICLE_RATES.perMil[vehicle.id];
  return vehicle.ratePerMil !== null && vehicle.ratePerMil !== undefined && vehicle.ratePerMil !== standard;
}

function settingsRecord() {
  return { ...defaultSettings(), ...(read("settings", null) || {}) };
}

// Kan läsas utan inloggning (företagsnamnet visas på inloggningen)
export async function getSettings() {
  return copy(settingsRecord());
}

export async function saveSettings(patch) {
  requireAdmin();
  const settings = settingsRecord();
  const errors = {};
  const next = { ...settings };

  if ("companyName" in patch) {
    next.companyName = text(errors, "companyName", patch.companyName, { required: true, max: 100, label: "Företagsnamn" });
  }
  if ("orgNumber" in patch) next.orgNumber = orgNumber(errors, "orgNumber", patch.orgNumber);
  if ("workWeek" in patch) next.workWeek = workWeek(errors, "workWeek", patch.workWeek);
  if ("hourStep" in patch) {
    const step = Number(patch.hourStep);
    if (!HOUR_STEPS.includes(step)) errors.hourStep = "Välj 15, 30 eller 60 minuter.";
    else next.hourStep = step;
  }
  if ("ratesCheckedAt" in patch) {
    const date = String(patch.ratesCheckedAt ?? "");
    if (!isValidISODate(date) || date > today()) errors.ratesCheckedAt = "Ogiltigt datum.";
    else next.ratesCheckedAt = date;
  }
  if ("retentionMonths" in patch) {
    const months = Number(patch.retentionMonths);
    if (!Number.isInteger(months) || months < 1 || months > 240) errors.retentionMonths = "Ange 1–240 månader.";
    else next.retentionMonths = months;
  }
  if ("overtime" in patch) {
    const mode = patch.overtime?.mode;
    if (!OVERTIME_MODES[mode]) errors["overtime.mode"] = "Välj hur övertid ska ersättas.";
    let factor = patch.overtime?.factor;
    factor = factor === null || factor === undefined || factor === "" ? null : Number(factor);
    if (factor !== null && (!Number.isFinite(factor) || factor < 1 || factor > 5 || !hasTwoDecimals(factor))) {
      errors["overtime.factor"] = "Ange en faktor mellan 1 och 5, t.ex. 1,5 – eller lämna tomt.";
    }
    next.overtime = { mode, factor };
  }
  if ("materials" in patch) {
    const materials = patch.materials ?? {};
    next.materials = {
      enabled: Boolean(materials.enabled),
      label: text(errors, "materials.label", materials.label, { required: true, max: 30, label: "Benämningen" }),
      allowFreeText: Boolean(materials.allowFreeText),
    };
  }
  if ("projects" in patch) {
    next.projects = { enabled: Boolean(patch.projects?.enabled) };
  }
  if ("travel" in patch) {
    const travel = patch.travel ?? {};
    next.travel = {
      enabled: Boolean(travel.enabled),
      billableDefault: Boolean(travel.billableDefault),
      employeeCanChangeBilling: Boolean(travel.employeeCanChangeBilling),
      countsTowardSchedule: Boolean(travel.countsTowardSchedule),
    };
  }
  fail(errors);
  if ("companyName" in patch || "workWeek" in patch) next.companyReviewed = true;
  write("settings", next);
  return copy(next);
}

// Byta namn på eller dölja en typ av tid, eller lägga till en ny typ:
//   category "absence" = frånvaro, "work" = arbetstid utan kund och projekt (t.ex. utbildning) – placeless
// Typer tas aldrig bort – de kan finnas i historiken. Grundtypen "Arbete" kan inte döljas.
export async function saveTimeType({ id, name, hidden = false, category = "absence" }) {
  requireAdmin();
  const settings = settingsRecord();
  const errors = {};
  const cleanName = text(errors, "name", name, { required: true, max: 40, label: "Namnet" });
  const types = settings.timeTypes.map((t) => ({ ...t }));
  const existing = id ? types.find((t) => t.id === id) : null;
  if (id && !existing) throw notFound("Typen");
  if (types.some((t) => t.id !== id && lower(t.name) === cleanName.toLowerCase())) {
    errors.name = "Namnet används redan.";
  }
  if (existing?.category === "work" && !existing.placeless && hidden) errors.hidden = "Arbete kan inte döljas.";
  fail(errors);

  if (existing) Object.assign(existing, { name: cleanName, hidden: Boolean(hidden) });
  else if (category === "work") types.push(type(newId(), cleanName, "work", { placeless: true, hidden: Boolean(hidden) }));
  else types.push(type(newId(), cleanName, "absence", { hidden: Boolean(hidden) }));
  write("settings", { ...settings, timeTypes: types });
  return copy(types);
}

// Belopp per mil: tomt = null, annars kronor med högst två decimaler
function ratePerMil(errors, field, value) {
  if (value === null || value === "" || value === undefined) return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000 || !hasTwoDecimals(rate)) {
    errors[field] = "Ange ett belopp i kronor, t.ex. 25 eller 12,50.";
  }
  return rate;
}

// Nytt belopp på ett fordon. Samma som Skatteverkets förval = följer förvalet även i fortsättningen.
// Firmabil har aldrig något belopp – företaget står för kostnaden.
function applyRate(vehicle, rate) {
  if (vehicle.isCompanyCar) return Object.assign(vehicle, { ratePerMil: null, rateYear: null, rateCustom: false });
  const standard = VEHICLE_RATES.perMil[vehicle.id];
  if (standard !== undefined && rate === standard) {
    const year = Math.max(vehicle.rateCustom ? 0 : vehicle.rateYear ?? 0, VEHICLE_RATES.year);
    return Object.assign(vehicle, { ratePerMil: rate, rateYear: year, rateCustom: false });
  }
  if (rate === vehicle.ratePerMil && vehicle.rateCustom) return vehicle;
  return Object.assign(vehicle, { ratePerMil: rate, rateYear: rate === null ? null : Number(today().slice(0, 4)), rateCustom: true });
}

// Byta namn på, dölja/visa eller lägga till ett fordon (id saknas = nytt eget fordon)
export async function saveVehicleType({ id, name, ratePerMil: rateValue = null, hidden = false }) {
  requireAdmin();
  const settings = settingsRecord();
  const errors = {};
  const cleanName = text(errors, "name", name, { required: true, max: 40, label: "Namnet" });
  const rate = ratePerMil(errors, "ratePerMil", rateValue);
  const types = settings.vehicleTypes.map((t) => ({ ...t }));
  const existing = id ? types.find((t) => t.id === id) : null;
  if (id && !existing) throw notFound("Fordonstypen");
  if (types.some((t) => t.id !== id && !t.retired && lower(t.name) === cleanName.toLowerCase())) {
    errors.name = "Namnet används redan.";
  }
  fail(errors);
  if (existing) {
    Object.assign(existing, { name: cleanName, hidden: Boolean(hidden) });
    if (existing.ratePerMil !== rate) applyRate(existing, rate);
  } else {
    types.push(applyRate({ id: newId(), name: cleanName, isCompanyCar: false, ratePerMil: null, hidden: Boolean(hidden) }, rate));
  }
  write("settings", { ...settings, vehicleTypes: types });
  return copy(types);
}

// Belopp för flera fordon på en gång (redigera i listan): { fordons-id: belopp eller "" }
// Fältfelen heter rate-<fordons-id>.
export async function saveVehicleRates(rates) {
  requireAdmin();
  const settings = settingsRecord();
  const errors = {};
  const types = settings.vehicleTypes.map((t) => ({ ...t }));
  const changes = [];
  for (const [id, value] of Object.entries(rates ?? {})) {
    const vehicle = types.find((t) => t.id === id);
    if (!vehicle) throw notFound("Fordonstypen");
    changes.push([vehicle, ratePerMil(errors, `rate-${id}`, value)]);
  }
  fail(errors, "Kontrollera beloppen.");
  for (const [vehicle, rate] of changes) {
    if (vehicle.ratePerMil !== rate) applyRate(vehicle, rate);
  }
  write("settings", { ...settings, vehicleTypes: types });
  return copy(types);
}

// "Jag har kontrollerat beloppen": beloppen gäller i år också
export async function confirmVehicleRates() {
  requireAdmin();
  const settings = settingsRecord();
  const year = Number(today().slice(0, 4));
  const types = settings.vehicleTypes.map((t) =>
    t.ratePerMil === null || t.ratePerMil === undefined ? t : { ...t, rateYear: Math.max(t.rateYear ?? 0, year) },
  );
  write("settings", { ...settings, vehicleTypes: types, ratesCheckedAt: today() });
  return copy(types);
}

/* ==========================================================================
   Första start
   ========================================================================== */

export async function needsSetup() {
  return all("users").length === 0;
}

// FAS 2: POST /api/setup – får bara lyckas när användartabellen är tom
export async function completeSetup({ companyName, orgNumber: org, workWeek: week, admin = {} }) {
  if (all("users").length) throw new StoreError("invalid-state", "Tidla är redan konfigurerat.");
  const errors = {};
  const company = text(errors, "companyName", companyName, { required: true, max: 100, label: "Företagsnamn" });
  const cleanOrg = orgNumber(errors, "orgNumber", org);
  const cleanWeek = workWeek(errors, "workWeek", week ?? DEFAULT_WORK_WEEK);
  const name = text(errors, "name", admin.name, { required: true, max: 100, label: "Namn" });
  const mail = email(errors, "email", admin.email, { required: true });
  if (String(admin.password ?? "").length < MIN_PASSWORD_LENGTH) {
    errors.password = `Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`;
  }
  fail(errors);

  const salt = createSalt();
  const now = Date.now();
  const user = {
    id: newId(),
    employeeNo: "1",
    name,
    email: mail,
    phone: "",
    title: "",
    role: "admin",
    status: "active",
    schedule: null,
    passwordHash: await hashPassword(admin.password, salt),
    salt,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
  };
  write("settings", { ...defaultSettings(), companyName: company, orgNumber: cleanOrg, workWeek: cleanWeek, companyReviewed: false });
  write("users", [user]);
  writeSession(user.id, false);
  return publicUser(user);
}

/* ==========================================================================
   Inloggning (FAS 1 – flyttas till servern i PHP-fasen)
   ========================================================================== */

export async function getSession() {
  return publicUser(currentUserRecord());
}

export async function login(emailAddress, password, remember = false) {
  const invalid = new StoreError("unauthenticated", "Fel e-post eller lösenord.");
  const user = all("users").find((u) => u.email === lower(emailAddress));
  if (!user || !password) throw invalid;
  if (!(await verifyPassword(String(password), user.salt, user.passwordHash))) throw invalid;
  if (user.status === "inactive") {
    throw new StoreError("forbidden", "Kontot är inaktiverat. Kontakta din administratör.");
  }
  writeSession(user.id, remember);
  return publicUser(user);
}

export async function logout() {
  clearSession();
}

// Används både vid första inloggningen (engångslösenord) och under Profil
export async function changePassword({ currentPassword, newPassword }) {
  const me = requireUser({ allowPasswordChange: true });
  const errors = {};
  // Efter inloggning med engångslösenord behövs det inte igen – sessionen visar redan att det stämde
  if (!me.mustChangePassword) {
    if (!currentPassword || !(await verifyPassword(String(currentPassword), me.salt, me.passwordHash))) {
      errors.currentPassword = "Lösenordet stämmer inte.";
    }
  }
  if (String(newPassword ?? "").length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Lösenordet måste ha minst ${MIN_PASSWORD_LENGTH} tecken.`;
  } else if (await verifyPassword(String(newPassword), me.salt, me.passwordHash)) {
    errors.newPassword = "Välj ett annat lösenord än det nuvarande.";
  }
  fail(errors);

  const users = all("users");
  const user = users.find((u) => u.id === me.id);
  const salt = createSalt();
  const now = Date.now();
  Object.assign(user, {
    salt,
    passwordHash: await hashPassword(newPassword, salt),
    mustChangePassword: false,
    status: user.status === "pending" ? "active" : user.status,
    activatedAt: user.activatedAt ?? now,
    updatedAt: now,
  });
  write("users", users);
  return publicUser(user);
}

/* ==========================================================================
   Anställda
   ========================================================================== */

export async function listUsers({ includeInactive = true } = {}) {
  const me = requireUser();
  if (me.role !== "admin") return [publicUser(me)];
  return all("users")
    .filter((u) => includeInactive || u.status !== "inactive")
    .sort((a, b) => sv(a.name, b.name))
    .map(publicUser);
}

export async function getUser(id) {
  const me = requireUser();
  if (me.role !== "admin" && id !== me.id) throw new StoreError("forbidden", "Du kan bara se ditt eget konto.");
  const user = all("users").find((u) => u.id === id);
  if (!user) throw notFound("Den anställde");
  return publicUser(user);
}

// Skapar eller ändrar en anställd. Nya anställda får ett engångslösenord som visas en gång.
export async function saveUser(data) {
  const me = requireAdmin();
  const users = all("users");
  const existing = data.id ? users.find((u) => u.id === data.id) : null;
  if (data.id && !existing) throw notFound("Den anställde");

  const errors = {};
  const name = text(errors, "name", data.name, { required: true, max: 100, label: "Namn" });
  const employeeNo = text(errors, "employeeNo", data.employeeNo, { required: true, max: 20, label: "Anställningsnummer" });
  const mail = email(errors, "email", data.email, { required: true });
  const phone = text(errors, "phone", data.phone, { max: 30, label: "Telefon" });
  const title = text(errors, "title", data.title, { max: 60, label: "Befattning" });
  const role = data.role === "admin" ? "admin" : data.role === "employee" ? "employee" : null;
  if (!role) errors.role = "Välj en roll.";
  const schedule = data.schedule ? workWeek(errors, "schedule", data.schedule) : null;
  // Ett ändrat schema gäller från ett valt datum (förval idag) – äldre veckor behåller schemat som gällde då
  const scheduleFrom = data.scheduleFrom ? String(data.scheduleFrom) : today();
  if (!isValidISODate(scheduleFrom)) errors.scheduleFrom = "Välj ett giltigt datum.";

  const others = users.filter((u) => u.id !== data.id);
  if (employeeNo && others.some((u) => lower(u.employeeNo) === employeeNo.toLowerCase())) {
    errors.employeeNo = "Anställningsnumret används redan.";
  }
  if (mail && others.some((u) => u.email === mail)) errors.email = "E-postadressen används redan.";
  if (existing && existing.role === "admin" && role === "employee" && existing.status === "active") {
    if (activeAdmins(users).length <= 1) errors.role = "Det måste finnas minst en aktiv administratör.";
    else if (existing.id === me.id) errors.role = "Du kan inte ta bort din egen administratörsroll.";
  }
  fail(errors);

  const now = Date.now();
  if (existing) {
    const changed = JSON.stringify(weekOn(existing, scheduleFrom, null)) !== JSON.stringify(schedule);
    if (changed) {
      // Utan registreringar finns ingen historik att skydda – då gäller schemat från början
      const hasEntries = all("entries").some((e) => e.userId === existing.id);
      existing.schedulePeriods = withPeriod(existing, hasEntries ? scheduleFrom : null, schedule);
      existing.schedule = schedule;
    } else {
      existing.schedulePeriods = schedulePeriods(existing);
    }
    Object.assign(existing, { name, employeeNo, email: mail, phone, title, role, updatedAt: now });
    write("users", users);
    return { user: publicUser(existing), oneTimePassword: null };
  }

  const oneTimePassword = createOneTimePassword();
  const salt = createSalt();
  const user = {
    id: newId(),
    employeeNo,
    name,
    email: mail,
    phone,
    title,
    role,
    status: "pending",
    schedule,
    schedulePeriods: schedule ? [{ from: null, week: schedule }] : [],
    passwordHash: await hashPassword(oneTimePassword, salt),
    salt,
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
  };
  users.push(user);
  write("users", users);
  return { user: publicUser(user), oneTimePassword };
}

// status: "inactive" (inaktivera) eller "active" (återaktivera)
export async function setUserStatus(id, status) {
  const me = requireAdmin();
  const users = all("users");
  const user = users.find((u) => u.id === id);
  if (!user) throw notFound("Den anställde");

  if (status === "inactive") {
    if (user.id === me.id) throw new StoreError("invalid-state", "Du kan inte inaktivera dig själv.");
    if (user.role === "admin" && user.status === "active" && activeAdmins(users).length <= 1) {
      throw new StoreError("invalid-state", "Det måste finnas minst en aktiv administratör.");
    }
    user.status = "inactive";
  } else if (status === "active") {
    // Den som aldrig har valt ett eget lösenord hamnar i "Väntar på aktivering" igen
    user.status = user.activatedAt && !user.mustChangePassword ? "active" : "pending";
  } else {
    throw new StoreError("validation", "Okänd status.");
  }
  user.updatedAt = Date.now();
  write("users", users);
  return publicUser(user);
}

// Skapar ett nytt engångslösenord. Användaren måste välja ett eget vid nästa inloggning.
export async function resetPassword(id) {
  const me = requireAdmin();
  if (id === me.id) throw new StoreError("invalid-state", "Byt ditt eget lösenord under Profil.");
  const users = all("users");
  const user = users.find((u) => u.id === id);
  if (!user) throw notFound("Den anställde");
  const oneTimePassword = createOneTimePassword();
  user.salt = createSalt();
  user.passwordHash = await hashPassword(oneTimePassword, user.salt);
  user.mustChangePassword = true;
  user.updatedAt = Date.now();
  write("users", users);
  return { user: publicUser(user), oneTimePassword };
}

// Bara anställda utan registreringar kan raderas – övriga inaktiveras
export async function deleteUser(id) {
  const me = requireAdmin();
  const users = all("users");
  const user = users.find((u) => u.id === id);
  if (!user) throw notFound("Den anställde");
  if (user.id === me.id) throw new StoreError("invalid-state", "Du kan inte ta bort dig själv.");
  if (all("entries").some((e) => e.userId === id) || all("materials").some((m) => m.userId === id)) {
    throw new StoreError("in-use", "Den anställde har registreringar och kan bara inaktiveras.");
  }
  if (user.role === "admin" && user.status === "active" && activeAdmins(users).length <= 1) {
    throw new StoreError("invalid-state", "Det måste finnas minst en aktiv administratör.");
  }
  write("users", users.filter((u) => u.id !== id));
}

/* ---------- Schema ---------- */

// Veckoschemat som gällde ett visst datum (eget schema i perioder, annars företagets)
function scheduleOn(user, date, settings = settingsRecord()) {
  return weekOn(user, date, settings.workWeek);
}

// Tid enligt schema en viss dag (egen, eller valfri anställd för admin)
export async function getScheduledHours(date, userId) {
  const me = requireUser();
  const targetId = userId ?? me.id;
  if (me.role !== "admin" && targetId !== me.id) throw new StoreError("forbidden", "Du kan bara se ditt eget schema.");
  const user = all("users").find((u) => u.id === targetId);
  if (!user) throw notFound("Den anställde");
  return scheduleOn(user, date)[weekdayKey(date)] ?? 0;
}

export async function getWorkWeek(userId) {
  const me = requireUser();
  const targetId = userId ?? me.id;
  if (me.role !== "admin" && targetId !== me.id) throw new StoreError("forbidden", "Du kan bara se ditt eget schema.");
  const user = all("users").find((u) => u.id === targetId);
  if (!user) throw notFound("Den anställde");
  return copy(scheduleOn(user, today()));
}

/* ==========================================================================
   Kunder
   ========================================================================== */

export async function listCustomers({ includeArchived = false } = {}) {
  const me = requireUser();
  const showArchived = includeArchived && me.role === "admin";
  return copy(
    all("customers")
      .filter((c) => showArchived || !c.archived)
      .sort((a, b) => sv(a.name, b.name)),
  );
}

export async function saveCustomer(data) {
  requireAdmin();
  const customers = all("customers");
  const existing = data.id ? customers.find((c) => c.id === data.id) : null;
  if (data.id && !existing) throw notFound("Kunden");

  const errors = {};
  const record = {
    customerNo: text(errors, "customerNo", data.customerNo, { required: true, max: 20, label: "Kundnummer" }),
    name: text(errors, "name", data.name, { required: true, max: 100, label: "Namn" }),
    orgNumber: orgNumber(errors, "orgNumber", data.orgNumber),
  };
  if (
    record.customerNo &&
    customers.some((c) => c.id !== data.id && lower(c.customerNo) === record.customerNo.toLowerCase())
  ) {
    errors.customerNo = "Kundnumret används redan.";
  }
  fail(errors);

  const now = Date.now();
  if (existing) Object.assign(existing, record, { updatedAt: now });
  else customers.push({ id: newId(), ...record, archived: false, createdAt: now, updatedAt: now });
  write("customers", customers);
  return copy(existing ?? customers[customers.length - 1]);
}

export async function setCustomerArchived(id, archived) {
  requireAdmin();
  const customers = all("customers");
  const customer = customers.find((c) => c.id === id);
  if (!customer) throw notFound("Kunden");
  customer.archived = Boolean(archived);
  customer.updatedAt = Date.now();
  write("customers", customers);
  return copy(customer);
}

// Kunder med projekt eller registreringar kan inte raderas, bara arkiveras
export async function deleteCustomer(id) {
  requireAdmin();
  const customers = all("customers");
  if (!customers.some((c) => c.id === id)) throw notFound("Kunden");
  if (all("projects").some((p) => p.customerId === id)) {
    throw new StoreError("in-use", "Kunden har projekt och kan bara arkiveras.");
  }
  if (all("entries").some((e) => e.customerId === id) || all("materials").some((m) => m.customerId === id)) {
    throw new StoreError("in-use", "Kunden har registreringar och kan bara arkiveras.");
  }
  write("customers", customers.filter((c) => c.id !== id));
}

/* ==========================================================================
   Projekt
   ========================================================================== */

const isSelectableCustomer = (customer) => Boolean(customer) && !customer.archived;

// Kunden som en tidrad eller ett uttag hör till: projektets kund, annars customerId (rad utan projekt)
function customerIdOf(row, projects) {
  if (!row.projectId) return row.customerId ?? null;
  return projects.find((p) => p.id === row.projectId)?.customerId ?? null;
}

function isSelectableProject(project, customers) {
  if (!project || project.archived || project.status !== "open") return false;
  const customer = customers.find((c) => c.id === project.customerId);
  return Boolean(customer) && !customer.archived;
}

// Filter: customerId, status ("open"/"closed"), includeArchived (admin), selectableOnly, q (sök)
export async function listProjects({ customerId, status, includeArchived = false, selectableOnly = false, q } = {}) {
  const me = requireUser();
  const showArchived = includeArchived && me.role === "admin";
  const customers = all("customers");
  const query = lower(q);
  return copy(
    all("projects")
      .filter((p) => {
        const customer = customers.find((c) => c.id === p.customerId);
        if (!showArchived && (p.archived || customer?.archived)) return false;
        if (selectableOnly && !isSelectableProject(p, customers)) return false;
        if (customerId && p.customerId !== customerId) return false;
        if (status && p.status !== status) return false;
        if (query) {
          const haystack = `${p.projectNo} ${p.name} ${p.address} ${customer?.customerNo ?? ""} ${customer?.name ?? ""}`;
          if (!haystack.toLowerCase().includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => sv(a.projectNo, b.projectNo)),
  );
}

export async function saveProject(data) {
  requireAdmin();
  const projects = all("projects");
  const customers = all("customers");
  const existing = data.id ? projects.find((p) => p.id === data.id) : null;
  if (data.id && !existing) throw notFound("Projektet");

  const errors = {};
  const customer = customers.find((c) => c.id === data.customerId);
  if (!customer) errors.customerId = "Välj en kund.";
  else if (customer.archived && existing?.customerId !== customer.id) errors.customerId = "Kunden är arkiverad.";
  const record = {
    customerId: data.customerId,
    projectNo: text(errors, "projectNo", data.projectNo, { required: true, max: 30, label: "Projektnummer" }),
    name: text(errors, "name", data.name, { required: true, max: 120, label: "Projektnamn" }),
    address: text(errors, "address", data.address, { max: 200, label: "Projektadress" }),
    contactName: text(errors, "contactName", data.contactName, { max: 120, label: "Kontaktperson" }),
    contactPhone: text(errors, "contactPhone", data.contactPhone, { max: 30, label: "Telefon" }),
    contactEmail: email(errors, "contactEmail", data.contactEmail),
    description: text(errors, "description", data.description, { max: 4000, label: "Beskrivningen" }),
    status: data.status === "closed" ? "closed" : "open",
  };
  if (record.projectNo && projects.some((p) => p.id !== data.id && lower(p.projectNo) === record.projectNo.toLowerCase())) {
    errors.projectNo = "Projektnumret används redan.";
  }
  fail(errors);

  const now = Date.now();
  record.closedAt = record.status === "closed" ? (existing?.status === "closed" ? existing.closedAt : today()) : null;
  if (existing) Object.assign(existing, record, { updatedAt: now });
  else projects.push({ id: newId(), ...record, documents: [], archived: false, createdAt: now, updatedAt: now });
  write("projects", projects);
  return copy(existing ?? projects[projects.length - 1]);
}

export async function setProjectStatus(id, status) {
  requireAdmin();
  if (!["open", "closed"].includes(status)) throw new StoreError("validation", "Okänd status.");
  const projects = all("projects");
  const project = projects.find((p) => p.id === id);
  if (!project) throw notFound("Projektet");
  project.status = status;
  project.closedAt = status === "closed" ? today() : null;
  project.updatedAt = Date.now();
  write("projects", projects);
  return copy(project);
}

export async function setProjectArchived(id, archived) {
  requireAdmin();
  const projects = all("projects");
  const project = projects.find((p) => p.id === id);
  if (!project) throw notFound("Projektet");
  project.archived = Boolean(archived);
  project.updatedAt = Date.now();
  write("projects", projects);
  return copy(project);
}

export async function deleteProject(id) {
  requireAdmin();
  const projects = all("projects");
  if (!projects.some((p) => p.id === id)) throw notFound("Projektet");
  if (all("entries").some((e) => e.projectId === id) || all("materials").some((m) => m.projectId === id)) {
    throw new StoreError("in-use", "Projektet har registreringar och kan bara avslutas eller arkiveras.");
  }
  const documents = projects.find((p) => p.id === id).documents ?? [];
  write("projects", projects.filter((p) => p.id !== id));
  await removeFiles(documents.map((d) => d.id)).catch(() => {});
}

/* ---------- Projektdokument (ritningar, arbetsordrar …) ----------
   Filerna ligger i IndexedDB – localStorage rymmer inte ritningar. Listan över dem ligger på projektet
   (project.documents). Säkerhetskopian innehåller bara listan, inte filerna.
   Fas 2: filerna laddas upp till servern i stället. */

const FILE_DB = "tidla-files";
const FILE_STORE = "files";
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;
let fileDbPromise = null;

const fileStorageError = () =>
  new StoreError("storage", "Det gick inte att spara filen. Webbläsarens lagring kan vara full eller avstängd.");

function fileDb() {
  if (!globalThis.indexedDB) return Promise.reject(fileStorageError());
  fileDbPromise ??= new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(FILE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(fileStorageError());
  }).catch((error) => {
    fileDbPromise = null;
    throw error;
  });
  return fileDbPromise;
}

// run(objectStore) får returnera en IDBRequest – dess resultat blir svaret
async function fileTransaction(mode, run) {
  const db = await fileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, mode);
    const request = run(tx.objectStore(FILE_STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(fileStorageError());
  });
}

const removeFiles = (ids) =>
  ids.length ? fileTransaction("readwrite", (files) => ids.forEach((id) => files.delete(id))) : Promise.resolve();

// Medarbetare ser inte arkiverade projekt (eller projekt hos arkiverade kunder)
function visibleProject(id) {
  const me = requireUser();
  const project = all("projects").find((p) => p.id === id);
  const customer = project && all("customers").find((c) => c.id === project.customerId);
  if (!project || (me.role !== "admin" && (project.archived || customer?.archived))) throw notFound("Projektet");
  return project;
}

// files: File-objekt från ett <input type="file">
export async function addProjectDocuments(projectId, files) {
  requireAdmin();
  visibleProject(projectId);
  const list = [...(files ?? [])];
  if (!list.length) throw new StoreError("validation", "Välj minst en fil.");
  const tooBig = list.find((f) => f.size > MAX_DOCUMENT_SIZE);
  if (tooBig) throw new StoreError("validation", `${tooBig.name} är för stor. En fil får vara högst 20 MB.`);
  const empty = list.find((f) => !f.size);
  if (empty) throw new StoreError("validation", `${empty.name} är tom.`);

  const now = Date.now();
  const added = list.map((f) => ({
    id: newId(),
    name: clean(f.name).slice(0, 200) || "Namnlös fil",
    type: f.type || "",
    size: f.size,
    addedAt: now,
  }));
  await fileTransaction("readwrite", (files) => added.forEach((d, i) => files.put(list[i], d.id)));

  const projects = all("projects");
  const project = projects.find((p) => p.id === projectId);
  project.documents = [...(project.documents ?? []), ...added];
  project.updatedAt = now;
  try {
    write("projects", projects);
  } catch (error) {
    await removeFiles(added.map((d) => d.id)).catch(() => {});
    throw error;
  }
  return copy(project);
}

export async function deleteProjectDocument(projectId, documentId) {
  requireAdmin();
  const projects = all("projects");
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw notFound("Projektet");
  if (!(project.documents ?? []).some((d) => d.id === documentId)) throw notFound("Dokumentet");
  project.documents = project.documents.filter((d) => d.id !== documentId);
  project.updatedAt = Date.now();
  write("projects", projects);
  await removeFiles([documentId]).catch(() => {});
  return copy(project);
}

// Svarar med { name, type, blob }
export async function getProjectDocument(projectId, documentId) {
  const project = visibleProject(projectId);
  const doc = (project.documents ?? []).find((d) => d.id === documentId);
  if (!doc) throw notFound("Dokumentet");
  const blob = await fileTransaction("readonly", (files) => files.get(documentId));
  if (!blob) throw new StoreError("not-found", "Filen finns inte i den här webbläsaren. Be administratören lägga in den igen.");
  return { name: doc.name, type: doc.type, blob };
}

/* ==========================================================================
   Tidrader
   ========================================================================== */

const isMonthLocked = (userId, month) => all("monthLocks").some((l) => l.userId === userId && l.month === month);

const lockedError = () =>
  new StoreError("locked", "Månaden är markerad som klar och låst. Be administratören låsa upp den.");

// Filter: userId, userIds, date, month, from, to, status (sträng eller lista), customerId (även via projekt), projectId,
// timeTypeId, category ("work" | "travel" | "overtime" | "absence", eller lista),
// kind ("project" = allt utom frånvaro | "absence"). Medarbetare får alltid bara sina egna rader.
export async function listEntries(filter = {}) {
  const me = requireUser();
  const f = { ...filter };
  if (me.role !== "admin") {
    f.userId = me.id;
    delete f.userIds;
  }
  const statuses = f.status ? [].concat(f.status) : null;
  const projects = f.customerId ? all("projects") : null;
  const typeCategory = new Map(settingsRecord().timeTypes.map((t) => [t.id, t.category]));
  const categories = f.category ? [].concat(f.category) : null;

  return copy(
    all("entries")
      .filter((e) => {
        if (f.userId && e.userId !== f.userId) return false;
        if (f.userIds && !f.userIds.includes(e.userId)) return false;
        if (f.date && e.date !== f.date) return false;
        if (f.month && !e.date.startsWith(f.month)) return false;
        if (f.from && e.date < f.from) return false;
        if (f.to && e.date > f.to) return false;
        if (statuses && !statuses.includes(e.status)) return false;
        if (f.projectId && e.projectId !== f.projectId) return false;
        if (f.customerId && customerIdOf(e, projects) !== f.customerId) return false;
        const category = typeCategory.get(e.timeTypeId);
        if (f.timeTypeId && e.timeTypeId !== f.timeTypeId) return false;
        if (categories && !categories.includes(category)) return false;
        if (f.kind === "project" && category === "absence") return false;
        if (f.kind === "absence" && category !== "absence") return false;
        return true;
      })
      .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1)),
  );
}

// Senaste egna registreringen före ett datum (för "Samma som igår")
export async function getLastEntryBefore(date) {
  const me = requireUser();
  const earlier = all("entries").filter((e) => e.userId === me.id && e.date < date);
  if (!earlier.length) return null;
  const lastDate = earlier.reduce((max, e) => (e.date > max ? e.date : max), "");
  const sameDay = earlier.filter((e) => e.date === lastDate).sort((a, b) => b.createdAt - a.createdAt);
  return copy(sameDay[0]);
}

// Skapar eller ändrar en egen tidrad. Godkända rader och låsta månader går inte att ändra.
export async function saveEntry(data) {
  const me = requireUser();
  const entries = all("entries");
  const existing = data.id ? entries.find((e) => e.id === data.id) : null;
  if (data.id && !existing) throw notFound("Registreringen");
  if (existing) {
    if (existing.userId !== me.id) throw new StoreError("forbidden", "Du kan bara ändra dina egna registreringar.");
    if (existing.status === "approved") throw new StoreError("locked", "Godkända registreringar är låsta.");
    if (isMonthLocked(me.id, monthOf(existing.date))) throw lockedError();
  }

  const settings = settingsRecord();
  const projects = all("projects");
  const customers = all("customers");
  const errors = {};

  const date = String(data.date ?? "");
  if (!isValidISODate(date)) errors.date = "Välj ett giltigt datum.";

  const validHours = (value) => Number.isFinite(value) && value >= 0 && value <= 24 && hasTwoDecimals(value);
  const hours = Number(data.hours ?? 0);
  if (!validHours(hours)) errors.hours = "Ange 0–24 timmar.";

  let projectId = data.projectId || null;
  let customerId = null;
  // Utan typ blir det vanligt arbete
  const timeTypeId = data.timeTypeId || defaultWorkType(settings).id;
  const timeType = settings.timeTypes.find((t) => t.id === timeTypeId);
  let vehicleTypeId = null;
  let vehicleBasis = null;
  let km = 0;

  const keepsType = existing?.timeTypeId === timeTypeId;
  if (!timeType || (timeType.hidden && !keepsType)) {
    errors.timeTypeId = "Välj typ av tid.";
  } else if (!overtimeAllowed(settings, timeType) && !keepsType) {
    errors.timeTypeId = "Den typen av övertid används inte i företaget.";
  }

  // Restid – en del av registreringen (inte vid frånvaro)
  const travel = settings.travel ?? defaultTravel();
  let travelHours = 0;
  let travelBillable = false;

  if (timeType?.category === "absence" || timeType?.placeless) {
    // Frånvaro, och arbetstid utan kund (t.ex. utbildning): ingen kund, inget projekt och inget fordon
    projectId = null;
  } else {
    if (projectsEnabled(settings)) {
      if (!projectId) {
        errors.projectId = "Välj kund och projekt, eller en typ av frånvaro.";
      } else {
        const project = projects.find((p) => p.id === projectId);
        const keepsOld = project && existing?.projectId === projectId;
        if (!isSelectableProject(project, customers) && !keepsOld) {
          errors.projectId = "Projektet går inte att välja. Det kan vara avslutat eller arkiverat.";
        }
      }
    } else {
      // Utan projekt rapporteras tiden direkt på kunden
      customerId = data.customerId || null;
      const customer = customers.find((c) => c.id === customerId);
      const keepsOld = Boolean(customer) && Boolean(existing) && customerIdOf(existing, projects) === customerId;
      if (!customerId) errors.customerId = "Välj en kund, eller en typ av frånvaro.";
      else if (!isSelectableCustomer(customer) && !keepsOld) errors.customerId = "Kunden går inte att välja. Den kan vara arkiverad.";
      // En äldre rad med projekt på samma kund behåller projektet
      projectId = keepsOld && existing.projectId ? existing.projectId : null;
      if (projectId) customerId = null;
    }

    travelHours = Number(data.travelHours || 0);
    if (!validHours(travelHours)) errors.travelHours = "Ange 0–24 timmar restid.";
    else if (travelHours > 0 && !travel.enabled && !(existing?.travelHours > 0)) {
      errors.travelHours = "Restid används inte i företaget.";
    }
    // Får medarbetaren inte ändra debiteringen gäller företagets förval
    travelBillable = travel.employeeCanChangeBilling
      ? Boolean(data.travelBillable ?? travel.billableDefault)
      : travel.billableDefault;
    if (!travelHours) travelBillable = false;

    vehicleTypeId = data.vehicleTypeId || null;
    if (vehicleTypeId) {
      const vehicle = settings.vehicleTypes.find((v) => v.id === vehicleTypeId);
      if (!vehicle || (vehicle.hidden && existing?.vehicleTypeId !== vehicleTypeId)) {
        errors.vehicleTypeId = "Välj ett fordon.";
      } else if (vehicle.isCompanyCar) {
        vehicleBasis = data.vehicleBasis;
        if (!["day", "km"].includes(vehicleBasis)) errors.vehicleBasis = "Välj Bil per dag eller Bil per mil.";
      }
      // Kilometer anges inte för firmabil med "Bil per dag" (samma logik som prototypen)
      if (!(vehicle?.isCompanyCar && vehicleBasis === "day")) {
        const value = data.km === "" || data.km === null || data.km === undefined ? 0 : Number(data.km);
        if (!Number.isInteger(value) || value < 0 || value > 100000) errors.km = "Ange hela kilometer.";
        else km = value;
      }
    }
  }

  const comment = text(errors, "comment", data.comment, { max: 500, label: "Kommentaren" });

  if (!errors.date && isMonthLocked(me.id, monthOf(date))) throw lockedError();

  if (!errors.hours && !errors.travelHours && hours + travelHours <= 0) {
    errors.hours = travel.enabled && timeType?.category !== "absence"
      ? "Ange timmar eller restid."
      : "Ange mer än 0 timmar.";
  }

  // Arbete och restid tillsammans får vara högst 24 timmar per dag
  if (!errors.date && !errors.hours && !errors.travelHours) {
    const dayTotal = entries
      .filter((e) => e.userId === me.id && e.date === date && e.id !== data.id)
      .reduce((sum, e) => sum + e.hours + (e.travelHours || 0), 0);
    if (dayTotal + hours + travelHours > 24) {
      const left = Math.max(0, 24 - dayTotal);
      errors.hours = `Högst 24 timmar per dag. Du kan lägga till ${String(left).replace(".", ",")} h till.`;
    }
  }
  fail(errors);

  const now = Date.now();
  const record = {
    userId: me.id,
    date,
    hours,
    projectId,
    customerId,
    timeTypeId,
    travelHours,
    travelBillable,
    vehicleTypeId,
    vehicleBasis,
    km,
    comment,
    // En ändrad nekad rad blir ett utkast igen
    status: "draft",
    rejectReason: "",
    reviewedBy: null,
    reviewedAt: null,
    updatedAt: now,
  };
  if (existing) Object.assign(existing, record);
  else entries.push({ id: newId(), ...record, createdAt: now });
  write("entries", entries);
  return copy(existing ?? entries[entries.length - 1]);
}

// Frånvaro för flera dagar på en gång (t.ex. en veckas semester): en rad per arbetsdag enligt schemat,
// med schemats timmar. Dagar som redan har registreringar hoppas över. Allt sparas – eller inget.
// Returnerar { saved: [rader], skipped: [datum som redan hade tid] }.
const MAX_ABSENCE_DAYS = 62;

export async function saveAbsenceRange({ from, to, timeTypeId, comment = "" }) {
  const me = requireUser();
  const settings = settingsRecord();
  const errors = {};
  if (!isValidISODate(from)) errors.date = "Välj ett giltigt datum.";
  if (!isValidISODate(to)) errors.to = "Välj ett giltigt datum.";
  else if (!errors.date && to < from) errors.to = "Till och med kan inte vara före första dagen.";
  const timeType = settings.timeTypes.find((t) => t.id === timeTypeId);
  if (!timeType || timeType.category !== "absence" || timeType.hidden) errors.timeTypeId = "Välj en typ av frånvaro.";
  const cleanComment = text(errors, "comment", comment, { max: 500, label: "Kommentaren" });
  fail(errors);

  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_ABSENCE_DAYS) throw new StoreError("validation", `Högst ${MAX_ABSENCE_DAYS} dagar åt gången.`, { to: `Högst ${MAX_ABSENCE_DAYS} dagar åt gången.` });
  }
  const hoursOn = (date) => scheduleOn(me, date, settings)[weekdayKey(date)] ?? 0;
  const entries = all("entries");
  const workDays = dates.filter((date) => hoursOn(date) > 0);
  if (!workDays.length) {
    throw new StoreError("validation", "Det finns inga arbetsdagar enligt schemat i perioden.", { to: "Inga arbetsdagar enligt schemat." });
  }
  if (workDays.some((date) => isMonthLocked(me.id, monthOf(date)))) throw lockedError();
  const skipped = workDays.filter((date) => entries.some((e) => e.userId === me.id && e.date === date));
  const toSave = workDays.filter((date) => !skipped.includes(date));
  if (!toSave.length) {
    throw new StoreError("validation", "Alla arbetsdagar i perioden har redan registreringar.", { to: "Alla dagar har redan tid." });
  }

  const now = Date.now();
  const saved = toSave.map((date) => ({
    id: newId(),
    userId: me.id,
    date,
    hours: hoursOn(date),
    projectId: null,
    customerId: null,
    timeTypeId,
    travelHours: 0,
    travelBillable: false,
    vehicleTypeId: null,
    vehicleBasis: null,
    km: 0,
    comment: cleanComment,
    status: "draft",
    rejectReason: "",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  write("entries", [...entries, ...saved]);
  return { saved: copy(saved), skipped };
}

export async function deleteEntry(id) {
  const me = requireUser();
  const entries = all("entries");
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw notFound("Registreringen");
  if (entry.userId !== me.id) throw new StoreError("forbidden", "Du kan bara ta bort dina egna registreringar.");
  if (entry.status === "approved") throw new StoreError("locked", "Godkända registreringar är låsta.");
  if (isMonthLocked(me.id, monthOf(entry.date))) throw lockedError();
  write("entries", entries.filter((e) => e.id !== id));
}

function review(ids, changes) {
  const me = requireAdmin();
  const entries = all("entries");
  const idSet = new Set(ids);
  const targets = entries.filter((e) => idSet.has(e.id));
  if (!targets.length) throw notFound("Registreringarna");
  if (targets.some((e) => isMonthLocked(e.userId, monthOf(e.date)))) throw lockedError();
  const now = Date.now();
  targets.forEach((e) => Object.assign(e, changes, { reviewedBy: me.id, reviewedAt: now, updatedAt: now }));
  write("entries", entries);
  return targets.length;
}

// Godkänn en eller flera rader (t.ex. en hel vecka för en anställd)
export async function approveEntries(ids) {
  return review(ids, { status: "approved", rejectReason: "" });
}

export async function rejectEntries(ids, reason) {
  const errors = {};
  const cleanReason = text(errors, "reason", reason, { required: true, max: 200, label: "Orsaken" });
  fail(errors);
  return review(ids, { status: "rejected", rejectReason: cleanReason });
}

/* ==========================================================================
   Månadslås ("Markera månad som klar")
   ========================================================================== */

export async function listMonthLocks({ month, userId } = {}) {
  const me = requireUser();
  const targetUser = me.role === "admin" ? userId : me.id;
  return copy(
    all("monthLocks").filter((l) => (!month || l.month === month) && (!targetUser || l.userId === targetUser)),
  );
}

export async function lockMonth(userId, month) {
  const me = requireAdmin();
  if (!isValidMonth(month)) throw new StoreError("validation", "Ogiltig månad.");
  if (!all("users").some((u) => u.id === userId)) throw notFound("Den anställde");
  const locks = all("monthLocks");
  const existing = locks.find((l) => l.userId === userId && l.month === month);
  if (existing) return copy(existing);
  const lock = { userId, month, lockedBy: me.id, lockedAt: Date.now() };
  locks.push(lock);
  write("monthLocks", locks);
  return copy(lock);
}

export async function unlockMonth(userId, month) {
  requireAdmin();
  const locks = all("monthLocks");
  if (!locks.some((l) => l.userId === userId && l.month === month)) {
    throw new StoreError("invalid-state", "Månaden är inte låst.");
  }
  write("monthLocks", locks.filter((l) => !(l.userId === userId && l.month === month)));
}

/* ==========================================================================
   Material (tillval)
   Företaget slår på funktionen, väljer vad den ska heta (Material, Produkter, Förbrukning …)
   och bygger en egen artikellista. Medarbetarna registrerar uttag: artikel, antal, projekt, meddelande.
   ========================================================================== */

export const MATERIAL_LABELS = ["Material", "Produkter", "Förbrukning"];
export const UNITS = ["st", "förp", "kg", "g", "m", "liter", "ml", "tub", "flaska", "rulle", "par"];

// Startförslag för bygg – admin väljer själv att lägga till dem och ändrar sedan fritt
export const ARTICLE_TEMPLATE = [
  ["Skruv", "kg"], ["Spik", "kg"], ["Reglar", "st"], ["Gipsskivor", "st"], ["Fogmassa", "tub"],
  ["Tejp", "rulle"], ["Isolering", "förp"], ["Byggplast", "rulle"], ["Spackel", "liter"], ["Sågklingor", "st"],
];

function defaultMaterials() {
  return { enabled: false, label: "Material", allowFreeText: true };
}

const materialSettings = (settings = settingsRecord()) => ({ ...defaultMaterials(), ...(settings.materials ?? {}) });

function requireMaterials() {
  if (!materialSettings().enabled) {
    throw new StoreError("invalid-state", "Materialfunktionen är avstängd. Administratören kan slå på den under Inställningar.");
  }
}

/* ---------- Artiklar ---------- */

// Medarbetare ser bara synliga artiklar
export async function listArticles({ includeHidden = false } = {}) {
  const me = requireUser();
  const showHidden = includeHidden && me.role === "admin";
  return copy(all("articles").filter((a) => showHidden || !a.hidden).sort((a, b) => sv(a.name, b.name)));
}

export async function saveArticle(data) {
  requireAdmin();
  const articles = all("articles");
  const existing = data.id ? articles.find((a) => a.id === data.id) : null;
  if (data.id && !existing) throw notFound("Artikeln");
  const errors = {};
  const record = {
    name: text(errors, "name", data.name, { required: true, max: 80, label: "Namnet" }),
    unit: text(errors, "unit", data.unit, { required: true, max: 15, label: "Enheten" }),
    articleNo: text(errors, "articleNo", data.articleNo, { max: 30, label: "Artikelnumret" }),
    hidden: Boolean(data.hidden),
  };
  if (record.name && articles.some((a) => a.id !== data.id && lower(a.name) === record.name.toLowerCase())) {
    errors.name = "Artikeln finns redan.";
  }
  if (record.articleNo && articles.some((a) => a.id !== data.id && lower(a.articleNo) === record.articleNo.toLowerCase())) {
    errors.articleNo = "Artikelnumret används redan.";
  }
  fail(errors);
  const now = Date.now();
  if (existing) Object.assign(existing, record, { updatedAt: now });
  else articles.push({ id: newId(), ...record, createdAt: now, updatedAt: now });
  write("articles", articles);
  return copy(existing ?? articles[articles.length - 1]);
}

// Lägger till startförslagen (hoppar över namn som redan finns). Returnerar antal nya.
export async function addArticleTemplate() {
  requireAdmin();
  const articles = all("articles");
  const now = Date.now();
  let added = 0;
  for (const [name, unit] of ARTICLE_TEMPLATE) {
    if (articles.some((a) => lower(a.name) === name.toLowerCase())) continue;
    articles.push({ id: newId(), name, unit, articleNo: "", hidden: false, createdAt: now, updatedAt: now });
    added++;
  }
  write("articles", articles);
  return added;
}

/* ---------- Uttag ---------- */

// Filter: from, to, month, date, handled (true/false), projectId, customerId, userId. Medarbetare ser bara egna uttag.
export async function listMaterials(filter = {}) {
  const me = requireUser();
  const userId = me.role === "admin" ? filter.userId : me.id;
  const projects = filter.customerId ? all("projects") : null;
  return copy(
    all("materials")
      .filter((m) => {
        if (userId && m.userId !== userId) return false;
        if (filter.date && m.date !== filter.date) return false;
        if (filter.month && !m.date.startsWith(filter.month)) return false;
        if (filter.from && m.date < filter.from) return false;
        if (filter.to && m.date > filter.to) return false;
        if (typeof filter.handled === "boolean" && m.handled !== filter.handled) return false;
        if (filter.projectId && m.projectId !== filter.projectId) return false;
        if (filter.customerId && customerIdOf(m, projects) !== filter.customerId) return false;
        return true;
      })
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)),
  );
}

// Ett uttag: en artikel ur listan (articleId) – eller fritext (name + unit) om admin tillåter det.
// Namn och enhet sparas på uttaget, så att historiken stämmer även om artikeln ändras.
export async function saveMaterial(data) {
  const me = requireUser();
  requireMaterials();
  const settings = materialSettings();
  const errors = {};
  const date = String(data.date ?? "");
  if (!isValidISODate(date)) errors.date = "Välj ett giltigt datum.";

  let name = "";
  let unit = "";
  let articleId = null;
  if (data.articleId) {
    const article = all("articles").find((a) => a.id === data.articleId);
    if (!article || article.hidden) errors.articleId = "Välj en artikel i listan.";
    else ({ id: articleId, name, unit } = article);
  } else if (settings.allowFreeText) {
    name = text(errors, "name", data.name, { required: true, max: 80, label: "Vad" });
    unit = text(errors, "unit", data.unit, { required: true, max: 15, label: "Enheten" });
  } else {
    errors.articleId = "Välj en artikel i listan.";
  }

  const quantity = Number(String(data.quantity ?? "").replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !hasTwoDecimals(quantity)) {
    errors.quantity = "Ange ett antal större än 0, t.ex. 2 eller 0,5.";
  }
  const message = text(errors, "message", data.message, { max: 500, label: "Meddelandet" });
  // Uttaget hör till ett projekt – eller direkt till en kund när projekt inte används
  let projectId = null;
  let customerId = null;
  if (projectsEnabled()) {
    const project = all("projects").find((p) => p.id === data.projectId);
    if (!isSelectableProject(project, all("customers"))) errors.projectId = "Välj ett pågående projekt.";
    else projectId = project.id;
  } else {
    const customer = all("customers").find((c) => c.id === data.customerId);
    if (!isSelectableCustomer(customer)) errors.customerId = "Välj en kund.";
    else customerId = customer.id;
  }
  fail(errors);

  const materials = all("materials");
  const record = {
    id: newId(),
    userId: me.id,
    date,
    articleId,
    name,
    unit,
    quantity,
    projectId,
    customerId,
    message,
    handled: false,
    handledBy: null,
    handledAt: null,
    createdAt: Date.now(),
  };
  materials.push(record);
  write("materials", materials);
  return copy(record);
}

// Egna uttag kan tas bort tills admin har hanterat dem. Admin kan ta bort alla ohanterade.
export async function deleteMaterial(id) {
  const me = requireUser();
  const materials = all("materials");
  const item = materials.find((m) => m.id === id);
  if (!item) throw notFound("Raden");
  if (me.role !== "admin" && item.userId !== me.id) throw new StoreError("forbidden", "Du kan bara ta bort det du själv har registrerat.");
  if (item.handled) throw new StoreError("locked", "Raden är markerad som klar och kan inte tas bort.");
  write("materials", materials.filter((m) => m.id !== id));
}

export async function setMaterialsHandled(ids, handled = true) {
  const me = requireAdmin();
  const materials = all("materials");
  const idSet = new Set(ids);
  const targets = materials.filter((m) => idSet.has(m.id));
  if (!targets.length) throw notFound("Raderna");
  const now = Date.now();
  targets.forEach((m) =>
    Object.assign(m, { handled: Boolean(handled), handledBy: handled ? me.id : null, handledAt: handled ? now : null }),
  );
  write("materials", materials);
  return targets.length;
}

// Antal nya (ej hanterade) uttag – visas som räknare för admin när funktionen är på
export async function countNewMaterials() {
  const me = currentUserRecord();
  if (!me || me.role !== "admin" || me.mustChangePassword || !materialSettings().enabled) return 0;
  return all("materials").filter((m) => !m.handled).length;
}

/* ==========================================================================
   Säkerhetskopia
   ========================================================================== */

// Innehåller även lösenordshashar – behövs för att kopian ska gå att läsa in igen
export async function exportBackup() {
  requireAdmin();
  const data = { settings: settingsRecord() };
  COLLECTIONS.forEach((name) => (data[name] = all(name)));
  return { app: "tidla", schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

// Ersätter ALL Tidla-data med innehållet i kopian
export async function importBackup(backup) {
  requireAdmin();
  const invalid = new StoreError("validation", "Filen är inte en giltig säkerhetskopia från Tidla.");
  // "tidra" = kopior från när appen hette Tidra
  if (!backup || !["tidla", "tidra"].includes(backup.app) || typeof backup.data !== "object" || backup.data === null) throw invalid;
  if (backup.schema !== SCHEMA_VERSION) {
    throw new StoreError("validation", "Säkerhetskopian kommer från en annan version av Tidla och kan inte läsas in.");
  }
  const { data } = backup;
  if (typeof data.settings !== "object" || data.settings === null) throw invalid;
  for (const name of OPTIONAL_COLLECTIONS) data[name] ??= [];
  for (const name of COLLECTIONS) {
    if (!Array.isArray(data[name]) || !data[name].every((row) => row && typeof row === "object")) throw invalid;
  }
  const idCollections = COLLECTIONS.filter((name) => name !== "monthLocks");
  if (idCollections.some((name) => data[name].some((row) => typeof row.id !== "string"))) throw invalid;
  if (!activeAdmins(data.users).length) {
    throw new StoreError("validation", "Säkerhetskopian saknar en aktiv administratör och kan inte läsas in.");
  }

  write("settings", { ...defaultSettings(), ...data.settings });
  COLLECTIONS.forEach((name) => write(name, data[name]));
  // Äldre kopior kan ha frånvarotyper i stället för typer av tid
  migrateProjectNumbers();
  migrateTimeTypes();
  migrateTravelAndOvertime();
  migrateMaterials();
  migrateVehicles();

  // Loggas ut om det egna kontot inte finns kvar i kopian
  currentUserRecord();
  return Object.fromEntries(COLLECTIONS.map((name) => [name, data[name].length]));
}

// Tömmer all data i Tidla och loggar ut (temat behålls). Används bara av testversionen
// (Byt företag och Skapa konto) – finns inte i API:et i fas 2.
export async function resetAllData() {
  clearSession();
  for (const name of ["schema", "settings", ...COLLECTIONS]) {
    try {
      local().removeItem(PREFIX + name);
    } catch {
      /* ignoreras */
    }
  }
  if (globalThis.indexedDB) await fileTransaction("readwrite", (files) => files.clear()).catch(() => {});
  emitChange("*");
}

/* ==========================================================================
   Gallring (manuell i fas 1)
   ========================================================================== */

function checkCutoff(cutoff) {
  if (!isValidISODate(cutoff) || cutoff > today()) {
    throw new StoreError("validation", "Ange ett datum som inte ligger i framtiden.");
  }
}

// Hur mycket som ligger före ett datum: tidrader och material från lagret
export async function countEntriesBefore(cutoff) {
  requireAdmin();
  checkCutoff(cutoff);
  const old = all("entries").filter((e) => e.date < cutoff);
  const oldMaterials = all("materials").filter((m) => m.date < cutoff);
  const oldest = [...old, ...oldMaterials].reduce((min, row) => (!min || row.date < min ? row.date : min), null);
  return { entries: old.length, materials: oldMaterials.length, oldest };
}

// Raderar tidrader och material från lagret före datumet, och månadslås för hela månader före datumet
export async function purgeEntriesBefore(cutoff) {
  requireAdmin();
  checkCutoff(cutoff);
  const entries = all("entries");
  const keep = entries.filter((e) => e.date >= cutoff);
  const materials = all("materials");
  const keepMaterials = materials.filter((m) => m.date >= cutoff);
  const locks = all("monthLocks");
  const keepLocks = locks.filter((l) => l.month >= monthOf(cutoff));
  write("entries", keep);
  write("materials", keepMaterials);
  write("monthLocks", keepLocks);
  return {
    entries: entries.length - keep.length,
    materials: materials.length - keepMaterials.length,
    monthLocks: locks.length - keepLocks.length,
  };
}
