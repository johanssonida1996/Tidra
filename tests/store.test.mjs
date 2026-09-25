// Tester för js/store.js. Körs med:  node tests/store.test.mjs
// Använder en lagring i minnet – rör aldrig webbläsarens data.
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { parseHours, formatHours, formatHoursUnit } from "../js/lib/format.js";
import { isoWeek, startOfWeek, addDays, toISODate, weekdayKey, formatShort, formatLong } from "../js/lib/dates.js";
import { toCSV } from "../js/lib/csv.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
  get length() {
    return this.map.size;
  }
  key(index) {
    return this.keys()[index] ?? null;
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
store.useStorage(local, session);

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "StoreError");
    assert.equal(error.code, code, `väntade ${code}, fick ${error.code}: ${error.message}`);
    return true;
  });
}

// Prototypens nycklar ska aldrig röras
local.setItem("tk-u3", "[prototyp]");
local.setItem("tk-d3-test-admin", "{prototyp}");
session.setItem("tk-session", "test-admin");

console.log("Hjälpfunktioner");

await test("timmar tolkas med komma och punkt och visas med komma", () => {
  assert.equal(parseHours("4,5"), 4.5);
  assert.equal(parseHours("4.5"), 4.5);
  assert.equal(parseHours(" 8 "), 8);
  assert.equal(parseHours("abc"), null);
  assert.equal(parseHours(""), null);
  assert.equal(formatHours(4.5), "4,5");
  assert.equal(formatHours(4), "4,0");
  assert.equal(formatHours(4.25), "4,25");
  assert.equal(formatHoursUnit(8.5), "8,5 h");
});

await test("datum räknas i lokal tid", () => {
  const justAfterMidnight = new Date(2026, 8, 24, 0, 30);
  assert.equal(toISODate(justAfterMidnight), "2026-09-24");
  assert.equal(weekdayKey("2026-09-24"), "thu");
  assert.equal(startOfWeek("2026-09-24"), "2026-09-21");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // över sommartidsbytet
  assert.deepEqual(isoWeek("2026-09-24"), { year: 2026, week: 39 });
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
  assert.equal(formatShort("2026-09-24"), "tor 24 sep");
  assert.equal(formatLong("2026-09-24"), "Torsdag 24 september");
});

await test("CSV: semikolon, BOM, decimalkomma och skydd mot formler", () => {
  const csv = toCSV(["Datum", "Timmar", "Kommentar"], [["2026-09-24", 4.5, "=SUMMA(A1)"], ["2026-09-25", 8, 'Sa "hej"; ok']]);
  assert.ok(csv.startsWith("﻿Datum;Timmar;Kommentar\r\n"));
  assert.ok(csv.includes("2026-09-24;4,5;'=SUMMA(A1)"));
  assert.ok(csv.includes('"Sa ""hej""; ok"'));
});

console.log("Första start och inloggning");

await test("tom lagring kräver första start och har ingen data", async () => {
  assert.equal(await store.needsSetup(), true);
  assert.equal(await store.getSession(), null);
  assert.equal(local.keys().filter((k) => k.startsWith("tidla:")).length, 0);
});

await test("ogiltig första start ger fältfel", async () => {
  await rejects(store.completeSetup({ companyName: "", admin: { name: "", email: "x", password: "kort" } }), "validation");
  assert.equal(await store.needsSetup(), true);
});

