// Sidor, vilka roller som får se dem och menyerna.
// Rollen kontrolleras i routern, i varje vy och i store.js.
import { isAdmin } from "./auth.js";
import { projectsOn } from "./lib/place.js";

export const ALL = ["admin", "employee"];
export const ADMIN = ["admin"];

// public: kräver ingen inloggning. bare: visas utan sidomeny/flikmeny.
// titleFor: titel som beror på inställningarna (annars title).
export const ROUTES = {
  signup: { public: true, bare: true, title: "Skapa konto", load: () => import("./views/setup.js") },
  login: { public: true, bare: true, title: "Logga in", load: () => import("./views/login.js") },
  losenord: { bare: true, roles: ALL, title: "Välj lösenord", load: () => import("./views/change-password.js") },
  "kom-igang": { roles: ALL, title: "Kom igång", load: () => import("./views/getting-started.js") },
  tid: { roles: ALL, title: "Lägg till tid", load: () => import("./views/time.js") },
  granska: { roles: ALL, title: "Granskning", load: () => import("./views/review.js") },
  projekt: {
    roles: ALL,
    title: "Kunder & projekt",
    titleFor: (settings) => (projectsOn(settings) ? "Kunder & projekt" : "Kunder"),
    load: () => import("./views/projects.js"),
  },
  anstallda: { roles: ADMIN, title: "Anställda", load: () => import("./views/staff.js") },
  material: { roles: ADMIN, title: "Material", load: () => import("./views/materials.js") },
  installningar: { roles: ADMIN, title: "Inställningar", load: () => import("./views/settings.js") },
  profil: { roles: ALL, title: "Profil", load: () => import("./views/profile.js") },
  mer: { roles: ADMIN, title: "Mer", load: () => import("./views/more.js") },
  stilguide: { public: true, bare: true, title: "Stilguide", load: () => import("./views/styleguide.js") },
};

export const HOME = "tid";

// Material är ett tillval med företagets egen benämning (Material, Produkter …)
const materialsOn = (settings) => Boolean(settings?.materials?.enabled);
const materialLabel = (settings) => settings?.materials?.label || "Material";

// Utan projekt heter sidan Kunder
const projectsItem = (user, settings, adminLabel) =>
  projectsOn(settings)
    ? { route: "projekt", label: isAdmin(user) ? adminLabel : "Projekt", icon: "folder" }
    : { route: "projekt", label: "Kunder", icon: "building" };

// Sidomenyn (dator)
export function sidebarItems(user, settings) {
  const items = [
    { route: "kom-igang", label: "Kom igång", icon: "flag" },
    { route: "tid", label: "Tidrapport", icon: "clock" },
    { route: "granska", label: "Granskning", icon: "review" },
    projectsItem(user, settings, "Kunder & projekt"),
  ];
  if (isAdmin(user)) {
    items.push(
      { route: "anstallda", label: "Anställda", icon: "users" },
      ...(materialsOn(settings) ? [{ route: "material", label: materialLabel(settings), icon: "box", badge: "materials" }] : []),
      { route: "installningar", label: "Inställningar", icon: "settings" },
    );
  }
  return items;
}

// Flikmenyn (mobil). Fem flikar för alla – Kom igång har en egen flik.
// Admin: den femte är "Mer" (anställda, material, inställningar, profil). Medarbetare: Profil.
export function tabItems(user, settings) {
  const items = [
    { route: "tid", label: "Tid", icon: "clock" },
    { route: "granska", label: "Granska", icon: "review" },
    projectsItem(user, settings, "Projekt"),
  ];
  items.push(
    { route: "kom-igang", label: "Kom igång", icon: "flag" },
    isAdmin(user)
      ? { route: "mer", label: "Mer", icon: "more", badge: "materials", also: ["anstallda", "material", "installningar", "profil"] }
      : { route: "profil", label: "Profil", icon: "user" },
  );
  return items;
}

// Undersidor under "Mer" i mobilen
export function moreItems(settings) {
  return [
    { route: "anstallda", label: "Anställda", icon: "users", text: "Lägg till, redigera och inaktivera" },
    ...(materialsOn(settings)
      ? [{ route: "material", label: materialLabel(settings), icon: "box", text: "Material från lagret och artiklar", badge: "materials" }]
      : []),
    { route: "installningar", label: "Inställningar", icon: "settings", text: "Projekt, övertid, restid, frånvaro och material" },
    { route: "profil", label: "Profil", icon: "user", text: "Byt lösenord och logga ut" },
  ];
}
