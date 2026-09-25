// Exportfiler (CSV för Excel): tidsunderlag och materialuttag.
// Rena funktioner – får data in, ger filnamn och innehåll tillbaka. Testas i tests/export.test.mjs.
import { toCSV } from "./csv.js";

const STATUS = { draft: "Utkast", approved: "Godkänd", rejected: "Nekad" };
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

// suffix: t.ex. "-v39" när bara en vecka exporteras
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
    "Restid", "Restid debiteras", "Fordon", "Fordonsgrund", "Km", "Kr/mil",
    "Kommentar", "Status",
  ];
  const rows = [...entries]
    .sort((a, b) => (a.date === b.date ? (userById.get(a.userId)?.name ?? "").localeCompare(userById.get(b.userId)?.name ?? "", "sv") : a.date < b.date ? -1 : 1))
    .map((e) => {
      const user = userById.get(e.userId);
      const project = projectById.get(e.projectId);
      const customer = customerById.get(project?.customerId);
      const type = typeById.get(e.timeTypeId);
      const vehicle = vehicleById.get(e.vehicleTypeId);
      const overtime = type?.category === "overtime";
      const travel = e.travelHours || 0;
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
      const project = projectById.get(m.projectId);
      const customer = customerById.get(project?.customerId);
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
        m.handled ? "Hanterad" : "Ny",
      ];
    });
  return { filename: filename("tidla-material", month, suffix), content: toCSV(header, rows) };
}
