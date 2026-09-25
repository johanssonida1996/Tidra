// Tester för exportfilerna. Körs med:  node tests/export.test.mjs
import assert from "node:assert/strict";
import { buildTimeCsv, buildMaterialCsv } from "../js/lib/export.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const users = [
  { id: "u1", name: "Maja Medarbetare", employeeNo: "2" },
  { id: "u2", name: "Anna Admin", employeeNo: "1" },
];
const customers = [{ id: "c1", customerNo: "100", name: "Brf Almen" }];
const projects = [{ id: "p1", customerId: "c1", projectNo: "P-2041", name: "Takbyte; etapp 1" }];
const settings = {
  overtime: { mode: "both", factor: 1.5 },
  timeTypes: [
    { id: "normal", name: "Arbete", category: "work" },
    { id: "ot-lon", name: "Övertid – lön", category: "overtime", compensation: "pay" },
    { id: "ot-komp", name: "Övertid – komptid", category: "overtime", compensation: "leave" },
    { id: "vab", name: "VAB", category: "absence" },
  ],
  vehicleTypes: [
    { id: "firmabil", name: "Firmabil", isCompanyCar: true },
    { id: "privat-bil", name: "Privat bil", isCompanyCar: false, ratePerMil: 25 },
  ],
};
const entries = [
  { id: "e1", userId: "u1", date: "2026-09-24", hours: 7.5, projectId: "p1", timeTypeId: "normal", travelHours: 1, travelBillable: true, vehicleTypeId: "privat-bil", km: 34, comment: "=SUMMA(A1)", status: "approved" },
  { id: "e2", userId: "u1", date: "2026-09-24", hours: 2, projectId: "p1", timeTypeId: "ot-komp", travelHours: 0, vehicleTypeId: "firmabil", vehicleBasis: "day", km: 0, comment: "", status: "draft" },
  { id: "e3", userId: "u2", date: "2026-09-23", hours: 8, projectId: null, timeTypeId: "vab", travelHours: 0, vehicleTypeId: null, km: 0, comment: "", status: "rejected" },
];

console.log("Export");

test("tidsfil: rubriker, BOM, semikolon och filnamn", () => {
  const { filename, content } = buildTimeCsv({ entries, users, projects, customers, settings, month: "2026-09" });
  assert.equal(filename, "tidla-underlag-2026-09.csv");
  assert.ok(content.startsWith("﻿Datum;Anställd;Anställningsnummer;Kundnummer;Kund;Projektnummer;Projekt;Typ av tid;Timmar;"));
  assert.equal(content.split("\r\n").filter(Boolean).length, 4);
});

test("tidsfil: sorterad på datum, decimalkomma, restid och fordon", () => {
  const lines = buildTimeCsv({ entries, users, projects, customers, settings, month: "2026-09" }).content.split("\r\n");
  assert.ok(lines[1].startsWith("2026-09-23;Anna Admin;1;;;;;VAB;8;"), lines[1]);
  assert.ok(lines[2].startsWith('2026-09-24;Maja Medarbetare;2;100;Brf Almen;P-2041;"Takbyte; etapp 1";Arbete;7,5;;;1;Ja;Privat bil;;34;25;'), lines[2]);
  assert.ok(lines[2].endsWith(";'=SUMMA(A1);Godkänd"), "Formel ska skyddas och status stå i klartext");
  assert.ok(lines[3].includes(";Övertid – komptid;2;Komptid;1,5;;;Firmabil;Bil per dag;;;"), lines[3]);
  assert.ok(lines[3].endsWith(";Utkast"));
});

test("tidsfil: suffix för vecka", () => {
  assert.equal(buildTimeCsv({ entries: [], users, projects, customers, settings, month: "2026-09", suffix: "-v39" }).filename, "tidla-underlag-2026-09-v39.csv");
});

test("materialfil: kolumner, artikelnummer och status", () => {
  const { filename, content } = buildMaterialCsv({
    materials: [
      { id: "m1", userId: "u1", date: "2026-09-24", articleId: "a1", name: "Skruv", unit: "kg", quantity: 2.5, projectId: "p1", message: "Beställ mer", handled: false, createdAt: 1 },
    ],
    users, projects, customers,
    articles: [{ id: "a1", articleNo: "S-5" }],
    month: "2026-09",
  });
  assert.equal(filename, "tidla-material-2026-09.csv");
  const lines = content.split("\r\n");
  assert.equal(lines[0], "﻿Datum;Anställd;Kundnummer;Kund;Projektnummer;Projekt;Artikel;Artikelnummer;Antal;Enhet;Meddelande;Status");
  assert.equal(lines[1], '2026-09-24;Maja Medarbetare;100;Brf Almen;P-2041;"Takbyte; etapp 1";Skruv;S-5;2,5;kg;Beställ mer;Ny');
});

console.log(process.exitCode ? "\nNågot exporttest misslyckades." : `\nAlla ${passed} exporttester gick igenom.`);
