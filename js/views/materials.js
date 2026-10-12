// Material (bara admin) – med företagets egen benämning. Två flikar:
//   Från lagret: det medarbetarna har tagit från lagret – nya och klara, filter, markera som klara
//                (klar = admin har tagit hand om det, t.ex. beställt nytt eller fakturerat)
//   Artiklar: företagets artikellista, startförslag för bygg
// #/material/artiklar öppnar fliken Artiklar direkt.
import * as store from "../store.js";
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { formatDate, formatShort } from "../lib/dates.js";
import { formatQuantity, plural } from "../lib/format.js";
import {
  field, input, select, statusPill, pill, emptyState, openDialog, confirmDialog, notify,
} from "../lib/ui.js";
import { ARTICLE_TEMPLATE, UNITS } from "../store.js";
import { placeKey, placeLabel, projectsOn } from "../lib/place.js";
import { ADMIN } from "../routes.js";
import { allowed } from "./guard.js";
import { updateBadges } from "./shell.js";

export async function render(container, ctx) {
  if (!allowed(ctx, ADMIN, container)) return;

  const settings = ctx.settings.materials ?? { enabled: false, label: "Material" };
  const label = settings.label || "Material";

  if (!settings.enabled) {
    setHTML(
      container,
      html`<div class="page-head"><div class="page-head__text"><h1 class="page-title">${label}</h1></div></div>
        ${emptyState({
          iconName: "box",
          title: `${label} är avstängt`,
          text: "Slå på funktionen under Inställningar om medarbetarna ska kunna registrera material som de tar från lagret.",
          action: html`<a class="btn btn--primary" href="#/installningar">Till Inställningar</a>`,
        })}`,
    );
    return;
  }

  const state = {
    tab: ctx.params[0] === "artiklar" ? "artiklar" : "uttag",
    status: "new",
    place: "",
    q: "",
    items: [],
    articles: [],
    users: [],
    projects: [],
    customers: [],
  };

  async function load() {
    [state.items, state.articles, state.users, state.projects, state.customers] = await Promise.all([
      store.listMaterials(),
      store.listArticles({ includeHidden: true }),
      store.listUsers(),
      store.listProjects({ includeArchived: true }),
      store.listCustomers({ includeArchived: true }),
    ]);
  }
  await load();

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">${label}</h1>
          <p class="page-lead">Material som medarbetarna har tagit från lagret – och artiklarna de kan välja bland.</p>
        </div>
      </div>
      <div class="segmented" role="group" aria-label="Visa">
        <button type="button" class="segmented__btn" data-tab="uttag">Från lagret</button>
        <button type="button" class="segmented__btn" data-tab="artiklar">Artiklar</button>
      </div>
      <div class="stack" data-content></div>
    `,
  );

  const content = container.querySelector("[data-content]");
  const userName = (id) => state.users.find((u) => u.id === id)?.name ?? "Okänd";
  // Raden hör till ett projekt – eller bara en kund när projekt inte används
  const placeText = (m) =>
    placeLabel(m, (id) => state.projects.find((x) => x.id === id), (id) => state.customers.find((x) => x.id === id));

  function renderTab() {
    container.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
    if (state.tab === "artiklar") renderArticles();
    else renderItems();
  }

  /* ---------- Från lagret ---------- */

  function renderItems() {
    // Projekten (eller kunderna) som har något från lagret
    const usedPlaces = [...new Map(state.items.map((m) => [placeKey(m), placeText(m)])).entries()];
    const withProjects = projectsOn(ctx.settings);
    setHTML(
      content,
      html`
        <div class="toolbar">
          ${field({
            id: "mt-search",
            label: "Sök",
            control: input({ id: "mt-search", type: "search", iconName: "search", value: state.q, placeholder: "Vad, person eller meddelande", autocomplete: "off" }),
          })}
          ${field({
            id: "mt-status",
            label: "Status",
            control: select({
              id: "mt-status",
              value: state.status,
              options: [
                { value: "new", label: "Nya" },
                { value: "handled", label: "Klara" },
                { value: "all", label: "Alla" },
              ],
            }),
          })}
          ${field({
            id: "mt-place",
            label: withProjects ? "Projekt" : "Kund",
            control: select({
              id: "mt-place",
              value: state.place,
              placeholder: withProjects ? "Alla projekt" : "Alla kunder",
              options: usedPlaces.map(([key, label]) => ({ value: key, label })),
            }),
          })}
        </div>
        <div class="stack stack--m" data-items></div>
      `,
    );
    content.querySelector("#mt-search").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderItemList();
    });
    content.querySelector("#mt-status").addEventListener("change", (e) => {
      state.status = e.target.value;
      renderItemList();
    });
    content.querySelector("#mt-place").addEventListener("change", (e) => {
      state.place = e.target.value;
      renderItemList();
    });
    renderItemList();
  }

  function filteredItems() {
    const query = state.q.trim().toLowerCase();
    return state.items
      .filter((m) => state.status === "all" || (state.status === "new" ? !m.handled : m.handled))
      .filter((m) => !state.place || placeKey(m) === state.place)
      .filter((m) => !query || `${m.name} ${userName(m.userId)} ${m.message}`.toLowerCase().includes(query));
  }

  function renderItemList() {
    const rows = filteredItems();
    const newRows = rows.filter((m) => !m.handled);
    const host = content.querySelector("[data-items]");
    if (!state.items.length) {
      setHTML(host, emptyState({
        iconName: "box",
        title: "Inget har tagits från lagret än",
        text: state.articles.length
          ? "När medarbetarna registrerar material från lagret visas det här."
          : "Börja med att lägga till artiklar, så att medarbetarna kan välja i en lista.",
        action: state.articles.length ? "" : html`<button type="button" class="btn btn--primary" data-tab="artiklar">Till Artiklar</button>`,
      }));
      return;
    }
    setHTML(
      host,
      html`
        <p class="text-muted text-small">
          <strong>Markera som klar</strong> när du har tagit hand om raden – till exempel beställt nytt eller lagt det på kundens faktura.
          Klara rader kan inte längre tas bort av medarbetaren.
        </p>
        <div class="split split--center">
          <p class="text-muted text-small" aria-live="polite">${plural(rows.length, "rad", "rader")}</p>
          ${newRows.length > 1
            ? html`<button type="button" class="btn btn--secondary btn--sm" data-handle-all>${icon("check", 16)}Markera ${newRows.length} som klara</button>`
            : ""}
        </div>
        ${rows.length
          ? html`<ul class="list">
              ${rows.map((m) => html`<li class="row row--wrap${m.handled ? " row--muted" : ""}">
                <span class="row__icon${m.handled ? "" : " row__icon--pink"}">${icon("box", 20)}</span>
                <span class="row__body">
                  <span class="row__title">${m.name} · ${formatQuantity(m.quantity, m.unit)}</span>
                  <span class="row__meta">${formatShort(m.date)} · ${userName(m.userId)} · ${placeText(m)}</span>
                  ${m.message ? html`<span class="row__meta">”${m.message}”</span>` : ""}
                </span>
                <span class="row__aside">${statusPill(m.handled ? "handled" : "new")}</span>
                <span class="row__actions">
                  <button type="button" class="btn ${m.handled ? "btn--text" : "btn--secondary"} btn--sm" data-handle="${m.id}"
                    aria-label="${m.handled ? "Ångra klar" : "Markera som klar"}: ${m.name}">
                    ${m.handled ? "Ångra" : html`${icon("check", 16)}Klar`}
                  </button>
                  ${m.handled
                    ? ""
                    : html`<button type="button" class="icon-btn icon-btn--ghost icon-btn--danger" data-delete-item="${m.id}" title="Ta bort"
                        aria-label="Ta bort ${m.name}">${icon("trash", 18)}</button>`}
                </span>
              </li>`)}
            </ul>`
          : emptyState({ iconName: "search", title: "Inget matchar", text: "Ändra sökningen eller filtren." })}
      `,
    );
  }

  /* ---------- Artiklar ---------- */

  function renderArticles() {
    const visible = state.articles.filter((a) => !a.hidden).length;
    setHTML(
      content,
      html`
        <div class="split split--center split--stack">
          <p class="text-muted text-small">${plural(visible, "artikel", "artiklar")} i listan${state.articles.length > visible ? ` · ${state.articles.length - visible} dolda` : ""}</p>
          <div class="cluster">
            <button type="button" class="btn btn--secondary" data-templates>${icon("plus")}Förslag på artiklar</button>
            <button type="button" class="btn btn--primary" data-new-article>${icon("plus")}Ny artikel</button>
          </div>
        </div>
        ${state.articles.length
          ? html`<ul class="list">
              ${state.articles.map((a) => html`<li class="row row--wrap${a.hidden ? " row--muted" : ""}">
                <span class="row__icon">${icon("box", 20)}</span>
                <span class="row__body">
                  <span class="row__title">${a.name}</span>
                  <span class="row__meta">${[`Enhet: ${a.unit}`, a.articleNo && `Art.nr ${a.articleNo}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span class="row__aside">${a.hidden ? pill("Dold", "draft", "minus") : ""}</span>
                <span class="row__actions">
                  <button type="button" class="btn btn--secondary btn--sm" data-edit-article="${a.id}" aria-label="Redigera ${a.name}">${icon("edit", 16)}Redigera</button>
                  <button type="button" class="btn btn--text btn--sm" data-toggle-article="${a.id}" aria-label="${a.hidden ? "Visa" : "Dölj"} ${a.name}">${a.hidden ? "Visa" : "Dölj"}</button>
                </span>
              </li>`)}
            </ul>`
          : emptyState({
              iconName: "box",
              title: "Lägg till er första artikel",
              text: "Lägg till det ni faktiskt använder – eller börja med vanliga byggartiklar och ändra dem sedan.",
              action: html`<button type="button" class="btn btn--primary" data-templates>Visa förslag på artiklar</button>`,
            })}
      `,
    );
  }

  async function articleDialog(article = null) {
    const a = article ?? { unit: "st" };
    await openDialog({
      title: article ? `Redigera ${a.name}` : "Ny artikel",
      body: html`
        ${field({ id: "ar-name", label: "Namn", control: input({ id: "ar-name", name: "name", value: a.name, autocomplete: "off", required: true }) })}
        <div class="grid-2">
          ${field({
            id: "ar-unit",
            label: "Enhet",
            help: "Välj i listan eller skriv en egen.",
            control: html`${input({ id: "ar-unit", name: "unit", value: a.unit, list: "ar-units", autocomplete: "off", help: true })}
              <datalist id="ar-units">${UNITS.map((u) => html`<option value="${u}"></option>`)}</datalist>`,
          })}
          ${field({ id: "ar-no", label: "Artikelnummer", optional: true, control: input({ id: "ar-no", name: "articleNo", value: a.articleNo, autocomplete: "off" }) })}
        </div>
      `,
      actions: html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
        <button type="submit" class="btn btn--primary">${article ? "Spara" : "Lägg till"}</button>`,
      onSubmit: async ({ form }) => {
        const data = Object.fromEntries(new FormData(form));
        await store.saveArticle({ ...data, id: a.id, hidden: a.hidden });
        notify(article ? "Artikeln är sparad" : "Artikeln är tillagd");
        return "done";
      },
    }).then(async (result) => {
      if (result === "done") {
        await load();
        renderTab();
      }
    });
  }

  async function templateDialog() {
    // Bara förslag som inte redan finns i listan (samma namn, oavsett stora och små bokstäver)
    const missing = ARTICLE_TEMPLATE.filter(([name]) => !state.articles.some((a) => a.name.toLowerCase() === name.toLowerCase()));
    const result = await openDialog({
      title: "Förslag på artiklar",
      body: missing.length
        ? html`<p>Lägg till vanliga byggartiklar. Du kan sedan byta namn, ändra enhet och dölja det ni inte använder.</p>
            <ul class="text-muted text-small">
              ${missing.map(([name, unit]) => html`<li>${name} (${unit})</li>`)}
            </ul>
            ${missing.length < ARTICLE_TEMPLATE.length
              ? html`<p class="text-muted text-small">${plural(ARTICLE_TEMPLATE.length - missing.length, "förslag finns", "förslag finns")} redan i listan och visas inte.</p>`
              : ""}`
        : html`<p>Alla förslag finns redan i artikellistan.</p>`,
      actions: missing.length
        ? html`<button type="button" class="btn btn--secondary" data-close>Avbryt</button>
            <button type="submit" class="btn btn--primary" value="add">${icon("plus")}Lägg till ${plural(missing.length, "artikel", "artiklar")}</button>`
        : html`<button type="button" class="btn btn--primary" data-close>Stäng</button>`,
      onSubmit: async () => {
        const added = await store.addArticleTemplate();
        notify(added ? `${plural(added, "artikel", "artiklar")} lades till` : "Alla förslag fanns redan");
        return "done";
      },
    });
    if (result === "done") {
      await load();
      renderTab();
    }
  }

  /* ---------- Händelser ---------- */

  container.addEventListener("click", async (event) => {
    const target = event.target;
    const tab = target.closest("[data-tab]");
    if (tab) {
      state.tab = tab.dataset.tab;
      history.replaceState(null, "", state.tab === "artiklar" ? "#/material/artiklar" : "#/material");
      renderTab();
      return;
    }
    if (target.closest("[data-new-article]")) articleDialog();
    if (target.closest("[data-templates]")) templateDialog();
    const edit = target.closest("[data-edit-article]");
    if (edit) articleDialog(state.articles.find((a) => a.id === edit.dataset.editArticle));

    try {
      const toggle = target.closest("[data-toggle-article]");
      if (toggle) {
        const a = state.articles.find((x) => x.id === toggle.dataset.toggleArticle);
        await store.saveArticle({ ...a, hidden: !a.hidden });
        notify(a.hidden ? `${a.name} visas igen` : `${a.name} är dold`);
        await load();
        renderTab();
        content.querySelector(`[data-toggle-article="${a.id}"]`)?.focus();
      }
      const handle = target.closest("[data-handle]");
      if (handle) {
        const m = state.items.find((x) => x.id === handle.dataset.handle);
        await store.setMaterialsHandled([m.id], !m.handled);
        notify(m.handled ? `${m.name} är markerad som ny igen` : `${m.name} är markerad som klar`);
        await load();
        renderItemList();
        updateBadges();
      }
      if (target.closest("[data-handle-all]")) {
        const ids = filteredItems().filter((m) => !m.handled).map((m) => m.id);
        const ok = await confirmDialog({
          title: `Markera ${ids.length} rader som klara?`,
          message: "Alla nya rader som visas i listan markeras som klara.",
          confirmLabel: "Markera som klara",
        });
        if (!ok) return;
        await store.setMaterialsHandled(ids);
        notify(plural(ids.length, "rad är markerad som klar", "rader är markerade som klara"));
        await load();
        renderItemList();
        updateBadges();
      }
      const del = target.closest("[data-delete-item]");
      if (del) {
        const m = state.items.find((x) => x.id === del.dataset.deleteItem);
        const ok = await confirmDialog({
          title: `Ta bort ${m.name}?`,
          message: `${formatQuantity(m.quantity, m.unit)} från lagret, registrerat av ${userName(m.userId)} ${formatDate(m.date)}.`,
          confirmLabel: "Ta bort",
          danger: true,
        });
        if (!ok) return;
        await store.deleteMaterial(m.id);
        notify(`${m.name} är borttagen`);
        await load();
        renderItemList();
        updateBadges();
      }
    } catch (error) {
      notify(error.message, { type: "error" });
    }
  });

  renderTab();
}
