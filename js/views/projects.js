// Kunder & projekt.
// Admin: flikar för projekt och kunder, sök/filter, lägga till, redigera, avsluta, arkivera och ta bort.
// Medarbetare: läsvy över projekten med sök. Projekten fälls ut och visar adress, kontakt, beskrivning och dokument.
// Använder företaget inte projekt (Inställningar) visas bara kunderna – för admin och medarbetare.
// Adresser: #/projekt, #/projekt/kunder, #/projekt/projekt/ny, #/projekt/kunder/ny (öppnar formuläret direkt),
// #/projekt/projekt/<id> (fäller ut projektet – länken från Tidrapporten).
import * as store from "../store.js";
import { html, setHTML, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { plural, nextNumber } from "../lib/format.js";
import {
  field, input, select, textarea, statusPill, emptyState, openDialog, confirmDialog, notify, callout,
} from "../lib/ui.js";
import { isAdmin } from "../auth.js";
import { projectsOn, mapUrl, telUrl } from "../lib/place.js";

const sv = (a, b) => String(a).localeCompare(String(b), "sv", { numeric: true, sensitivity: "base" });

// 1 234 567 byte → "1,2 MB"
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;
}

export async function render(container, ctx) {
  const admin = isAdmin(ctx.user);
  const withProjects = projectsOn(ctx.settings);
  const [tab = "projekt", action] = ctx.params;
  const state = {
    tab: !withProjects || (admin && tab === "kunder") ? "kunder" : "projekt",
    q: "",
    customerId: "",
    status: "open",
    archived: false,
    customers: [],
    projects: [],
    open: new Set(),
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
          <h1 class="page-title">${!withProjects ? "Kunder" : admin ? "Kunder & projekt" : "Projekt"}</h1>
          <p class="page-lead">
            ${!withProjects
              ? admin
                ? "Medarbetarna rapporterar tiden direkt på kunderna. Projekt kan slås på under Inställningar."
                : "Kunderna du kan rapportera tid på."
              : admin
                ? "En kund kan ha flera projekt. Medarbetarna väljer först kund och sedan projekt."
                : "Projekten du kan rapportera tid på. Tryck på ett projekt för adress, kontakt och dokument."}
          </p>
        </div>
        ${admin
          ? html`<div class="cluster page-head__actions">
              <button type="button" class="btn ${withProjects ? "btn--secondary" : "btn--primary"}" data-new-customer>${icon("plus")}Ny kund</button>
              ${withProjects ? html`<button type="button" class="btn btn--primary" data-new-project>${icon("plus")}Nytt projekt</button>` : ""}
            </div>`
          : ""}
      </div>
      ${admin && withProjects
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
              placeholder: customersTab ? "Namn, kundnummer eller org.nr" : "Sök projekt",
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
          title: admin ? "Lägg till din första kund" : "Inga kunder ännu",
          text: withProjects ? "All tid rapporteras på en kund och ett projekt." : "All tid rapporteras på en kund.",
          action: admin ? html`<button type="button" class="btn btn--primary" data-new-customer>${icon("plus")}Ny kund</button>` : "",
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
        return `${p.projectNo} ${p.name} ${p.address} ${p.contactName ?? ""} ${c?.name ?? ""} ${c?.customerNo ?? ""}`.toLowerCase().includes(query);
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

  // Raden fälls ut och visar adress, kontakt, beskrivning och dokument
  function projectRow(p) {
    const c = customerById(p.customerId);
    const meta = [c ? `${c.name} (kundnr ${c.customerNo})` : "Okänd kund", p.address].filter(Boolean).join(" · ");
    const open = state.open.has(p.id);
    return html`<li class="project${open ? " project--open" : ""}" data-project="${p.id}">
      <div class="project__head">
        <button type="button" class="project__toggle" data-toggle-project="${p.id}" aria-expanded="${String(open)}" aria-controls="pr-detail-${p.id}">
          <span class="row__icon">${icon("folder", 20)}</span>
          <span class="row__body">
            <span class="row__title">${p.projectNo} · ${p.name}</span>
            <span class="row__meta">${meta}</span>
          </span>
          <span class="project__status">${p.archived || c?.archived ? statusPill("archived") : statusPill(p.status)}</span>
          <span class="trip__chevron">${icon("chevronDown", 20)}</span>
        </button>
        ${admin
          ? html`<span class="project__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-edit-project="${p.id}"
                aria-label="Redigera ${p.projectNo} ${p.name}">${icon("edit", 16)}Redigera</button>
            </span>`
          : ""}
      </div>
      <div class="project__body" id="pr-detail-${p.id}" ${open ? "" : raw("hidden")}>${projectDetails(p)}</div>
    </li>`;
  }

  function projectDetails(p) {
    const hasFacts = p.address || p.contactName || p.contactPhone || p.contactEmail;
    const documents = p.documents ?? [];
    return html`
      ${hasFacts
        ? html`<dl class="kv">
            ${p.address
              ? html`<dt>Adress</dt><dd><a href="${mapUrl(p.address)}" target="_blank" rel="noopener">${p.address}</a></dd>`
              : ""}
            ${p.contactName ? html`<dt>Kontaktperson</dt><dd>${p.contactName}</dd>` : ""}
            ${p.contactPhone ? html`<dt>Telefon</dt><dd><a href="${telUrl(p.contactPhone)}">${p.contactPhone}</a></dd>` : ""}
            ${p.contactEmail ? html`<dt>E-post</dt><dd><a href="mailto:${p.contactEmail}">${p.contactEmail}</a></dd>` : ""}
          </dl>`
        : ""}
      ${p.description
        ? html`<div class="project__section">
            <h3 class="project__heading">Beskrivning</h3>
            <p class="project__description">${p.description}</p>
          </div>`
        : ""}
      <div class="project__section">
        <h3 class="project__heading">Dokument</h3>
        ${documents.length
          ? html`<ul class="doc-list">
              ${documents.map((d) => html`<li class="doc">
                <button type="button" class="doc__open" data-open-doc="${d.id}" data-project-id="${p.id}">
                  ${icon("file", 18)}
                  <span class="doc__name">${d.name}</span>
                  <span class="doc__size">${formatSize(d.size)}</span>
                </button>
                ${admin
                  ? html`<button type="button" class="icon-btn icon-btn--ghost" data-delete-doc="${d.id}" data-project-id="${p.id}"
                      aria-label="Ta bort ${d.name}">${icon("trash", 16)}</button>`
                  : ""}
              </li>`)}
            </ul>`
          : html`<p class="text-muted text-small">
              ${admin ? "Lägg in ritningar, arbetsordrar och andra dokument som medarbetarna behöver." : "Inga dokument ännu."}
            </p>`}
        ${admin
          ? html`<div>
              <label class="btn btn--secondary btn--sm file-button">
                ${icon("upload", 16)}Lägg till dokument
                <input type="file" multiple data-add-docs="${p.id}" />
              </label>
            </div>`
          : ""}
      </div>
      ${!hasFacts && !p.description && admin
        ? html`<p class="text-help">Adress, kontaktperson och beskrivning fyller du i under Redigera.</p>`
        : ""}
    `;
  }

  // Ritar om ett projekt efter en ändring och behåller det utfällt
  function replaceProject(saved) {
    state.projects = state.projects.map((p) => (p.id === saved.id ? saved : p));
    const item = content.querySelector(`[data-project="${CSS.escape(saved.id)}"]`);
    if (!item) return;
    const body = item.querySelector(".project__body");
    setHTML(body, projectDetails(saved));
  }

  async function addDocuments(inputEl) {
    const projectId = inputEl.dataset.addDocs;
    const files = [...inputEl.files];
    inputEl.value = "";
    if (!files.length) return;
    try {
      replaceProject(await store.addProjectDocuments(projectId, files));
      notify(files.length === 1 ? "Dokumentet är tillagt" : `${files.length} dokument är tillagda`);
    } catch (error) {
      notify(error.message, { type: "error" });
    }
    content.querySelector(`[data-add-docs="${CSS.escape(projectId)}"]`)?.focus();
  }

  async function deleteDocument(projectId, documentId) {
    const doc = state.projects.find((p) => p.id === projectId)?.documents?.find((d) => d.id === documentId);
    if (!doc) return;
    const ok = await confirmDialog({
      title: `Ta bort ${doc.name}?`,
      message: "Dokumentet tas bort från projektet och kan inte längre öppnas av medarbetarna.",
      confirmLabel: "Ta bort",
      danger: true,
    });
    if (!ok) return;
    try {
      replaceProject(await store.deleteProjectDocument(projectId, documentId));
      notify("Dokumentet är borttaget");
    } catch (error) {
      notify(error.message, { type: "error" });
    }
    content.querySelector(`[data-add-docs="${CSS.escape(projectId)}"]`)?.focus();
  }

  // PDF och bilder öppnas i en ny flik, annat laddas ner. Fliken öppnas direkt vid klicket –
  // annars stoppas den av popup-spärren när filen hämtas.
  async function openDocument(projectId, documentId) {
    const doc = state.projects.find((p) => p.id === projectId)?.documents?.find((d) => d.id === documentId);
    const viewable = /^(image\/|application\/pdf$|text\/plain$)/.test(doc?.type ?? "");
    const tab = viewable ? window.open("", "_blank") : null;
    try {
      const { name, blob } = await store.getProjectDocument(projectId, documentId);
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      notify(error.message, { type: "error" });
    }
  }

  function toggleProject(button) {
    const id = button.dataset.toggleProject;
    const open = !state.open.has(id);
    if (open) state.open.add(id);
    else state.open.delete(id);
    button.setAttribute("aria-expanded", String(open));
    button.closest(".project").classList.toggle("project--open", open);
    content.querySelector(`#pr-detail-${CSS.escape(id)}`).hidden = !open;
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
        ${c.archived ? statusPill("archived") : withProjects ? html`<span class="text-muted text-small">${plural(count, "projekt", "projekt")}</span>` : ""}
      </span>
      ${admin
        ? html`<span class="row__actions row__actions--end">
            <button type="button" class="btn btn--secondary btn--sm" data-edit-customer="${c.id}"
              aria-label="Redigera ${c.name}">${icon("edit", 16)}Redigera</button>
          </span>`
        : ""}
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
      ${customer?.archived ? callout(withProjects ? "Kunden är arkiverad. Den och dess projekt syns inte för medarbetarna." : "Kunden är arkiverad och syns inte för medarbetarna.", { iconName: "archive" }) : ""}
      <div class="grid-2">
        ${field({ id: "cu-name", label: "Namn", control: input({ id: "cu-name", name: "name", value: c.name, required: true, autocomplete: "off" }) })}
        ${field({
          id: "cu-no",
          label: "Kundnummer",
          help: customer
            ? "Följer med i fakturaunderlaget."
            : "Förslag: nästa lediga nummer. Följer med i fakturaunderlaget – ändra till kundnumret i ert faktureringsprogram om ni har ett.",
          control: input({
            id: "cu-no", name: "customerNo", value: c.customerNo ?? nextNumber(state.customers.map((x) => x.customerNo)),
            required: true, autocomplete: "off", help: true,
          }),
        })}
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
            message: "Kunden tas bort permanent. Kunder med projekt eller registreringar kan inte tas bort – arkivera dem i stället.",
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
    const choosable = state.customers.filter((c) => !c.archived || c.id === project?.customerId);
    const onlyCustomer = choosable.length === 1 ? choosable[0].id : "";
    const p = project ?? { status: "open", customerId: state.customerId || onlyCustomer };
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
        ${field({ id: "pj-name", label: "Projektnamn", control: input({ id: "pj-name", name: "name", value: p.name, required: true, autocomplete: "off" }) })}
        ${field({
          id: "pj-projectno",
          label: "Projektnummer",
          help: project
            ? "Visas i tidrapporten och följer med i fakturaunderlaget."
            : "Förslag: nästa lediga nummer. Visas i tidrapporten och följer med i fakturaunderlaget.",
          control: input({
            id: "pj-projectno", name: "projectNo", value: p.projectNo ?? nextNumber(state.projects.map((x) => x.projectNo)),
            required: true, autocomplete: "off", help: true,
          }),
        })}
        ${field({
          id: "pj-address",
          label: "Projektadress",
          optional: true,
          help: "Medarbetarna kan öppna adressen i kartan.",
          control: input({ id: "pj-address", name: "address", value: p.address, autocomplete: "off", help: true }),
        })}
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
      <fieldset class="fieldset">
        <legend class="field__label">Kontakt på plats</legend>
        <div class="grid-2">
          ${field({
            id: "pj-contact",
            label: "Kontaktperson",
            optional: true,
            className: "span-all",
            control: input({ id: "pj-contact", name: "contactName", value: p.contactName, autocomplete: "off" }),
          })}
          ${field({
            id: "pj-phone",
            label: "Telefon",
            optional: true,
            control: input({ id: "pj-phone", name: "contactPhone", type: "tel", value: p.contactPhone, autocomplete: "off" }),
          })}
          ${field({
            id: "pj-email",
            label: "E-post",
            optional: true,
            control: input({ id: "pj-email", name: "contactEmail", type: "email", value: p.contactEmail, autocomplete: "off" }),
          })}
        </div>
      </fieldset>
      ${field({
        id: "pj-description",
        label: "Beskrivning",
        optional: true,
        help: "Syns för medarbetarna under Projekt, t.ex. portkod, var nyckeln finns eller vad som ska göras. Dokument lägger du till i projektlistan.",
        control: textarea({ id: "pj-description", name: "description", value: p.description, rows: 4, "aria-describedby": "pj-description-help" }),
      })}
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
        const saved = await store.saveProject({ ...data, id: p.id });
        if (!project) {
          // Filtren får inte dölja det nya projektet
          state.customerId = "";
          state.status = saved.status;
          state.q = "";
        }
        notify(project ? "Projektet är sparat" : "Projektet är tillagt");
        return project ? "done" : "added";
      },
    }).then(async (result) => {
      if (result === "added" && state.tab !== "projekt") {
        // Ett nytt projekt lades till från fliken Kunder – visa det i projektlistan
        state.tab = "projekt";
        history.replaceState(null, "", "#/projekt");
      }
      if (result === "done" || result === "added") await refresh();
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
    const toggle = event.target.closest("[data-toggle-project]");
    if (toggle) {
      toggleProject(toggle);
      return;
    }
    const openDoc = event.target.closest("[data-open-doc]");
    if (openDoc) {
      openDocument(openDoc.dataset.projectId, openDoc.dataset.openDoc);
      return;
    }
    if (!admin) return;
    const deleteDoc = event.target.closest("[data-delete-doc]");
    if (deleteDoc) deleteDocument(deleteDoc.dataset.projectId, deleteDoc.dataset.deleteDoc);
    if (event.target.closest("[data-new-customer]")) customerDialog();
    if (event.target.closest("[data-new-project]")) projectDialog();
    const editCustomer = event.target.closest("[data-edit-customer]");
    if (editCustomer) customerDialog(customerById(editCustomer.dataset.editCustomer));
    const editProject = event.target.closest("[data-edit-project]");
    if (editProject) projectDialog(state.projects.find((p) => p.id === editProject.dataset.editProject));
  });

  container.addEventListener("change", (event) => {
    if (admin && event.target.matches("[data-add-docs]")) addDocuments(event.target);
  });

  // Länk från Tidrapporten: fäll ut projektet och visa det även om filtret annars döljer det
  const linked = withProjects && tab === "projekt" && action && action !== "ny" ? state.projects.find((p) => p.id === action) : null;
  if (linked) {
    state.open.add(linked.id);
    if (linked.status !== state.status) state.status = "all";
    history.replaceState(null, "", "#/projekt");
  }

  renderTab();

  if (linked) {
    const toggle = content.querySelector(`[data-toggle-project="${CSS.escape(linked.id)}"]`);
    toggle?.scrollIntoView({ block: "start" });
    toggle?.focus({ preventScroll: true });
  }

  // Länkar från Kom igång: öppna formuläret direkt och städa adressen
  if (admin && action === "ny") {
    history.replaceState(null, "", state.tab === "kunder" && withProjects ? "#/projekt/kunder" : "#/projekt");
    if (state.tab === "kunder") customerDialog();
    else projectDialog();
  }
}