let admin;
await test("första start skapar företag och admin och loggar in", async () => {
  admin = await store.completeSetup({
    companyName: "Testföretaget AB",
    orgNumber: "5566778899",
    workWeek: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 6, sat: 0, sun: 0 },
    admin: { name: "Anna Admin", email: "Anna@Example.se", password: "hemligt123" },
  });
  assert.equal(admin.role, "admin");
  assert.equal(admin.email, "anna@example.se");
  assert.equal(admin.passwordHash, undefined);
  assert.equal((await store.getSession()).id, admin.id);
  const settings = await store.getSettings();
  assert.equal(settings.orgNumber, "556677-8899");
  assert.equal(settings.hourStep, 0.5);
  assert.equal(settings.timeTypes.length, 12);
  assert.deepEqual([...new Set(settings.timeTypes.map((t) => t.category))], ["work", "overtime", "absence"]);
  assert.equal(settings.timeTypes[0].name, "Arbete");
  assert.deepEqual(settings.overtime, { mode: "both", factor: null });
  assert.deepEqual(settings.travel, { enabled: true, billableDefault: false, employeeCanChangeBilling: true, countsTowardSchedule: false });
  assert.equal(settings.vehicleTypes.length, 6);
  assert.ok(settings.vehicleTypes.every((v) => v.ratePerMil === null));
  assert.equal(local.getItem("tidla:schema"), "1");
  await rejects(store.completeSetup({ companyName: "Igen", admin: { name: "X", email: "x@y.se", password: "12345678" } }), "invalid-state");
});

await test("utloggning och fel lösenord", async () => {
  await store.logout();
  assert.equal(await store.getSession(), null);
  await rejects(store.login("anna@example.se", "fel"), "unauthenticated");
  await rejects(store.listCustomers(), "unauthenticated");
});

await test("Kom ihåg mig sparar sessionen i localStorage, annars sessionStorage", async () => {
  await store.login("ANNA@example.se", "hemligt123", true);
  assert.ok(local.getItem("tidla:session"));
  assert.equal(session.getItem("tidla:session"), null);
  await store.login("anna@example.se", "hemligt123", false);
  assert.equal(local.getItem("tidla:session"), null);
  assert.ok(session.getItem("tidla:session"));
});

console.log("Kunder, projekt och anställda");

let customer, project, closedProject, employee, otp;
await test("kund med unikt kundnummer", async () => {
  customer = await store.saveCustomer({ customerNo: "100", name: "Kund Ett", orgNumber: "5566778899", email: "ignoreras@example.se" });
  assert.equal(customer.orgNumber, "556677-8899");
  assert.equal("email" in customer, false);
  await rejects(store.saveCustomer({ customerNo: "100", name: "Dubblett" }), "duplicate");
  await rejects(store.saveCustomer({ customerNo: "101", name: "X", orgNumber: "123" }), "validation");
});

await test("projekt med unikt projektnummer kopplat till kund", async () => {
  project = await store.saveProject({ customerId: customer.id, projectNo: "L-1", name: "Takbyte" });
  closedProject = await store.saveProject({ customerId: customer.id, projectNo: "L-2", name: "Klart", status: "closed" });
  await rejects(store.saveProject({ customerId: customer.id, projectNo: "l-1", name: "Dubblett" }), "duplicate");
  const selectable = await store.listProjects({ customerId: customer.id, selectableOnly: true });
  assert.deepEqual(selectable.map((p) => p.projectNo), ["L-1"]);
});

await test("anställd får engångslösenord och status Väntar", async () => {
  const result = await store.saveUser({ name: "Maja Medarbetare", employeeNo: "2", email: "maja@example.se", role: "employee" });
  employee = result.user;
  otp = result.oneTimePassword;
  assert.equal(employee.status, "pending");
  assert.equal(otp.length, 10);
  await rejects(store.saveUser({ name: "X", employeeNo: "2", email: "ny@example.se", role: "employee" }), "duplicate");
  await rejects(store.saveUser({ name: "X", employeeNo: "3", email: "MAJA@example.se", role: "employee" }), "duplicate");
});

await test("sista aktiva admin kan inte nedgraderas eller inaktiveras", async () => {
  await rejects(store.saveUser({ ...admin, role: "employee" }), "validation");
  await rejects(store.setUserStatus(admin.id, "inactive"), "invalid-state");
});

console.log("Medarbetare");

await test("medarbetare loggar in med engångslösenord och måste byta", async () => {
  await store.login("maja@example.se", otp);
  const me = await store.getSession();
  assert.equal(me.mustChangePassword, true);
  await rejects(store.listCustomers(), "forbidden");
  await rejects(store.changePassword({ newPassword: "kort" }), "validation");
  await rejects(store.changePassword({ newPassword: otp }), "validation");
  // Engångslösenordet behöver inte anges igen direkt efter inloggningen
  const updated = await store.changePassword({ newPassword: "nyttlosen1" });
  assert.equal(updated.status, "active");
  assert.equal(updated.mustChangePassword, false);
});

