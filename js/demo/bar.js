// Testversionen: raden "Testversion – allt sparas i den här webbläsaren" överst i appen,
// med knappen Byt företag som tömmer datan.
import * as store from "../store.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { confirmDialog } from "../lib/ui.js";

// Raden överst i appen
export function demoBar() {
  return html`<div class="demo-bar" role="note">
    ${icon("info", 16)}
    <span>Testversion – sparas bara i den här webbläsaren.</span>
    <button type="button" class="link-btn" data-demo-reset>Byt företag</button>
  </div>`;
}

export function bindDemoBar(root, onReset) {
  root.querySelector("[data-demo-reset]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Byta företag?",
      message: "Allt i Tidla i den här webbläsaren raderas. Sedan kan du skapa ett nytt företag.",
      confirmLabel: "Radera och byt",
      danger: true,
    });
    if (!ok) return;
    await store.resetAllData();
    onReset();
  });
}
