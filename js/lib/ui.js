// Gemensamma gränssnittsdelar: bekräftelser, dialoger, fält, piller och tomma lägen.
import { html, raw, escape } from "./html.js";
import { icon } from "./icons.js";
import { initials } from "./format.js";

let uid = 0;
export const nextId = (prefix = "t") => `${prefix}-${++uid}`;

/* ---------- Diskret bekräftelse (aria-live="polite") ---------- */

// action: { label, onClick } – en knapp i bekräftelsen (t.ex. "Lägg till material"). Visas då lite längre.
export function notify(message, { type = "success", duration, action = null } = {}) {
  const region = document.getElementById("notice-region");
  if (!region) return;
  duration ??= action ? 8000 : 3500;
  const notice = document.createElement("div");
  notice.className = `notice${type === "error" ? " notice--error" : ""}${action ? " notice--action" : ""}`;
  notice.innerHTML = `<span class="notice__icon">${icon(type === "error" ? "alert" : "check", 16)}</span><span>${escape(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-btn notice__action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      notice.remove();
      action.onClick();
    });
    notice.append(button);
  }
  region.append(notice);
  setTimeout(() => {
    notice.classList.add("notice--leaving");
    setTimeout(() => notice.remove(), 300);
  }, duration);
}

/* ---------- Dialog ---------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Öppnar en modal dialog. onSubmit({ form, action }) kan returnera false för att hålla den öppen.
// Promise löses med onSubmit:s returvärde (eller knappens value), eller undefined vid Avbryt/Esc.
export function openDialog({ title, body, actions, wide = false, onSubmit, onOpen, initialFocus }) {
  return new Promise((resolve) => {
    const titleId = nextId("dialog-title");
    const dialog = document.createElement("dialog");
    dialog.className = `dialog${wide ? " dialog--wide" : ""}`;
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.innerHTML = String(html`
      <form class="dialog__inner" method="dialog" novalidate>
        <div class="dialog__head">
          <h2 class="dialog__title" id="${titleId}">${title}</h2>
          <button type="button" class="icon-btn icon-btn--ghost" data-close aria-label="Stäng">${icon("close", 20)}</button>
        </div>
        <div class="form-error" data-form-error role="alert" tabindex="-1" hidden></div>
        <div class="dialog__body">${body}</div>
        <div class="dialog__actions">${actions}</div>
      </form>
    `);

    const form = dialog.querySelector("form");
    const previousFocus = document.activeElement;
    let result;

    const close = (value) => {
      result = value;
      dialog.close();
    };

    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) close(undefined);
    });

    // Håll Tab inne i dialogen (Edge och Safari släpper annars ut fokus till webbläsaren)
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.value || "submit";
      if (!onSubmit) return close(action);
      const buttons = [...form.querySelectorAll("button")];
      buttons.forEach((b) => (b.disabled = true));
      try {
        const value = await onSubmit({ form, action, dialog });
        if (value !== false) close(value ?? action);
      } catch (error) {
        showFormErrors(form, error);
      } finally {
        buttons.forEach((b) => (b.disabled = b.hasAttribute("data-keep-disabled")));
      }
    });

    dialog.addEventListener("close", () => {
      dialog.remove();
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    onOpen?.({ form, dialog, close });
    const focusTarget = initialFocus
      ? dialog.querySelector(initialFocus)
      : dialog.querySelector(".dialog__body :is(input, select, textarea):not([disabled])");
    (focusTarget || dialog.querySelector(".dialog__actions button:last-child"))?.focus();
  });
}

// Bekräftelsedialog. requireText = text som måste skrivas in för att knappen ska aktiveras.
export async function confirmDialog({
  title,
  message,
  confirmLabel = "Bekräfta",
  cancelLabel = "Avbryt",
  danger = false,
  requireText = null,
}) {
  const inputId = nextId("confirm");
  const body = html`
    ${message ? html`<p>${message}</p>` : ""}
    ${requireText
      ? html`<div class="field">
          <label class="field__label" for="${inputId}">Skriv <strong>${requireText}</strong> för att bekräfta</label>
          <input class="input" id="${inputId}" name="confirmText" autocomplete="off" />
        </div>`
      : ""}
  `;
  const actions = html`
    <button type="button" class="btn btn--secondary" data-close>${cancelLabel}</button>
    <button type="submit" class="btn ${danger ? "btn--danger" : "btn--primary"}" value="confirm"
      ${requireText ? raw("disabled data-keep-disabled") : ""}>${confirmLabel}</button>
  `;
  const result = await openDialog({
    title,
    body,
    actions,
    initialFocus: requireText ? `#${inputId}` : ".dialog__actions .btn--secondary",
    onOpen: ({ form }) => {
      if (!requireText) return;
      const input = form.querySelector(`#${inputId}`);
      const button = form.querySelector('button[value="confirm"]');
      input.addEventListener("input", () => {
        const ok = input.value.trim() === requireText;
        button.disabled = !ok;
        button.toggleAttribute("data-keep-disabled", !ok);
      });
    },
    onSubmit: ({ form }) => {
      if (requireText && form.querySelector(`#${inputId}`).value.trim() !== requireText) return false;
      return "confirm";
    },
  });
  return result === "confirm";
}

