// Inställningar (bara admin): företag, arbetstid, projekt, övertid, restid, typer av tid, fordon och milersättning,
// material, säkerhetskopia och gallring.
// #/installningar/<del> (t.ex. foretag, fordon) scrollar direkt till den delen.
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { WEEKDAYS, WEEKDAY_LABELS, today, addMonths, formatDate } from "../lib/dates.js";
import { formatAmount, parseAmount, parseHours, formatHours, formatHoursUnit, plural } from "../lib/format.js";
import {
  field, input, pill, openDialog, confirmDialog, notify, callout, showFormErrors, clearFormErrors, setBusy,
} from "../lib/ui.js";
import { downloadFile } from "../lib/csv.js";
import { ratesNeedCheck } from "../lib/reminders.js";
import { OVERTIME_MODES, TIME_CATEGORIES, MATERIAL_LABELS, HOUR_STEPS, VEHICLE_RATES } from "../store.js";
import { ADMIN } from "../routes.js";
import { allowed } from "./guard.js";

const MODE_HELP = {
  both: "Medarbetaren väljer Övertid – komptid eller Övertid – lön.",
  pay: "Bara Övertid – lön visas.",
  leave: "Bara Övertid – komptid visas.",
  off: "Övertid kan inte registreras.",
};

const SECTIONS = [
  ["foretag", "Företag"],
  ["arbetstid", "Arbetstid"],
  ["projekt", "Projekt"],
  ["overtid", "Övertid och restid"],
  ["typer", "Typer av tid"],
  ["fordon", "Fordon och milersättning"],
  ["material", "Material"],
  ["sakerhetskopia", "Säkerhetskopia"],
  ["gallring", "Gallring"],
];

// Vad standardfordonen är (visas under namnet i listan)
const VEHICLE_INFO = {
  firmabil: "Företagets bil – företaget står för kostnaden.",
  "privat-bil": "Den anställdes egen bil.",
  forman: "Bensin, diesel eller laddhybrid.",
  "forman-el": "Förmånsbil som drivs helt med el.",
  motorcykel: "Skatteverket har inget eget belopp för motorcykel – fyll i det ni betalar.",
};

// 1.5 → "1,5", 25 → "25", 12.5 → "12,5"
const shortNumber = (value) => (value === null || value === undefined ? "" : formatAmount(value).replace(/,00$/, "").replace(/(,\d)0$/, "$1"));

