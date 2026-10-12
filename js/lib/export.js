// Exportfiler (CSV för Excel): tidsunderlag och materialuttag.
// Rena funktioner – får data in, ger filnamn och innehåll tillbaka. Testas i tests/export.test.mjs.
import { toCSV } from "./csv.js";
import { placeOf } from "./place.js";

const STATUS = { draft: "Väntar på granskning", approved: "Godkänd", rejected: "Nekad" };
const BASIS = { day: "Bil per dag", km: "Bil per mil" };
const COMPENSATION = { pay: "Lön", leave: "Komptid" };

function lookups({ users, projects, customers, settings }) {
  const userById = new Map(users.map((u) => [u.id, u]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const typeById = new Map(settings.timeTypes.map((t) => [t.id, t]));
  const vehicleById = new Map(settings.vehicleTypes.map((v) => [v.id, v]));
  return { userById, projectById, customerById, typeById, vehicleById };
}

// Del av ett filnamn: "Erik Lind" → "erik-lind", "Brf Åkern" → "brf-akern"
export function filenamePart(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// suffix: filtren som gällde, t.ex. "-v39-erik-lind-godkanda"
function filename(prefix, month, suffix = "") {
  return `${prefix}-${month}${suffix}.csv`;
}

// Tidsunderlag – en rad per registrering
export function buildTimeCsv({ entries, users, projects, customers, settings, month, suffix = "" }) {
  const { userById, projectById, customerById, typeById, vehicleById } = lookups({ users, projects, customers, settings });
  const factor = settings.overtime?.factor ?? null;
  const header = [
    "Datum", "Anställd", "Anställningsnummer", "Kundnummer", "Kund", "Projektnummer", "Projekt",
    "Typ av tid", "Timmar", "Övertidsersättning", "Faktor",
    "Restid", "Restid debiteras", "Fordon", "Fordonsgrund", "Km", "Kr/mil", "Milersättning (kr)",
    "Kommentar", "Status",
  ];
  const rows = [...entries]
    .sort((a, b) => (a.date === b.date ? (userById.get(a.userId)?.name ?? "").localeCompare(userById.get(b.userId)?.name ?? "", "sv") : a.date < b.date ? -1 : 1))
    .map((e) => {
      const user = userById.get(e.userId);
      const { project, customer } = placeOf(e, (id) => projectById.get(id), (id) => customerById.get(id));
      const type = typeById.get(e.timeTypeId);
      const vehicle = vehicleById.get(e.vehicleTypeId);
      const overtime = type?.category === "overtime";
      const travel = e.travelHours || 0;
      const rate = vehicle && !vehicle.isCompanyCar && vehicle.ratePerMil !== null && vehicle.ratePerMil !== undefined ? vehicle.ratePerMil : null;
      // Milersättning = km / 10 (mil) × kr/mil, avrundat till öre. Firmabil ger ingen ersättning.
      const allowance = rate !== null && e.km ? Math.round((e.km / 10) * rate * 100) / 100 : "";
      return [
        e.date,
        user?.name ?? "",
        user?.employeeNo ?? "",
        customer?.customerNo ?? "",
        customer?.name ?? "",
        project?.projectNo ?? "",
        project?.name ?? "",
        type?.name ?? "",
        e.hours,
        overtime ? COMPENSATION[type.compensation] ?? "" : "",
        overtime && factor ? factor : "",
        travel || "",
        travel ? (e.travelBillable ? "Ja" : "Nej") : "",
        vehicle?.name ?? "",
        vehicle?.isCompanyCar ? BASIS[e.vehicleBasis] ?? "" : "",
        vehicle && e.km ? e.km : "",
        vehicle && vehicle.ratePerMil !== null && vehicle.ratePerMil !== undefined ? vehicle.ratePerMil : "",
        allowance,
        e.comment ?? "",
        STATUS[e.status] ?? e.status,
      ];
    });
  return { filename: filename("tidla-underlag", month, suffix), content: toCSV(header, rows) };
}

// Materialuttag – en rad per uttag
export function buildMaterialCsv({ materials, users, projects, customers, articles = [], month, suffix = "" }) {
  const userById = new Map(users.map((u) => [u.id, u]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const header = [
    "Datum", "Anställd", "Kundnummer", "Kund", "Projektnummer", "Projekt",
    "Artikel", "Artikelnummer", "Antal", "Enhet", "Meddelande", "Status",
  ];
  const rows = [...materials]
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
    .map((m) => {
      const { project, customer } = placeOf(m, (id) => projectById.get(id), (id) => customerById.get(id));
      return [
        m.date,
        userById.get(m.userId)?.name ?? "",
        customer?.customerNo ?? "",
        customer?.name ?? "",
        project?.projectNo ?? "",
        project?.name ?? "",
        m.name,
        articleById.get(m.articleId)?.articleNo ?? "",
        m.quantity,
        m.unit,
        m.message ?? "",
        m.handled ? "Klar" : "Ny",
      ];
    });
  return { filename: filename("tidla-material", month, suffix), content: toCSV(header, rows) };
}
