// "Kom igång" för medarbetare – första stegen och hur man rapporterar tid.
// Stegen bockas av automatiskt. Det som admin har stängt av (resa, övertid, material) visas inte.
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { firstName, formatHoursUnit, formatPercent } from "../lib/format.js";
import { callout, statusPill } from "../lib/ui.js";

const DAY_NAMES = { mon: "mån", tue: "tis", wed: "ons", thu: "tor", fri: "fre", sat: "lör", sun: "sön" };

export async function renderEmployeeGuide(container, ctx) {
  const me = ctx.user;
  const settings = ctx.settings;
  const [entries, workWeek] = await Promise.all([store.listEntries({ userId: me.id }), store.getWorkWeek()]);

  const travel = settings.travel ?? { enabled: true };
  const hasVehicles = settings.vehicleTypes.some((v) => !v.hidden);
  const showTrip = travel.enabled || hasVehicles;
  const overtimeMode = settings.overtime?.mode ?? "both";
  const overtimeTypes = settings.timeTypes.filter(
    (t) => t.category === "overtime" && !t.hidden && (overtimeMode === "both" || t.compensation === overtimeMode),
  );
  const materials = settings.materials ?? { enabled: false };
  const materialLabel = (materials.label || "Material").toLowerCase();
  const step = settings.hourStep || 0.5;
  const stepText = step === 1 ? "en timme" : `${Math.round(step * 60)} minuter`;

  const steps = [
    {
      done: true,
      title: "Välj ett eget lösenord",
      text: "Klart! Du kan byta lösenord när du vill under Profil.",
      href: "#/profil",
      action: "Profil",
    },
    {
      done: entries.length > 0,
      title: "Registrera din första tid",
      text: "Välj kund och projekt, kontrollera timmarna och tryck Spara registrering.",
      href: "#/tid",
      action: "Till tidrapporten",
      doneAction: "Tidrapport",
    },
    {
      done: entries.some((e) => e.status === "approved"),
      title: "Se när tiden är godkänd",
      text: "Under Granskning ser du dina rader vecka för vecka och om administratören har godkänt dem.",
      href: "#/granska",
      action: "Granskning",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  // "mån–fre 8,0 h" eller "mån 8,0 h · fre 6,0 h"
  const days = Object.entries(DAY_NAMES).filter(([key]) => workWeek[key] > 0);
  const sameHours = days.length && days.every(([key]) => workWeek[key] === workWeek[days[0][0]]);
  const weekdaysInRow = days.map(([key]) => key).join() === Object.keys(DAY_NAMES).slice(0, days.length).join();
  const scheduleText = !days.length
    ? "Inga arbetsdagar är inlagda."
    : sameHours && weekdaysInRow && days.length > 1
      ? `${days[0][1]}–${days[days.length - 1][1]} ${formatHoursUnit(workWeek[days[0][0]])} per dag`
      : days.map(([key, name]) => `${name} ${formatHoursUnit(workWeek[key])}`).join(" · ");

  const howTo = [
    html`<strong>Välj kund och sedan projekt.</strong> Bara pågående projekt går att välja. Saknas ett projekt? Fråga din administratör.`,
    html`<strong>Välj typ av tid.</strong> Oftast Arbete. Är du ledig väljer du en typ av frånvaro, till exempel semester eller sjuk – då behövs inget projekt.`,
    html`<strong>Kontrollera timmarna.</strong> De fylls i efter din arbetstid. Ändra med − och + (${stepText} per tryck) eller skriv, till exempel 4,5.`,
    ...(showTrip
      ? [html`<strong>Reste du?</strong> Öppna <em>${travel.enabled ? "Lägg till restid eller milersättning" : "Lägg till milersättning"}</em> och fyll i ${travel.enabled ? "restid och " : ""}fordon.`]
      : []),
    ...(materials.enabled
      ? [html`<strong>Tog du ${materialLabel} från lagret?</strong> Öppna <em>Lägg till ${materialLabel} från lager</em>. Ska du bara registrera ${materialLabel}, sätt timmarna till 0.`]
      : []),
    html`<strong>Tryck Spara registrering.</strong> Allt du har fyllt i sparas på en gång och syns i listan under formuläret.`,
  ];

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <div class="eyebrow">Hej, ${firstName(me.name)}</div>
          <h1 class="page-title">Kom igång</h1>
          <p class="page-lead">Så rapporterar du tid i Tidla${settings.companyName ? ` för ${settings.companyName}` : ""}. Det tar en minut om dagen.</p>
        </div>
      </div>

      <section class="card card--lg stack" aria-labelledby="gs-steps">
        <div class="split split--center">
          <h2 class="card__title" id="gs-steps">Steg för steg</h2>
          <span class="text-muted text-small num">${doneCount} av ${steps.length} klart</span>
        </div>
        <div class="progress" role="progressbar" aria-label="Kom igång" aria-valuemin="0" aria-valuemax="${steps.length}"
          aria-valuenow="${doneCount}" aria-valuetext="${doneCount} av ${steps.length} steg klara">
          <div class="progress__bar" style="width: ${formatPercent(doneCount, steps.length).replace(" ", "")}"></div>
        </div>
        <ol class="guide">
          ${steps.map(
            (s, i) => html`<li class="guide__step${s.done ? " guide__step--done" : ""}${i === current ? " guide__step--current" : ""}">
              <span class="guide__marker" aria-hidden="true">${s.done ? icon("check", 18, 2.4) : i + 1}</span>
              <div class="guide__body">
                <h3 class="guide__title">
                  ${s.title}
                  <span class="visually-hidden">${s.done ? "(klart)" : "(inte klart)"}</span>
                </h3>
                <p class="guide__text">${s.text}</p>
              </div>
              <a class="btn ${i === current ? "btn--primary" : "btn--secondary"} btn--sm guide__action" href="${s.href}">
                ${s.done ? s.doneAction ?? s.action : s.action}${i === current ? icon("arrowRight", 16) : ""}
              </a>
            </li>`,
          )}
        </ol>
      </section>

      <div class="grid-2">
        <section class="card stack stack--m" aria-labelledby="gs-how">
          <h2 class="card__title" id="gs-how">Så registrerar du tid</h2>
          <ol class="numbered">
            ${howTo.map((item) => html`<li>${item}</li>`)}
          </ol>
          <p class="text-muted text-small">Din arbetstid: ${scheduleText}.</p>
        </section>

        <section class="card stack stack--m" aria-labelledby="gs-status">
          <h2 class="card__title" id="gs-status">Vad händer sedan?</h2>
          <ul class="info-list">
            <li>${statusPill("draft")}<span>Sparad tid är ett <strong>utkast</strong> tills administratören har granskat den. Du kan ändra och ta bort den.</span></li>
            <li>${statusPill("approved")}<span><strong>Godkänd</strong> tid är låst. Behöver något ändras, kontakta din administratör.</span></li>
            <li>${statusPill("rejected")}<span><strong>Nekad</strong> tid visas med en orsak överst i tidrapporten. Redigera raden och spara igen.</span></li>
            <li>${icon("lock", 18)}<span>När månaden är <strong>markerad som klar</strong> går den inte längre att ändra.</span></li>
          </ul>
        </section>
      </div>

      <section class="card stack stack--m" aria-labelledby="gs-tips">
        <h2 class="card__title" id="gs-tips">Bra att veta</h2>
        <ul class="info-list">
          <li>${icon("clock", 18)}<span><strong>Samma som igår</strong> fyller i formuläret som förra gången. Kontrollera och tryck Spara.</span></li>
          <li>${icon("calendar", 18)}<span><strong>Glömt en dag?</strong> Byt dag med pilarna eller datumet överst – i mobilen trycker du på dagen i veckoraden.</span></li>
          ${overtimeTypes.length
            ? html`<li>${icon("overtime", 18)}<span><strong>Övertid:</strong> anger du fler timmar än din arbetstid kan du spara resten som
                ${overtimeTypes.map((t) => t.name.toLowerCase()).join(" eller ")}. Du kan också välja det under Typ av tid.</span></li>`
            : ""}
          <li>${icon("user", 18)}<span><strong>Glömt lösenordet?</strong> Be din administratör återställa det – du får då ett nytt engångslösenord.</span></li>
          <li>${icon("flag", 18)}<span><strong>Lägg Tidla på hemskärmen</strong> så öppnas den som en app. iPhone: Dela → Lägg till på hemskärmen.
            Android: menyn ⋮ → Lägg till på startskärmen.</span></li>
        </ul>
      </section>

      ${entries.length
        ? ""
        : callout(html`<strong>Redo?</strong> Registrera dagens tid – det går snabbare än du tror. <a href="#/tid">Till tidrapporten</a>`, { iconName: "info" })}
    `,
  );
}
