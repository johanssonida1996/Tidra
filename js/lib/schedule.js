// Arbetsschema per anställd över tid.
//
// En anställd kan ha eget schema i perioder: schedulePeriods = [{ from, week }], sorterade på from.
//   from: "ÅÅÅÅ-MM-DD" – perioden gäller från och med den dagen (null = från början)
//   week: { mon … sun } timmar, eller null = företagets arbetstid
// Ett nytt schema gäller alltså bara framåt – äldre veckor räknas med schemat som gällde då.
// Äldre data har bara user.schedule (ett schema utan datum) – det gäller då från början.
// Rena funktioner – används av store.js och vyerna.

export function schedulePeriods(user) {
  if (Array.isArray(user?.schedulePeriods)) return user.schedulePeriods;
  return user?.schedule ? [{ from: null, week: user.schedule }] : [];
}

// Veckoschemat som gäller ett visst datum
export function weekOn(user, date, companyWeek) {
  let current = null;
  for (const period of schedulePeriods(user)) {
    if (!period.from || period.from <= date) current = period;
  }
  return current?.week ?? companyWeek;
}

// Lägger till ett schema som gäller från ett datum. Perioder som börjar samma dag eller senare ersätts.
export function withPeriod(user, from, week) {
  // from = null: schemat gäller från början, och alla tidigare perioder ersätts
  const kept = schedulePeriods(user).filter((p) => from && (!p.from || p.from < from));
  const periods = [...kept, { from, week }];
  // Bara företagets arbetstid från början behöver ingen period
  return periods.length === 1 && !periods[0].week && !from ? [] : periods;
}

// Schemat som senast lades in (det som visas i formuläret) och om det börjar gälla senare
export function latestPeriod(user) {
  const periods = schedulePeriods(user);
  return periods[periods.length - 1] ?? null;
}