await test("vanligt lösenordsbyte kräver nuvarande lösenord", async () => {
  await rejects(store.changePassword({ currentPassword: "fel", newPassword: "annatlosen1" }), "validation");
  await store.changePassword({ currentPassword: "nyttlosen1", newPassword: "annatlosen1" });
  await store.changePassword({ currentPassword: "annatlosen1", newPassword: "nyttlosen1" });
});

await test("medarbetare når inte admin-funktioner", async () => {
  await rejects(store.saveCustomer({ customerNo: "9", name: "X" }), "forbidden");
  assert.equal((await store.listUsers()).length, 1);
  await rejects(store.approveEntries(["x"]), "forbidden");
  await rejects(store.exportBackup(), "forbidden");
  assert.equal(await store.countNewMaterials(), 0);
});

let entry;
await test("programmerad tid följer företagets schema", async () => {
  assert.equal(await store.getScheduledHours("2026-09-24"), 8);
  assert.equal(await store.getScheduledHours("2026-09-25"), 6);
  assert.equal(await store.getScheduledHours("2026-09-26"), 0);
});

await test("tidrad kräver projekt eller frånvaro", async () => {
  await rejects(store.saveEntry({ date: "2026-09-24", hours: 4 }), "validation");
  await rejects(store.saveEntry({ date: "2026-09-24", hours: 4, projectId: closedProject.id }), "validation");
  await rejects(store.saveEntry({ date: "2026-09-24", hours: 0, projectId: project.id }), "validation");
  await rejects(store.saveEntry({ date: "2026-09-24", hours: 25, projectId: project.id }), "validation");
});

await test("firmabil: dag eller mil, km bara vid mil", async () => {
  await rejects(
    store.saveEntry({ date: "2026-09-24", hours: 4, projectId: project.id, vehicleTypeId: "firmabil" }),
    "validation",
  );
  entry = await store.saveEntry({
    date: "2026-09-24",
    hours: 4.5,
    projectId: project.id,
    vehicleTypeId: "firmabil",
    vehicleBasis: "day",
    km: 55,
    comment: "Takbyte",
  });
  assert.equal(entry.status, "draft");
  assert.equal(entry.km, 0);
  const perMil = await store.saveEntry({
    date: "2026-09-23",
    hours: 8,
    projectId: project.id,
    vehicleTypeId: "firmabil",
    vehicleBasis: "km",
    km: 42,
  });
  assert.equal(perMil.km, 42);
});

await test("frånvaro rensar projekt och fordon", async () => {
  const absence = await store.saveEntry({
    date: "2026-09-25",
    hours: 6,
    timeTypeId: "vab",
    projectId: project.id,
    vehicleTypeId: "privat-bil",
    km: 10,
  });
  assert.equal(absence.projectId, null);
  assert.equal(absence.vehicleTypeId, null);
  assert.equal(absence.km, 0);
});

await test("högst 24 timmar per dag", async () => {
  await rejects(store.saveEntry({ date: "2026-09-24", hours: 20, projectId: project.id }), "validation");
});

await test("Samma som igår hittar senaste arbetsdagen", async () => {
  const last = await store.getLastEntryBefore("2026-09-28");
  assert.equal(last.date, "2026-09-25");
});