export async function render(container, ctx) {
  if (!allowed(ctx, ADMIN, container)) return;

  let settings = await store.getSettings();

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">Inställningar</h1>
          <p class="page-lead">Reglerna gäller hela företaget. Medarbetarna ser bara de val du tillåter.</p>
        </div>
      </div>
      <nav class="settings-nav" aria-label="Delar på sidan">
        ${SECTIONS.map(([id, label]) => html`<button type="button" class="btn btn--secondary btn--sm" data-goto-section="${id}">${label}</button>`)}
      </nav>
      <section class="card card--lg" id="set-sec-foretag" aria-labelledby="set-company" data-company></section>
      <section class="card card--lg" id="set-sec-arbetstid" aria-labelledby="set-week" data-week></section>
      <section class="card card--lg" id="set-sec-projekt" aria-labelledby="set-projects" data-projects></section>
      <div class="grid-2 settings-grid" id="set-sec-overtid">
        <section class="card card--lg" aria-labelledby="set-overtime" data-overtime></section>
        <section class="card card--lg" aria-labelledby="set-travel" data-travel></section>
      </div>
      <section class="card card--lg stack" id="set-sec-typer" aria-labelledby="set-types" data-types></section>
      <section class="card card--lg stack" id="set-sec-fordon" aria-labelledby="set-vehicles" data-vehicles></section>
      <section class="card card--lg" id="set-sec-material" aria-labelledby="set-materials" data-materials></section>
      <div class="grid-2 settings-grid">
        <section class="card card--lg stack" id="set-sec-sakerhetskopia" aria-labelledby="set-backup" data-backup></section>
        <section class="card card--lg" id="set-sec-gallring" aria-labelledby="set-retention" data-retention></section>
      </div>
    `,
  );

  const $ = (selector) => container.querySelector(selector);
  // Kryssruta eller radioknapp med etikett och förklaring (value behövs för radioknappar)
  const choice = (type, name, id, label, help, checked, disabled = false, value = null) => html`<div class="choice">
    <input type="${type}" id="${id}" name="${name}" ${value !== null ? raw(`value="${value}"`) : ""} ${checked ? raw("checked") : ""} ${disabled ? raw("disabled") : ""}
      ${help ? raw(`aria-describedby="${id}-help"`) : ""} />
    <label for="${id}">${label}</label>
    ${help ? html`<span class="choice__help" id="${id}-help">${help}</span>` : ""}
  </div>`;

  /* ---------- Företag ---------- */

  function renderCompany() {
    setHTML(
      $("[data-company]"),
      html`<form class="form" data-company-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-company">Företag</h2>
          <p class="text-muted text-small">Företagsnamnet visas under logotypen i menyn.</p>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        <div class="grid-2">
          ${field({ id: "set-company-name", label: "Företagsnamn", control: input({ id: "set-company-name", name: "companyName", value: settings.companyName, autocomplete: "organization" }) })}
          ${field({
            id: "set-org",
            label: "Organisationsnummer",
            optional: true,
            help: "10 siffror, t.ex. 556677-8899.",
            control: input({ id: "set-org", name: "orgNumber", value: settings.orgNumber, inputmode: "numeric", autocomplete: "off", help: true }),
          })}
        </div>
        <div class="form__actions"><button type="submit" class="btn btn--primary">Spara företag</button></div>
      </form>`,
    );
  }

  /* ---------- Arbetstid och tidssteg ---------- */

  function renderWeek() {
    const total = WEEKDAYS.reduce((sum, day) => sum + settings.workWeek[day], 0);
    setHTML(
      $("[data-week]"),
      html`<form class="form" data-week-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-week">Arbetstid</h2>
          <p class="text-muted text-small">
            Timmar per veckodag. Styr den förifyllda tiden och "enligt schema" i tidrapporten.
            Anställda med eget schema (under Anställda) påverkas inte.
          </p>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        <fieldset class="fieldset">
          <legend class="field__label">Timmar per dag</legend>
          <div class="week-grid">
            ${WEEKDAYS.map(
              (day) => html`<div class="field">
                <label class="field__label" for="set-${day}"><span aria-hidden="true">${WEEKDAY_LABELS[day].slice(0, 3)}</span><span class="visually-hidden">${WEEKDAY_LABELS[day]}</span></label>
                <input class="input" id="set-${day}" name="workWeek.${day}" inputmode="decimal" autocomplete="off" value="${formatHours(settings.workWeek[day])}" />
              </div>`,
            )}
          </div>
        </fieldset>
        <p class="text-muted text-small" data-week-total aria-live="polite">Totalt ${formatHoursUnit(total)} per vecka.</p>
        <fieldset class="fieldset">
          <legend class="field__label">Pilarna för timmar ändrar</legend>
          <div class="radio-list radio-list--row">
            ${HOUR_STEPS.map((step) =>
              choice("radio", "hourStep", `set-step-${step * 100}`, step === 1 ? "60 minuter" : `${step * 60} minuter`, "", settings.hourStep === step, false, step),
            )}
          </div>
        </fieldset>
        <div class="form__actions"><button type="submit" class="btn btn--primary">Spara arbetstid</button></div>
      </form>`,
    );
  }

  /* ---------- Övertid ---------- */

  function renderOvertime() {
    const overtime = settings.overtime;
    setHTML(
      $("[data-overtime]"),
      html`<form class="form" data-overtime-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-overtime">Övertid</h2>
          <p class="text-muted text-small">Övertid registreras som en typ av tid och räknas utöver schemat.</p>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        <fieldset class="fieldset">
          <legend class="field__label">Ersätts med</legend>
          <div class="radio-list">
            ${Object.entries(OVERTIME_MODES).map(([value, label]) => html`<div class="choice">
              <input type="radio" id="set-mode-${value}" name="mode" value="${value}" ${overtime.mode === value ? raw("checked") : ""}
                aria-describedby="set-mode-${value}-help" />
              <label for="set-mode-${value}">${label}</label>
              <span class="choice__help" id="set-mode-${value}-help">${MODE_HELP[value]}</span>
            </div>`)}
          </div>
        </fieldset>
        ${field({
          id: "set-factor",
          label: "Faktor",
          optional: true,
          help: "T.ex. 1,5. Följer med i exporten som underlag till lönen – själva beräkningen görs i lönesystemet.",
          control: input({ id: "set-factor", name: "factor", value: shortNumber(overtime.factor), inputmode: "decimal", autocomplete: "off", help: true }),
        })}
        <div class="form__actions"><button type="submit" class="btn btn--primary">Spara övertid</button></div>
      </form>`,
    );
  }

  /* ---------- Projekt ---------- */

  function renderProjects() {
    const enabled = settings.projects?.enabled !== false;
    setHTML(
      $("[data-projects]"),
      html`<form class="form" data-projects-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-projects">Projekt</h2>
          <p class="text-muted text-small">
            Med projekt väljer medarbetarna först kund och sedan projekt – bra för jobb som pågår en tid.
            Utan projekt väljer de bara kund – bra för många korta jobb.
          </p>
        </div>
        ${choice("checkbox", "enabled", "set-projects-enabled", "Använd projekt", "Av: tid och material rapporteras direkt på kunden. Det som redan är registrerat ändras inte.", enabled)}
        <div class="form__actions"><button type="submit" class="btn btn--primary">Spara projekt</button></div>
      </form>`,
    );
  }

  /* ---------- Restid ---------- */

  function renderTravel() {
    const travel = settings.travel;
    setHTML(
      $("[data-travel]"),
      html`<form class="form" data-travel-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-travel">Restid</h2>
          <p class="text-muted text-small">Restid registreras under "Resa" tillsammans med milersättningen.</p>
        </div>
        <div class="radio-list">
          ${choice("checkbox", "enabled", "set-enabled", "Använd restid", "Av: bara milersättning visas under Resa.", travel.enabled)}
          ${choice("checkbox", "billableDefault", "set-billableDefault", "Debiteras kunden som standard", "Förvalet när medarbetaren fyller i restid.", travel.billableDefault, !travel.enabled)}
          ${choice("checkbox", "employeeCanChangeBilling", "set-employeeCanChangeBilling", "Medarbetaren får ändra debiteringen", "Av: förvalet ovan gäller alltid.", travel.employeeCanChangeBilling, !travel.enabled)}
          ${choice("checkbox", "countsTowardSchedule", "set-countsTowardSchedule", "Räknas som arbetstid mot schemat", "På: restiden fyller upp dagens tid.", travel.countsTowardSchedule, !travel.enabled)}
        </div>
        <div class="form__actions"><button type="submit" class="btn btn--primary">Spara restid</button></div>
      </form>`,
    );
  }

  /* ---------- Typer av tid ---------- */

  function renderTypes() {
    const types = settings.timeTypes;
    const row = (t) => {
      const canHide = t.category === "absence" || Boolean(t.placeless);
      const overtimeOff = t.category === "overtime" && !(settings.overtime.mode === "both" || settings.overtime.mode === t.compensation);
      return html`<li class="row row--wrap${t.hidden ? " row--muted" : ""}">
        <span class="row__icon${t.category === "absence" ? " row__icon--pink" : ""}">${icon(t.category === "absence" ? "sun" : t.category === "overtime" ? "overtime" : "clock", 18)}</span>
        <span class="row__body">
          <span class="row__title">${t.name}</span>
          <span class="row__meta">${t.placeless ? "Arbetstid utan kund och projekt" : TIME_CATEGORIES[t.category]}${t.category === "overtime" ? ` · ersätts med ${t.compensation === "leave" ? "komptid" : "lön"}` : ""}</span>
        </span>
        <span class="row__aside">
          ${t.hidden ? pill("Dold", "draft", "minus") : ""}
          ${overtimeOff ? pill("Av enligt övertid", "draft", "minus") : ""}
        </span>
        <span class="row__actions">
          <button type="button" class="btn btn--secondary btn--sm" data-rename="${t.id}" aria-label="Byt namn på ${t.name}">${icon("edit", 16)}Byt namn</button>
          ${canHide
            ? html`<button type="button" class="btn btn--text btn--sm" data-toggle-hidden="${t.id}" aria-label="${t.hidden ? "Visa" : "Dölj"} ${t.name}">${t.hidden ? "Visa" : "Dölj"}</button>`
            : ""}
        </span>
      </li>`;
    };
    setHTML(
      $("[data-types]"),
      html`
        <div class="split split--center split--stack">
          <div class="stack stack--s">
            <h2 class="card__title" id="set-types">Typer av tid</h2>
            <p class="text-muted text-small">Det medarbetarna väljer under "Typ av tid". Dolda typer finns kvar i historiken.</p>
          </div>
          <button type="button" class="btn btn--secondary" data-new-type>${icon("plus")}Ny typ av tid</button>
        </div>
        <h3 class="section-label">Arbete och övertid</h3>
        <ul class="list">${types.filter((t) => t.category !== "absence").map(row)}</ul>
        <h3 class="section-label">Frånvaro</h3>
        <ul class="list">${types.filter((t) => t.category === "absence").map(row)}</ul>
      `,
    );
  }

  /* ---------- Fordon och milersättning ---------- */

  function renderVehicles() {
    const reminder = ratesNeedCheck(settings);
    const visible = settings.vehicleTypes.filter((v) => !v.hidden && !v.retired);
    const skatteverket = html`<a href="${VEHICLE_RATES.url}" target="_blank" rel="noopener">Skatteverket: Belopp och procent ${VEHICLE_RATES.year}<span class="visually-hidden"> (öppnas i ny flik)</span></a>`;
    // Varifrån beloppet kommer
    const source = (v) => {
      const standard = VEHICLE_RATES.perMil[v.id];
      if (v.rateCustom) {
        return standard !== undefined ? `Eget belopp. Skatteverkets belopp för ${VEHICLE_RATES.year}: ${shortNumber(standard)} kr.` : "Eget belopp.";
      }
      if (v.ratePerMil === null || v.ratePerMil === undefined) return "Inget belopp – fyll i det ni betalar.";
      return `Skatteverkets belopp för ${v.rateYear ?? VEHICLE_RATES.year} – ändra om ni har ett annat avtal.`;
    };
    setHTML(
      $("[data-vehicles]"),
      html`
        <div class="stack stack--s">
          <h2 class="card__title" id="set-vehicles">Fordon och milersättning</h2>
          <p class="text-muted text-small">
            Medarbetarna väljer fordon under Resa i tidrapporten. Beloppen per mil är förifyllda med Skatteverkets skattefria belopp
            och följer med i exporten. Ändra om ni betalar något annat – egna belopp ändras aldrig automatiskt.
          </p>
          <p class="text-small">${skatteverket}</p>
        </div>
        ${reminder.due
          ? html`<div class="callout callout--pink">
              ${icon("alert", 18)}
              <div class="stack stack--s">
                <p><strong>Beloppen gäller ${reminder.validYear ?? "ett tidigare år"} – kontrollera för ${reminder.year}.</strong>
                  Skatteverket ändrar milersättningen vid årsskiftet.</p>
                <div class="cluster">
                  <button type="button" class="btn btn--secondary btn--sm" data-rates-checked>${icon("check", 16)}Jag har kontrollerat beloppen</button>
                </div>
              </div>
            </div>`
          : reminder.validYear
            ? html`<p class="text-muted text-small">Beloppen gäller ${reminder.validYear}.${settings.ratesCheckedAt ? ` Senast kontrollerade ${formatDate(settings.ratesCheckedAt)}.` : ""}</p>`
            : ""}
        <form class="form" data-rates-form novalidate>
          <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
          <ul class="list">
            ${visible.map((v) => html`<li class="row row--wrap">
              <span class="row__icon">${icon("car", 18)}</span>
              <span class="row__body">
                <span class="row__title">${v.name}</span>
                ${VEHICLE_INFO[v.id] ? html`<span class="row__meta">${VEHICLE_INFO[v.id]}</span>` : ""}
                ${v.isCompanyCar
                  ? html`<span class="row__meta">Ingen ersättning – körda mil sparas bara som underlag.</span>`
                  : html`<span class="row__meta" id="rate-${v.id}-help">${source(v)}</span>`}
              </span>
              <span class="row__actions">
                ${v.isCompanyCar
                  ? ""
                  : html`<span class="rate-field">
                      <label class="visually-hidden" for="rate-${v.id}">Belopp per mil för ${v.name}</label>
                      <input class="input rate-field__input" id="rate-${v.id}" name="rate-${v.id}" value="${shortNumber(v.ratePerMil)}"
                        inputmode="decimal" autocomplete="off" aria-describedby="rate-${v.id}-help" />
                      <span class="rate-field__unit" aria-hidden="true">kr/mil</span>
                    </span>`}
                <span class="row__buttons">
                  <button type="button" class="btn btn--text btn--sm" data-rename-vehicle="${v.id}" aria-label="Byt namn på ${v.name}">Byt namn</button>
                  <button type="button" class="btn btn--text btn--text-danger btn--sm" data-toggle-vehicle="${v.id}" aria-label="Ta bort ${v.name} från listan">Ta bort</button>
                </span>
              </span>
            </li>`)}
          </ul>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary">Spara belopp</button>
            <button type="button" class="btn btn--secondary" data-add-vehicle>${icon("plus")}Lägg till fordon</button>
          </div>
        </form>
      `,
    );
  }

  /* ---------- Material ---------- */

  function renderMaterials() {
    const materials = settings.materials;
    const custom = !MATERIAL_LABELS.includes(materials.label);
    setHTML(
      $("[data-materials]"),
      html`<form class="form" data-materials-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-materials">Material från lager</h2>
          <p class="text-muted text-small">
            Låt medarbetarna registrera det de tar från lagret, till exempel skruv, reglar eller fogmassa.
            Du bestämmer vad det ska heta och vilka artiklar som finns.
          </p>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        ${choice("checkbox", "enabled", "set-mat-enabled", "Använd material", "Av: inget syns i menyn, tidrapporten eller exporten.", materials.enabled)}
        <fieldset class="fieldset" data-mat-options ${materials.enabled ? "" : raw("disabled")}>
          <legend class="field__label">Vad ska det heta i appen?</legend>
          <div class="radio-list radio-list--row">
            ${[...MATERIAL_LABELS, "Eget"].map((name) =>
              choice("radio", "labelChoice", `set-mat-label-${name}`, name, "", name === "Eget" ? custom : materials.label === name, false, name),
            )}
          </div>
          <div data-custom-label ${custom ? "" : raw("hidden")}>
            ${field({ id: "set-mat-custom", label: "Eget namn", control: input({ id: "set-mat-custom", name: "label", value: custom ? materials.label : "", autocomplete: "off" }) })}
          </div>
          ${choice("checkbox", "allowFreeText", "set-mat-free", 'Tillåt "Annat – skriv själv"', "För sådant som inte finns i artikellistan.", materials.allowFreeText)}
        </fieldset>
        <div class="form__actions">
          <button type="submit" class="btn btn--primary">Spara</button>
          ${materials.enabled ? html`<a class="btn btn--text" href="#/material/artiklar">Artikellistan ${icon("arrowRight", 16)}</a>` : ""}
        </div>
      </form>`,
    );
  }

  /* ---------- Säkerhetskopia ---------- */

  function renderBackup() {
    setHTML(
      $("[data-backup]"),
      html`
        <h2 class="card__title" id="set-backup">Säkerhetskopia</h2>
        <p class="text-muted text-small">
          Tills vidare sparas allt i den här webbläsaren. Rensas webbläsarens data försvinner allt – exportera en kopia regelbundet.
        </p>
        ${callout("Filen innehåller all data, även inloggningsuppgifter (krypterade). Förvara den säkert.", { iconName: "lock" })}
        <div class="cluster">
          <button type="button" class="btn btn--primary" data-export-backup>${icon("download")}Exportera säkerhetskopia</button>
          <label class="btn btn--secondary file-button">
            ${icon("upload")}Läs in säkerhetskopia
            <input type="file" accept="application/json,.json" data-import-backup />
          </label>
        </div>
      `,
    );
  }

  /* ---------- Gallring ---------- */

  const cutoffFor = (months) => `${addMonths(today().slice(0, 7), -months)}-01`;

  async function renderRetention() {
    const months = settings.retentionMonths;
    const cutoff = cutoffFor(months);
    const { entries, materials, oldest } = await store.countEntriesBefore(cutoff);
    // "12 registreringar och 3 rader material från lagret"
    const what = [
      entries ? plural(entries, "registrering", "registreringar") : "",
      materials ? `${plural(materials, "rad", "rader")} material från lagret` : "",
    ].filter(Boolean).join(" och ");
    setHTML(
      $("[data-retention]"),
      html`<form class="form" data-retention-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-retention">Gallring</h2>
          <p class="text-muted text-small">
            Tidrader och material från lagret som är äldre än den valda tiden kan raderas, tillsammans med låsningen av de månaderna.
            Anställda, kunder, projekt och artiklar ligger kvar. Inget raderas automatiskt.
          </p>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        ${field({
          id: "set-retention-months",
          label: "Spara registreringar i (månader)",
          help: "Förval 36 månader (3 år).",
          control: input({ id: "set-retention-months", name: "retentionMonths", value: String(months), inputmode: "numeric", autocomplete: "off", help: true }),
        })}
        <div class="form__actions"><button type="submit" class="btn btn--secondary">Spara tid</button></div>
        <div class="callout">
          ${icon("info", 18)}
          <div>
            ${what
              ? html`<strong>${what}</strong> är äldre än ${formatDate(cutoff)} (äldsta: ${formatDate(oldest)}).`
              : html`Inga registreringar eller material från lagret är äldre än ${formatDate(cutoff)}.`}
          </div>
        </div>
        ${what
          ? html`<div><button type="button" class="btn btn--danger btn--wrap" data-purge="${cutoff}" data-what="${what}">${icon("trash", 16)}Radera ${plural(entries + materials, "rad", "rader")}</button></div>`
          : ""}
      </form>`,
    );
  }

  /* ---------- Rita ---------- */

  function renderAll() {
    renderCompany();
    renderWeek();
    renderProjects();
    renderOvertime();
    renderTravel();
    renderTypes();
    renderVehicles();
    renderMaterials();
    renderBackup();
    renderRetention();
  }

  async function reload() {
    settings = await store.getSettings();
    renderAll();
  }

  /* ---------- Dialoger ---------- */

  async function typeDialog(type = null) {
    await openDialog({
      title: type ? `Byt namn på ${type.name}` : "Ny typ av tid",
      body: html`
        ${field({ id: "type-name", label: "Namn", control: input({ id: "type-name", name: "name", value: type?.name, autocomplete: "off", required: true }) })}
        ${type
          ? ""
          : html`<fieldset class="fieldset">
              <legend class="field__label">Räknas som</legend>
              <div class="radio-list">
                ${choice("radio", "category", "type-cat-absence", "Frånvaro", "T.ex. tjänstledighet eller ledig utan lön.", true, false, "absence")}
                ${choice("radio", "category", "type-cat-work", "Arbetstid utan kund och projekt", "T.ex. utbildning, kurs eller möte. Räknas som arbete i summor och export.", false, false, "work")}
              </div>
            </fieldset>`}
      `,
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary">${type ? "Spara" : "Lägg till"}</button>`,
      onSubmit: async ({ form }) => {
        await store.saveTimeType({ id: type?.id, name: form.elements.name.value, hidden: type?.hidden ?? false, category: form.elements.category?.value });
        notify(type ? "Namnet är ändrat" : `${form.elements.name.value.trim()} är tillagd`);
        return "done";
      },
    }).then((result) => result === "done" && reload());
  }

  // Lägg till fordon: ur den färdiga listan (dolda standardfordon) eller ett eget
  async function addVehicleDialog() {
    const ready = settings.vehicleTypes.filter((v) => v.hidden && !v.retired);
    const rateText = (v) =>
      v.isCompanyCar ? "Ingen ersättning" : v.ratePerMil !== null && v.ratePerMil !== undefined ? `${shortNumber(v.ratePerMil)} kr/mil` : "Inget belopp";
    await openDialog({
      title: "Lägg till fordon",
      body: html`
        ${ready.length
          ? html`<div class="stack stack--s">
              ${ready.map((v) => html`<button type="submit" class="quick" value="${v.id}" aria-label="Lägg till ${v.name}, ${rateText(v)}">
                <span class="row__icon">${icon("car", 19)}</span>
                <span class="row__body">
                  <span class="row__title">${v.name}</span>
                  <span class="row__meta">${[rateText(v), VEHICLE_INFO[v.id]].filter(Boolean).join(" · ")}</span>
                </span>
                <span class="row__arrow">${icon("plus")}</span>
              </button>`)}
            </div>`
          : ""}
        <h3 class="section-label">Eget fordon</h3>
        <div class="grid-2">
          ${field({ id: "veh-name", label: "Namn", control: input({ id: "veh-name", name: "name", autocomplete: "off" }) })}
          ${field({
            id: "veh-rate",
            label: "Belopp per mil (kr)",
            optional: true,
            control: input({ id: "veh-rate", name: "ratePerMil", inputmode: "decimal", autocomplete: "off" }),
          })}
        </div>
      `,
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary" value="custom">Lägg till eget fordon</button>`,
      onSubmit: async ({ form, action }) => {
        if (action === "custom") {
          const rate = parseAmount(form.elements.ratePerMil.value);
          if (Number.isNaN(rate)) throw Object.assign(new Error("Kontrollera beloppet."), { fields: { ratePerMil: "Ange ett belopp, t.ex. 25 eller 12,50." } });
          await store.saveVehicleType({ name: form.elements.name.value, ratePerMil: rate });
          notify(`${form.elements.name.value.trim()} är tillagt`);
          return "done";
        }
        const v = ready.find((x) => x.id === action);
        if (!v) return false;
        await store.saveVehicleType({ ...v, hidden: false });
        notify(`${v.name} är tillagd`);
        return "done";
      },
    }).then((result) => result === "done" && reload());
  }

  async function renameVehicleDialog(vehicle) {
    await openDialog({
      title: `Byt namn på ${vehicle.name}`,
      body: field({ id: "veh-rename", label: "Namn", control: input({ id: "veh-rename", name: "name", value: vehicle.name, autocomplete: "off", required: true }) }),
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary">Spara</button>`,
      onSubmit: async ({ form }) => {
        await store.saveVehicleType({ ...vehicle, name: form.elements.name.value });
        notify("Namnet är ändrat");
        return "done";
      },
    }).then((result) => result === "done" && reload());
  }

  /* ---------- Händelser ---------- */

  container.addEventListener("input", (event) => {
    if (!event.target.name?.startsWith("workWeek.")) return;
    const form = event.target.form;
    const total = WEEKDAYS.reduce((sum, day) => sum + (parseHours(form.elements[`workWeek.${day}`].value) ?? 0), 0);
    form.querySelector("[data-week-total]").textContent = `Totalt ${formatHoursUnit(total)} per vecka.`;
  });

  container.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.matches("[data-import-backup]")) {
      const file = target.files?.[0];
      target.value = "";
      if (file) importBackup(file);
      return;
    }
    const materialsForm = target.closest("[data-materials-form]");
    if (materialsForm) {
      if (target.name === "enabled") materialsForm.querySelector("[data-mat-options]").disabled = !target.checked;
      if (target.name === "labelChoice") {
        const custom = target.value === "Eget";
        materialsForm.querySelector("[data-custom-label]").hidden = !custom;
        if (custom) materialsForm.querySelector("#set-mat-custom").focus();
      }
      return;
    }
    // Restidens övriga val går bara att ändra när restid används
    if (target.closest("[data-travel-form]") && target.name === "enabled") {
      $("[data-travel-form]")
        .querySelectorAll('input[type="checkbox"]:not([name="enabled"])')
        .forEach((box) => (box.disabled = !target.checked));
    }
  });

  async function importBackup(file) {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      notify("Filen kunde inte läsas. Välj en säkerhetskopia från Tidla (.json).", { type: "error" });
      return;
    }
    const exported = backup?.exportedAt ? ` från ${formatDate(backup.exportedAt.slice(0, 10))}` : "";
    const ok = await confirmDialog({
      title: "Läsa in säkerhetskopian?",
      message: `All data i Tidla ersätts med innehållet i kopian${exported}. Det som har registrerats efter att kopian gjordes försvinner.`,
      confirmLabel: "Ersätt all data",
      danger: true,
      requireText: "ERSÄTT",
    });
    if (!ok) return;
    try {
      const counts = await store.importBackup(backup);
      notify(`Säkerhetskopian är inläst: ${plural(counts.users, "anställd", "anställda")}, ${plural(counts.entries, "registrering", "registreringar")}.`);
      await ctx.refresh();
    } catch (error) {
      notify(error.message, { type: "error" });
    }
  }

  container.addEventListener("submit", async (event) => {
    const form = event.target;
    event.preventDefault();
    clearFormErrors(form);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      if (form.matches("[data-company-form]")) {
        await store.saveSettings({ companyName: form.elements.companyName.value, orgNumber: form.elements.orgNumber.value });
        notify("Företaget är sparat");
        await ctx.refresh(); // företagsnamnet i menyn
        return;
      }
      if (form.matches("[data-week-form]")) {
        const week = {};
        const errors = {};
        for (const day of WEEKDAYS) {
          const hours = parseHours(form.elements[`workWeek.${day}`].value);
          if (hours === null || hours > 24) errors[`workWeek.${day}`] = "Ange 0–24 timmar.";
          week[day] = hours;
        }
        if (Object.keys(errors).length) throw Object.assign(new Error("Kontrollera arbetstiden."), { fields: errors });
        await store.saveSettings({ workWeek: week, hourStep: Number(form.elements.hourStep.value) });
        notify("Arbetstiden är sparad");
      }
      if (form.matches("[data-overtime-form]")) {
        const factor = parseAmount(form.elements.factor.value);
        if (Number.isNaN(factor)) throw Object.assign(new Error("Kontrollera faktorn."), { fields: { factor: "Ange t.ex. 1,5 – eller lämna tomt." } });
        await store.saveSettings({ overtime: { mode: form.elements.mode.value, factor } });
        notify("Övertiden är sparad");
      }
      if (form.matches("[data-rates-form]")) {
        const rates = {};
        const errors = {};
        for (const el of form.querySelectorAll('input[name^="rate-"]')) {
          const value = parseAmount(el.value);
          if (Number.isNaN(value)) errors[el.name] = "Ange ett belopp, t.ex. 25 eller 12,50.";
          rates[el.name.slice(5)] = value;
        }
        if (Object.keys(errors).length) throw Object.assign(new Error("Kontrollera beloppen."), { fields: errors });
        await store.saveVehicleRates(rates);
        notify("Beloppen är sparade");
      }
      if (form.matches("[data-projects-form]")) {
        await store.saveSettings({ projects: { enabled: form.elements.enabled.checked } });
        notify(form.elements.enabled.checked ? "Projekt används" : "Projekt används inte – tiden rapporteras på kunder");
        await ctx.refresh(); // menyn heter Kunder eller Kunder & projekt
        return;
      }
      if (form.matches("[data-travel-form]")) {
        const value = (name) => form.elements[name].checked;
        await store.saveSettings({
          travel: {
            enabled: value("enabled"),
            billableDefault: value("billableDefault"),
            employeeCanChangeBilling: value("employeeCanChangeBilling"),
            countsTowardSchedule: value("countsTowardSchedule"),
          },
        });
        notify("Restiden är sparad");
      }
      if (form.matches("[data-materials-form]")) {
        const label = form.elements.labelChoice.value;
        await store.saveSettings({
          materials: {
            enabled: form.elements.enabled.checked,
            label: label === "Eget" ? form.elements.label.value : label,
            allowFreeText: form.elements.allowFreeText.checked,
          },
        });
        notify("Materialinställningen är sparad");
        await ctx.refresh(); // menyn visar Material med den nya benämningen
        return;
      }
      if (form.matches("[data-retention-form]")) {
        const months = Number(form.elements.retentionMonths.value);
        await store.saveSettings({ retentionMonths: months });
        notify("Tiden för gallring är sparad");
      }
      await reload();
    } catch (error) {
      setBusy(button, false);
      // Fältnamnen från store heter overtime.factor osv.
      const fields = Object.fromEntries(
        Object.entries(error.fields ?? {}).map(([k, v]) => [k.startsWith("workWeek.") ? k : k.split(".").pop(), v]),
      );
      showFormErrors(form, { ...error, message: error.message, fields });
    }
  });

  container.addEventListener("click", async (event) => {
    const target = event.target;
    const section = target.closest("[data-goto-section]");
    if (section) {
      const el = $(`#set-sec-${section.dataset.gotoSection}`);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.querySelector("h2")?.setAttribute("tabindex", "-1");
      el.querySelector("h2")?.focus({ preventScroll: true });
      return;
    }
    if (target.closest("[data-new-type]")) return typeDialog();
    const rename = target.closest("[data-rename]");
    if (rename) return typeDialog(settings.timeTypes.find((t) => t.id === rename.dataset.rename));
    if (target.closest("[data-add-vehicle]")) return addVehicleDialog();
    const renameVehicle = target.closest("[data-rename-vehicle]");
    if (renameVehicle) return renameVehicleDialog(settings.vehicleTypes.find((v) => v.id === renameVehicle.dataset.renameVehicle));

    try {
      const toggle = target.closest("[data-toggle-hidden]");
      if (toggle) {
        const type = settings.timeTypes.find((t) => t.id === toggle.dataset.toggleHidden);
        await store.saveTimeType({ id: type.id, name: type.name, hidden: !type.hidden });
        notify(type.hidden ? `${type.name} visas igen` : `${type.name} är dold`);
        await reload();
        $(`[data-toggle-hidden="${type.id}"]`)?.focus();
      }
      const toggleVehicle = target.closest("[data-toggle-vehicle]");
      if (toggleVehicle) {
        const v = settings.vehicleTypes.find((x) => x.id === toggleVehicle.dataset.toggleVehicle);
        await store.saveVehicleType({ ...v, hidden: true });
        notify(`${v.name} är borttagen från listan – du kan lägga till den igen`);
        await reload();
        $("[data-add-vehicle]")?.focus();
      }
      if (target.closest("[data-rates-checked]")) {
        await store.confirmVehicleRates();
        notify("Beloppen är markerade som kontrollerade");
        await reload();
      }
      if (target.closest("[data-export-backup]")) {
        const backup = await store.exportBackup();
        downloadFile(`tidla-sakerhetskopia-${today()}.json`, JSON.stringify(backup, null, 2), "application/json");
        notify("Säkerhetskopian är nedladdad");
      }
      const purge = target.closest("[data-purge]");
      if (purge) {
        const what = purge.dataset.what;
        const cutoff = purge.dataset.purge;
        const first = await confirmDialog({
          title: `Radera ${what}?`,
          message: `Alla registreringar och allt material från lagret före ${formatDate(cutoff)} raderas permanent. Exportera gärna en säkerhetskopia först.`,
          confirmLabel: "Fortsätt",
          danger: true,
        });
        if (!first) return;
        const second = await confirmDialog({
          title: "Är du helt säker?",
          message: "Det här går inte att ångra.",
          confirmLabel: "Radera",
          danger: true,
          requireText: "RADERA",
        });
        if (!second) return;
        const result = await store.purgeEntriesBefore(cutoff);
        notify([
          result.entries ? plural(result.entries, "registrering raderad", "registreringar raderade") : "",
          result.materials ? `${plural(result.materials, "rad", "rader")} material från lagret raderade` : "",
        ].filter(Boolean).join(", "));
        await reload();
      }
    } catch (error) {
      notify(error.message, { type: "error" });
    }
  });

  renderAll();

  // #/installningar/<del>: scrolla dit direkt
  if (ctx.params[0] && SECTIONS.some(([id]) => id === ctx.params[0])) {
    $(`#set-sec-${ctx.params[0]}`)?.scrollIntoView({ block: "start" });
  }
}
