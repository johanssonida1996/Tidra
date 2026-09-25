// Kunder & projekt.
// Admin: flikar för projekt och kunder, sök/filter, lägga till, redigera, avsluta, arkivera och ta bort.
// Medarbetare: läsvy över projekten med sök.
// Adresser: #/projekt, #/projekt/kunder, #/projekt/projekt/ny, #/projekt/kunder/ny (öppnar formuläret direkt).
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { plural } from "../lib/format.js";
import {
  field, input, select, statusPill, emptyState, openDialog, confirmDialog, notify, callout,
} from "../lib/ui.js";
import { isAdmin } from "../auth.js";

const sv = (a, b) => String(a).localeCompare(String(b), "sv", { numeric: true, sensitivity: "base" });

export async function render(container, ctx) {
  const admin = isAdmin(ctx.user);
  const [tab = "projekt", action] = ctx.params;
  const state = {
    tab: admin && tab === "kunder" ? "kunder" : "projekt",
    q: "",
    customerId: "",
    status: "open",
    archived: false,
    customers: [],
    projects: [],
  };

  async function load() {
    [state.customers, state.projects] = await Promise.all([
      store.listCustomers({ includeArchived: admin }),
      store.listProjects({ includeArchived: admin }),
    ]);
  }
  await load();

  const customerById = (id) => state.customers.find((c) => c.id === id);

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">${admin ? "Kunder & projekt" : "Projekt"}</h1>
          <p class="page-lead">
            ${admin
              ? "En kund kan ha flera projekt. Medarbetarna väljer först kund och sedan projekt."
              : "Projekten du kan rapportera tid på."}
          </p>
        </div>
        ${admin
          ? html`<div class="cluster page-head__actions">
              <button type="button" class="btn btn--secondary" data-new-customer>${icon("plus")}Ny kund</button>
              <button type="button" class="btn btn--primary" data-new-project>${icon("plus")}Nytt projekt</button>
            </div>`
          : ""}
      </div>
      ${admin
        ? html`<div class="segmented" role="group" aria-label="Visa">
            <button type="button" class="segmented__btn" data-tab="projekt">Projekt</button>
            <button type="button" class="segmented__btn" data-tab="kunder">Kunder</button>
          </div>`
        : ""}
      <div class="stack" data-tab-content></div>
    `,
  );

  const content = container.querySelector("[data-tab-content]");

  /* ---------- Flikar ---------- */

  function renderTab() {
    container.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
    const customersTab = state.tab === "kunder";
    setHTML(
      content,
      html`
        <div class="toolbar">
          ${field({
            id: "pr-search",
            label: "Sök",
            control: input({
              id: "pr-search",
              type: "search",
              iconName: "search",
              value: state.q,
              placeholder: customersTab ? "Namn, kundnummer eller org.nr" : "Nummer, namn, kund eller adress",
              autocomplete: "off",
            }),
          })}
          ${!customersTab
            ? html`
                ${field({
                  id: "pr-customer",
                  label: "Kund",
                  control: select({
                    id: "pr-customer",
                    value: state.customerId,
                    placeholder: "Alla kunder",
                    options: state.customers
                      .filter((c) => !c.archived || state.archived)
                      .map((c) => ({ value: c.id, label: c.name })),
                  }),
                })}
                ${field({
                  id: "pr-status",
                  label: "Status",
                  control: select({
                    id: "pr-status",
                    value: state.status,
                    options: [
                      { value: "open", label: "Pågående" },
                      { value: "closed", label: "Avslutade" },
                      { value: "all", label: "Alla" },
                    ],
                  }),
                })}`
            : ""}
          ${admin
            ? html`<label class="check toolbar__check"><input type="checkbox" id="pr-archived" ${state.archived ? raw("checked") : ""} /> Visa arkiverade</label>`
            : ""}
        </div>
        <p class="text-muted text-small" data-count aria-live="polite"></p>
        <div data-list></div>
      `,
    );

    content.querySelector("#pr-search").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderList();
    });
    content.querySelector("#pr-customer")?.addEventListener("change", (e) => {
      state.customerId = e.target.value;
      renderList();
    });
    content.querySelector("#pr-status")?.addEventListener("change", (e) => {
      state.status = e.target.value;
      renderList();
    });
    content.querySelector("#pr-archived")?.addEventListener("change", (e) => {
      state.archived = e.target.checked;
      renderTab();
      content.querySelector("#pr-archived").focus();
    });
    renderList();
  }

  function renderList() {
    const list = content.querySelector("[data-list]");
    const count = content.querySelector("[data-count]");
    const query = state.q.trim().toLowerCase();

    if (state.tab === "kunder") {
      const rows = state.customers
        .filter((c) => state.archived || !c.archived)
        .filter((c) => !query || `${c.name} ${c.customerNo} ${c.orgNumber}`.toLowerCase().includes(query));
      count.textContent = plural(rows.length, "kund", "kunder");
      if (!state.customers.length) {
        setHTML(list, emptyState({
          iconName: "building",
          title: "Lägg till din första kund",
          text: "All tid rapporteras på en kund och ett projekt.",
          action: html`<button type="button" class="btn btn--primary" data-new-customer>${icon("plus")}Ny kund</button>`,
        }));
        return;
      }
      setHTML(list, rows.length ? html`<ul class="list">${rows.map(customerRow)}</ul>` : noMatches());
      return;
    }

    const rows = state.projects
      .filter((p) => state.archived || (!p.archived && !customerById(p.customerId)?.archived))
      .filter((p) => !state.customerId || p.customerId === state.customerId)
      .filter((p) => state.status === "all" || p.status === state.status)
      .filter((p) => {
        if (!query) return true;
        const c = customerById(p.customerId);
        return `${p.projectNo} ${p.name} ${p.address} ${c?.name ?? ""} ${c?.customerNo ?? ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => sv(a.projectNo, b.projectNo));
    count.textContent = plural(rows.length, "projekt", "projekt");

    if (!state.projects.length) {
      setHTML(list, admin
        ? emptyState({
            iconName: "folder",
            title: state.customers.length ? "Lägg till ditt första projekt" : "Börja med en kund",
            text: state.customers.length
              ? "Koppla projektet till en kund. Då kan medarbetarna rapportera tid på det."
              : "Projekt kopplas alltid till en kund. Lägg till kunden först.",
            action: state.customers.length
              ? html`<button type="button" class="btn btn--primary" data-new-project>${icon("plus")}Nytt projekt</button>`
              : html`<button type="button" class="btn btn--primary" data-new-customer>${icon("plus")}Ny kund</button>`,
          })
        : emptyState({ iconName: "folder", title: "Inga projekt ännu", text: "Din administratör lägger till kunder och projekt." }));
      return;
    }
    setHTML(list, rows.length ? html`<ul class="list">${rows.map(projectRow)}</ul>` : noMatches());
  }

  function noMatches() {
    return emptyState({ iconName: "search", title: "Inget matchar", text: "Ändra sökningen eller filtren." });
  }

  function projectRow(p) {
    const c = customerById(p.customerId);
    const meta = [c ? `${c.name} (kundnr ${c.customerNo})` : "Okänd kund", p.address].filter(Boolean).join(" · ");
    return html`<li class="row row--wrap">
      <span class="row__icon">${icon("folder", 20)}</span>
      <span class="row__body">
        <span class="row__title">${p.projectNo} · ${p.name}</span>
        <span class="row__meta">${meta}</span>
      </span>
      <span class="row__aside">
        ${p.archived || c?.archived ? statusPill("archived") : statusPill(p.status)}
      </span>
      ${admin
        ? html`<span class="row__actions row__actions--end">
            <button type="button" class="btn btn--secondary btn--sm" data-edit-project="${p.id}"
              aria-label="Redigera ${p.projectNo} ${p.name}">${icon("edit", 16)}Redigera</button>
          </span>`
        : ""}
    </li>`;
  }

  function customerRow(c) {
    const count = state.projects.filter((p) => p.customerId === c.id && !p.archived).length;
    const meta = [`Kundnr ${c.customerNo}`, c.orgNumber && `Org.nr ${c.orgNumber}`].filter(Boolean).join(" · ");
    return html`<li class="row row--wrap">
      <span class="row__icon">${icon("building", 20)}</span>
      <span class="row__body">
        <span class="row__title">${c.name}</span>
        <span class="row__meta">${meta}</span>
      </span>
      <span class="row__aside">
        ${c.archived ? statusPill("archived") : html`<span class="text-muted text-small">${plural(count, "projekt", "projekt")}</span>`}
      </span>
      <span class="row__actions row__actions--end">
        <button type="button" class="btn btn--secondary btn--sm" data-edit-customer="${c.id}"
          aria-label="Redigera ${c.name}">${icon("edit", 16)}Redigera</button>
      </span>
    </li>`;
  }

  /* ---------- Dialoger ---------- */

  async function refresh() {
    await load();
    renderTab();
  }

  async function customerDialog(customer = null) {
    const c = customer ?? {};
    const actions = html`
      ${customer
        ? html`<button type="submit" class="btn btn--text dialog__extra" value="archive" formnovalidate>
              ${icon("archive", 16)}${c.archived ? "Återställ" : "Arkivera"}
            </button>
            <button type="submit" class="btn btn--text btn--text-danger" value="delete" formnovalidate>${icon("trash", 16)}Ta bort</button>`
        : ""}
      <button type="button" class="btn btn--secondary" data-close>Avbryt</button>
      <button type="submit" class="btn btn--primary" value="save">${customer ? "Spara" : "Lägg till kund"}</button>
    `;
    const body = html`
      ${customer?.archived ? callout("Kunden är arkiverad. Den och dess projekt syns inte för medarbetarna.", { iconName: "archive" }) : ""}
      <div class="grid-2">
        ${field({ id: "cu-no", label: "Kundnummer", control: input({ id: "cu-no", name: "customerNo", value: c.customerNo, required: true, autocomplete: "off" }) })}
        ${field({ id: "cu-name", label: "Namn", control: input({ id: "cu-name", name: "name", value: c.name, required: true, autocomplete: "off" }) })}
        ${field({
          id: "cu-org",
          label: "Organisationsnummer",
          optional: true,
          className: "span-all",
          help: "10 siffror, t.ex. 556677-8899.",
          control: input({ id: "cu-org", name: "orgNumber", value: c.orgNumber, inputmode: "numeric", autocomplete: "off", help: true }),
        })}
      </div>
    `;

    await openDialog({
      title: customer ? `Redigera ${c.name}` : "Ny kund",
      wide: true,
      body,
      actions,
      onSubmit: async ({ form, action }) => {
        if (action === "archive") {
          await store.setCustomerArchived(c.id, !c.archived);
          notify(c.archived ? "Kunden är återställd" : "Kunden är arkiverad");
          return "done";
        }
        if (action === "delete") {
          const ok = await confirmDialog({
            title: `Ta bort ${c.name}?`,
            message: "Kunden tas bort permanent. Kunder med projekt kan inte tas bort – arkivera dem i stället.",
            confirmLabel: "Ta bort",
            danger: true,
          });
          if (!ok) return false;
          await store.deleteCustomer(c.id);
          notify("Kunden är borttagen");
          return "done";
        }
        const data = Object.fromEntries(new FormData(form));
        await store.saveCustomer({ ...data, id: c.id });
        notify(customer ? "Kunden är sparad" : "Kunden är tillagd");
        return "done";
      },
    }).then(async (result) => {
      if (result === "done") await refresh();
    });
  }

  async function projectDialog(project = null) {
    const p = project ?? { status: "open", customerId: state.customerId };
    const choosable = state.customers.filter((c) => !c.archived || c.id === p.customerId);
    if (!choosable.length) {
      await openDialog({
        title: "Lägg till en kund först",
        body: html`<p>Projekt kopplas alltid till en kund. Lägg till kunden först, sedan projektet.</p>`,
        actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
          <button type="submit" class="btn btn--primary" value="customer">Ny kund</button>`,
      }).then((result) => result === "customer" && customerDialog());
      return;
    }

    const actions = html`
      ${project
        ? html`<button type="submit" class="btn btn--text dialog__extra" value="archive" formnovalidate>
              ${icon("archive", 16)}${p.archived ? "Återställ" : "Arkivera"}
            </button>
            <button type="submit" class="btn btn--text btn--text-danger" value="delete" formnovalidate>${icon("trash", 16)}Ta bort</button>`
        : ""}
      <button type="button" class="btn btn--secondary" data-close>Avbryt</button>
      <button type="submit" class="btn btn--primary" value="save">${project ? "Spara" : "Lägg till projekt"}</button>
    `;
    const body = html`
      ${p.archived ? callout("Projektet är arkiverat och syns inte för medarbetarna.", { iconName: "archive" }) : ""}
      <div class="grid-2">
        ${field({
          id: "pj-customer",
          label: "Kund",
          className: "span-all",
          help: project ? "Byter du kund följer projektets tidigare registreringar med till den nya kunden." : "",
          control: select({
            id: "pj-customer",
            name: "customerId",
            value: p.customerId,
            placeholder: "Välj kund…",
            required: true,
            help: Boolean(project),
            options: choosable.map((c) => ({ value: c.id, label: `${c.name} (kundnr ${c.customerNo})` })),
          }),
        })}
        ${field({ id: "pj-projectno", label: "Projektnummer", control: input({ id: "pj-projectno", name: "projectNo", value: p.projectNo, placeholder: "t.ex. 26015", required: true, autocomplete: "off" }) })}
        ${field({ id: "pj-name", label: "Projektnamn", control: input({ id: "pj-name", name: "name", value: p.name, required: true, autocomplete: "off" }) })}
        ${field({ id: "pj-address", label: "Projektadress", optional: true, control: input({ id: "pj-address", name: "address", value: p.address, autocomplete: "off" }) })}
        ${field({
          id: "pj-status",
          label: "Status",
          help: "Avslutade projekt går inte att välja i tidrapporten.",
          control: select({
            id: "pj-status",
            name: "status",
            value: p.status,
            help: true,
            options: [
              { value: "open", label: "Pågående" },
              { value: "closed", label: "Avslutat" },
            ],
          }),
        })}
      </div>
    `;

    await openDialog({
      title: project ? `Redigera ${p.projectNo} · ${p.name}` : "Nytt projekt",
      wide: true,
      body,
      actions,
      onSubmit: async ({ form, action }) => {
        if (action === "archive") {
          await store.setProjectArchived(p.id, !p.archived);
          notify(p.archived ? "Projektet är återställt" : "Projektet är arkiverat");
          return "done";
        }
        if (action === "delete") {
          const ok = await confirmDialog({
            title: `Ta bort ${p.projectNo} · ${p.name}?`,
            message: "Projektet tas bort permanent. Projekt med registreringar kan inte tas bort – avsluta eller arkivera dem i stället.",
            confirmLabel: "Ta bort",
            danger: true,
          });
          if (!ok) return false;
          await store.deleteProject(p.id);
          notify("Projektet är borttaget");
          return "done";
        }
        const data = Object.fromEntries(new FormData(form));
        await store.saveProject({ ...data, id: p.id });
        notify(project ? "Projektet är sparat" : "Projektet är tillagt");
        return "done";
      },
    }).then(async (result) => {
      if (result === "done") await refresh();
    });
  }

  /* ---------- Händelser ---------- */

  container.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton && tabButton.dataset.tab !== state.tab) {
      state.tab = tabButton.dataset.tab;
      state.q = "";
      history.replaceState(null, "", state.tab === "kunder" ? "#/projekt/kunder" : "#/projekt");
      renderTab();
      return;
    }
    if (!admin) return;
    if (event.target.closest("[data-new-customer]")) customerDialog();
    if (event.target.closest("[data-new-project]")) projectDialog();
    const editCustomer = event.target.closest("[data-edit-customer]");
    if (editCustomer) customerDialog(customerById(editCustomer.dataset.editCustomer));
    const editProject = event.target.closest("[data-edit-project]");
    if (editProject) projectDialog(state.projects.find((p) => p.id === editProject.dataset.editProject));
  });

  renderTab();

  // Länkar från Kom igång: öppna formuläret direkt och städa adressen
  if (admin && action === "ny") {
    history.replaceState(null, "", state.tab === "kunder" ? "#/projekt/kunder" : "#/projekt");
    if (state.tab === "kunder") customerDialog();
    else projectDialog();
  }
}
