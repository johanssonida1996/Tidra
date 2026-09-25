// Anställda (bara admin): lägga till, redigera, inaktivera, återställa lösenord och ta bort.
// Nya anställda får ett engångslösenord som visas en gång. #/anstallda/ny öppnar formuläret direkt.
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { WEEKDAYS, WEEKDAY_LABELS } from "../lib/dates.js";
import { plural, parseHours, formatHours, formatHoursUnit } from "../lib/format.js";
import {
  field, input, select, statusPill, pill, avatar, emptyState, openDialog, confirmDialog, notify, callout,
} from "../lib/ui.js";
import { ROLES } from "../auth.js";
import { ADMIN } from "../routes.js";
import { allowed } from "./guard.js";

const STATUS_FILTERS = [
  { value: "current", label: "Aktiva och väntande" },
  { value: "active", label: "Aktiva" },
  { value: "pending", label: "Väntar på aktivering" },
  { value: "inactive", label: "Inaktiva" },
  { value: "all", label: "Alla" },
];

export async function render(container, ctx) {
  if (!allowed(ctx, ADMIN, container)) return;

  const state = { q: "", status: "current", users: [], settings: await store.getSettings() };
  const load = async () => (state.users = await store.listUsers());
  await load();

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">Anställda</h1>
          <p class="page-lead">Nya anställda får ett engångslösenord och väljer ett eget vid första inloggningen.</p>
        </div>
        <div class="cluster page-head__actions">
          <button type="button" class="btn btn--primary" data-new-user>${icon("plus")}Ny anställd</button>
        </div>
      </div>
      <div class="toolbar">
        ${field({
          id: "st-search",
          label: "Sök",
          control: input({ id: "st-search", type: "search", iconName: "search", placeholder: "Namn, anställningsnummer eller e-post", autocomplete: "off" }),
        })}
        ${field({
          id: "st-status",
          label: "Status",
          control: select({ id: "st-status", value: state.status, options: STATUS_FILTERS }),
        })}
      </div>
      <p class="text-muted text-small" data-count aria-live="polite"></p>
      <div data-list></div>
    `,
  );

  const list = container.querySelector("[data-list]");
  const count = container.querySelector("[data-count]");

  function renderList() {
    const query = state.q.trim().toLowerCase();
    const rows = state.users
      .filter((u) => {
        if (state.status === "current") return u.status !== "inactive";
        return state.status === "all" || u.status === state.status;
      })
      .filter((u) => !query || `${u.name} ${u.employeeNo} ${u.email} ${u.title}`.toLowerCase().includes(query));
    count.textContent = plural(rows.length, "anställd", "anställda");

    if (state.users.length === 1) {
      setHTML(
        list,
        html`<ul class="list">${rows.map(userRow)}</ul>
          ${emptyState({
            iconName: "users",
            title: "Lägg till din första medarbetare",
            text: "Du får ett engångslösenord att lämna över. Vid första inloggningen väljer medarbetaren ett eget lösenord.",
            action: html`<button type="button" class="btn btn--primary" data-new-user>${icon("plus")}Ny anställd</button>`,
          })}`,
      );
      return;
    }
    setHTML(
      list,
      rows.length
        ? html`<ul class="list">${rows.map(userRow)}</ul>`
        : emptyState({ iconName: "search", title: "Inget matchar", text: "Ändra sökningen eller filtret." }),
    );
  }

  function userRow(u) {
    const me = u.id === ctx.user.id;
    const meta = [`Anst.nr ${u.employeeNo}`, u.title, u.email].filter(Boolean).join(" · ");
    return html`<li class="row row--wrap${u.status === "inactive" ? " row--muted" : ""}">
      ${avatar(u.name)}
      <span class="row__body">
        <span class="row__title">${u.name}${me ? html` <span class="text-muted">(du)</span>` : ""}</span>
        <span class="row__meta">${meta}</span>
      </span>
      <span class="row__aside">
        ${u.role === "admin" ? pill("Admin", "draft", "key") : ""}
        ${statusPill(u.status)}
      </span>
      <span class="row__actions">
        <button type="button" class="btn btn--secondary btn--sm" data-edit-user="${u.id}"
          aria-label="Redigera ${u.name}">${icon("edit", 16)}Redigera</button>
      </span>
    </li>`;
  }

  async function refresh() {
    await load();
    renderList();
  }

  /* ---------- Engångslösenord ---------- */

  async function showOneTimePassword(user, password, { reset = false } = {}) {
    await openDialog({
      title: reset ? `Nytt engångslösenord för ${user.name}` : `${user.name} är tillagd`,
      body: html`
        <p>
          Lämna över engångslösenordet till ${user.name} tillsammans med e-postadressen
          <strong>${user.email}</strong>. Vid första inloggningen väljer ${user.name.split(" ")[0]} ett eget lösenord.
        </p>
        <div class="secret" aria-label="Engångslösenord">${password}</div>
        ${callout("Lösenordet visas bara nu. Skriv ned det eller kopiera det innan du stänger.", { variant: "pink", iconName: "alert" })}
      `,
      actions: html`
        <button type="button" class="btn btn--secondary" data-copy>${icon("copy", 16)}Kopiera</button>
        <button type="submit" class="btn btn--primary" value="done">Klart</button>
      `,
      initialFocus: "[data-copy]",
      onOpen: ({ dialog }) => {
        dialog.querySelector("[data-copy]").addEventListener("click", async (event) => {
          try {
            await navigator.clipboard.writeText(password);
            notify("Engångslösenordet är kopierat");
          } catch {
            // Utan urklipp: markera texten så att den kan kopieras med Ctrl+C
            const range = document.createRange();
            range.selectNodeContents(dialog.querySelector(".secret"));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            notify("Markerat – kopiera med Ctrl+C");
          }
          event.currentTarget.focus();
        });
      },
    });
  }

  /* ---------- Lägg till / redigera ---------- */

  function scheduleFields(schedule) {
    const week = schedule ?? state.settings.workWeek;
    return html`<div class="week-grid">
      ${WEEKDAYS.map(
        (day) => html`<div class="field">
          <label class="field__label" for="us-${day}"><span aria-hidden="true">${WEEKDAY_LABELS[day].slice(0, 3)}</span><span class="visually-hidden">${WEEKDAY_LABELS[day]}</span></label>
          <input class="input" id="us-${day}" name="schedule.${day}" inputmode="decimal" autocomplete="off" value="${formatHours(week[day])}" />
        </div>`,
      )}
    </div>`;
  }

  async function userDialog(user = null) {
    const u = user ?? { role: "employee" };
    const me = user?.id === ctx.user.id;
    const companyWeek = WEEKDAYS.reduce((sum, d) => sum + state.settings.workWeek[d], 0);

    const actions = html`
      ${user && !me
        ? html`<button type="submit" class="btn btn--text dialog__extra" value="reset" formnovalidate>${icon("key", 16)}Återställ lösenord</button>
            <button type="submit" class="btn btn--text" value="status" formnovalidate>
              ${u.status === "inactive" ? html`${icon("check", 16)}Aktivera igen` : html`${icon("minus", 16)}Inaktivera`}
            </button>
            <button type="submit" class="btn btn--text btn--text-danger" value="delete" formnovalidate>${icon("trash", 16)}Ta bort</button>`
        : ""}
      <button type="button" class="btn btn--secondary" data-close>Avbryt</button>
      <button type="submit" class="btn btn--primary" value="save">${user ? "Spara" : "Lägg till och visa lösenord"}</button>
    `;

    const body = html`
      ${u.status === "inactive" ? callout(`${u.name} är inaktiverad och kan inte logga in.`, { iconName: "minus" }) : ""}
      ${u.status === "pending" ? callout(`${u.name} har inte loggat in än. Tappat bort engångslösenordet? Återställ lösenordet för att få ett nytt.`, { iconName: "clock" }) : ""}
      <div class="grid-2">
        ${field({ id: "us-name", label: "Namn", control: input({ id: "us-name", name: "name", value: u.name, autocomplete: "off", required: true }) })}
        ${field({ id: "us-no", label: "Anställningsnummer", control: input({ id: "us-no", name: "employeeNo", value: u.employeeNo, autocomplete: "off", required: true }) })}
        ${field({ id: "us-email", label: "E-post", help: "Används för att logga in.", control: input({ id: "us-email", name: "email", type: "email", value: u.email, autocomplete: "off", required: true, help: true }) })}
        ${field({ id: "us-phone", label: "Telefon", optional: true, control: input({ id: "us-phone", name: "phone", type: "tel", value: u.phone, autocomplete: "off" }) })}
        ${field({ id: "us-title", label: "Befattning", optional: true, control: input({ id: "us-title", name: "title", value: u.title, placeholder: "t.ex. Snickare", autocomplete: "off" }) })}
        ${field({
          id: "us-role",
          label: "Roll",
          help: "Administratörer kan även hantera kunder, anställda och granskning.",
          control: select({
            id: "us-role",
            name: "role",
            value: u.role,
            help: true,
            disabled: me,
            options: [
              { value: "employee", label: ROLES.employee },
              { value: "admin", label: ROLES.admin },
            ],
          }),
        })}
      </div>
      <fieldset class="fieldset stack stack--m">
        <legend class="field__label">Arbetstid</legend>
        <label class="check">
          <input type="checkbox" name="ownSchedule" ${u.schedule ? raw("checked") : ""} />
          Eget arbetsschema
        </label>
        <p class="text-help" data-company-schedule ${u.schedule ? raw("hidden") : ""}>
          Följer företagets arbetstid: ${formatHoursUnit(companyWeek)} per vecka.
        </p>
        <div data-schedule ${u.schedule ? "" : raw("hidden")}>${scheduleFields(u.schedule)}</div>
      </fieldset>
    `;

    await openDialog({
      title: user ? `Redigera ${u.name}` : "Ny anställd",
      wide: true,
      body,
      actions,
      onOpen: ({ form }) => {
        const toggle = form.elements.ownSchedule;
        toggle.addEventListener("change", () => {
          form.querySelector("[data-schedule]").hidden = !toggle.checked;
          form.querySelector("[data-company-schedule]").hidden = toggle.checked;
        });
      },
      onSubmit: async ({ form, action }) => {
        if (action === "reset") {
          const ok = await confirmDialog({
            title: `Återställa lösenordet för ${u.name}?`,
            message: "Det nuvarande lösenordet slutar fungera. Du får ett nytt engångslösenord att lämna över.",
            confirmLabel: "Återställ",
          });
          if (!ok) return false;
          const { oneTimePassword } = await store.resetPassword(u.id);
          return { reset: oneTimePassword };
        }
        if (action === "status") {
          const inactivate = u.status !== "inactive";
          if (inactivate) {
            const ok = await confirmDialog({
              title: `Inaktivera ${u.name}?`,
              message: "Hen kan inte logga in längre. Registreringarna finns kvar och du kan aktivera kontot igen.",
              confirmLabel: "Inaktivera",
              danger: true,
            });
            if (!ok) return false;
          }
          await store.setUserStatus(u.id, inactivate ? "inactive" : "active");
          notify(inactivate ? `${u.name} är inaktiverad` : `${u.name} är aktiverad igen`);
          return "done";
        }
        if (action === "delete") {
          const ok = await confirmDialog({
            title: `Ta bort ${u.name}?`,
            message: "Kontot tas bort permanent. Anställda med registreringar kan inte tas bort – inaktivera dem i stället.",
            confirmLabel: "Ta bort",
            danger: true,
          });
          if (!ok) return false;
          await store.deleteUser(u.id);
          notify(`${u.name} är borttagen`);
          return "done";
        }

        const data = Object.fromEntries(new FormData(form));
        let schedule = null;
        if (form.elements.ownSchedule.checked) {
          schedule = {};
          const errors = {};
          for (const day of WEEKDAYS) {
            const hours = parseHours(data[`schedule.${day}`]);
            if (hours === null || hours > 24) errors[`schedule.${day}`] = "Ange 0–24 timmar.";
            else schedule[day] = hours;
          }
          if (Object.keys(errors).length) {
            throw Object.assign(new Error("Kontrollera arbetstiden."), { fields: errors });
          }
        }
        const result = await store.saveUser({
          id: u.id,
          name: data.name,
          employeeNo: data.employeeNo,
          email: data.email,
          phone: data.phone,
          title: data.title,
          role: me ? u.role : data.role,
          schedule,
        });
        if (result.oneTimePassword) return { created: result.user, password: result.oneTimePassword };
        notify(`${result.user.name} är sparad`);
        return "done";
      },
    }).then(async (result) => {
      if (!result) return;
      await refresh();
      if (result.created) await showOneTimePassword(result.created, result.password);
      if (result.reset) await showOneTimePassword(u, result.reset, { reset: true });
    });
  }

  /* ---------- Händelser ---------- */

  container.querySelector("#st-search").addEventListener("input", (e) => {
    state.q = e.target.value;
    renderList();
  });
  container.querySelector("#st-status").addEventListener("change", (e) => {
    state.status = e.target.value;
    renderList();
  });
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-new-user]")) userDialog();
    const edit = event.target.closest("[data-edit-user]");
    if (edit) userDialog(state.users.find((u) => u.id === edit.dataset.editUser));
  });

  renderList();

  if (ctx.params[0] === "ny") {
    history.replaceState(null, "", "#/anstallda");
    userDialog();
  }
}
