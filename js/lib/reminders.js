// Påminnelser till admin.
import { today } from "./dates.js";

// Milersättningen ändras vid årsskiftet. Påminn om beloppen aldrig kontrollerats,
// eller senast kontrollerades ett tidigare år.
export function ratesNeedCheck(settings) {
  const checked = settings.ratesCheckedAt;
  if (!checked) return { due: true, reason: "never" };
  if (checked.slice(0, 4) < today().slice(0, 4)) return { due: true, reason: "new-year", year: today().slice(0, 4) };
  return { due: false };
}

export const SKATTEVERKET_URL = "https://www.skatteverket.se/";
