// Sätter valt tema innan sidan ritas, så att ljust tema inte blinkar till vid omladdning.
//
// Enda undantaget från regeln att bara js/store.js får läsa localStorage: temat måste läsas
// synkront i <head>, innan modulerna har laddats. Skriptet läser bara nyckeln – den ägs och
// skrivs av store.js (getThemePreference / setThemePreference). Rör inga andra nycklar här.
(function () {
  try {
    // "tidra:theme" = sparat innan appen bytte namn (store.js flyttar nyckeln vid start)
    var theme = localStorage.getItem("tidla:theme") || localStorage.getItem("tidra:theme");
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  } catch (error) {
    /* Utan lagring följer temat systemets inställning */
  }
})();
