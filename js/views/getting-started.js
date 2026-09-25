// "Kom igång" – två versioner:
// Admin: vad som behövs innan medarbetarna kan rapportera tid (kunder, projekt, medarbetare).
// Medarbetare: första stegen och hur man rapporterar tid. Texterna följer admins inställningar.
// Stegen bockas av automatiskt utifrån datan.
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { firstName, formatPercent } from "../lib/format.js";
import { callout } from "../lib/ui.js";
import { ALL } from "../routes.js";
import { isAdmin } from "../auth.js";
import { renderEmployeeGuide } from "./getting-started-employee.js";
import { allowed } from "./guard.js";
import { ratesNeedCheck } from "../lib/reminders.js";

export async function render(container, ctx) {
  if (!allowed(ctx, ALL, container)) return;
  if (!isAdmin(ctx.user)) {
    await renderEmployeeGuide(container, ctx);
    return;
  }

  const [settings, customers, projects, users] = await Promise.all([
    store.getSettings(),
    store.listCustomers(),
    store.listProjects({ selectableOnly: true }),
    store.listUsers(),
  ]);

  const steps = [
    {
      done: Boolean(settings.companyName),
      title: "Företag och arbetstid",
      text: "Företagsnamnet angav du när kontot skapades. Lägg gärna till organisationsnummer och kontrollera arbetstiden – förval är mån–fre 8 h.",
      href: "#/installningar/foretag",
      action: "Ändra",
      doneAction: "Ändra",
    },
    {
      done: customers.length > 0,
      title: "Lägg till din första kund",
      text: "All tid rapporteras på en kund och ett projekt. Kundnumret följer med i fakturaunderlaget.",
      href: "#/projekt/kunder/ny",
      doneHref: "#/projekt/kunder",
      action: "Lägg till kund",
      doneAction: "Visa kunder",
    },
    {
      done: projects.length > 0,
      title: "Lägg till ett projekt",
      text: "Koppla projektet till kunden. Medarbetarna väljer först kund och sedan projekt – bara pågående projekt går att välja.",
      href: "#/projekt/projekt/ny",
      doneHref: "#/projekt",
      action: "Lägg till projekt",
      doneAction: "Visa projekt",
    },
    {
      done: users.length > 1,
      title: "Lägg till din första medarbetare",
      text: "Du får ett engångslösenord att lämna över. Vid första inloggningen väljer medarbetaren ett eget lösenord.",
      href: "#/anstallda/ny",
      doneHref: "#/anstallda",
      action: "Lägg till medarbetare",
      doneAction: "Visa anställda",
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;
  const current = steps.findIndex((step) => !step.done);

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <div class="eyebrow">Hej, ${firstName(ctx.user.name)}</div>
          <h1 class="page-title">Kom igång</h1>
          <p class="page-lead">Så gör du Tidla redo för dina medarbetare. Stegen bockas av automatiskt.</p>
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

        ${allDone
          ? callout(
              html`<strong>Klart!</strong> Nu kan dina medarbetare logga in och börja rapportera tid.
                <a href="#/tid">Till tidrapporten</a>`,
              { iconName: "check" },
            )
          : ""}

        <ol class="guide">
          ${steps.map(
            (step, i) => html`<li class="guide__step${step.done ? " guide__step--done" : ""}${i === current ? " guide__step--current" : ""}">
              <span class="guide__marker" aria-hidden="true">${step.done ? icon("check", 18, 2.4) : i + 1}</span>
              <div class="guide__body">
                <h3 class="guide__title">
                  ${step.title}
                  <span class="visually-hidden">${step.done ? "(klart)" : "(inte klart)"}</span>
                </h3>
                <p class="guide__text">${step.text}</p>
              </div>
              <a class="btn ${i === current ? "btn--primary" : "btn--secondary"} btn--sm guide__action" href="${step.done ? step.doneHref ?? step.href : step.href}">
                ${step.done ? step.doneAction : step.action}${i === current ? icon("arrowRight", 16) : ""}
              </a>
            </li>`,
          )}
        </ol>

        <div class="guide__optional">
          <span class="guide__marker guide__marker--optional" aria-hidden="true">${icon("settings", 16)}</span>
          <div class="guide__body">
            <h3 class="guide__title">Valfritt: övertid, restid och frånvaro</h3>
            <p class="guide__text">
              Bestäm hur övertid och restid ska fungera och vilka frånvarotyper som ska finnas. Allt är förinställt, så du kan också vänta.
            </p>
          </div>
          <a class="btn btn--text btn--sm guide__action" href="#/installningar">Inställningar</a>
        </div>
        ${ratesNeedCheck(settings).due
          ? html`<div class="guide__optional guide__optional--todo">
              <span class="guide__marker guide__marker--todo" aria-hidden="true">${icon("car", 16)}</span>
              <div class="guide__body">
                <h3 class="guide__title">${ratesNeedCheck(settings).reason === "new-year"
                  ? `Nytt år – kontrollera milersättningen för ${ratesNeedCheck(settings).year}`
                  : "Fyll i milersättningen"}</h3>
                <p class="guide__text">Skatteverket ändrar beloppen per mil vid årsskiftet. Beloppen följer med i exporten som underlag.</p>
              </div>
              <a class="btn btn--secondary btn--sm guide__action" href="#/installningar/fordon">Kontrollera</a>
            </div>`
          : ""}
      </section>

      <div class="grid-2">
        <section class="card stack stack--m" aria-labelledby="gs-first-login">
          <h2 class="card__title" id="gs-first-login">Så loggar en medarbetare in första gången</h2>
          <ol class="numbered">
            <li>Du lägger till medarbetaren under <a href="#/anstallda">Anställda</a>.</li>
            <li>Ett engångslösenord visas en gång – skriv ned det eller skicka det på ett säkert sätt.</li>
            <li>Medarbetaren loggar in med sin e-post och engångslösenordet.</li>
            <li>Tidla ber medarbetaren välja ett eget lösenord. Därefter står hen som Aktiv.</li>
          </ol>
          <p class="text-muted text-small">Glömt lösenord? Du kan återställa det under Anställda – då skapas ett nytt engångslösenord.</p>
        </section>

        <section class="card stack stack--m" aria-labelledby="gs-how">
          <h2 class="card__title" id="gs-how">Så fungerar Tidla</h2>
          <ul class="info-list">
            <li>${icon("clock", 18)}<span><strong>Medarbetarna rapporterar</strong> kund, projekt och timmar. Timmarna förifylls enligt arbetstiden. Frånvaro kräver inget projekt.</span></li>
            <li>${icon("review", 18)}<span><strong>Du granskar</strong> och godkänner eller nekar rader. Nekade rader kan rättas av medarbetaren.</span></li>
            <li>${icon("lock", 18)}<span><strong>Markera månaden som klar</strong> när allt är godkänt – då låses den.</span></li>
            <li>${icon("download", 18)}<span><strong>Fakturaunderlag</strong> exporteras som CSV som öppnas direkt i Excel.</span></li>
          </ul>
        </section>
      </div>

      ${callout(
        html`<strong>Ta säkerhetskopior.</strong> Tills vidare sparas allt i den här webbläsaren. Exportera en säkerhetskopia
          regelbundet under <a href="#/installningar">Inställningar</a> – om webbläsarens data rensas försvinner annars allt.`,
        { variant: "pink", iconName: "alert" },
      )}
    `,
  );
}
