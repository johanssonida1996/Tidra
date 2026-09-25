// Rollkontroll i varje vy – räcker inte att dölja menyval.
import { html, setHTML } from "../lib/html.js";
import { hasRole } from "../auth.js";
import { emptyState } from "../lib/ui.js";

export function allowed(ctx, roles, container) {
  if (hasRole(ctx.user, roles)) return true;
  setHTML(
    container,
    html`<h1 class="page-title" tabindex="-1">Ingen behörighet</h1>
      ${emptyState({
        iconName: "lock",
        title: "Du har inte behörighet till den här sidan",
        text: "Sidan är bara till för administratörer.",
        action: html`<a class="btn btn--primary" href="#/tid">Till Lägg till tid</a>`,
      })}`,
  );
  return false;
}