/* ---------- Formulärfel ---------- */

export function clearFormErrors(form) {
  form.querySelectorAll("[data-generated-error]").forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
    input.removeAttribute("aria-invalid");
    const described = (input.getAttribute("aria-describedby") || "")
      .split(" ")
      .filter((id) => id && !id.endsWith("-error"));
    if (described.length) input.setAttribute("aria-describedby", described.join(" "));
    else input.removeAttribute("aria-describedby");
  });
  const box = form.querySelector("[data-form-error]");
  if (box) {
    box.hidden = true;
    box.textContent = "";
  }
}

// Visar fel från StoreError (fields = { fältnamn: meddelande }) vid respektive fält.
export function showFormErrors(form, error) {
  clearFormErrors(form);
  const fields = error?.fields || {};
  let first = null;
  let unmatched = false;

  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) {
      unmatched = true;
      continue;
    }
    const errorId = `${input.id || nextId(name)}-error`;
    const el = document.createElement("div");
    el.className = "field__error";
    el.id = errorId;
    el.dataset.generatedError = "";
    el.innerHTML = `${icon("alert", 14)}<span>${escape(message)}</span>`;
    const field = input.closest(".field");
    if (field) field.append(el);
    else input.after(el);
    input.setAttribute("aria-invalid", "true");
    const described = input.getAttribute("aria-describedby");
    input.setAttribute("aria-describedby", described ? `${described} ${errorId}` : errorId);
    first ??= input;
  }

  const box = form.querySelector("[data-form-error]");
  const showBox = !first || unmatched;
  if (box && showBox) {
    box.hidden = false;
    box.innerHTML = `${icon("alert", 18)}<span>${escape(error?.message || "Något gick fel. Försök igen.")}</span>`;
  } else if (!box && showBox) {
    notify(error?.message || "Något gick fel. Försök igen.", { type: "error" });
  }
  (first || box)?.focus?.();
  if (!first && box) box.scrollIntoView({ block: "nearest" });
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

/* ---------- Byggstenar (HTML) ---------- */

export function field({ id, label, control, help, optional = false, className = "" }) {
  const helpId = help ? `${id}-help` : null;
  return html`
    <div class="field ${className}">
      <label class="field__label" for="${id}">${label}${optional ? html` <span class="field__optional">(valfritt)</span>` : ""}</label>
      ${control}
      ${help ? html`<div class="field__help" id="${helpId}">${help}</div>` : ""}
    </div>
  `;
}

