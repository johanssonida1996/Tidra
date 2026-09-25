// Testversionens exempelföretag: laddas via store.js med samma regler som appen.
// Körs med:  node tests/demo.test.mjs
import * as store from "../js/store.js";
import { loadDemoCompany } from "../js/demo/seed.js";
import { DEMO_COMPANIES, DEMO_PASSWORD } from "../js/demo/companies.js";
import { today, startOfWeek } from "../js/lib/dates.js";

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
}

const local = new MemoryStorage();
store.useStorage(local, new MemoryStorage());

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}

for (const company of DEMO_COMPANIES) {
  await test(`${company.name}: laddas, rätt person inloggad och data för granskning`, async () => {
    const user = await loadDemoCompany(company.key, "employee");
    check(user.email === company.employees[0].email, `Fel inloggad: ${user.email}`);
    check((await store.getSettings()).companyName === company.name, "Fel företagsnamn");
    const own = await store.listEntries();
    check(own.every((e) => e.userId === user.id), "Medarbetaren ser andras rader");
    check(own.some((e) => e.status === "rejected"), "Medarbetaren har ingen nekad rad");

    await store.logout();
    await store.login(company.admin.email, DEMO_PASSWORD);
    const entries = await store.listEntries();
    const count = (status) => entries.filter((e) => e.status === status).length;
    check(count("approved") > 50 && count("draft") > 5 && count("rejected") === 1, `Fel fördelning: ${count("approved")}/${count("draft")}/${count("rejected")}`);
    check(entries.every((e) => e.date <= today()), "Rader i framtiden");
    check(entries.filter((e) => e.date >= startOfWeek(today())).every((e) => e.status === "draft"), "Veckans rader ska vara utkast");
    check((await store.listMonthLocks()).length > 0, "Förra månaden är inte markerad som klar");
    check((await store.listMaterials()).length > 0, "Inga materialuttag");
  });

  await test(`${company.name}: alla kan logga in med ${DEMO_PASSWORD}`, async () => {
    for (const person of [company.admin, ...company.employees]) {
      await store.logout();
      const user = await store.login(person.email, DEMO_PASSWORD);
      check(!user.mustChangePassword, `${person.name} måste byta lösenord`);
    }
    if (company.pending) {
      await store.login(company.admin.email, DEMO_PASSWORD);
      const pending = (await store.listUsers()).find((u) => u.email === company.pending.email);
      check(pending?.status === "pending", "Den väntande medarbetaren saknas");
    }
  });
}

await test("Samma data varje gång (samma slumptal)", async () => {
  await loadDemoCompany("bygg", "admin");
  const first = (await store.listEntries()).map((e) => `${e.date}${e.hours}${e.status}`).join();
  await loadDemoCompany("bygg", "admin");
  const second = (await store.listEntries()).map((e) => `${e.date}${e.hours}${e.status}`).join();
  check(first === second, "Datan skiljer sig mellan två laddningar");
});

await test("resetAllData tömmer allt utom temat och loggar ut", async () => {
  local.setItem("tidla:theme", '"dark"');
  local.setItem("tk-u3", "prototyp");
  await store.resetAllData();
  check(await store.needsSetup(), "Användarna finns kvar");
  check(!(await store.getSession()), "Fortfarande inloggad");
  const keys = [...local.map.keys()];
  check(keys.sort().join() === "tidla:theme,tk-u3", `Kvar: ${keys.join(", ")}`);
});

console.log(failed ? `\n${failed} demotester misslyckades.` : "\nAlla demotester gick igenom.");
if (failed) process.exitCode = 1;
