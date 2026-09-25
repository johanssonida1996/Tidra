// Inställningar (bara admin): företag, arbetstid, övertid, restid, typer av tid, fordon och milersättning,
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
import { ratesNeedCheck, SKATTEVERKET_URL } from "../lib/reminders.js";
import { OVERTIME_MODES, TIME_CATEGORIES, MATERIAL_LABELS, HOUR_STEPS } from "../store.js";
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
  ["overtid", "Övertid och restid"],
  ["typer", "Typer av tid"],
  ["fordon", "Fordon och milersättning"],
  ["material", "Material"],
  ["sakerhetskopia", "Säkerhetskopia"],
  ["gallring", "Gallring"],
];

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
            Timmar per veckodag. Styr den förifyllda tiden och "Programmerad" i tidrapporten.
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
      const canHide = t.category === "absence";
      const overtimeOff = t.category === "overtime" && !(settings.overtime.mode === "both" || settings.overtime.mode === t.compensation);
      return html`<li class="row row--wrap${t.hidden ? " row--muted" : ""}">
        <span class="row__icon${t.category === "absence" ? " row__icon--pink" : ""}">${icon(t.category === "absence" ? "sun" : t.category === "overtime" ? "overtime" : "clock", 18)}</span>
        <span class="row__body">
          <span class="row__title">${t.name}</span>
          <span class="row__meta">${TIME_CATEGORIES[t.category]}${t.category === "overtime" ? ` · ersätts med ${t.compensation === "leave" ? "komptid" : "lön"}` : ""}</span>
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
          <button type="button" class="btn btn--secondary" data-new-type>${icon("plus")}Ny frånvarotyp</button>
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
    setHTML(
      $("[data-vehicles]"),
      html`
        <div class="split split--center split--stack">
          <div class="stack stack--s">
            <h2 class="card__title" id="set-vehicles">Fordon och milersättning</h2>
            <p class="text-muted text-small">
              Ersättning per mil följer med i exporten som underlag. Kontrollera Skatteverkets aktuella belopp (sök på "milersättning" på deras webbplats) – de ändras vid årsskiftet.
            </p>
          </div>
          <button type="button" class="btn btn--secondary" data-new-vehicle>${icon("plus")}Nytt fordon</button>
        </div>
        <div class="callout${reminder.due ? " callout--pink" : ""}">
          ${icon(reminder.due ? "alert" : "check", 18)}
          <div class="stack stack--s">
            <p>
              ${reminder.due
                ? reminder.reason === "never"
                  ? html`<strong>Beloppen har inte kontrollerats.</strong> Fyll i Skatteverkets aktuella belopp per mil.`
                  : html`<strong>Nytt år – kontrollera beloppen för ${reminder.year}.</strong> Skatteverket ändrar milersättningen vid årsskiftet.`
                : html`Senast kontrollerade: <strong>${formatDate(settings.ratesCheckedAt)}</strong>.`}
            </p>
            <div class="cluster">
              <a class="btn btn--text btn--sm" href="${SKATTEVERKET_URL}" target="_blank" rel="noopener">
                Öppna Skatteverket ${icon("arrowRight", 16)}<span class="visually-hidden">, öppnas i ny flik – sök på milersättning</span>
              </a>
              <button type="button" class="btn btn--secondary btn--sm" data-rates-checked>${icon("check", 16)}Jag har kontrollerat beloppen</button>
            </div>
          </div>
        </div>
        <ul class="list">
          ${settings.vehicleTypes.map((v) => html`<li class="row row--wrap${v.hidden ? " row--muted" : ""}">
            <span class="row__icon">${icon("car", 18)}</span>
            <span class="row__body">
              <span class="row__title">${v.name}</span>
              <span class="row__meta">${[
                v.ratePerMil !== null && v.ratePerMil !== undefined ? `${shortNumber(v.ratePerMil)} kr/mil` : "Belopp saknas",
                v.isCompanyCar ? "Bil per dag eller per mil" : "",
              ].filter(Boolean).join(" · ")}</span>
            </span>
            <span class="row__aside">${v.hidden ? pill("Dold", "draft", "minus") : ""}</span>
            <span class="row__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-edit-vehicle="${v.id}" aria-label="Redigera ${v.name}">${icon("edit", 16)}Redigera</button>
              <button type="button" class="btn btn--text btn--sm" data-toggle-vehicle="${v.id}" aria-label="${v.hidden ? "Visa" : "Dölj"} ${v.name}">${v.hidden ? "Visa" : "Dölj"}</button>
            </span>
          </li>`)}
        </ul>
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
            Låt medarbetarna registrera det de tar från lagret, till exempel byggmaterial, hårfärg eller städmedel.
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
    const { entries, oldest } = await store.countEntriesBefore(cutoff);
    setHTML(
      $("[data-retention]"),
      html`<form class="form" data-retention-form novalidate>
        <div class="stack stack--s">
          <h2 class="card__title" id="set-retention">Gallring</h2>
          <p class="text-muted text-small">Registreringar äldre än den valda tiden kan raderas. Inget raderas automatiskt.</p>
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
            ${entries
              ? html`<strong>${plural(entries, "registrering", "registreringar")}</strong> är äldre än ${formatDate(cutoff)} (äldsta: ${formatDate(oldest)}).`
              : html`Inga registreringar är äldre än ${formatDate(cutoff)}.`}
          </div>
        </div>
        ${entries
          ? html`<div><button type="button" class="btn btn--danger" data-purge="${cutoff}" data-count="${entries}">${icon("trash", 16)}Radera ${plural(entries, "registrering", "registreringar")}</button></div>`
          : ""}
      </form>`,
    );
  }

  /* ---------- Rita ---------- */

  function renderAll() {
    renderCompany();
    renderWeek();
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
      title: type ? `Byt namn på ${type.name}` : "Ny frånvarotyp",
      body: field({ id: "type-name", label: "Namn", control: input({ id: "type-name", name: "name", value: type?.name, autocomplete: "off", required: true }) }),
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary">${type ? "Spara" : "Lägg till"}</button>`,
      onSubmit: async ({ form }) => {
        await store.saveTimeType({ id: type?.id, name: form.elements.name.value, hidden: type?.hidden ?? false });
        notify(type ? "Namnet är ändrat" : "Frånvarotypen är tillagd");
        return "done";
      },
    }).then((result) => result === "done" && reload());
  }

  async function vehicleDialog(vehicle = null) {
    await openDialog({
      title: vehicle ? `Redigera ${vehicle.name}` : "Nytt fordon",
      body: html`
        ${field({ id: "veh-name", label: "Namn", control: input({ id: "veh-name", name: "name", value: vehicle?.name, autocomplete: "off", required: true }) })}
        ${field({
          id: "veh-rate",
          label: "Ersättning per mil (kr)",
          optional: true,
          help: "Kontrollera Skatteverkets aktuella belopp.",
          control: input({ id: "veh-rate", name: "ratePerMil", value: shortNumber(vehicle?.ratePerMil), inputmode: "decimal", autocomplete: "off", help: true }),
        })}
      `,
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary">${vehicle ? "Spara" : "Lägg till"}</button>`,
      onSubmit: async ({ form }) => {
        const rate = parseAmount(form.elements.ratePerMil.value);
        if (Number.isNaN(rate)) throw Object.assign(new Error("Kontrollera beloppet."), { fields: { ratePerMil: "Ange ett belopp, t.ex. 25 eller 12,50." } });
        await store.saveVehicleType({ id: vehicle?.id, name: form.elements.name.value, ratePerMil: rate, hidden: vehicle?.hidden ?? false });
        notify(vehicle ? "Fordonet är sparat" : "Fordonet är tillagt");
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
    if (target.closest("[data-new-vehicle]")) return vehicleDialog();
    const editVehicle = target.closest("[data-edit-vehicle]");
    if (editVehicle) return vehicleDialog(settings.vehicleTypes.find((v) => v.id === editVehicle.dataset.editVehicle));

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
        await store.saveVehicleType({ ...v, hidden: !v.hidden });
        notify(v.hidden ? `${v.name} visas igen` : `${v.name} är dold`);
        await reload();
        $(`[data-toggle-vehicle="${v.id}"]`)?.focus();
      }
      if (target.closest("[data-rates-checked]")) {
        await store.saveSettings({ ratesCheckedAt: today() });
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
        const count = Number(purge.dataset.count);
        const cutoff = purge.dataset.purge;
        const first = await confirmDialog({
          title: `Radera ${plural(count, "registrering", "registreringar")}?`,
          message: `Alla registreringar före ${formatDate(cutoff)} raderas permanent. Exportera gärna en säkerhetskopia först.`,
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
        notify(`${plural(result.entries, "registrering", "registreringar")} raderade`);
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
