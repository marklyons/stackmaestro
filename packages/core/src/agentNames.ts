// A fixed, ordered pool so the same lineup of names tends to show up demo to
// demo. Picked for recognizability over completeness — no claim to a "correct"
// canonical set of Greek mythology figures.
const GREEK_NAMES = [
  "Atlas",
  "Castor",
  "Pollux",
  "Medea",
  "Odysseus",
  "Icarus",
  "Persephone",
  "Hermes",
  "Athena",
  "Prometheus",
  "Theseus",
  "Ariadne",
  "Orion",
  "Daphne",
  "Phoebe",
  "Helios",
  "Selene",
  "Iris",
  "Hecate",
  "Perseus",
  "Jason",
  "Circe",
  "Orpheus",
  "Eurydice",
];

/** Picks a name from the pool that no other active claim is currently using. Falls back to
 *  cycling with a numeric suffix in the unlikely case every name in the pool is taken at once. */
export function assignGreekName(namesInUse: Set<string>): string {
  const free = GREEK_NAMES.find((name) => !namesInUse.has(name));
  if (free) return free;

  let round = 2;
  for (;;) {
    for (const name of GREEK_NAMES) {
      const candidate = `${name} ${round}`;
      if (!namesInUse.has(candidate)) return candidate;
    }
    round++;
  }
}
