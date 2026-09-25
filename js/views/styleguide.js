// Stilguide för utvecklare: visar alla komponenter med den riktiga CSS:en.
// Exempeltexterna här sparas inte någonstans. Öppnas via #/stilguide (eller #/stilguide/medarbetare).
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  field, input, select, textarea, statusPill, avatar, emptyState, callout,
  notify, confirmDialog, showFormErrors, clearFormErrors, passwordToggle, bindPasswordToggles,
} from "../lib/ui.js";
import { formatHours, parseHours, clamp, roundToStep } from "../lib/format.js";
import { today, weekDates, formatDayShort, dayOfMonth, formatShort, isoWeek } from "../lib/dates.js";
import { renderShell } from "./shell.js";
import { themeChoiceControl } from "../theme.js";

// Semantiska färger – swatcharna följer valt tema
const COLORS = [
  ["--bg", "Sidbakgrund", "--text"], ["--surface", "Yta", "--text"], ["--surface-2", "Yta 2", "--text"],
  ["--text", "Text", "--bg"], ["--text-muted", "Hjälptext", "--bg"], ["--border-strong", "Fältkant", "--text"],
  ["--primary", "Primär", "--on-primary"], ["--link", "Länk och ikon", "--bg"], ["--sidebar", "Sidomeny", "--white"],
  ["--accent", "Rosa accent", "--on-accent"], ["--accent-soft", "Rosa mjuk", "--on-accent-soft"],
  ["--info-soft", "Marin mjuk", "--on-info-soft"], ["--danger", "Fel", "--bg"], ["--draft-bg", "Utkast", "--draft-text"],
];