// Attribut som bara skrivs ut när värdet är sant
function attrs(map) {
  return raw(
    Object.entries(map)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}="${escape(v)}"`))
      .join(" "),
  );
}

export function input({
  id,
  name = id,
  type = "text",
  value = "",
  iconName,
  help = false,
  action,
  className = "",
  ...rest
}) {
  const classes = ["input", iconName && "input--with-icon", action && "input--with-action", className]
    .filter(Boolean)
    .join(" ");
  const control = html`<input class="${classes}" ${attrs({
    id,
    name,
    type,
    value,
    "aria-describedby": help ? `${id}-help` : null,
    ...rest,
  })} />`;
  if (!iconName && !action) return control;
  return html`<div class="field__control">
    ${iconName ? html`<span class="field__icon">${icon(iconName, 18)}</span>` : ""}
    ${control}
    ${action || ""}
  </div>`;
}

export function textarea({ id, name = id, value = "", ...rest }) {
  return html`<textarea class="textarea" ${attrs({ id, name, ...rest })}>${value}</textarea>`;
}

// options: [{ value, label, disabled }] – eller groups: [{ label, options: [...] }] för grupperade val
export function select({ id, name = id, options = [], groups = null, value = "", placeholder, help = false, ...rest }) {
  const option = (o) =>
    html`<option value="${o.value}" ${o.value === value ? raw("selected") : ""} ${o.disabled ? raw("disabled") : ""}>${o.label}</option>`;
  return html`<div class="field__control">
    <select class="select" ${attrs({ id, name, "aria-describedby": help ? `${id}-help` : null, ...rest })}>
      ${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ""}
      ${groups
        ? groups.filter((g) => g.options.length).map((g) => html`<optgroup label="${g.label}">${g.options.map(option)}</optgroup>`)
        : options.map(option)}
    </select>
    <span class="field__chevron">${icon("chevronDown", 18)}</span>
  </div>`;
}

export function pill(label, variant = "draft", iconName) {
  return html`<span class="pill pill--${variant}">${iconName ? icon(iconName, 13, 2.4) : ""}${label}</span>`;
}

const STATUS = {
  draft: ["Utkast", "draft", "edit"],
  approved: ["Godkänd", "success", "check"],
  rejected: ["Nekad", "rejected", "alert"],
  pending: ["Väntar på aktivering", "pending", "clock"],
  active: ["Aktiv", "success", "check"],
  inactive: ["Inaktiv", "draft", "minus"],
  open: ["Pågående", "progress", "clock"],
  closed: ["Avslutat", "done", "check"],
  archived: ["Arkiverad", "draft", "archive"],
  new: ["Ny", "pending", "box"],
  handled: ["Hanterad", "done", "check"],
  locked: ["Klar", "done", "lock"],
};

export function statusPill(status) {
  const [label, variant, iconName] = STATUS[status] || [status, "draft"];
  return pill(label, variant, iconName);
}

export function avatar(name, { pink = false, large = false } = {}) {
  return html`<span class="avatar${pink ? " avatar--pink" : ""}${large ? " avatar--lg" : ""}" aria-hidden="true">${initials(name)}</span>`;
}

export function emptyState({ iconName = "info", title, text, action }) {
  return html`
    <div class="empty">
      <span class="empty__icon">${icon(iconName, 22)}</span>
      <p class="empty__title">${title}</p>
      ${text ? html`<p class="empty__text">${text}</p>` : ""}
      ${action || ""}
    </div>
  `;
}

export function callout(text, { variant = "", iconName = "info" } = {}) {
  return html`<div class="callout${variant ? ` callout--${variant}` : ""}">${icon(iconName, 18)}<div>${text}</div></div>`;
}

// Knapp "Visa lösenord" som växlar fältets typ
export function bindPasswordToggles(root) {
  root.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const inputEl = root.querySelector(`#${CSS.escape(button.dataset.togglePassword)}`);
      const show = inputEl.type === "password";
      inputEl.type = show ? "text" : "password";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute("aria-label", show ? "Dölj lösenord" : "Visa lösenord");
      button.innerHTML = String(icon(show ? "eyeOff" : "eye", 18));
    });
  });
}

export function passwordToggle(inputId) {
  return html`<button type="button" class="field__action" data-toggle-password="${inputId}"
    aria-label="Visa lösenord" aria-pressed="false" aria-controls="${inputId}">${icon("eye", 18)}</button>`;
}
