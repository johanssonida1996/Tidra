// Lägg till tid – designen 3-lagg-till-tid-dator / 5-lagg-till-tid-mobil.
// Samma vy för medarbetare och admin (admin rapporterar egen tid).
// Dator: datumväljare ‹ Idag · tor 24 sep ›, formulär till vänster, Dagens tid och Snabbval till höger.
// Mobil: veckoremsa mån–fre, kortet "Idag x av y h", formuläret i en kolumn.
//
// Formuläret har tre delar som fälls ut och ihop, och en gemensam Spara-knapp under:
// 1. Registrera arbetstid (utfälld) – kund, projekt, typ av tid, timmar och kommentar
// 2. Resa (stängd) – restid och milersättning, sparas på samma rad som arbetstiden
// 3. Material (stängd, tillval) – ett uttag på samma projekt och datum
// Vad som syns styrs av admins inställningar.
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  today, addDays, startOfWeek, weekDates, isoWeek, monthOf, weekdayKey,
  formatShort, formatLong, formatLongLower, formatDayShort, dayOfMonth, isValidISODate,
} from "../lib/dates.js";
import {
  parseHours, formatHours, formatHoursUnit, formatInteger, clamp, roundToStep, firstName, plural,
} from "../lib/format.js";
import {
  field, input, select, textarea, statusPill, emptyState, callout, confirmDialog, notify,
  showFormErrors, clearFormErrors, setBusy,
} from "../lib/ui.js";
import { isAdmin } from "../auth.js";
import { ALL } from "../routes.js";
import { allowed } from "./guard.js";
import { updateBadges } from "./shell.js";

const TYPE_ICONS = { work: "clock", overtime: "overtime", absence: "sun" };
// Valet "Annat – skriv själv" i materiallistan
const OTHER = "__other";
// Fältnamn i formuläret för materialet (store.saveMaterial använder namnen utan "mat")
const MATERIAL_FIELDS = { articleId: "matArticleId", name: "matName", unit: "matUnit", quantity: "matQuantity", message: "matMessage" };

// Hur många minuter ett steg är, i text
const stepText = (step) => (step === 1 ? "en timme" : `${Math.round(step * 60)} minuter`);

