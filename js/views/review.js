// Granskning.
// Admin: alla anställdas tid per månad – filter, summeringar, godkänna/neka rader eller veckor,
//        markera månad som klar och exportera CSV (tid och material).
// Medarbetare: samma sida med bara egna rader, utan knappar.
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  today, currentMonth, addMonths, monthRange, datesInRange, isoWeek, weekdayKey, formatShort, formatMonthCapital,
  formatMonth, isValidMonth, toISODate, addDays, startOfWeek,
} from "../lib/dates.js";
import { formatHoursUnit, formatHoursDiff, formatInteger, plural } from "../lib/format.js";
import {
  field, select, textarea, statusPill, pill, avatar, emptyState, callout, openDialog, confirmDialog, notify,
} from "../lib/ui.js";
import { downloadFile } from "../lib/csv.js";
import { buildTimeCsv, buildMaterialCsv, filenamePart } from "../lib/export.js";
import { isAdmin } from "../auth.js";
import { ALL } from "../routes.js";
import { allowed } from "./guard.js";
import { placeOf, placeLabel, projectsOn } from "../lib/place.js";
import { ratesNeedCheck } from "../lib/reminders.js";
import { weekOn } from "../lib/schedule.js";

const STATUS_FILTERS = [
  { value: "", label: "Alla" },
  { value: "draft", label: "Väntar på granskning" },
  { value: "approved", label: "Godkända" },
  { value: "rejected", label: "Nekade" },
];