export function render(root, ctx) {
  const asEmployee = ctx.params[0] === "medarbetare";
  const demoUser = asEmployee
    ? { name: "Exempel Medarbetare", title: "Snickare", role: "employee" }
    : { name: "Exempel Administratör", title: "", role: "admin" };
  const container = renderShell(root, {
    user: demoUser,
    settings: { companyName: "Exempelföretaget" },
    route: "tid",
    onLogout: () => ctx.navigate("stilguide"),
  });

  const day = today();
  const week = weekDates(day, 5);

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <div class="eyebrow">Utvecklarsida</div>
          <h1 class="page-title">Stilguide</h1>
          <p class="page-lead">Komponenterna i Tidla med riktig CSS. Inget här sparas.</p>
        </div>
        <div class="cluster">
          <a class="btn btn--secondary btn--sm" href="#/stilguide" ${asEmployee ? "" : html`aria-current="page"`}>Som admin</a>
          <a class="btn btn--secondary btn--sm" href="#/stilguide/medarbetare" ${asEmployee ? html`aria-current="page"` : ""}>Som medarbetare</a>
        </div>
      </div>

      <section class="card stack" aria-labelledby="sg-theme">
        <h2 class="card__title" id="sg-theme">Tema</h2>
        <p class="text-muted text-small">Automatiskt följer datorns eller telefonens inställning. Temaknappen i menyn växlar mellan ljust och mörkt.</p>
        ${themeChoiceControl()}
      </section>

      <section class="card stack" aria-labelledby="sg-colors">
        <h2 class="card__title" id="sg-colors">Färger</h2>
        <div class="swatches">
          ${COLORS.map(
            ([token, label, fg]) => html`<div class="stack stack--s">
              <div class="swatch" style="background: var(${token}); color: var(${fg})">${token}</div>
              <span class="text-small">${label}</span>
            </div>`,
          )}
        </div>
      </section>

      <section class="card stack" aria-labelledby="sg-type">
        <h2 class="card__title" id="sg-type">Typografi</h2>
        <p class="h1">Rubrik 1</p>
        <p class="h2">Rubrik 2</p>
        <p class="h3">Rubrik 3</p>
        <p>Brödtext 15/500. Välj först kund och därefter rätt projekt.</p>
        <p class="text-small">Liten 13/500</p>
        <p class="text-help">Hjälptext 12,5</p>
        <p class="stat__value">8,5 h</p>
        <p class="section-label">Registrerat idag</p>
      </section>

      <section class="card stack" aria-labelledby="sg-buttons">
        <h2 class="card__title" id="sg-buttons">Knappar</h2>
        <div class="cluster">
          <button type="button" class="btn btn--primary">${icon("check")}Spara registrering</button>
          <button type="button" class="btn btn--secondary">Rensa</button>
          <button type="button" class="btn btn--accent">${icon("plus")}Ny registrering</button>
          <button type="button" class="btn btn--text">Glömt lösenord?</button>
          <button type="button" class="btn btn--danger">Ta bort</button>
          <button type="button" class="btn btn--primary" disabled>Inaktiv</button>
          <button type="button" class="btn btn--secondary btn--sm">Liten</button>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn--secondary" data-demo="notify">Visa bekräftelse</button>
          <button type="button" class="btn btn--secondary" data-demo="confirm">Bekräftelsedialog</button>
          <button type="button" class="btn btn--secondary" data-demo="double">Dubbel bekräftelse</button>
        </div>
      </section>

      <section class="card card--lg" aria-labelledby="sg-fields">
        <form class="form" data-demo-form novalidate>
          <h2 class="card__title" id="sg-fields">Formulärfält</h2>
          <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
          <div class="grid-2">
            ${field({ id: "sg-email", label: "E-post", control: input({ id: "sg-email", type: "email", iconName: "mail", placeholder: "namn@foretag.se", autocomplete: "off" }) })}
            ${field({
              id: "sg-password",
              label: "Lösenord",
              control: input({ id: "sg-password", type: "password", iconName: "lock", action: passwordToggle("sg-password"), autocomplete: "off" }),
            })}
            ${field({
              id: "sg-customer",
              label: "1. Kund",
              control: select({ id: "sg-customer", placeholder: "Välj kund…", options: [{ value: "a", label: "Exempelkund AB" }] }),
            })}
            ${field({
              id: "sg-project",
              label: "2. Projekt",
              help: "Endast projekt för vald kund visas.",
              control: select({ id: "sg-project", placeholder: "Välj kund först…", disabled: true, help: true }),
            })}
          </div>
          <div class="grid-2">
            ${field({ id: "sg-date", label: "Datum", control: input({ id: "sg-date", type: "date", value: day, iconName: "calendar" }) })}
            <div class="field">
              <label class="field__label" for="sg-hours">Timmar</label>
              <div class="stepper">
                <button type="button" class="icon-btn" data-step="-1" aria-label="Minska 30 minuter">${icon("minus", 20)}</button>
                <input class="input stepper__input" id="sg-hours" name="hours" inputmode="decimal" value="8,5" autocomplete="off" />
                <button type="button" class="icon-btn" data-step="1" aria-label="Öka 30 minuter">${icon("plus", 20)}</button>
              </div>
              <div class="field__help">Förinställd dagstid – pilarna ändrar 30 minuter.</div>
            </div>
          </div>
          ${field({ id: "sg-comment", label: "Kommentar", optional: true, control: textarea({ id: "sg-comment", placeholder: "T.ex. vad som gjordes" }) })}
          <label class="check"><input type="checkbox" checked /> Kom ihåg mig</label>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary btn--lg">${icon("check")}Visa fältfel</button>
            <button type="button" class="btn btn--secondary btn--lg" data-demo="clear">Rensa fel</button>
          </div>
        </form>
      </section>

      <section class="card stack" aria-labelledby="sg-status">
        <h2 class="card__title" id="sg-status">Status</h2>
        <div class="cluster">
          ${["approved", "pending", "rejected", "draft", "active", "inactive", "open", "closed", "archived", "new", "handled", "locked"].map(statusPill)}
          <span class="count-badge">3</span>
        </div>
      </section>

      <div class="time-layout">
        <div class="time-layout__main">
          <section class="stack stack--m" aria-labelledby="sg-rows">
            <div class="split">
              <h2 class="h3" id="sg-rows">Listrader</h2>
              <span class="text-muted text-small">3 registreringar</span>
            </div>
            <ul class="list">
              <li class="row">
                <span class="row__icon">${icon("clock", 20)}</span>
                <span class="row__body"><span class="row__title">Exempelkund · L-1 Takbyte</span><span class="row__meta">Firmabil, bil per dag</span></span>
                <span class="row__aside">${statusPill("draft")}<span class="row__value">4,0 h</span></span>
              </li>
              <li class="row row--wrap">
                <span class="row__icon row__icon--error">${icon("alert", 20)}</span>
                <span class="row__body">
                  <span class="row__title">Exempelkund · L-2 Fönster</span>
                  <span class="row__meta">Privat bil · 42 km</span>
                  <span class="row__note">Nekad: Fel projekt</span>
                </span>
                <span class="row__aside">${statusPill("rejected")}<span class="row__value">3,5 h</span></span>
                <span class="row__actions">
                  <button type="button" class="btn btn--secondary btn--sm">${icon("edit", 16)}Redigera</button>
                  <button type="button" class="btn btn--text btn--sm">${icon("trash", 16)}Ta bort</button>
                </span>
              </li>
              <li class="row row--muted">
                ${avatar("Exempel Person")}
                <span class="row__body"><span class="row__title">Exempel Person</span><span class="row__meta">Lärling</span></span>
                ${statusPill("pending")}
              </li>
            </ul>
          </section>
          ${emptyState({
            iconName: "building",
            title: "Lägg till din första kund",
            text: "Kunder och projekt behövs innan du kan rapportera tid på ett projekt.",
            action: html`<button type="button" class="btn btn--accent">${icon("plus")}Ny kund</button>`,
          })}
          ${callout("Kontrollera Skatteverkets aktuella belopp.")}
          ${callout("Månaden är markerad som klar och låst.", { variant: "pink", iconName: "lock" })}
          <div class="card">
            <h2 class="card__title">Tabell</h2>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Vecka</th><th class="num">Rapporterat</th><th class="num">Schema</th><th class="num">Avvikelse</th></tr></thead>
                <tbody>
                  <tr><td>Vecka 38</td><td class="num">40,0 h</td><td class="num">40,0 h</td><td class="num">±0 h</td></tr>
                  <tr><td>Vecka 39</td><td class="num">36,5 h</td><td class="num">40,0 h</td><td class="num deviation">−3,5 h</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="time-layout__aside">
          <div class="datenav">
            <button type="button" class="icon-btn" aria-label="Föregående dag">${icon("chevronLeft")}</button>
            <span class="datenav__label">Idag · ${formatShort(day)}</span>
            <button type="button" class="icon-btn" aria-label="Nästa dag">${icon("chevronRight")}</button>
          </div>
          <div class="weekstrip" role="group" aria-label="Vecka ${isoWeek(day).week}">
            <div class="weekstrip__days">
              ${week.map(
                (d, i) => html`<button type="button" class="weekstrip__day" aria-pressed="${d === day ? "true" : "false"}">
                  <span class="weekstrip__name">${formatDayShort(d)}</span>
                  <span class="weekstrip__date">${dayOfMonth(d)}</span>
                  ${i < 2 && d !== day ? html`<span class="weekstrip__sum">8,5 h</span>` : html`<span class="weekstrip__dot"></span>`}
                </button>`,
              )}
            </div>
          </div>
          <div class="today-card">
            <div class="split"><strong>Idag</strong><span class="text-muted"><span class="today-card__value">4,0</span> av 8,5 h</span></div>
            <div class="progress"><div class="progress__bar" style="width: 47%"></div></div>
          </div>
          <section class="card stack" aria-labelledby="sg-today">
            <h2 class="card__title" id="sg-today">Dagens tid</h2>
            <div class="stats">
              <div class="stat"><span class="stat__label">Programmerad</span><span class="stat__value">8,5 h</span></div>
              <div class="stat stat--pink"><span class="stat__label">Kvar att fördela</span><span class="stat__value">4,5 h</span></div>
            </div>
            <div class="stack stack--s">
              <div class="progress" role="progressbar" aria-valuenow="47" aria-valuemin="0" aria-valuemax="100" aria-label="Registrerat av dagens tid"><div class="progress__bar" style="width: 47%"></div></div>
              <div class="split text-small text-muted"><span>4,0 h registrerat</span><span>47 %</span></div>
            </div>
          </section>
          <section class="card stack" aria-labelledby="sg-quick">
            <h2 class="card__title" id="sg-quick">Snabbval</h2>
            <button type="button" class="quick">
              <span class="row__icon row__icon--pink">${icon("box", 19)}</span>
              <span class="row__body"><span class="row__title">Material från lager</span><span class="row__meta">Registrera uttag och meddelande</span></span>
              <span class="count-badge">2</span>
              <span class="row__arrow">${icon("arrowRight")}</span>
            </button>
            <button type="button" class="quick">
              <span class="row__icon">${icon("clock", 19)}</span>
              <span class="row__body"><span class="row__title">Samma som igår</span><span class="row__meta">Exempelkund · L-1 · 8,5 h</span></span>
              <span class="row__arrow">${icon("arrowRight")}</span>
            </button>
          </section>
        </aside>
      </div>
    `,
  );

  bindPasswordToggles(container);

  // Stegknappar för timmar: 0–24 i steg om 0,5
  const hours = container.querySelector("#sg-hours");
  container.querySelectorAll("[data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      const value = parseHours(hours.value) ?? 0;
      hours.value = formatHours(clamp(roundToStep(value + Number(button.dataset.step) * 0.5, 0.5), 0, 24));
    }),
  );
  container.querySelectorAll(".weekstrip__day").forEach((button) =>
    button.addEventListener("click", () =>
      container.querySelectorAll(".weekstrip__day").forEach((b) => b.setAttribute("aria-pressed", String(b === button))),
    ),
  );

  const form = container.querySelector("[data-demo-form]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showFormErrors(form, {
      message: "Kontrollera de markerade fälten.",
      fields: { "sg-email": "Ange en giltig e-postadress.", hours: "Ange mer än 0 och högst 24 timmar." },
    });
  });

  container.addEventListener("click", async (event) => {
    const demo = event.target.closest("[data-demo]")?.dataset.demo;
    if (demo === "notify") notify("Registreringen är sparad");
    if (demo === "clear") clearFormErrors(form);
    if (demo === "confirm") {
      const ok = await confirmDialog({
        title: "Ta bort registreringen?",
        message: "Registreringen tas bort permanent.",
        confirmLabel: "Ta bort",
        danger: true,
      });
      notify(ok ? "Du bekräftade" : "Du avbröt");
    }
    if (demo === "double") {
      const ok = await confirmDialog({
        title: "Radera gamla registreringar?",
        message: "Det här går inte att ångra.",
        confirmLabel: "Radera",
        danger: true,
        requireText: "RADERA",
      });
      notify(ok ? "Du bekräftade" : "Du avbröt");
    }
  });
}
