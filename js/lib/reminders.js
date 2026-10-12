// Påminnelser till admin.
import { today } from "./dates.js";

// Milersättningen ändras vid årsskiftet. Varje fordon sparar vilket år beloppet gäller (rateYear).
// Påminn när det äldsta beloppet bland fordonen som används gäller ett tidigare år än i år.
// { due, validYear, year } – validYear = året beloppen gäller, year = i år.
export function ratesNeedCheck(settings, now = today()) {
  const year = Number(now.slice(0, 4));
  const years = (settings.vehicleTypes ?? [])
    .filter((v) => !v.hidden && !v.retired && v.ratePerMil !== null && v.ratePerMil !== undefined)
    .map((v) => v.rateYear ?? 0);
  if (!years.length) return { due: false, validYear: null, year };
  const validYear = Math.min(...years);
  return { due: validYear < year, validYear: validYear || null, year };
}