await test("material kräver pågående projekt ur registret", async () => {
  // Avstängt som standard
  await rejects(store.saveMaterial({ date: "2026-09-24", name: "Skruv", unit: "kg", quantity: 2, projectId: project.id }), "invalid-state");
  // Slå på direkt i lagringen (testet kör som medarbetare)
  const settings = JSON.parse(local.getItem("tidla:settings"));
  settings.materials = { enabled: true, label: "Material", allowFreeText: true };
  local.setItem("tidla:settings", JSON.stringify(settings));
  await rejects(store.saveMaterial({ date: "2026-09-24", name: "Skruv", unit: "kg", quantity: 2, projectId: closedProject.id }), "validation");
  await rejects(store.saveMaterial({ date: "2026-09-24", name: "Skruv", unit: "kg", quantity: 0, projectId: project.id }), "validation");
  const saved = await store.saveMaterial({ date: "2026-09-24", name: "Skruv", unit: "kg", quantity: "2,5", projectId: project.id });
  assert.equal(saved.quantity, 2.5);
  assert.equal(saved.articleId, null);
  assert.equal((await store.listMaterials()).length, 1);
});

console.log("Granskning");

await test("admin godkänner och nekar, medarbetaren kan inte ändra godkänt", async () => {
  await store.logout();
  await store.login("anna@example.se", "hemligt123");
  assert.equal(await store.countNewMaterials(), 1);
  const all = await store.listEntries({ userId: employee.id, month: "2026-09" });
  assert.equal(all.length, 3);
  await rejects(store.rejectEntries([entry.id], "  "), "validation");
  assert.equal(await store.approveEntries([entry.id]), 1);
  const other = all.find((e) => e.id !== entry.id);
  await store.rejectEntries([other.id], "Fel projekt");
  await rejects(store.saveEntry({ ...entry, hours: 3 }), "forbidden");

  await store.logout();
  await store.login("maja@example.se", "nyttlosen1");
  await rejects(store.saveEntry({ ...entry, hours: 3 }), "locked");
  await rejects(store.deleteEntry(entry.id), "locked");
  const rejected = (await store.listEntries({ status: "rejected" }))[0];
  assert.equal(rejected.rejectReason, "Fel projekt");
  const fixed = await store.saveEntry({ ...rejected, hours: 7.5 });
  assert.equal(fixed.status, "draft");
  assert.equal(fixed.rejectReason, "");
});

await test("låst månad stoppar ändringar tills admin låser upp", async () => {
  await store.logout();
  await store.login("anna@example.se", "hemligt123");
  await store.lockMonth(employee.id, "2026-09");
  const draft = (await store.listEntries({ userId: employee.id, status: "draft" }))[0];
  await rejects(store.approveEntries([draft.id]), "locked");

  await store.logout();
  await store.login("maja@example.se", "nyttlosen1");
  await rejects(store.saveEntry({ date: "2026-09-10", hours: 2, projectId: project.id }), "locked");
  await rejects(store.deleteEntry(draft.id), "locked");
  await rejects(store.unlockMonth(employee.id, "2026-09"), "forbidden");

  await store.logout();
  await store.login("anna@example.se", "hemligt123");
  await store.unlockMonth(employee.id, "2026-09");
  assert.equal((await store.listMonthLocks({ month: "2026-09" })).length, 0);
});

console.log("Radering, arkivering och inaktivering");

await test("kund, projekt och anställd med registreringar kan inte raderas", async () => {
  await rejects(store.deleteCustomer(customer.id), "in-use");
  await rejects(store.deleteProject(project.id), "in-use");
  await rejects(store.deleteUser(employee.id), "in-use");
  await store.deleteProject(closedProject.id);
});

await test("arkiverad kund döljer sina projekt", async () => {
  await store.setCustomerArchived(customer.id, true);
  assert.equal((await store.listCustomers()).length, 0);
  assert.equal((await store.listProjects()).length, 0);
  assert.equal((await store.listCustomers({ includeArchived: true })).length, 1);
  await store.setCustomerArchived(customer.id, false);
});

await test("inaktiverad anställd kan inte logga in", async () => {
  await store.setUserStatus(employee.id, "inactive");
  await store.logout();
  await rejects(store.login("maja@example.se", "nyttlosen1"), "forbidden");
  await store.login("anna@example.se", "hemligt123");
  const reactivated = await store.setUserStatus(employee.id, "active");
  assert.equal(reactivated.status, "active");
});

