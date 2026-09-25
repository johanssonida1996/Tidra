// Laddar ett exempelföretag i testversionen: tömmer webbläsarens Tidla-data och bygger upp företaget
// med samma funktioner i store.js som appen använder – så att all data följer samma regler.
// Tidraderna skapas från första dagen förra månaden till idag och ser likadana ut varje gång
// (slumptalen utgår från företagets nyckel).
import * as store from "../store.js";
import { today, addDays, startOfWeek, weekdayKey, monthOf, addMonths, monthRange } from "../lib/dates.js";
import { roundToStep } from "../lib/format.js";
import { DEMO_COMPANIES, DEMO_PASSWORD } from "./companies.js";

// Slumptal som blir samma varje gång (mulberry32)
function seededRandom(text) {
  let seed = [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUANTITIES = { kg: [0.5, 1, 2], g: [30, 60, 120], ml: [50, 100, 250], st: [2, 4, 6, 10], m: [3, 6, 12] };

export function findDemoCompany(key) {
  return DEMO_COMPANIES.find((c) => c.key === key);
}

// role: "admin" eller "employee" – vem som är inloggad när företaget är klart
export async function loadDemoCompany(key, role = "admin") {
  const company = findDemoCompany(key);
  if (!company) throw new Error("Okänt exempelföretag.");
  const random = seededRandom(company.key);
  const chance = (p) => random() < p;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const step = company.settings.hourStep;

  await store.resetAllData();

  /* ---------- Företag, admin och inställningar ---------- */

  await store.completeSetup({
    companyName: company.name,
    workWeek: company.settings.workWeek,
    admin: { name: company.admin.name, email: company.admin.email, password: DEMO_PASSWORD },
  });
  await store.login(company.admin.email, DEMO_PASSWORD);
  const admin = await store.getSession();
  await store.saveUser({ ...admin, title: company.admin.title, employeeNo: company.admin.employeeNo });
  await store.saveSettings({ ...company.settings, ratesCheckedAt: today() });

  for (const vehicle of (await store.getSettings()).vehicleTypes) {
    const rate = company.vehicleRates[vehicle.id];
    const hidden = company.hiddenVehicles.includes(vehicle.id);
    if (rate === undefined && !hidden) continue;
    await store.saveVehicleType({ id: vehicle.id, name: vehicle.name, ratePerMil: rate ?? vehicle.ratePerMil, hidden });
  }
  await store.addArticleTemplate(company.articleTemplate);
  const articles = await store.listArticles();

  /* ---------- Kunder och projekt ---------- */

  const customers = [];
  const projects = [];
  for (const c of company.customers) {
    const customer = await store.saveCustomer({ customerNo: c.customerNo, name: c.name });
    customers.push(customer);
    for (const [projectNo, name, address] of c.projects) {
      projects.push(await store.saveProject({ customerId: customer.id, projectNo, name, address }));
    }
  }
  if (company.closedProject) {
    const [projectNo, name, address] = company.closedProject.project;
    const closed = await store.saveProject({ customerId: customers[company.closedProject.customer].id, projectNo, name, address });
    await store.setProjectStatus(closed.id, "closed");
  }

  /* ---------- Anställda ---------- */

  const people = [{ user: admin, profile: { projects: company.adminProjects }, isAdmin: true }];
  for (const e of company.employees) {
    const { user, oneTimePassword } = await store.saveUser({
      name: e.name, employeeNo: e.employeeNo, email: e.email, title: e.title, role: "employee", schedule: e.schedule ?? null,
    });
    people.push({ user, profile: e, oneTimePassword });
  }
  if (company.pending) await store.saveUser({ ...company.pending, role: "employee" });

  /* ---------- Tid och material – varje person rapporterar själv ---------- */

  const from = monthRange(addMonths(monthOf(today()), -1)).from;
  const to = today();
  // Semestervecka för den andra medarbetaren – andra hela veckan förra månaden
  const vacationStart = addDays(startOfWeek(addDays(from, 7)), 7);
  const overtimeTypes = { both: ["ot-komp", "ot-lon"], pay: ["ot-lon"], leave: ["ot-komp"], off: [] }[company.settings.overtime.mode];
  const daily = company.daily;

  for (const [index, person] of people.entries()) {
    if (person.oneTimePassword) {
      await store.login(person.profile.email, person.oneTimePassword);
      await store.changePassword({ newPassword: DEMO_PASSWORD });
    } else {
      await store.login(person.user.email, DEMO_PASSWORD);
    }
    const schedule = person.profile.schedule ?? company.settings.workWeek;
    const projectIds = person.profile.projects.map((i) => projects[i].id);
    const vehicle = person.profile.vehicle;

    for (let date = from; date <= to; date = addDays(date, 1)) {
      const planned = schedule[weekdayKey(date)] ?? 0;
      if (!planned) continue;
      // Alla har inte hunnit rapportera idag
      if (date === to && chance(0.5)) continue;

      if (index === 2 && date >= vacationStart && date < addDays(vacationStart, 5)) {
        await store.saveEntry({ date, timeTypeId: "semester", hours: planned });
        continue;
      }
      if (!person.isAdmin && chance(daily.sick)) {
        await store.saveEntry({ date, timeTypeId: "sjuk", hours: planned });
        continue;
      }

      // Arbete: ett eller två projekt, ibland VAB halva dagen
      const vab = !person.isAdmin && chance(daily.vab);
      const workHours = vab ? roundToStep(planned / 2, step) : planned;
      let rows = [[pick(projectIds), workHours]];
      if (projectIds.length > 1 && workHours >= 4 && chance(daily.twoProjects)) {
        const first = roundToStep(workHours * (0.5 + random() * 0.25), step);
        const second = projectIds.find((id) => id !== rows[0][0]);
        rows = [[rows[0][0], first], [second, workHours - first]];
      }
      for (const [i, [projectId, hours]] of rows.entries()) {
        const trip = {};
        if (i === 0 && vehicle && chance(daily.trip)) {
          const isCompanyCar = vehicle === "firmabil";
          Object.assign(trip, {
            vehicleTypeId: vehicle,
            vehicleBasis: isCompanyCar ? "day" : null,
            km: isCompanyCar ? "" : 10 + Math.floor(random() * 70),
          });
        }
        if (i === 0 && company.settings.travel.enabled && chance(daily.travelHours)) {
          trip.travelHours = pick(step < 0.5 ? [0.5, 0.75, 1] : [0.5, 1]);
        }
        await store.saveEntry({
          date, projectId, hours, timeTypeId: "normal", comment: chance(0.2) ? pick(company.comments) : "", ...trip,
        });
      }
      if (vab) await store.saveEntry({ date, timeTypeId: "vab", hours: planned - workHours });
      if (overtimeTypes.length && chance(daily.overtime)) {
        await store.saveEntry({ date, projectId: rows[0][0], timeTypeId: pick(overtimeTypes), hours: pick([1, 1.5, 2]) });
      }
      if (!person.isAdmin && chance(daily.material)) {
        const article = pick(articles);
        await store.saveMaterial({
          date,
          articleId: article.id,
          quantity: pick(QUANTITIES[article.unit] ?? [1, 2, 3]),
          projectId: rows[0][0],
          message: pick(company.materialMessages),
        });
      }
    }
  }

  /* ---------- Admin granskar: äldre veckor godkända, förra veckan delvis, en rad nekad ---------- */

  await store.login(company.admin.email, DEMO_PASSWORD);
  const thisMonday = startOfWeek(to);
  const lastMonday = addDays(thisMonday, -7);
  const entries = await store.listEntries();
  const employee = people[1].user;

  // Den nekade raden hamnar hos medarbetaren man loggar in som – så att det syns i tidrapporten
  const own = entries.filter((e) => e.userId === employee.id && e.projectId && e.date >= lastMonday && e.date < thisMonday);
  const rejected = own.find((e) => (company.key === "stad" ? e.travelHours > 0 : true)) ?? own[0];
  // Förra veckan: varannan person är godkänd, de andra väntar på granskning
  const lastWeekApproved = new Set(people.filter((_, i) => i % 2 === 0).map((p) => p.user.id));
  const approve = entries.filter(
    (e) => e.id !== rejected?.id && (e.date < lastMonday || (e.date < thisMonday && lastWeekApproved.has(e.userId))),
  );
  if (rejected) await store.rejectEntries([rejected.id], company.rejectReason);
  if (approve.length) await store.approveEntries(approve.map((e) => e.id));

  // Förra månaden markeras som klar för dem som har allt godkänt
  const lastMonth = addMonths(monthOf(to), -1);
  const approvedIds = new Set(approve.map((e) => e.id));
  for (const { user } of people) {
    const monthEntries = entries.filter((e) => e.userId === user.id && monthOf(e.date) === lastMonth);
    if (monthEntries.length && monthEntries.every((e) => approvedIds.has(e.id))) await store.lockMonth(user.id, lastMonth);
  }

  const oldMaterials = (await store.listMaterials()).filter((m) => m.date < lastMonday);
  if (oldMaterials.length) await store.setMaterialsHandled(oldMaterials.map((m) => m.id), true);

  /* ---------- Logga in som den som valdes ---------- */

  await store.logout();
  const target = role === "employee" ? employee : admin;
  return store.login(target.email, DEMO_PASSWORD, true);
}