export async function render(container, ctx) {
  if (!allowed(ctx, ALL, container)) return;

  const me = ctx.user;
  const settings = ctx.settings;
  const step = settings.hourStep || 0.5;
  const vehicles = settings.vehicleTypes.filter((v) => !v.hidden);
  const timeTypes = settings.timeTypes;
  const overtimeMode = settings.overtime?.mode ?? "both";
  const travel = settings.travel ?? { enabled: true, billableDefault: false, employeeCanChangeBilling: true, countsTowardSchedule: false };
  const defaultType = timeTypes.find((t) => t.category === "work")?.id ?? "normal";
  const materials = settings.materials ?? { enabled: false, label: "Material" };
  const materialLabel = materials.label || "Material";
  const quantityText = (q) => String(q).replace(".", ",");
  // Inget fordon är förvalt – man väljer själv om milersättning ska registreras
  const defaultVehicle = "";

  const typeById = (id) => timeTypes.find((t) => t.id === id);
  const isAbsence = (id) => typeById(id)?.category === "absence";
  const isOvertimeType = (id) => typeById(id)?.category === "overtime";
  // Övertidstyper som admin tillåter
  const allowedOvertime = timeTypes.filter(
    (t) => t.category === "overtime" && !t.hidden && (overtimeMode === "both" || t.compensation === overtimeMode),
  );

  // "Arbete" (arbete + tillåten övertid) och "Frånvaro"
  const typeGroups = (currentId) => [
    {
      label: "Arbete",
      options: timeTypes
        .filter((t) => (t.category === "work" && !t.hidden) || allowedOvertime.includes(t) || (t.id === currentId && t.category !== "absence"))
        .map((t) => ({ value: t.id, label: t.name })),
    },
    {
      label: "Frånvaro",
      options: timeTypes
        .filter((t) => t.category === "absence" && (!t.hidden || t.id === currentId))
        .map((t) => ({ value: t.id, label: t.name })),
    },
  ];

  function typeHelp(type) {
    if (!type) return "";
    if (type.category === "absence") return "Frånvaro kräver ingen kund eller projekt.";
    if (type.category === "overtime") {
      return `Räknas utöver schemat och ersätts med ${type.compensation === "leave" ? "komptid (ledighet)" : "lön"}.`;
    }
    return "";
  }

  const [customers, projects, workWeek] = await Promise.all([
    store.listCustomers(),
    store.listProjects({ selectableOnly: true }),
    store.getWorkWeek(),
  ]);
  // Även avslutade/arkiverade projekt behövs för att visa äldre rader
  const allProjects = await store.listProjects({ includeArchived: isAdmin(me) });
  const allCustomers = isAdmin(me) ? await store.listCustomers({ includeArchived: true }) : customers;
  const articles = materials.enabled ? await store.listArticles() : [];
  const allowFreeText = materials.allowFreeText ?? true;

  const state = {
    date: isValidISODate(ctx.params[0]) ? ctx.params[0] : today(),
    weekEntries: [],
    locked: false,
    lastEntry: null,
    editing: null,
    workOpen: true,
    tripOpen: false,
    tripTouched: false, // användaren har själv öppnat eller stängt Resa
    materialOpen: false,
    dayMaterials: [],
    form: emptyForm(),
    material: emptyMaterial(),
  };

  function emptyMaterial() {
    return { articleId: articles.length ? "" : OTHER, name: "", unit: "", quantity: "", message: "" };
  }

  // Har man börjat fylla i materialet?
  const hasMaterial = (m = state.material) =>
    Boolean((m.articleId && m.articleId !== OTHER) || m.name.trim() || m.unit.trim() || String(m.quantity).trim() || m.message.trim());

  function emptyForm() {
    return {
      customerId: "",
      projectId: "",
      timeTypeId: defaultType,
      hours: null,
      travelHours: 0,
      travelBillable: travel.billableDefault,
      vehicleTypeId: defaultVehicle,
      vehicleBasis: "day",
      km: "",
      comment: "",
    };
  }

  const projectById = (id) => allProjects.find((p) => p.id === id) ?? projects.find((p) => p.id === id);
  const customerById = (id) => allCustomers.find((c) => c.id === id);
  const vehicleById = (id) => settings.vehicleTypes.find((v) => v.id === id);
  const dayEntries = (date = state.date) => state.weekEntries.filter((e) => e.date === date);
  const isOvertime = (e) => isOvertimeType(e.timeTypeId);
  // Tid som räknas mot schemat: arbete och frånvaro, restid om admin har valt det. Övertid räknas för sig.
  const scheduleHours = (e) => (isOvertime(e) ? 0 : e.hours) + (travel.countsTowardSchedule ? e.travelHours || 0 : 0);
  // All registrerad tid (visas i veckoremsan)
  const daySum = (date = state.date) => dayEntries(date).reduce((sum, e) => sum + e.hours + (e.travelHours || 0), 0);
  const scheduleSum = (date = state.date) => dayEntries(date).reduce((sum, e) => sum + scheduleHours(e), 0);
  const overtimeSum = (date = state.date) => dayEntries(date).filter(isOvertime).reduce((sum, e) => sum + e.hours, 0);
  const scheduled = (date = state.date) => workWeek[weekdayKey(date)] ?? 0;

  // Kvar av schemat (utom raden som redigeras)
  function remainingSchedule() {
    const used = dayEntries()
      .filter((e) => e.id !== state.editing?.id)
      .reduce((sum, e) => sum + scheduleHours(e), 0);
    return Math.max(0, roundToStep(scheduled() - used, step));
  }

  // Förifylld tid: det som är kvar av schemat – men inte vid övertid
  const suggestedHours = () => (isOvertimeType(state.form.timeTypeId) ? 0 : remainingSchedule());

  async function load() {
    const monday = startOfWeek(state.date);
    const [weekEntries, locks, lastEntry] = await Promise.all([
      store.listEntries({ userId: me.id, from: monday, to: addDays(monday, 6) }),
      store.listMonthLocks({ month: monthOf(state.date), userId: me.id }),
      store.getLastEntryBefore(state.date),
    ]);
    state.weekEntries = weekEntries;
    state.rejected = await store.listEntries({ userId: me.id, status: "rejected" });
    state.locked = locks.length > 0;
    state.lastEntry = lastEntry;
    if (materials.enabled) {
      state.dayMaterials = await store.listMaterials({ userId: me.id, date: state.date });
    }
  }

  /* ---------- Skelett ---------- */

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <div class="eyebrow">Hej, ${firstName(me.name)}</div>
          <h1 class="page-title">Lägg till tid</h1>
          <p class="page-lead only-desktop">Välj först kund och därefter rätt projekt för arbetet.</p>
          <div class="only-mobile" data-mobile-week></div>
        </div>
        <div class="only-desktop" data-datenav></div>
      </div>

      <div data-rejected></div>

      <div class="only-mobile stack stack--m" data-mobile-day></div>

      <div class="time-layout">
        <div class="time-layout__main">
          <section class="time-form" aria-label="Registrera tid" data-form-card></section>
          <section class="stack stack--m" aria-labelledby="time-list-title" data-list></section>
          <section class="stack stack--m" aria-labelledby="time-material-title" data-material-list hidden></section>
        </div>
        <aside class="time-layout__aside" aria-label="Översikt">
          <section class="card stack only-desktop" aria-labelledby="time-today-title" data-today></section>
          <section class="card stack" aria-labelledby="time-quick-title" data-quick></section>
        </aside>
      </div>
    `,
  );

  const $ = (selector) => container.querySelector(selector);

  /* ---------- Datum ---------- */

  // focusLabel: aria-label på knappen som ska få fokus igen efter omritningen
  function setDate(date, focusLabel = null) {
    if (!isValidISODate(date) || date === state.date) return;
    state.date = date;
    state.editing = null;
    state.form = { ...state.form, hours: null, comment: "" };
    state.tripTouched = false;
    history.replaceState(null, "", `#/tid/${date}`);
    refresh({ focusLabel });
  }

  function renderDateNav() {
    const isToday = state.date === today();
    setHTML(
      $("[data-datenav]"),
      html`<div class="cluster cluster--tight">
        ${!isToday ? html`<button type="button" class="btn btn--text btn--sm" data-goto="${today()}">Till idag</button>` : ""}
        <div class="datenav">
          <button type="button" class="icon-btn" data-goto="${addDays(state.date, -1)}" aria-label="Föregående dag">${icon("chevronLeft")}</button>
          <label class="datenav__label">
            ${isToday ? "Idag · " : ""}${formatShort(state.date)}
            <span class="visually-hidden">– välj datum</span>
            <input type="date" class="datenav__picker" value="${state.date}" data-date-picker />
          </label>
          <button type="button" class="icon-btn" data-goto="${addDays(state.date, 1)}" aria-label="Nästa dag">${icon("chevronRight")}</button>
        </div>
      </div>`,
    );
  }

  function renderMobileWeek() {
    const monday = startOfWeek(state.date);
    const week = isoWeek(state.date).week;
    setHTML(
      $("[data-mobile-week]"),
      html`<div class="week-head">
        <button type="button" class="icon-btn icon-btn--ghost" data-goto="${addDays(monday, -7)}" aria-label="Föregående vecka">${icon("chevronLeft")}</button>
        <span class="week-head__label">Vecka ${week}${settings.companyName ? ` · ${settings.companyName}` : ""}</span>
        <button type="button" class="icon-btn icon-btn--ghost" data-goto="${addDays(monday, 7)}" aria-label="Nästa vecka">${icon("chevronRight")}</button>
        <label class="link-btn week-head__pick">
          Välj datum
          <input type="date" class="datenav__picker" value="${state.date}" data-date-picker />
        </label>
      </div>`,
    );
  }

  function renderMobileDay() {
    const monday = startOfWeek(state.date);
    // Mån–fre, plus helgdagar som är valda eller har registreringar
    const days = weekDates(monday, 7).filter((d, i) => i < 5 || d === state.date || dayEntries(d).length);
    const sum = scheduleSum();
    const overtime = overtimeSum();
    const planned = scheduled();
    const isToday = state.date === today();
    setHTML(
      $("[data-mobile-day]"),
      html`
        <div class="weekstrip" role="group" aria-label="Välj dag">
          <div class="weekstrip__days">
            ${days.map((d) => {
              const total = daySum(d);
              const label = `${formatLong(d)}, ${total ? `${formatHours(total)} timmar registrerade` : "ingen registrering"}`;
              return html`<button type="button" class="weekstrip__day" data-goto="${d}"
                aria-pressed="${String(d === state.date)}" aria-label="${label}">
                <span class="weekstrip__name" aria-hidden="true">${formatDayShort(d)}</span>
                <span class="weekstrip__date" aria-hidden="true">${dayOfMonth(d)}</span>
                ${total && d !== state.date
                  ? html`<span class="weekstrip__sum" aria-hidden="true">${formatHoursUnit(total)}</span>`
                  : html`<span class="weekstrip__dot" aria-hidden="true"></span>`}
              </button>`;
            })}
          </div>
        </div>
        <div class="today-card">
          <div class="split">
            <strong>${isToday ? "Idag" : formatShort(state.date)}</strong>
            <span class="text-muted"><span class="today-card__value">${formatHours(sum)}</span> av ${formatHoursUnit(planned)}</span>
          </div>
          ${overtime ? html`<span class="text-small text-muted">+ ${formatHoursUnit(overtime)} övertid</span>` : ""}
          ${progressBar(sum, planned)}
        </div>
      `,
    );
  }

  function progressBar(sum, planned) {
    const percent = planned ? Math.min(100, Math.round((sum / planned) * 100)) : sum ? 100 : 0;
    return html`<div class="progress" role="progressbar" aria-label="Registrerat av programmerad tid"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${formatHours(sum)} av ${formatHours(planned)} timmar">
      <div class="progress__bar" style="width: ${percent}%"></div>
    </div>`;
  }

  /* ---------- Dagens tid och snabbval ---------- */

  function renderToday() {
    const sum = scheduleSum();
    const overtime = overtimeSum();
    const planned = scheduled();
    const left = Math.max(0, planned - sum);
    const percent = planned ? Math.min(100, Math.round((sum / planned) * 100)) : 0;
    setHTML(
      $("[data-today]"),
      html`
        <h2 class="card__title" id="time-today-title">${state.date === today() ? "Dagens tid" : `Tid ${formatShort(state.date)}`}</h2>
        <div class="stats">
          <div class="stat"><span class="stat__label">Registrerat</span><span class="stat__value">${formatHoursUnit(sum)}</span></div>
          <div class="stat stat--pink"><span class="stat__label">Övertid</span><span class="stat__value">${formatHoursUnit(overtime)}</span></div>
        </div>
        <div class="stack stack--s">
          ${progressBar(sum, planned)}
          <div class="split text-small text-muted">
            <span>${planned ? `av ${formatHoursUnit(planned)} programmerad · ${formatHoursUnit(left)} kvar` : "Ledig dag enligt schemat"}</span>
            <span>${planned ? `${percent} %` : ""}</span>
          </div>
        </div>
      `,
    );
  }

  function describeEntry(e) {
    if (isAbsence(e.timeTypeId)) {
      const name = typeById(e.timeTypeId)?.name ?? "Frånvaro";
      return { title: name, short: name };
    }
    const p = projectById(e.projectId);
    const c = customerById(p?.customerId);
    return {
      title: `${c?.name ?? "Okänd kund"} · ${p ? `${p.projectNo} ${p.name}` : "Okänt projekt"}`,
      short: `${c?.name ?? "Okänd kund"} · ${p?.projectNo ?? "?"}`,
    };
  }

  const entryTotal = (e) => e.hours + (e.travelHours || 0);

  function renderQuick() {
    const last = state.lastEntry;
    setHTML(
      $("[data-quick]"),
      html`
        <h2 class="card__title" id="time-quick-title">Snabbval</h2>
        <button type="button" class="quick" data-same-as-last ${!last || state.locked ? raw("disabled") : ""}>
          <span class="row__icon">${icon("clock", 19)}</span>
          <span class="row__body">
            <span class="row__title">Samma som igår</span>
            <span class="row__meta">
              ${last
                ? `${describeEntry(last).short} · ${formatHoursUnit(entryTotal(last))} (${formatShort(last.date)})`
                : "Blir tillgängligt när du har registrerat tid"}
            </span>
          </span>
          <span class="row__arrow">${icon("arrowRight")}</span>
        </button>
      `,
    );
  }

  /* ---------- Formulär ---------- */

  function stepper({ id, name, value, label }) {
    return html`<div class="stepper">
      <button type="button" class="icon-btn" data-step="-1" data-step-for="${id}" aria-label="Minska ${label} ${stepText(step)}">${icon("minus", 20)}</button>
      <input class="input stepper__input" id="${id}" name="${name}" inputmode="decimal" autocomplete="off"
        value="${formatHours(value)}" aria-describedby="${id}-help" />
      <button type="button" class="icon-btn" data-step="1" data-step-for="${id}" aria-label="Öka ${label} ${stepText(step)}">${icon("plus", 20)}</button>
    </div>`;
  }

  function tripSummary(f) {
    const vehicle = vehicleById(f.vehicleTypeId);
    const parts = [];
    if (f.travelHours) parts.push(`Restid ${formatHoursUnit(f.travelHours)}${f.travelBillable ? " (debiteras)" : ""}`);
    if (vehicle) parts.push(vehicleText(f));
    return parts.length ? parts.join(" · ") : travel.enabled ? "Restid och milersättning" : "Milersättning";
  }

  // Visas i rubriken när "Registrera arbetstid" är ihopfälld
  function workSummary(f) {
    const hours = formatHoursUnit(f.hours ?? suggestedHours());
    const type = typeById(f.timeTypeId);
    if (type?.category === "absence") return `${type.name} · ${hours}`;
    const p = projectById(f.projectId);
    const c = customerById(f.customerId);
    const where = p ? `${c?.name ?? ""} · ${p.projectNo}` : c ? `${c.name} · inget projekt valt` : "Ingen kund vald";
    return [where, type?.category === "overtime" ? type.name : "", hours].filter(Boolean).join(" · ");
  }

  function materialSummary(m) {
    const article = articles.find((a) => a.id === m.articleId);
    const name = article?.name ?? m.name.trim();
    const unit = article?.unit ?? m.unit.trim();
    const quantity = String(m.quantity).trim();
    return [name, quantity ? `${quantity.replace(".", ",")} ${unit}`.trim() : ""].filter(Boolean).join(" · ") || "Påbörjat";
  }

  // En del av formuläret som fälls ut och ihop (Arbetstid, Resa, Material)
  function section({ key, open, iconName, title, meta = "", pink = false, body }) {
    return html`<div class="trip${open ? " trip--open" : ""}" data-section="${key}">
      <button type="button" class="trip__toggle" data-toggle="${key}" aria-expanded="${String(open)}" aria-controls="time-${key}">
        <span class="row__icon${pink ? " row__icon--pink" : ""}">${icon(iconName, 19)}</span>
        <span class="row__body">
          <span class="row__title">${title}</span>
          ${meta ? html`<span class="row__meta" data-summary="${key}">${meta}</span>` : ""}
        </span>
        <span class="trip__chevron">${icon("chevronDown", 20)}</span>
      </button>
      <div class="trip__body" id="time-${key}" ${open ? "" : raw("hidden")}>${body}</div>
    </div>`;
  }

  function materialFields(m) {
    if (!articles.length && !allowFreeText) {
      return callout("Administratören har inte lagt till några artiklar än.", { iconName: "info" });
    }
    const article = articles.find((a) => a.id === m.articleId);
    const other = m.articleId === OTHER;
    return html`
      <p class="text-muted text-small">Uttaget kopplas till projektet och datumet ovan. Vill du bara registrera material? Sätt timmarna till 0.</p>
      ${field({
        id: "mat-article",
        label: "Vad",
        control: select({
          id: "mat-article",
          name: MATERIAL_FIELDS.articleId,
          value: m.articleId,
          placeholder: articles.length ? "Välj i listan…" : undefined,
          options: [
            ...articles.map((a) => ({ value: a.id, label: `${a.name} (${a.unit})` })),
            ...(allowFreeText ? [{ value: OTHER, label: "Annat – skriv själv" }] : []),
          ],
        }),
      })}
      ${other
        ? html`<div class="grid-2">
            ${field({ id: "mat-name", label: "Beskrivning", control: input({ id: "mat-name", name: MATERIAL_FIELDS.name, value: m.name, autocomplete: "off" }) })}
            ${field({
              id: "mat-unit",
              label: "Enhet",
              control: html`${input({ id: "mat-unit", name: MATERIAL_FIELDS.unit, value: m.unit, list: "mat-units", autocomplete: "off", placeholder: "t.ex. st" })}
                <datalist id="mat-units">${store.UNITS.map((u) => html`<option value="${u}"></option>`)}</datalist>`,
            })}
          </div>`
        : ""}
      <div class="grid-2">
        ${field({
          id: "mat-quantity",
          label: html`Antal${article ? html` <span class="field__optional">(${article.unit})</span>` : ""}`,
          control: input({ id: "mat-quantity", name: MATERIAL_FIELDS.quantity, value: m.quantity, inputmode: "decimal", autocomplete: "off", placeholder: "t.ex. 2" }),
        })}
      </div>
      ${field({
        id: "mat-message",
        label: "Meddelande",
        optional: true,
        control: textarea({ id: "mat-message", name: MATERIAL_FIELDS.message, value: m.message, rows: 2, placeholder: "T.ex. om något behöver beställas" }),
      })}
    `;
  }

  function renderForm() {
    const f = state.form;
    const editing = state.editing;
    const currentType = typeById(f.timeTypeId);
    const absence = currentType?.category === "absence";
    const customerProjects = projects.filter((p) => p.customerId === f.customerId);
    // En äldre rad kan ligga på ett projekt som har avslutats – visa det ändå när raden redigeras
    const editingProject = editing?.projectId && projectById(editing.projectId);
    if (editingProject && editingProject.customerId === f.customerId && !customerProjects.some((p) => p.id === editingProject.id)) {
      customerProjects.push(editingProject);
    }
    const vehicle = vehicleById(f.vehicleTypeId);
    const showBasis = vehicle?.isCompanyCar;
    const showKm = vehicle && !(vehicle.isCompanyCar && f.vehicleBasis === "day");
    const hours = f.hours ?? suggestedHours();
    const noProjects = !projects.length;
    const tripLabel = travel.enabled ? "Resa" : "Milersättning";
    const addTripLabel = travel.enabled ? "Lägg till restid eller milersättning" : "Lägg till milersättning";
    // Material hör inte till tidraden – därför inte när en rad redigeras
    const showMaterial = materials.enabled && !absence && !editing;

    setHTML(
      $("[data-form-card]"),
      html`<form class="form" data-time-form novalidate>
        ${state.locked
          ? callout(
              html`<strong>${capitalizeMonth(state.date)} är markerad som klar och låst.</strong> Be din administratör låsa upp månaden om något behöver ändras.`,
              { variant: "pink", iconName: "lock" },
            )
          : ""}
        ${editing
          ? html`<div class="callout"><span>${icon("edit", 18)}</span><div>Du redigerar en registrering från ${formatLongLower(editing.date)}.
              <button type="button" class="link-btn" data-cancel-edit>Avbryt redigering</button></div></div>`
          : ""}
        ${noProjects && !state.locked
          ? callout(
              isAdmin(me)
                ? html`Det finns inga pågående projekt än. <a href="#/projekt/projekt/ny">Lägg till ett projekt</a> – eller registrera frånvaro.`
                : "Din administratör har inte lagt till några projekt än. Du kan registrera frånvaro så länge.",
              { iconName: "info" },
            )
          : ""}
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>

        <fieldset class="fieldset form" ${state.locked ? raw("disabled") : ""}>
          <legend class="visually-hidden">Registrering för ${formatLongLower(state.date)}</legend>
          ${section({
            key: "work",
            open: state.workOpen,
            iconName: "clock",
            title: "Registrera arbetstid",
            meta: state.workOpen ? "" : workSummary(f),
            body: html`
              <div class="grid-2">
                ${field({
                  id: "time-customer",
                  label: html`<span class="only-desktop">1. </span>Kund`,
                  control: select({
                    id: "time-customer",
                    name: "customerId",
                    value: f.customerId,
                    placeholder: "Välj kund…",
                    disabled: absence,
                    options: customers
                      .filter((c) => projects.some((p) => p.customerId === c.id) || c.id === f.customerId)
                      .map((c) => ({ value: c.id, label: c.name })),
                  }),
                })}
                ${field({
                  id: "time-project",
                  label: html`<span class="only-desktop">2. </span>Projekt`,
                  help: absence ? "Frånvaro kräver ingen kund eller projekt." : "Endast projekt för vald kund visas.",
                  control: select({
                    id: "time-project",
                    name: "projectId",
                    value: f.projectId,
                    placeholder: f.customerId ? "Välj projekt…" : "Välj kund först…",
                    disabled: absence || !f.customerId,
                    help: true,
                    options: customerProjects.map((p) => ({ value: p.id, label: `${p.projectNo} · ${p.name}` })),
                  }),
                })}
              </div>

              <div class="grid-2">
                ${field({
                  id: "time-type",
                  label: "Typ av tid",
                  help: typeHelp(currentType),
                  control: select({
                    id: "time-type",
                    name: "timeTypeId",
                    value: f.timeTypeId,
                    help: Boolean(typeHelp(currentType)),
                    groups: typeGroups(f.timeTypeId),
                  }),
                })}
                <div class="field only-desktop">
                  <label class="field__label" for="time-date">Datum</label>
                  <div class="field__control date-field">
                    <span class="field__icon">${icon("calendar", 18)}</span>
                    <span class="input input--with-icon date-field__text" aria-hidden="true">${formatLong(state.date)}</span>
                    <input class="date-field__input" id="time-date" name="date" type="date" value="${state.date}" data-date-picker />
                  </div>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="time-hours">Timmar</label>
                <div class="grid-2">
                  ${stepper({ id: "time-hours", name: "hours", value: hours, label: "timmar" })}
                </div>
                <div class="field__help" id="time-hours-help">
                  ${isOvertimeType(f.timeTypeId) || absence
                    ? `Pilarna ändrar ${stepText(step)}.`
                    : html`<span class="only-desktop">Förinställd dagstid – pilarna ändrar ${stepText(step)}.</span>
                        <span class="only-mobile">Pilarna ändrar ${stepText(step)}.</span>`}
                </div>
                <div data-overtime-hint aria-live="polite"></div>
              </div>

              ${field({
                id: "time-comment",
                label: "Kommentar",
                optional: true,
                control: textarea({
                  id: "time-comment",
                  name: "comment",
                  value: f.comment,
                  rows: 3,
                  placeholder: "T.ex. vad som gjordes",
                }),
              })}
            `,
          })}

          ${absence
            ? ""
            : section({
                key: "trip",
                open: state.tripOpen,
                iconName: state.tripOpen || hasTrip(f) ? "car" : "plus",
                title: state.tripOpen || hasTrip(f) ? tripLabel : addTripLabel,
                meta: state.tripOpen || hasTrip(f) ? tripSummary(f) : "",
                body: html`
                  ${travel.enabled
                    ? html`<div class="grid-2">
                        <div class="field">
                          <label class="field__label" for="time-travel">Restid</label>
                          ${stepper({ id: "time-travel", name: "travelHours", value: f.travelHours || 0, label: "restid" })}
                          <div class="field__help" id="time-travel-help">
                            ${travel.countsTowardSchedule ? "Räknas som arbetstid mot schemat." : "Räknas inte mot schemat."}
                          </div>
                        </div>
                        <div class="field">
                          <span class="field__label">Debitering</span>
                          ${travel.employeeCanChangeBilling
                            ? html`<label class="check"><input type="checkbox" name="travelBillable" ${f.travelBillable ? raw("checked") : ""} /> Debiteras kunden</label>`
                            : html`<p class="text-muted text-small check">${travel.billableDefault ? "Restiden debiteras kunden." : "Restiden debiteras inte kunden."}</p>`}
                        </div>
                      </div>`
                    : ""}
                  <div class="grid-auto">
                    ${field({
                      id: "time-vehicle",
                      label: "Milersättning",
                      control: select({
                        id: "time-vehicle",
                        name: "vehicleTypeId",
                        value: f.vehicleTypeId,
                        placeholder: "Inget fordon",
                        options: vehicles.map((v) => ({ value: v.id, label: v.name })),
                      }),
                    })}
                    ${showBasis
                      ? field({
                          id: "time-basis",
                          label: `${vehicle.name} registreras som`,
                          control: select({
                            id: "time-basis",
                            name: "vehicleBasis",
                            value: f.vehicleBasis,
                            options: [
                              { value: "day", label: "Bil per dag" },
                              { value: "km", label: "Bil per mil" },
                            ],
                          }),
                        })
                      : ""}
                    ${showKm
                      ? field({
                          id: "time-km",
                          label: "Körda kilometer",
                          optional: true,
                          control: input({ id: "time-km", name: "km", value: f.km, inputmode: "numeric", autocomplete: "off" }),
                        })
                      : ""}
                  </div>
                `,
              })}

          ${showMaterial
            ? section({
                key: "material",
                open: state.materialOpen,
                iconName: state.materialOpen || hasMaterial() ? "box" : "plus",
                pink: state.materialOpen || hasMaterial(),
                title: state.materialOpen || hasMaterial() ? `${materialLabel} från lager` : `Lägg till ${materialLabel.toLowerCase()} från lager`,
                meta: hasMaterial() ? materialSummary(state.material) : state.materialOpen ? "Uttag och meddelande" : "",
                body: materialFields(state.material),
              })
            : ""}

          <div class="form__actions form__actions--stack">
            <button type="submit" class="btn btn--primary btn--lg">${icon("check")}${editing ? "Spara ändringar" : "Spara registrering"}</button>
            <button type="button" class="btn btn--secondary btn--lg" data-clear>${editing ? "Avbryt" : "Rensa"}</button>
          </div>
        </fieldset>
      </form>`,
    );
    renderOvertimeHint();
  }

  // "2,0 h över schemat" – erbjud att spara resten som övertid (bara för vanligt arbete)
  function renderOvertimeHint() {
    const hint = $("[data-overtime-hint]");
    if (!hint) return;
    const f = state.form;
    const hours = parseHours($("#time-hours")?.value) ?? 0;
    const excess = roundToStep(hours - remainingSchedule(), 0.01);
    const show = !state.editing && !state.locked && typeById(f.timeTypeId)?.category === "work" && allowedOvertime.length && excess > 0;
    if (!show) {
      setHTML(hint, "");
      return;
    }
    const work = hours - excess;
    setHTML(
      hint,
      html`<div class="overtime-hint">
        <span>${icon("overtime", 18)}</span>
        <div class="stack stack--s">
          <p><strong>${formatHoursUnit(excess)} över schemat.</strong> Vill du spara det som övertid?
            ${work > 0 ? html`Då sparas ${formatHoursUnit(work)} som arbete och ${formatHoursUnit(excess)} som övertid.` : ""}</p>
          <div class="cluster">
            ${allowedOvertime.map(
              (t) => html`<button type="button" class="btn btn--secondary btn--sm" data-split="${t.id}">Spara som ${t.name.toLowerCase()}</button>`,
            )}
          </div>
        </div>
      </div>`,
    );
  }

  const capitalizeMonth = (date) => {
    const text = formatLong(date).split(" ").slice(2).join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1) + " " + date.slice(0, 4);
  };

  // Läser fälten till state.form (utan att rita om)
  function readForm() {
    const form = $("[data-time-form]");
    if (!form) return;
    const el = form.elements;
    state.form = {
      ...state.form,
      customerId: el.customerId?.value ?? state.form.customerId,
      projectId: el.projectId?.value ?? state.form.projectId,
      timeTypeId: el.timeTypeId?.value ?? state.form.timeTypeId,
      hours: parseHours(el.hours.value),
      travelHours: el.travelHours ? parseHours(el.travelHours.value) : state.form.travelHours,
      travelBillable: el.travelBillable ? el.travelBillable.checked : state.form.travelBillable,
      vehicleTypeId: el.vehicleTypeId?.value ?? state.form.vehicleTypeId,
      vehicleBasis: el.vehicleBasis?.value ?? state.form.vehicleBasis,
      km: el.km?.value ?? state.form.km,
      comment: el.comment.value,
    };
    if (el[MATERIAL_FIELDS.quantity]) {
      const value = (key) => el[MATERIAL_FIELDS[key]]?.value ?? state.material[key];
      state.material = {
        articleId: value("articleId"),
        name: value("name"),
        unit: value("unit"),
        quantity: value("quantity"),
        message: value("message"),
      };
    }
  }

  // Uppdaterar texten i rubriken på Resa och Material medan man skriver
  function updateSummaries() {
    const trip = $('[data-summary="trip"]');
    if (trip) trip.textContent = tripSummary(state.form);
    const material = $('[data-summary="material"]');
    if (material) material.textContent = hasMaterial() ? materialSummary(state.material) : "Uttag och meddelande";
  }

  // Ritar om formuläret men behåller fokus på samma fält
  function rerenderForm() {
    const focusedName = document.activeElement?.name;
    renderForm();
    if (focusedName) $(`[data-time-form] [name="${focusedName}"]`)?.focus();
  }

  /* ---------- Listan ---------- */

  function vehicleText(e) {
    const v = vehicleById(e.vehicleTypeId);
    if (!v) return "";
    if (v.isCompanyCar) {
      return e.vehicleBasis === "km"
        ? `${v.name}, bil per mil${Number(e.km) ? ` · ${formatInteger(e.km)} km` : ""}`
        : `${v.name}, bil per dag`;
    }
    return Number(e.km) ? `${v.name} · ${formatInteger(e.km)} km` : v.name;
  }

  function renderList() {
    const rows = dayEntries();
    const isToday = state.date === today();
    setHTML(
      $("[data-list]"),
      html`
        <div class="split">
          <h2 class="list-heading" id="time-list-title">Registrerat ${isToday ? "idag" : formatLongLower(state.date)}</h2>
          <span class="text-muted text-small">${plural(rows.length, "registrering", "registreringar")}</span>
        </div>
        ${rows.length
          ? html`<ul class="list">
              ${rows.map((e) => {
                const { title } = describeEntry(e);
                const editable = !state.locked && e.status !== "approved";
                const rowType = typeById(e.timeTypeId);
                const travelText = e.travelHours
                  ? `Restid ${formatHoursUnit(e.travelHours)}${e.travelBillable ? " (debiteras)" : ""}`
                  : "";
                const hoursText = e.travelHours && e.hours ? `${rowType?.category === "overtime" ? rowType.name : "Arbete"} ${formatHoursUnit(e.hours)}` : "";
                const meta = [
                  rowType?.category === "overtime" && !hoursText ? rowType.name : "",
                  hoursText,
                  travelText,
                  vehicleText(e),
                  e.comment,
                ].filter(Boolean).join(" · ");
                return html`<li class="row row--wrap${state.editing?.id === e.id ? " row--editing" : ""}">
                  <span class="row__icon${rowType?.category === "absence" ? " row__icon--pink" : ""}">${icon(!e.hours && e.travelHours ? "car" : TYPE_ICONS[rowType?.category] ?? "clock", 20)}</span>
                  <span class="row__body">
                    <span class="row__title">${title}</span>
                    ${meta ? html`<span class="row__meta">${meta}</span>` : ""}
                    ${e.status === "rejected" && e.rejectReason ? html`<span class="row__note">Nekad: ${e.rejectReason}</span>` : ""}
                  </span>
                  <span class="row__aside">
                    ${statusPill(e.status)}
                    <span class="row__value">${formatHoursUnit(entryTotal(e))}</span>
                  </span>
                  ${editable
                    ? html`<span class="row__tools">
                        <button type="button" class="icon-btn icon-btn--ghost" data-edit="${e.id}" title="Redigera"
                          aria-label="Redigera ${title}, ${formatHoursUnit(entryTotal(e))}">${icon("edit", 18)}</button>
                        <button type="button" class="icon-btn icon-btn--ghost icon-btn--danger" data-delete="${e.id}" title="Ta bort"
                          aria-label="Ta bort ${title}, ${formatHoursUnit(entryTotal(e))}">${icon("trash", 18)}</button>
                      </span>`
                    : ""}
                </li>`;
              })}
            </ul>`
          : emptyState({
              iconName: "clock",
              title: "Inga registreringar",
              text: state.locked ? "Månaden är låst." : "Fyll i formuläret ovan och tryck Spara.",
            })}
      `,
    );
  }

  // "1 nekad registrering att rätta" – med länk till dagen
  function renderRejected() {
    const rows = state.rejected ?? [];
    if (!rows.length) {
      // Ny medarbetare utan registreringar – tipsa om Kom igång
      const isNew = !isAdmin(me) && !state.lastEntry && !state.weekEntries.length;
      setHTML(
        $("[data-rejected]"),
        isNew ? callout(html`<strong>Ny i Tidla?</strong> <a href="#/kom-igang">Läs Kom igång</a> – där står hur du rapporterar tid.`, { iconName: "info" }) : "",
      );
      return;
    }
    const first = rows[0];
    const here = rows.some((e) => e.date === state.date);
    setHTML(
      $("[data-rejected]"),
      html`<div class="callout callout--error" role="status">
        ${icon("alert", 18)}
        <div>
          <strong>${plural(rows.length, "nekad registrering", "nekade registreringar")} att rätta.</strong>
          ${here
            ? " Se listan nedan – redigera raden och spara igen."
            : html` <a href="#/tid/${first.date}">Visa ${formatLongLower(first.date)}</a>`}
        </div>
      </div>`,
    );
  }

  function renderMaterialList() {
    const host = $("[data-material-list]");
    host.hidden = !materials.enabled || !state.dayMaterials.length;
    if (host.hidden) return;
    const isToday = state.date === today();
    setHTML(
      host,
      html`
        <div class="split">
          <h2 class="list-heading" id="time-material-title">${materialLabel} ${isToday ? "idag" : formatLongLower(state.date)}</h2>
          <span class="text-muted text-small">${plural(state.dayMaterials.length, "uttag", "uttag")}</span>
        </div>
        <ul class="list">
          ${state.dayMaterials.map((m) => html`<li class="row row--wrap">
            <span class="row__icon row__icon--pink">${icon("box", 20)}</span>
            <span class="row__body">
              <span class="row__title">${m.name} · ${quantityText(m.quantity)} ${m.unit}</span>
              <span class="row__meta">${[describeEntry({ projectId: m.projectId }).title, m.message].filter(Boolean).join(" · ")}</span>
            </span>
            <span class="row__aside">${statusPill(m.handled ? "handled" : "new")}</span>
            ${m.handled || state.locked
              ? ""
              : html`<span class="row__tools">
                  <button type="button" class="icon-btn icon-btn--ghost icon-btn--danger" data-delete-material="${m.id}" title="Ta bort"
                    aria-label="Ta bort ${m.name}, ${quantityText(m.quantity)} ${m.unit}">${icon("trash", 18)}</button>
                </span>`}
          </li>`)}
        </ul>
      `,
    );
  }

  // Senaste registreringen (idag, annars senast före) – avgör om Resa ska vara öppen
  function latestHadTrip() {
    const latest = [...dayEntries()].sort((a, b) => b.createdAt - a.createdAt)[0] ?? state.lastEntry;
    return Boolean(latest && (latest.travelHours || latest.vehicleTypeId));
  }

  /* ---------- Rita allt ---------- */

  async function refresh({ focusLabel = null } = {}) {
    await load();
    renderDateNav();
    renderMobileWeek();
    renderMobileDay();
    renderToday();
    renderQuick();
    // Resa öppnas automatiskt för den som brukar resa – om man inte själv har valt
    if (!state.editing && !state.tripTouched) state.tripOpen = latestHadTrip() || hasTrip(state.form);
    renderForm();
    renderList();
    renderMaterialList();
    renderRejected();
    if (focusLabel) {
      // Behåll fokus på knappen som bytte datum (eller vald dag i veckoremsan)
      const again = [...container.querySelectorAll("[data-goto]")].find(
        (el) => el.getAttribute("aria-label") === focusLabel && el.offsetParent !== null,
      ) ?? container.querySelector('.weekstrip__day[aria-pressed="true"]');
      again?.focus();
    }
  }

  // Fyller formuläret från en befintlig rad (redigera eller "Samma som igår")
  function formFromEntry(entry, { keepProject = true } = {}) {
    return {
      ...emptyForm(),
      customerId: keepProject && entry.projectId ? projectById(entry.projectId)?.customerId ?? "" : "",
      projectId: keepProject ? entry.projectId ?? "" : "",
      timeTypeId: entry.timeTypeId ?? defaultType,
      hours: entry.hours,
      travelHours: entry.travelHours || 0,
      travelBillable: Boolean(entry.travelBillable),
      vehicleTypeId: entry.vehicleTypeId ?? "",
      vehicleBasis: entry.vehicleBasis ?? "day",
      km: Number(entry.km) ? String(entry.km) : "",
    };
  }

  const hasTrip = (f) => Boolean(f.travelHours || f.vehicleTypeId);

  /* ---------- Spara ---------- */

  const WORK_FIELDS = ["customerId", "projectId", "timeTypeId", "hours", "comment"];
  const TRIP_FIELDS = ["travelHours", "travelBillable", "vehicleTypeId", "vehicleBasis", "km"];

  // Fäller ut delarna som har fel, så att felen syns. Returnerar formuläret (det kan ha ritats om).
  function openSectionsWithErrors(fields = {}) {
    const keys = Object.keys(fields);
    let changed = false;
    if (!state.workOpen && keys.some((k) => WORK_FIELDS.includes(k))) {
      state.workOpen = changed = true;
    }
    if (!state.tripOpen && keys.some((k) => TRIP_FIELDS.includes(k))) {
      state.tripOpen = state.tripTouched = changed = true;
    }
    if (!state.materialOpen && keys.some((k) => Object.values(MATERIAL_FIELDS).includes(k))) {
      state.materialOpen = changed = true;
    }
    if (changed) rerenderForm();
    return $("[data-time-form]");
  }

  // Felen från store.saveMaterial heter articleId, quantity … – i formuläret matArticleId …
  const materialErrors = (fields = {}) =>
    Object.fromEntries(Object.entries(fields).map(([key, message]) => [MATERIAL_FIELDS[key] ?? key, message]));

  function materialData() {
    const m = state.material;
    const other = m.articleId === OTHER;
    return {
      date: state.date,
      articleId: other ? null : m.articleId,
      name: other ? m.name : "",
      unit: other ? m.unit : "",
      quantity: m.quantity,
      projectId: state.form.projectId,
      message: m.message,
    };
  }

  // Sparar allt som är ifyllt: arbetstid (med resa) och material.
  // split: typ-id för övertid – sparar det som ryms i schemat som arbete och resten som övertid
  async function save(form, split = null) {
    readForm();
    clearFormErrors(form);
    const f = state.form;
    const absence = isAbsence(f.timeTypeId);
    const withMaterial = materials.enabled && !absence && !state.editing && hasMaterial();
    // 0 timmar och ingen resa = bara material
    const withEntry = Boolean(state.editing) || !withMaterial || f.hours !== 0 || hasTrip(f);

    const fields = {};
    if (f.hours === null) fields.hours = "Ange timmar, t.ex. 4,5.";
    else if (f.hours < 0 || f.hours > 24) fields.hours = "Ange 0–24 timmar.";
    if (f.travelHours === null) fields.travelHours = "Ange restid, t.ex. 1,5.";
    if (!absence) {
      if (!f.customerId) fields.customerId = "Välj en kund, eller en typ av frånvaro.";
      else if (!f.projectId) fields.projectId = "Välj ett projekt.";
    }
    if (withMaterial) {
      const m = state.material;
      if (!m.articleId) fields[MATERIAL_FIELDS.articleId] = "Välj i listan.";
      else if (m.articleId === OTHER) {
        if (!m.name.trim()) fields[MATERIAL_FIELDS.name] = "Skriv vad du har tagit.";
        if (!m.unit.trim()) fields[MATERIAL_FIELDS.unit] = "Ange enhet, t.ex. st.";
      }
      const quantity = Number(String(m.quantity).trim().replace(",", "."));
      if (!String(m.quantity).trim() || !Number.isFinite(quantity) || quantity <= 0) {
        fields[MATERIAL_FIELDS.quantity] = "Ange ett antal, t.ex. 2 eller 0,5.";
      }
    }
    if (Object.keys(fields).length) {
      showFormErrors(openSectionsWithErrors(fields), { message: "Kontrollera de markerade fälten.", fields });
      return;
    }

    const base = {
      date: state.date,
      projectId: absence ? null : f.projectId,
      comment: f.comment,
    };
    const trip = absence
      ? { travelHours: 0, vehicleTypeId: null }
      : {
          travelHours: f.travelHours || 0,
          travelBillable: f.travelBillable,
          vehicleTypeId: f.vehicleTypeId || null,
          vehicleBasis: f.vehicleBasis,
          km: f.km,
        };

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    const wasEditing = Boolean(state.editing);
    let entrySaved = false;
    try {
      if (withEntry && split) {
        const excess = roundToStep(f.hours - remainingSchedule(), 0.01);
        const work = f.hours - excess;
        // Resan följer med arbetsraden (eller övertidsraden om hela tiden är övertid)
        if (work > 0) await store.saveEntry({ ...base, ...trip, timeTypeId: f.timeTypeId, hours: work });
        await store.saveEntry({ ...base, ...(work > 0 ? { travelHours: 0 } : trip), timeTypeId: split, hours: excess });
      } else if (withEntry) {
        await store.saveEntry({ ...base, ...trip, id: state.editing?.id, timeTypeId: f.timeTypeId, hours: f.hours });
      }
      entrySaved = withEntry;
      if (withMaterial) await store.saveMaterial(materialData());
    } catch (error) {
      const fromMaterial = entrySaved || !withEntry;
      if (entrySaved) {
        // Tiden är sparad men inte materialet – behåll projektet och materialet så att man kan rätta
        state.editing = null;
        state.form = { ...emptyForm(), customerId: f.customerId, projectId: f.projectId, hours: 0 };
        await refresh();
        notify("Tiden är sparad");
      } else {
        setBusy(button, false);
      }
      const shown = fromMaterial
        ? {
            message: entrySaved ? `Tiden är sparad, men uttaget kunde inte sparas. ${error.message}` : error.message,
            fields: materialErrors(error.fields),
          }
        : error;
      showFormErrors(openSectionsWithErrors(shown.fields), shown);
      return;
    }

    state.editing = null;
    state.form = emptyForm();
    state.tripTouched = false;
    state.workOpen = true;
    if (withMaterial) {
      state.material = emptyMaterial();
      state.materialOpen = false;
    }
    await refresh();
    if (withMaterial) updateBadges();
    const message = wasEditing
      ? "Ändringen är sparad"
      : !withEntry
        ? "Uttaget är registrerat"
        : withMaterial
          ? "Tiden och uttaget är sparade"
          : split
            ? "Arbete och övertid är sparade"
            : "Registreringen är sparad";
    notify(message);
    $("#time-customer")?.focus();
  }

  /* ---------- Händelser ---------- */

  container.addEventListener("click", async (event) => {
    const target = event.target;
    const goto = target.closest("[data-goto]");
    if (goto) {
      readForm();
      const label = goto.getAttribute("aria-label") ?? "";
      // Dagarna i remsan byter etikett – fokusera den valda dagen i stället
      setDate(goto.dataset.goto, goto.classList.contains("weekstrip__day") ? "__day" : label);
      return;
    }

    // Öppna kalendern när man klickar på datumet
    const picker = target.closest("[data-date-picker]");
    if (picker) {
      try {
        picker.showPicker?.();
      } catch {
        /* Äldre webbläsare öppnar kalendern själva */
      }
      return;
    }

    const stepButton = target.closest("[data-step]");
    if (stepButton) {
      const inputEl = $(`#${stepButton.dataset.stepFor}`);
      const current = parseHours(inputEl.value) ?? 0;
      const next = clamp(roundToStep(current + Number(stepButton.dataset.step) * step, step), 0, 24);
      inputEl.value = formatHours(next);
      readForm();
      if (inputEl.name === "hours") renderOvertimeHint();
      else updateSummaries();
      return;
    }

    // Fäll ut/ihop Arbetstid, Resa eller Material
    const toggle = target.closest("[data-toggle]");
    if (toggle) {
      readForm();
      const key = toggle.dataset.toggle;
      const prop = { work: "workOpen", trip: "tripOpen", material: "materialOpen" }[key];
      state[prop] = !state[prop];
      if (key === "trip") state.tripTouched = true;
      renderForm();
      if (state[prop]) $(`#time-${key}`).querySelector("input:not([disabled]), select:not([disabled])")?.focus();
      else $(`[data-toggle="${key}"]`)?.focus();
      return;
    }

    const delMaterial = target.closest("[data-delete-material]");
    if (delMaterial) {
      const item = state.dayMaterials.find((m) => m.id === delMaterial.dataset.deleteMaterial);
      const ok = await confirmDialog({
        title: "Ta bort uttaget?",
        message: `${item.name} · ${quantityText(item.quantity)} ${item.unit}.`,
        confirmLabel: "Ta bort",
        danger: true,
      });
      if (!ok) return;
      try {
        await store.deleteMaterial(item.id);
        notify("Uttaget är borttaget");
        await refresh();
        updateBadges();
      } catch (error) {
        notify(error.message, { type: "error" });
      }
      return;
    }

    const split = target.closest("[data-split]");
    if (split) {
      save($("[data-time-form]"), split.dataset.split);
      return;
    }

    if (target.closest("[data-clear]") || target.closest("[data-cancel-edit]")) {
      state.editing = null;
      state.form = emptyForm();
      state.material = emptyMaterial();
      state.workOpen = true;
      state.materialOpen = false;
      state.tripTouched = false;
      state.tripOpen = latestHadTrip();
      renderForm();
      renderList();
      $("#time-customer")?.focus();
      return;
    }

    if (target.closest("[data-same-as-last]")) {
      const last = state.lastEntry;
      if (!last) return;
      const selectable = !last.projectId || projects.some((x) => x.id === last.projectId);
      const type = typeById(last.timeTypeId);
      const typeOk = type && !type.hidden && (type.category !== "overtime" || allowedOvertime.includes(type));
      state.editing = null;
      state.form = { ...formFromEntry(last, { keepProject: selectable }), timeTypeId: typeOk ? last.timeTypeId : defaultType };
      state.tripOpen = hasTrip(state.form);
      state.workOpen = true;
      renderForm();
      renderList();
      notify(
        selectable
          ? `Ifyllt från ${formatShort(last.date)} – tryck Spara för att spara.`
          : "Projektet från förra gången är avslutat – välj ett annat.",
      );
      $("#time-hours")?.focus();
      return;
    }

    const edit = target.closest("[data-edit]");
    if (edit) {
      const entry = state.weekEntries.find((e) => e.id === edit.dataset.edit);
      if (!entry) return;
      state.editing = entry;
      state.form = { ...formFromEntry(entry), comment: entry.comment };
      state.tripOpen = hasTrip(state.form);
      state.workOpen = true;
      renderForm();
      renderList();
      $("[data-form-card]").scrollIntoView({ block: "start", behavior: "smooth" });
      $("#time-hours").focus({ preventScroll: true });
      return;
    }

    const del = target.closest("[data-delete]");
    if (del) {
      const entry = state.weekEntries.find((e) => e.id === del.dataset.delete);
      if (!entry) return;
      const ok = await confirmDialog({
        title: "Ta bort registreringen?",
        message: `${describeEntry(entry).title}, ${formatHoursUnit(entryTotal(entry))} ${formatLongLower(entry.date)}.`,
        confirmLabel: "Ta bort",
        danger: true,
      });
      if (!ok) return;
      try {
        await store.deleteEntry(entry.id);
        if (state.editing?.id === entry.id) {
          state.editing = null;
          state.form = emptyForm();
        }
        notify("Registreringen är borttagen");
        await refresh();
        $("[data-list] h2")?.focus();
      } catch (error) {
        notify(error.message, { type: "error" });
      }
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-date-picker]")) {
      readForm();
      setDate(target.value);
      return;
    }
    if (!target.closest("[data-time-form]")) return;
    readForm();
    if (target.name === "customerId") state.form.projectId = "";
    if (target.name === "timeTypeId") state.form.hours = null; // ny förifylld tid för typen
    if (["customerId", "timeTypeId", "vehicleTypeId", "vehicleBasis", MATERIAL_FIELDS.articleId].includes(target.name)) rerenderForm();
    else updateSummaries();
  });

  container.addEventListener("input", (event) => {
    if (!event.target.closest("[data-time-form]")) return;
    readForm();
    if (event.target.name === "hours") renderOvertimeHint();
    else updateSummaries();
  });

  container.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-time-form]")) return;
    event.preventDefault();
    save(event.target);
  });

  await refresh();
}