await test("återställt lösenord kräver nytt lösenord vid inloggning", async () => {
  const { oneTimePassword } = await store.resetPassword(employee.id);
  await store.logout();
  const me = await store.login("maja@example.se", oneTimePassword);
  assert.equal(me.mustChangePassword, true);
  await store.logout();
  await store.login("anna@example.se", "hemligt123");
});

console.log("Säkerhetskopia och gallring");

await test("export och import av säkerhetskopia", async () => {
  const backup = await store.exportBackup();
  assert.equal(backup.app, "tidla");
  assert.equal(backup.data.users.length, 2);
  await rejects(store.importBackup({ app: "annat" }), "validation");
  const counts = await store.importBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(counts.entries, 3);
  assert.equal((await store.getSession()).id, admin.id);
});

await test("gallring räknar och raderar gamla tidrader", async () => {
  const count = await store.countEntriesBefore("2026-09-24");
  assert.equal(count.entries, 1);
  assert.equal(count.oldest, "2026-09-23");
  const result = await store.purgeEntriesBefore("2026-09-24");
  assert.equal(result.entries, 1);
  await rejects(store.purgeEntriesBefore("2999-01-01"), "validation");
});

await test("gamla projekt med littra flyttas till projectNo vid start", async () => {
  const saved = local.getItem("tidla:projects");
  local.setItem("tidla:projects", JSON.stringify([{ id: "x", customerId: "c", littra: "L-9", name: "Gammalt" }]));
  await store.init();
  const [migrated] = JSON.parse(local.getItem("tidla:projects"));
  assert.equal(migrated.projectNo, "L-9");
  assert.equal("littra" in migrated, false);
  local.setItem("tidla:projects", saved);
});

console.log("Typer av tid, övertid och restid");

await test("registrering utan typ blir Arbete, restid är en del av raden", async () => {
  await store.logout();
  await store.login("anna@example.se", "hemligt123");
  const [p] = await store.listProjects();
  const normal = await store.saveEntry({ date: "2026-10-05", hours: 2, projectId: p.id });
  assert.equal(normal.timeTypeId, "normal");
  assert.equal(normal.travelHours, 0);
  // Restid kräver projekt precis som arbete, och är ej debiterad som förval
  await rejects(store.saveEntry({ date: "2026-10-05", hours: 0, travelHours: 1 }), "validation");
  const travel = await store.saveEntry({ date: "2026-10-05", hours: 0, travelHours: 1.5, projectId: p.id, vehicleTypeId: "privat-bil", km: 30 });
  assert.equal(travel.travelHours, 1.5);
  assert.equal(travel.travelBillable, false);
  const billed = await store.saveEntry({ date: "2026-10-05", hours: 1, travelHours: 1, travelBillable: true, projectId: p.id });
  assert.equal(billed.travelBillable, true);
  await rejects(store.saveEntry({ date: "2026-10-05", hours: 0, projectId: p.id }), "validation");
  await rejects(store.saveEntry({ date: "2026-10-05", hours: 1, timeTypeId: "finns-inte", projectId: p.id }), "validation");
  // Frånvaro har ingen restid
  const vab = await store.saveEntry({ date: "2026-10-06", hours: 4, timeTypeId: "vab", travelHours: 2, projectId: p.id });
  assert.equal(vab.travelHours, 0);
  assert.equal(vab.projectId, null);
});

await test("övertid: komptid och lön, styrs av admins inställning", async () => {
  const [p] = await store.listProjects();
  const before = (await store.listEntries({ category: "overtime" })).length;
  await store.saveEntry({ date: "2026-10-07", hours: 2, timeTypeId: "ot-komp", projectId: p.id });
  await store.saveEntry({ date: "2026-10-07", hours: 1, timeTypeId: "ot-lon", projectId: p.id });
  assert.equal((await store.listEntries({ category: "overtime" })).length, before + 2);

  await store.saveSettings({ overtime: { mode: "pay", factor: "1,5".replace(",", ".") } });
  assert.deepEqual((await store.getSettings()).overtime, { mode: "pay", factor: 1.5 });
  await rejects(store.saveEntry({ date: "2026-10-08", hours: 1, timeTypeId: "ot-komp", projectId: p.id }), "validation");
  await store.saveEntry({ date: "2026-10-08", hours: 1, timeTypeId: "ot-lon", projectId: p.id });
  await store.saveSettings({ overtime: { mode: "off", factor: null } });
  await rejects(store.saveEntry({ date: "2026-10-08", hours: 1, timeTypeId: "ot-lon", projectId: p.id }), "validation");
  await rejects(store.saveSettings({ overtime: { mode: "ibland" } }), "validation");
  await rejects(store.saveSettings({ overtime: { mode: "both", factor: 9 } }), "validation");
  await store.saveSettings({ overtime: { mode: "both", factor: null } });
});