export async function render(container, ctx) {
  if (!allowed(ctx, ALL, container)) return;

  const admin = isAdmin(ctx.user);
  const settings = ctx.settings;
  const travel = settings.travel ?? {};
  const materialsOn = Boolean(settings.materials?.enabled);
  // Påminnelse i januari: beloppen per mil gäller förra året
  const rates = ratesNeedCheck(settings);
  // Av: tiden rapporteras på kunder – summeringen blir per kund och projektfiltret försvinner
  const withProjects = projectsOn(settings);

  const state = {
    month: isValidMonth(ctx.params[0]) ? ctx.params[0] : currentMonth(),
    week: "",
    userId: "",
    customerId: "",
    projectId: "",
    status: "",
    onlyApproved: false,
    open: new Set(), // öppna veckor: "userId|vecka"
    entries: [],
    locks: [],
    users: [],
    projects: [],
    customers: [],
    materials: [],
    articles: [],
  };

  const [users, projects, customers] = await Promise.all([
    store.listUsers(),
    store.listProjects({ includeArchived: admin }),
    store.listCustomers({ includeArchived: admin }),
  ]);
  Object.assign(state, { users, projects, customers });

  const typeById = (id) => settings.timeTypes.find((t) => t.id === id);
  const projectById = (id) => state.projects.find((p) => p.id === id);
  const customerById = (id) => state.customers.find((c) => c.id === id);
  const userById = (id) => state.users.find((u) => u.id === id);
  // Kunden för en rad – via projektet, eller direkt när raden saknar projekt
  const customerIdOf = (row) => placeOf(row, projectById, customerById).customer?.id ?? (row.projectId ? null : row.customerId);
  const category = (e) => typeById(e.timeTypeId)?.category ?? "work";
  // Tid mot schemat: arbete och frånvaro (+ restid om admin valt det). Övertid räknas för sig.
  const scheduleHours = (e) => (category(e) === "overtime" ? 0 : e.hours) + (travel.countsTowardSchedule ? e.travelHours || 0 : 0);
  const sum = (list, fn) => list.reduce((total, e) => total + fn(e), 0);

  async function load() {
    const { from, to } = monthRange(state.month);
    [state.entries, state.locks] = await Promise.all([
      store.listEntries({ from, to }),
      store.listMonthLocks({ month: state.month }),
    ]);
    if (admin && materialsOn) {
      [state.materials, state.articles] = await Promise.all([
        store.listMaterials({ month: state.month }),
        store.listArticles({ includeHidden: true }),
      ]);
    }
  }

  // Veckor (ISO) som ligger i månaden
  function monthWeeks() {
    const { from, to } = monthRange(state.month);
    const weeks = new Map();
    for (const date of datesInRange(from, to)) {
      const { week } = isoWeek(date);
      if (!weeks.has(week)) weeks.set(week, []);
      weeks.get(week).push(date);
    }
    return [...weeks.entries()].map(([week, dates]) => ({ week, dates }));
  }

  // Filtrerade rader (allt utom status för exporten styrs också av filtren)
  function filtered({ ignoreStatus = false } = {}) {
    const weekDates = state.week ? monthWeeks().find((w) => String(w.week) === state.week)?.dates ?? [] : null;
    return state.entries.filter((e) => {
      if (weekDates && !weekDates.includes(e.date)) return false;
      if (state.userId && e.userId !== state.userId) return false;
      if (state.customerId && customerIdOf(e) !== state.customerId) return false;
      if (state.projectId && e.projectId !== state.projectId) return false;
      if (!ignoreStatus && state.status && e.status !== state.status) return false;
      return true;
    });
  }

  const isLocked = (userId) => state.locks.some((l) => l.userId === userId);

  /* ---------- Skelett ---------- */

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">${admin ? "Granskning" : "Granska"}</h1>
          <p class="page-lead">
            ${admin
              ? "Kontrollera, godkänn och exportera underlag för fakturering och lön."
              : "Din tid per vecka och månad – och vad som är godkänt."}
          </p>
        </div>
        <div class="monthnav" data-monthnav></div>
      </div>
      ${admin && rates.due
        ? callout(
            html`<strong>Milersättningen gäller ${rates.validYear ?? "ett tidigare år"} – kontrollera för ${rates.year}.</strong>
              Skatteverket ändrar beloppen vid årsskiftet. <a href="#/installningar/fordon">Kontrollera beloppen</a>`,
            { variant: "pink", iconName: "car" },
          )
        : ""}
      ${admin ? html`<div class="toolbar toolbar--even" data-filters></div>` : ""}
      <div class="stats stats--four" data-stats></div>
      ${admin ? html`<section class="card stack" aria-labelledby="rv-export" data-export></section>` : ""}
      <div class="stack stack--xl" data-people></div>
      ${admin
        ? html`<div class="stack stack--xl">
            <section class="card stack" aria-labelledby="rv-projects" data-projects></section>
            <section class="card stack" aria-labelledby="rv-absence" data-absence></section>
          </div>`
        : ""}
    `,
  );
  const $ = (selector) => container.querySelector(selector);

  /* ---------- Månad och filter ---------- */

  function renderMonthNav() {
    setHTML(
      $("[data-monthnav]"),
      html`<div class="datenav">
        <button type="button" class="icon-btn" data-month="${addMonths(state.month, -1)}" aria-label="Föregående månad">${icon("chevronLeft")}</button>
        <span class="datenav__label" aria-live="polite">${formatMonthCapital(state.month)}</span>
        <button type="button" class="icon-btn" data-month="${addMonths(state.month, 1)}" aria-label="Nästa månad">${icon("chevronRight")}</button>
      </div>`,
    );
  }

  function renderFilters() {
    if (!admin) return;
    const customerProjects = state.projects.filter((p) => !state.customerId || p.customerId === state.customerId);
    setHTML(
      $("[data-filters]"),
      html`
        ${field({
          id: "rv-user",
          label: "Anställd",
          control: select({ id: "rv-user", name: "userId", value: state.userId, placeholder: "Alla anställda", options: state.users
            .filter((u) => u.status === "active" || u.id === state.userId || state.entries.some((e) => e.userId === u.id))
            .map((u) => ({ value: u.id, label: u.name })) }),
        })}
        ${field({
          id: "rv-week",
          label: "Vecka",
          control: select({ id: "rv-week", name: "week", value: state.week, placeholder: "Hela månaden", options: monthWeeks().map((w) => ({ value: String(w.week), label: `Vecka ${w.week}` })) }),
        })}
        ${field({
          id: "rv-customer",
          label: "Kund",
          control: select({ id: "rv-customer", name: "customerId", value: state.customerId, placeholder: "Alla kunder", options: state.customers.map((c) => ({ value: c.id, label: c.name })) }),
        })}
        ${withProjects
          ? field({
              id: "rv-project",
              label: "Projekt",
              control: select({ id: "rv-project", name: "projectId", value: state.projectId, placeholder: "Alla projekt", options: customerProjects.map((p) => ({ value: p.id, label: `${p.projectNo} · ${p.name}` })) }),
            })
          : ""}
        ${field({
          id: "rv-status",
          label: "Status",
          control: select({ id: "rv-status", name: "status", value: state.status, options: STATUS_FILTERS }),
        })}
      `,
    );
  }

  /* ---------- Nyckeltal ---------- */

  function renderStats() {
    const rows = filtered();
    const work = sum(rows.filter((e) => category(e) === "work"), (e) => e.hours);
    const overtime = sum(rows.filter((e) => category(e) === "overtime"), (e) => e.hours);
    const absence = sum(rows.filter((e) => category(e) === "absence"), (e) => e.hours);
    const toReview = rows.filter((e) => e.status === "draft").length;
    const stat = (label, value, pink = false) =>
      html`<div class="stat${pink ? " stat--pink" : ""}"><span class="stat__label">${label}</span><span class="stat__value">${value}</span></div>`;
    setHTML(
      $("[data-stats]"),
      html`
        ${stat("Arbete", formatHoursUnit(work))}
        ${stat("Övertid", formatHoursUnit(overtime), true)}
        ${stat("Frånvaro", formatHoursUnit(absence))}
        ${admin ? stat("Att granska", plural(toReview, "rad", "rader"), toReview > 0) : stat("Restid", formatHoursUnit(sum(rows, (e) => e.travelHours || 0)))}
      `,
    );
  }

  /* ---------- Export ---------- */

  function renderExport() {
    if (!admin) return;
    setHTML(
      $("[data-export]"),
      html`
        <div class="split split--center split--stack export-bar">
          <div class="stack stack--s">
            <h2 class="card__title" id="rv-export">Exportera underlag</h2>
            <p class="text-muted text-small">
              Följer filtren ovan, och filnamnet visar vilka filter som gällde. Filen öppnas i Excel.
              Nekade rader tas inte med – välj status Nekade om du vill exportera dem.
            </p>
          </div>
          <div class="cluster export-actions">
            <label class="check"><input type="checkbox" data-only-approved ${state.onlyApproved ? raw("checked") : ""} /> Bara godkända</label>
            <button type="button" class="btn btn--primary" data-export-time>${icon("download")}Tid (CSV)</button>
            ${materialsOn
              ? html`<button type="button" class="btn btn--secondary" data-export-material>${icon("download")}${settings.materials.label} (CSV)</button>`
              : ""}
          </div>
        </div>
      `,
    );
  }

  /* ---------- Per anställd ---------- */

  // Tid enligt schema som borde vara inlagd:
  // - dagar före idag – idag bara om något redan är registrerat (annars blir dagen ett underskott direkt på morgonen)
  // - från den dag den anställde började (kontot aktiverades, eller första registreringen om den är tidigare)
  // - med schemat som gällde varje dag (ett nytt eget schema ändrar inte äldre veckor)
  function scheduleFor(user, dates) {
    const now = today();
    const own = state.entries.filter((e) => e.userId === user.id);
    const reportedToday = own.some((e) => e.date === now);
    const firstEntry = own.reduce((min, e) => (!min || e.date < min ? e.date : min), null);
    const activated = user.activatedAt ? toISODate(new Date(user.activatedAt)) : null;
    const start = [activated, firstEntry].filter(Boolean).sort()[0] ?? now;
    return dates
      .filter((date) => date >= start && (date < now || (date === now && reportedToday)))
      .reduce((total, date) => total + (weekOn(user, date, settings.workWeek)[weekdayKey(date)] ?? 0), 0);
  }

  // Registrerat som jämförs med schemat: bara till och med idag – inlagd frånvaro framåt (t.ex. semester) är ingen plustid
  const untilToday = (rows) => rows.filter((e) => e.date <= today());
  // Nekade rader ska rättas – de räknas inte som rapporterad tid utan visas för sig ("8,0 h nekat")
  const counted = (rows) => untilToday(rows).filter((e) => e.status !== "rejected");
  const rejectedHours = (rows) => sum(rows.filter((e) => e.status === "rejected"), (e) => e.hours + (e.travelHours || 0));

  // Avvikelsen blir röd först när perioden är slut – innan dess är ett underskott oftast bara tid som inte är inlagd än
  const diffClass = (diff, periodEnd) => (Math.abs(diff) > 0.001 && periodEnd < today() ? "deviation" : "text-muted");

  // Status för en vecka: nekade rader först, sedan om allt är godkänt, annars väntar den på granskning
  // I en låst månad väntar inget längre på granskning – raderna låstes utan att godkännas
  function weekStatus(rows, locked = false) {
    const rejected = rows.filter((e) => e.status === "rejected").length;
    if (rejected) return pill(plural(rejected, "nekad", "nekade"), "rejected", "alert");
    if (rows.every((e) => e.status === "approved")) return statusPill("approved");
    return locked ? pill("Låst utan godkännande", "draft", "lock") : statusPill("draft");
  }

  function entryRow(e, locked) {
    const type = typeById(e.timeTypeId);
    const title = type?.category === "absence" || type?.placeless ? type.name : placeLabel(e, projectById, customerById);
    const meta = [
      formatShort(e.date),
      type && type.category !== "absence" && type.category !== "work" ? type.name : "",
      e.travelHours ? `Restid ${formatHoursUnit(e.travelHours)}${e.travelBillable ? " (debiteras)" : ""}` : "",
      e.km ? `${formatInteger(e.km)} km` : "",
      e.comment,
    ].filter(Boolean).join(" · ");
    const canReview = admin && !locked;
    // Kompakt rad (ingen ikon): i mobilen hamnar timmar och knappar på samma rad under texten
    return html`<li class="row row--wrap row--compact">
      <span class="row__body">
        <span class="row__title">${title}</span>
        <span class="row__meta">${meta}</span>
        ${e.status === "rejected" && e.rejectReason ? html`<span class="row__note">Nekad: ${e.rejectReason}</span>` : ""}
      </span>
      <span class="row__aside">
        ${locked && e.status === "draft"
          ? pill("Låst utan godkännande", "draft", "lock")
          : canReview && e.status === "draft"
            ? "" // Knapparna visar redan att raden väntar på granskning
            : statusPill(e.status)}
        <span class="row__value">${formatHoursUnit(e.hours + (e.travelHours || 0))}</span>
      </span>
      ${canReview
        ? html`<span class="row__actions row__actions--end">
            ${e.status !== "approved"
              ? html`<button type="button" class="btn btn--secondary btn--sm" data-approve="${e.id}" aria-label="Godkänn ${title} ${formatShort(e.date)}">${icon("check", 16)}Godkänn</button>`
              : ""}
            ${e.status !== "rejected"
              ? html`<button type="button" class="btn btn--text btn--text-danger btn--sm" data-reject="${e.id}" aria-label="Neka ${title} ${formatShort(e.date)}">${icon("close", 16)}Neka</button>`
              : ""}
          </span>`
        : ""}
    </li>`;
  }

  function renderPeople() {
    const rows = filtered();
    const weeks = monthWeeks().filter((w) => !state.week || String(w.week) === state.week);
    // Admin: anställda med rader, plus aktiva anställda (så att "ingen tid" syns). Medarbetare: sig själv.
    const people = state.users.filter((u) =>
      (!state.userId || u.id === state.userId) && (rows.some((e) => e.userId === u.id) || (u.status === "active" && !state.customerId && !state.projectId && !state.status)),
    );
    if (!people.length) {
      setHTML($("[data-people]"), emptyState({ iconName: "review", title: "Inget att visa", text: "Ingen tid matchar filtren den här månaden." }));
      return;
    }

    setHTML(
      $("[data-people]"),
      people.map((user) => {
        const own = rows.filter((e) => e.userId === user.id);
        const locked = isLocked(user.id);
        const monthDates = weeks.flatMap((w) => w.dates);
        // All tid i perioden, oavsett filter på status, kund och projekt – annars blir jämförelsen med schemat fel
        const period = state.entries.filter((e) => e.userId === user.id && monthDates.includes(e.date));
        const planned = scheduleFor(user, monthDates);
        const reported = sum(counted(period), scheduleHours);
        const rejected = rejectedHours(period);
        const overtime = sum(period.filter((e) => category(e) === "overtime"), (e) => e.hours);
        const pending = state.entries.filter((e) => e.userId === user.id && e.status !== "approved").length;
        return html`<section class="card stack person" aria-labelledby="rv-person-${user.id}">
          <div class="person__head">
            ${avatar(user.name, { large: true })}
            <div class="person__title">
              <h2 class="card__title" id="rv-person-${user.id}">${user.name}</h2>
              <p class="text-muted text-small">
                ${formatHoursUnit(reported)} av ${formatHoursUnit(planned)}
                <span class="${diffClass(reported - planned, monthRange(state.month).to)}">(${formatHoursDiff(reported - planned)})</span>
                ${overtime ? ` · ${formatHoursUnit(overtime)} övertid` : ""}
                ${rejected ? html` · <span class="text-error">${formatHoursUnit(rejected)} nekat</span>` : ""}
              </p>
            </div>
            <div class="person__actions">
              ${locked ? pill("Månaden klar", "done", "lock") : ""}
              ${admin
                ? locked
                  ? html`<button type="button" class="btn btn--secondary btn--sm" data-unlock="${user.id}">${icon("unlock", 16)}Lås upp</button>`
                  : html`<button type="button" class="btn btn--secondary btn--sm" data-lock="${user.id}" data-pending="${pending}">${icon("lock", 16)}Markera ${formatMonth(state.month).split(" ")[0]} som klar</button>`
                : ""}
            </div>
          </div>
          ${locked
            ? callout(
                admin
                  ? pending
                    ? `Månaden är låst, men ${plural(pending, "rad är inte godkänd", "rader är inte godkända")}. Lås upp om du vill granska dem.`
                    : "Månaden är låst. Inga ändringar kan göras förrän du låser upp den."
                  : "Månaden är markerad som klar och låst.",
                { variant: "pink", iconName: "lock" },
              )
            : ""}
          ${own.length
            ? ""
            : html`<p class="text-muted text-small">Ingen tid registrerad i ${formatMonth(state.month).split(" ")[0]}.</p>`}
          <ul class="list" ${own.length ? "" : raw("hidden")}>
            ${weeks.map((w) => {
              const weekRows = own.filter((e) => w.dates.includes(e.date));
              const weekAll = period.filter((e) => w.dates.includes(e.date));
              const weekPlanned = scheduleFor(user, w.dates);
              const weekReported = sum(counted(weekAll), scheduleHours);
              const weekRejected = rejectedHours(weekAll);
              const weekAhead = sum(weekAll.filter((e) => e.date > today()), (e) => e.hours);
              const weekOvertime = sum(weekAll.filter((e) => category(e) === "overtime"), (e) => e.hours);
              const drafts = weekRows.filter((e) => e.status !== "approved");
              const key = `${user.id}|${w.week}`;
              const open = state.open.has(key);
              const diff = weekReported - weekPlanned;
              const upcoming = w.dates[0] > today();
              return html`<li class="week${open ? " week--open" : ""}">
                <div class="week__head">
                  <button type="button" class="week__toggle" data-toggle-week="${key}" aria-expanded="${String(open)}" aria-controls="rv-week-${key.replace("|", "-")}"
                    ${weekRows.length ? "" : raw("disabled")}>
                    <span class="week__name">Vecka ${w.week}</span>
                    <span class="week__dates text-muted text-small">${formatShort(w.dates[0])}–${formatShort(w.dates[w.dates.length - 1])}</span>
                    <span class="week__sum num">
                      ${upcoming && !weekReported
                        ? html`<span class="text-muted">Kommande${weekAhead ? ` · ${formatHoursUnit(weekAhead)} inlagt` : ""}</span>`
                        : html`${formatHoursUnit(weekReported)} <span class="text-muted">av ${formatHoursUnit(weekPlanned)}</span>
                          <span class="${diffClass(diff, addDays(startOfWeek(w.dates[0]), 6))}">${formatHoursDiff(diff)}</span>`}
                      ${weekOvertime ? html`<span class="text-muted">· ${formatHoursUnit(weekOvertime)} övertid</span>` : ""}
                      ${weekRejected ? html`<span class="text-error">· ${formatHoursUnit(weekRejected)} nekat</span>` : ""}
                      ${weekAhead && !(upcoming && !weekReported) ? html`<span class="text-muted">· ${formatHoursUnit(weekAhead)} inlagt framåt</span>` : ""}
                    </span>
                    ${weekRows.length ? html`<span class="trip__chevron">${icon("chevronDown", 18)}</span>` : ""}
                  </button>
                  ${admin && !locked && drafts.length
                    ? html`<span class="week__actions">
                        ${weekRows.some((e) => e.status === "rejected") ? weekStatus(weekRows) : ""}
                        <button type="button" class="btn btn--secondary btn--sm" data-approve-week="${key}">${icon("check", 16)}Godkänn vecka</button>
                        <button type="button" class="btn btn--text btn--text-danger btn--sm" data-reject-week="${key}">Neka</button>
                      </span>`
                    : weekRows.length
                      ? weekStatus(weekRows, locked)
                      : ""}
                </div>
                <div class="week__rows" id="rv-week-${key.replace("|", "-")}" ${open ? "" : raw("hidden")}>
                  <ul class="list">${weekRows.map((e) => entryRow(e, locked))}</ul>
                </div>
              </li>`;
            })}
          </ul>
        </section>`;
      }),
    );
  }

  /* ---------- Summeringar (admin) ---------- */

  function renderSummaries() {
    if (!admin) return;
    const rows = filtered();
    // Per projekt – eller per kund när projekt inte används (äldre projektrader räknas till sin kund)
    const groupOf = (e) => (withProjects && e.projectId ? `p:${e.projectId}` : `c:${customerIdOf(e)}`);
    const byProject = new Map();
    for (const e of rows.filter((x) => x.projectId || x.customerId)) {
      const key = groupOf(e);
      const item = byProject.get(key) ?? { hours: 0, overtime: 0, travelBilled: 0, travelFree: 0, count: 0, km: 0 };
      if (category(e) === "overtime") item.overtime += e.hours;
      else item.hours += e.hours;
      if (e.travelBillable) item.travelBilled += e.travelHours || 0;
      else item.travelFree += e.travelHours || 0;
      item.count += 1;
      item.km += Number(e.km) || 0;
      byProject.set(key, item);
    }
    const byAbsence = new Map();
    for (const e of rows.filter((x) => category(x) === "absence")) {
      byAbsence.set(e.timeTypeId, (byAbsence.get(e.timeTypeId) ?? 0) + e.hours);
    }

    setHTML(
      $("[data-projects]"),
      html`
        <h2 class="card__title" id="rv-projects">${withProjects ? "Per projekt" : "Per kund"}</h2>
        ${byProject.size
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr>
                <th scope="col">${withProjects ? "Projekt" : "Kund"}</th>
                <th scope="col" class="num">Arbete</th>
                <th scope="col" class="num">Övertid</th>
                <th scope="col" class="num">Restid deb.</th>
                <th scope="col" class="num">Restid ej deb.</th>
                <th scope="col" class="num">Km</th>
                <th scope="col" class="num">Rader</th>
              </tr></thead>
              <tbody>
                ${[...byProject.entries()].map(([key, s]) => {
                  const id = key.slice(2);
                  const p = key.startsWith("p:") ? projectById(id) : null;
                  const c = customerById(p ? p.customerId : id);
                  const title = key.startsWith("p:") ? (p ? `${p.projectNo} ${p.name}` : "Okänt projekt") : c?.name ?? "Okänd kund";
                  return html`<tr>
                    <th scope="row"><span class="table__title">${title}</span>${p ? html`<span class="text-muted text-small">${c?.name ?? ""}</span>` : ""}</th>
                    <td class="num">${formatHoursUnit(s.hours)}</td>
                    <td class="num">${formatHoursUnit(s.overtime)}</td>
                    <td class="num">${formatHoursUnit(s.travelBilled)}</td>
                    <td class="num">${formatHoursUnit(s.travelFree)}</td>
                    <td class="num">${formatInteger(s.km)}</td>
                    <td class="num">${s.count}</td>
                  </tr>`;
                })}
              </tbody>
            </table></div>`
          : html`<p class="text-muted text-small">${withProjects ? "Ingen projekttid." : "Ingen tid på kunder."}</p>`}
      `,
    );
    setHTML(
      $("[data-absence]"),
      html`
        <h2 class="card__title" id="rv-absence">Frånvaro per typ</h2>
        ${byAbsence.size
          ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th scope="col">Typ</th><th scope="col" class="num">Timmar</th></tr></thead>
              <tbody>
                ${[...byAbsence.entries()].map(([id, hours]) => html`<tr><th scope="row">${typeById(id)?.name ?? "Okänd"}</th><td class="num">${formatHoursUnit(hours)}</td></tr>`)}
              </tbody>
            </table></div>`
          : html`<p class="text-muted text-small">Ingen frånvaro.</p>`}
      `,
    );
  }

  /* ---------- Rita ---------- */

  function renderAll() {
    renderMonthNav();
    renderFilters();
    renderStats();
    renderExport();
    renderPeople();
    renderSummaries();
  }

  async function refresh() {
    await load();
    renderAll();
  }

  /* ---------- Åtgärder ---------- */

  async function askReason(count) {
    let reason = null;
    await openDialog({
      title: count > 1 ? `Neka ${count} rader` : "Neka raden",
      body: field({
        id: "rv-reason",
        label: "Orsak",
        help: "Medarbetaren ser orsaken och kan rätta raden.",
        control: textarea({ id: "rv-reason", name: "reason", rows: 2, maxlength: 200, help: true, placeholder: withProjects ? "T.ex. fel projekt" : "T.ex. fel kund" }),
      }),
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--danger">Neka</button>`,
      onSubmit: async ({ form }) => {
        const value = form.elements.reason.value.trim();
        if (!value) throw Object.assign(new Error("Skriv en kort orsak."), { fields: { reason: "Skriv en kort orsak." } });
        reason = value;
        return "ok";
      },
    });
    return reason;
  }

  const weekIds = (key) => {
    const [userId, week] = key.split("|");
    const dates = monthWeeks().find((w) => String(w.week) === week)?.dates ?? [];
    return filtered({ ignoreStatus: true }).filter((e) => e.userId === userId && dates.includes(e.date) && e.status !== "approved").map((e) => e.id);
  };

  // Filtren i filnamnet: tidla-underlag-2026-10-v41-erik-lind-godkanda.csv
  const STATUS_NAMES = { draft: "vantar", approved: "godkanda", rejected: "nekade" };
  function exportSuffix({ withStatus = true } = {}) {
    const parts = [
      state.week && `v${state.week}`,
      state.userId && userById(state.userId)?.name,
      state.customerId && customerById(state.customerId)?.name,
      state.projectId && projectById(state.projectId)?.projectNo,
      withStatus && (state.onlyApproved ? "godkanda" : STATUS_NAMES[state.status]),
    ];
    // Filter som inte används blir false/undefined/"" – de hoppas över före omvandlingen till text
    return parts.filter(Boolean).map(filenamePart).filter(Boolean).map((part) => `-${part}`).join("");
  }

  function exportTime() {
    const matching = filtered().filter((e) => !state.onlyApproved || e.status === "approved");
    // Nekade rader följer bara med när man filtrerar på dem – annars kan de faktureras av misstag
    const rows = matching.filter((e) => state.status === "rejected" || e.status !== "rejected");
    const skipped = matching.length - rows.length;
    if (!rows.length) {
      return notify(skipped ? "Alla rader är nekade. Välj status Nekade om du vill exportera dem." : "Det finns inga rader att exportera med de här filtren.", { type: "error" });
    }
    const { filename, content } = buildTimeCsv({
      entries: rows, users: state.users, projects: state.projects, customers: state.customers, settings,
      month: state.month, suffix: exportSuffix(),
    });
    downloadFile(filename, content);
    notify(`${filename} är nedladdad (${plural(rows.length, "rad", "rader")}${skipped ? `, ${plural(skipped, "nekad rad", "nekade rader")} togs inte med` : ""})`);
  }

  function exportMaterial() {
    const weekDates = state.week ? monthWeeks().find((w) => String(w.week) === state.week)?.dates ?? [] : null;
    const rows = state.materials.filter((m) =>
      (!weekDates || weekDates.includes(m.date)) &&
      (!state.userId || m.userId === state.userId) &&
      (!state.projectId || m.projectId === state.projectId) &&
      (!state.customerId || customerIdOf(m) === state.customerId),
    );
    if (!rows.length) return notify("Det finns inget material från lagret att exportera med de här filtren.", { type: "error" });
    const { filename, content } = buildMaterialCsv({
      materials: rows, users: state.users, projects: state.projects, customers: state.customers, articles: state.articles, month: state.month,
      suffix: exportSuffix({ withStatus: false }),
    });
    downloadFile(filename, content);
    notify(`${filename} är nedladdad (${plural(rows.length, "rad", "rader")})`);
  }

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-only-approved]")) {
      state.onlyApproved = target.checked;
      return;
    }
    if (!target.closest("[data-filters]")) return;
    state[target.name] = target.value;
    if (target.name === "customerId") state.projectId = "";
    renderAll();
    $(`[name="${target.name}"]`)?.focus();
  });

  container.addEventListener("click", async (event) => {
    const target = event.target;
    const month = target.closest("[data-month]");
    if (month) {
      state.month = month.dataset.month;
      state.week = "";
      state.open.clear();
      history.replaceState(null, "", `#/granska/${state.month}`);
      await refresh();
      $(`[aria-label="${month.getAttribute("aria-label")}"]`)?.focus();
      return;
    }
    const toggle = target.closest("[data-toggle-week]");
    if (toggle) {
      const key = toggle.dataset.toggleWeek;
      if (state.open.has(key)) state.open.delete(key);
      else state.open.add(key);
      renderPeople();
      $(`[data-toggle-week="${key}"]`)?.focus();
      return;
    }
    if (target.closest("[data-export-time]")) return exportTime();
    if (target.closest("[data-export-material]")) return exportMaterial();
    if (!admin) return;

    try {
      const approve = target.closest("[data-approve]");
      if (approve) {
        await store.approveEntries([approve.dataset.approve]);
        notify("Raden är godkänd");
        await refresh();
        return;
      }
      const reject = target.closest("[data-reject]");
      if (reject) {
        const reason = await askReason(1);
        if (!reason) return;
        await store.rejectEntries([reject.dataset.reject], reason);
        notify("Raden är nekad");
        await refresh();
        return;
      }
      const approveWeek = target.closest("[data-approve-week]");
      if (approveWeek) {
        const ids = weekIds(approveWeek.dataset.approveWeek);
        await store.approveEntries(ids);
        notify(plural(ids.length, "rad godkänd", "rader godkända"));
        await refresh();
        return;
      }
      const rejectWeek = target.closest("[data-reject-week]");
      if (rejectWeek) {
        const ids = weekIds(rejectWeek.dataset.rejectWeek);
        const reason = await askReason(ids.length);
        if (!reason) return;
        await store.rejectEntries(ids, reason);
        notify(plural(ids.length, "rad nekad", "rader nekade"));
        await refresh();
        return;
      }
      const lock = target.closest("[data-lock]");
      if (lock) {
        const user = userById(lock.dataset.lock);
        const pending = Number(lock.dataset.pending);
        // Är månaden inte slut kan det inte heller registreras tid för resten av den
        const { from, to } = monthRange(state.month);
        const rest = to >= today() ? { from: from > today() ? from : today(), to } : null;
        const ok = await confirmDialog({
          title: `Markera ${formatMonth(state.month)} som klar för ${user.name}?`,
          message: [
            pending
              ? `${plural(pending, "rad är inte godkänd", "rader är inte godkända")}. Månaden låses ändå, och ingen kan ändra något förrän du låser upp den.`
              : "Månaden låses. Ingen kan ändra något förrän du låser upp den.",
            rest
              ? `${formatMonthCapital(state.month)} är inte slut. ${user.name} kan inte heller registrera tid för resten av månaden (${formatShort(rest.from)}–${formatShort(rest.to)}) förrän du låser upp den.`
              : "",
          ].filter(Boolean).join(" "),
          confirmLabel: "Markera som klar",
        });
        if (!ok) return;
        await store.lockMonth(user.id, state.month);
        notify(`${formatMonthCapital(state.month)} är klar för ${user.name}`);
        await refresh();
        return;
      }
      const unlock = target.closest("[data-unlock]");
      if (unlock) {
        const user = userById(unlock.dataset.unlock);
        const ok = await confirmDialog({
          title: `Låsa upp ${formatMonth(state.month)} för ${user.name}?`,
          message: "Då kan rader ändras, godkännas och nekas igen.",
          confirmLabel: "Lås upp",
        });
        if (!ok) return;
        await store.unlockMonth(user.id, state.month);
        notify(`${formatMonthCapital(state.month)} är upplåst för ${user.name}`);
        await refresh();
      }
    } catch (error) {
      notify(error.message, { type: "error" });
    }
  });

  await refresh();
}
