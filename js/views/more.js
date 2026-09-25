// "Mer" – fjärde fliken i mobilen för admin: Kom igång, Anställda, Material, Inställningar och Profil.
import { html, setHTML } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { moreItems, ADMIN } from "../routes.js";
import { allowed } from "./guard.js";
import { updateBadges } from "./shell.js";

export function render(container, ctx) {
  if (!allowed(ctx, ADMIN, container)) return;

  setHTML(
    container,
    html`
      <div class="page-head">
        <div class="page-head__text">
          <h1 class="page-title">Mer</h1>
        </div>
      </div>
      <nav aria-label="Mer">
        <ul class="list">
          ${moreItems(ctx.settings).map(
            (item) => html`<li>
              <a class="quick" href="#/${item.route}">
                <span class="row__icon">${icon(item.icon, 19)}</span>
                <span class="row__body">
                  <span class="row__title">${item.label}</span>
                  <span class="row__meta">${item.text}</span>
                </span>
                ${item.badge ? html`<span class="count-badge" data-badge="${item.badge}" hidden></span>` : ""}
                <span class="row__arrow">${icon("arrowRight")}</span>
              </a>
            </li>`,
          )}
        </ul>
      </nav>
    `,
  );
  updateBadges(container);
}