await test("restid: av, förval för debitering och om medarbetaren får ändra", async () => {
  const [p] = await store.listProjects();
  await store.saveSettings({ travel: { enabled: true, billableDefault: true, employeeCanChangeBilling: false, countsTowardSchedule: true } });
  const forced = await store.saveEntry({ date: "2026-10-09", hours: 1, travelHours: 1, travelBillable: false, projectId: p.id });
  assert.equal(forced.travelBillable, true, "Företagets förval ska gälla när medarbetaren inte får ändra");
  await store.saveSettings({ travel: { enabled: false } });
  await rejects(store.saveEntry({ date: "2026-10-09", hours: 1, travelHours: 1, projectId: p.id }), "validation");
  await store.saveSettings({ travel: { enabled: true, billableDefault: false, employeeCanChangeBilling: true, countsTowardSchedule: false } });
});

await test("admin kan byta namn på och dölja typer, nya typer blir frånvaro", async () => {
  const types = await store.saveTimeType({ name: "Studiedag" });
  const study = types.find((t) => t.name === "Studiedag");
  assert.equal(study.category, "absence");
  await rejects(store.saveTimeType({ name: "Arbete" }), "duplicate");
  await rejects(store.saveTimeType({ id: "normal", name: "Arbete", hidden: true }), "validation");
  const renamed = await store.saveTimeType({ id: "vab", name: "Vård av barn" });
  assert.equal(renamed.find((t) => t.id === "vab").name, "Vård av barn");
  const hidden = await store.saveTimeType({ id: study.id, name: "Studiedag", hidden: true });
  assert.equal(hidden.find((t) => t.id === study.id).hidden, true);
});

await test("gamla frånvarotyper och registreringar flyttas till typer av tid", async () => {
  const savedSettings = local.getItem("tidla:settings");
  const savedEntries = local.getItem("tidla:entries");
  const settings = JSON.parse(savedSettings);
  delete settings.timeTypes;
  delete settings.overtime;
  delete settings.travel;
  settings.absenceTypes = [
    { id: "vab", name: "Vård av barn", hidden: false },
    { id: "egen", name: "Egen frånvaro", hidden: true },
  ];
  local.setItem("tidla:settings", JSON.stringify(settings));
  local.setItem("tidla:entries", JSON.stringify([
    { id: "a", userId: "u", date: "2026-01-02", hours: 8, projectId: "p", absenceTypeId: null },
    { id: "b", userId: "u", date: "2026-01-03", hours: 8, projectId: null, absenceTypeId: "vab" },
  ]));
  await store.init();
  const migrated = JSON.parse(local.getItem("tidla:settings"));
  assert.equal("absenceTypes" in migrated, false);
  assert.equal(migrated.timeTypes.find((t) => t.id === "vab").name, "Vård av barn");
  assert.equal(migrated.timeTypes.find((t) => t.id === "egen").category, "absence");
  assert.equal(migrated.overtime.mode, "both");
  const entries = JSON.parse(local.getItem("tidla:entries"));
  assert.deepEqual(entries.map((e) => e.timeTypeId), ["normal", "vab"]);
  assert.equal(entries.some((e) => "absenceTypeId" in e), false);
  local.setItem("tidla:settings", savedSettings);
  local.setItem("tidla:entries", savedEntries);
});

await test("restid och övertid som egna typer flyttas till den nya modellen", async () => {
  const savedSettings = local.getItem("tidla:settings");
  const savedEntries = local.getItem("tidla:entries");
  const settings = JSON.parse(savedSettings);
  delete settings.overtime;
  delete settings.travel;
  settings.timeTypes = [
    { id: "normal", name: "Normal", category: "work", billable: true, factor: null, compensation: null, hidden: false },
    { id: "restid-deb", name: "Restid (debiterbar)", category: "travel", billable: true, factor: null, compensation: null, hidden: false },
    { id: "ot-ledig-15", name: "Övertid ledig ×1,5", category: "overtime", billable: true, factor: 1.5, compensation: "leave", hidden: false },
    { id: "ot-lon-20", name: "Övertid lön ×2,0", category: "overtime", billable: true, factor: 2, compensation: "pay", hidden: false },
    { id: "vab", name: "Vård av barn", category: "absence", billable: false, factor: null, compensation: null, hidden: false },
  ];
  local.setItem("tidla:settings", JSON.stringify(settings));
  local.setItem("tidla:entries", JSON.stringify([
    { id: "a", userId: "u", date: "2026-01-02", hours: 2, projectId: "p", timeTypeId: "restid-deb" },
    { id: "b", userId: "u", date: "2026-01-02", hours: 1, projectId: "p", timeTypeId: "ot-ledig-15" },
    { id: "c", userId: "u", date: "2026-01-02", hours: 1, projectId: "p", timeTypeId: "ot-lon-20" },
    { id: "d", userId: "u", date: "2026-01-03", hours: 8, projectId: null, timeTypeId: "vab" },
  ]));
  await store.init();
  const migrated = JSON.parse(local.getItem("tidla:settings"));
  assert.deepEqual(migrated.timeTypes.map((t) => t.id).slice(0, 3), ["normal", "ot-komp", "ot-lon"]);
  assert.equal(migrated.timeTypes.find((t) => t.id === "vab").name, "Vård av barn");
  assert.equal(migrated.timeTypes.some((t) => t.category === "travel"), false);
  assert.equal(migrated.overtime.factor, 1.5);
  assert.equal(migrated.travel.enabled, true);
  const entries = JSON.parse(local.getItem("tidla:entries"));
  assert.deepEqual(
    entries.map((e) => [e.timeTypeId, e.hours, e.travelHours]),
    [["normal", 0, 2], ["ot-komp", 1, 0], ["ot-lon", 1, 0], ["vab", 8, 0]],
  );
  assert.equal(entries[0].travelBillable, true);
  local.setItem("tidla:settings", savedSettings);
  local.setItem("tidla:entries", savedEntries);
});

console.log("Material");

await test("material: benämning, artikellista, förslag per bransch och fritext", async () => {
  await store.logout();
  await store.login("anna@example.se", "hemligt123");
  await store.saveSettings({ materials: { enabled: true, label: "Produkter", allowFreeText: false } });
  assert.equal((await store.getSettings()).materials.label, "Produkter");
  await rejects(store.saveSettings({ materials: { enabled: true, label: "" } }), "validation");

  const added = await store.addArticleTemplate("frisor");
  assert.equal(added, 7);
  assert.equal(await store.addArticleTemplate("frisor"), 0, "Samma förslag ska inte läggas till två gånger");
  await rejects(store.addArticleTemplate("okand"), "validation");
  const color = (await store.listArticles()).find((a) => a.name === "Hårfärg");
  assert.equal(color.unit, "tub");
  await rejects(store.saveArticle({ name: "hårfärg", unit: "tub" }), "duplicate");
  const own = await store.saveArticle({ name: "Toner", unit: "ml", articleNo: "T-1" });
  await store.saveArticle({ ...own, hidden: true });
  assert.equal((await store.listArticles()).some((a) => a.id === own.id), false);
  assert.equal((await store.listArticles({ includeHidden: true })).some((a) => a.id === own.id), true);

  const [p] = await store.listProjects({ selectableOnly: true });
  const item = await store.saveMaterial({ date: "2026-10-01", articleId: color.id, quantity: 2, projectId: p.id });
  assert.equal(item.name, "Hårfärg");
  assert.equal(item.unit, "tub");
  await rejects(store.saveMaterial({ date: "2026-10-01", articleId: own.id, quantity: 1, projectId: p.id }), "validation");
  // Fritext är avstängt
  await rejects(store.saveMaterial({ date: "2026-10-01", name: "Annat", unit: "st", quantity: 1, projectId: p.id }), "validation");

  const before = await store.countNewMaterials();
  await store.setMaterialsHandled([item.id]);
  assert.equal(await store.countNewMaterials(), before - 1);
  await rejects(store.deleteMaterial(item.id), "locked");
  await store.saveSettings({ materials: { enabled: false, label: "Produkter", allowFreeText: false } });
  assert.equal(await store.countNewMaterials(), 0, "Ingen räknare när funktionen är av");
  await store.saveSettings({ materials: { enabled: true, label: "Material", allowFreeText: true } });
});

await test("gamla uttag med fritext flyttas till namn, antal och enhet", async () => {
  const saved = local.getItem("tidla:materials");
  local.setItem("tidla:materials", JSON.stringify([
    { id: "m1", userId: "u", date: "2026-01-02", material: "Skruv", quantity: "2,5 kg", projectId: "p", handled: false },
    { id: "m2", userId: "u", date: "2026-01-02", material: "Lister", quantity: "några", projectId: "p", handled: false },
  ]));
  await store.init();
  const migrated = JSON.parse(local.getItem("tidla:materials"));
  assert.deepEqual(migrated.map((m) => [m.name, m.quantity, m.unit]), [["Skruv", 2.5, "kg"], ["Lister", 1, "några"]]);
  local.setItem("tidla:materials", saved);
});

console.log("Tema");

await test("temavalet sparas per webbläsare och påverkar inte datan", async () => {
  assert.equal(store.getThemePreference(), null);
  store.setThemePreference("dark");
  assert.equal(store.getThemePreference(), "dark");
  assert.equal(local.getItem("tidla:theme"), "dark");
  store.setThemePreference("okänt");
  assert.equal(store.getThemePreference(), null);
  assert.equal(local.getItem("tidla:theme"), null);
  store.setThemePreference("light");
  const backup = await store.exportBackup();
  assert.equal("theme" in backup.data, false);
  store.setThemePreference(null);
});

await test("prototypens tk-nycklar är orörda", () => {
  assert.equal(local.getItem("tk-u3"), "[prototyp]");
  assert.equal(local.getItem("tk-d3-test-admin"), "{prototyp}");
  assert.equal(session.getItem("tk-session"), "test-admin");
  const foreign = local.keys().filter((k) => !k.startsWith("tidla:") && !k.startsWith("tk-"));
  assert.deepEqual(foreign, []);
});

await test("data från när appen hette Tidra flyttas till tidla:-nycklar", async () => {
  const oldLocal = new MemoryStorage();
  const oldSession = new MemoryStorage();
  oldLocal.setItem("tidra:schema", "1");
  oldLocal.setItem("tidra:users", "[]");
  oldLocal.setItem("tidla:users", '["nyare"]');
  oldLocal.setItem("tk-u3", "[prototyp]");
  oldSession.setItem("tidra:session", "{}");
  store.useStorage(oldLocal, oldSession);
  try {
    await store.init();
    assert.deepEqual(oldLocal.keys().sort(), ["tidla:schema", "tidla:users", "tk-u3"]);
    assert.equal(oldLocal.getItem("tidla:users"), '["nyare"]', "En befintlig tidla:-nyckel skrivs inte över");
    assert.equal(oldLocal.getItem("tk-u3"), "[prototyp]");
    assert.deepEqual(oldSession.keys(), ["tidla:session"]);
  } finally {
    store.useStorage(local, session);
  }
});

console.log(process.exitCode ? "\nNågot test misslyckades." : `\nAlla ${passed} tester gick igenom.`);
