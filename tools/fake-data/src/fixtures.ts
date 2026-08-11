/**
 * Small, committed fixture pools the generator draws from (DECISIONS D65 — we
 * commit the generator and these fixtures, never a generated data blob). The
 * data is deliberately and obviously fake: every generated email is on the
 * reserved `example.test` domain and every Constitution ID is above #5000
 * (real signing numbers are lower), so a generated profile can never be
 * mistaken for a real brother.
 */

export const FIRST_NAMES: readonly string[] = [
  "James",
  "Robert",
  "John",
  "Michael",
  "David",
  "William",
  "Richard",
  "Thomas",
  "Charles",
  "Daniel",
  "Matthew",
  "Anthony",
  "Mark",
  "Donald",
  "Steven",
  "Paul",
  "Andrew",
  "Joshua",
  "Kenneth",
  "Kevin",
  "Brian",
  "George",
  "Edward",
  "Ronald",
  "Timothy",
  "Jason",
  "Jeffrey",
  "Ryan",
  "Jacob",
  "Gary",
  "Nicholas",
  "Eric",
  "Jonathan",
  "Stephen",
  "Larry",
  "Justin",
  "Scott",
  "Brandon",
  "Benjamin",
  "Samuel",

  // The names below extend the pool to reflect PBE's international membership
  // (PBE and MIT draw brothers from around the world). Given names are real and
  // correctly spelled — only surnames carry the deliberate-misspelling
  // convention. Because makeName() draws first and last independently (and
  // middle names from this same pool), the generator naturally produces the
  // real-world mixing patterns: a Western given name with an ethnic surname, an
  // ethnic given name with a Western surname, and a Western first name in front
  // of an ethnic middle name (as when a brother of Chinese or Korean heritage
  // goes by a Western first name and keeps his given name as a middle name).
  // PBE is a male-only organization, so every name here is a male given name:
  // this list adds ethnic diversity but deliberately never gender diversity.

  // South Asian (Indian)
  "Arjun",
  "Rohan",
  "Vikram",
  "Rahul",
  "Aditya",
  "Nikhil",
  "Ravi",
  "Sanjay",

  // East Asian (Chinese, Korean, Japanese, Indonesian)
  "Wei",
  "Jian",
  "Hao",
  "Minjun",
  "Jihoon",
  "Haruto",
  "Kenji",
  "Ren",
  "Budi",
  "Bayu",

  // Latin American
  "Mateo",
  "Santiago",
  "Diego",
  "Javier",
  "Alejandro",
  "Rafael",
  "Joaquín",
  "Emilio",

  // African
  "Kwame",
  "Kofi",
  "Tunde",
  "Thabo",
  "Babatunde",
  "Jabari",
  "Sipho",
  "Oluwaseun",

  // Black American
  "Jamal",
  "DeShawn",
  "Marquis",
  "Darnell",
  "Malik",
  "Terrell",
  "Demetrius",
  "Xavier",

  // Scandinavian
  "Lars",
  "Magnus",
  "Bjørn",
  "Henrik",
  "Sven",
  "Søren",
  "Anders",
  "Nils",

  // Eastern European (Russian, Czech, Polish)
  "Dmitri",
  "Sergei",
  "Nikolai",
  "Tomáš",
  "Jakub",
  "Piotr",
  "Krzysztof",
  "Wojciech",

  // Middle Eastern (Arabic, Persian)
  "Omar",
  "Khalid",
  "Tariq",
  "Yusuf",
  "Hassan",
  "Reza",
  "Darius",
  "Arash",
] as const;

// Plausible but clearly-placeholder surnames (note the deliberate misspellings,
// e.g. "Smyth" for "Smith" — the house convention for the fake exemplar).
export const LAST_NAMES: readonly string[] = [
  "Smyth",
  "Jonas",
  "Willamson",
  "Brownell",
  "Joneson",
  "Millard",
  "Davison",
  "Garcio",
  "Rodrigue",
  "Wilsone",
  "Martinet",
  "Andersohn",
  "Tayler",
  "Thomason",
  "Jacksonn",
  "Whyte",
  "Harriss",
  "Martine",
  "Thompsen",
  "Garretson",
  "Robinette",
  "Clarkson",
  "Lewisohn",
  "Lees",
  "Walkerton",
  "Hallman",
  "Allenby",
  "Younge",
  "Hernandes",
  "Kingsford",
  "Wrighton",
  "Lopaz",
  "Hilliard",
  "Scotson",
  "Greenway",
  "Adamson",
  "Bakersfield",
  "Nelsen",
  "Hillman",
  "Ramiro",

  // International surnames extending the pool, carrying the same deliberate
  // light-misspelling convention as above (e.g. Patell, Nakamuro, Okonkwa) so
  // they stay obviously fake. (There is no separate "Black American" block:
  // those surnames overlap the Anglo pool above; the dedicated Black American
  // *given* names in FIRST_NAMES are what surface that community in the data.)

  // South Asian (Indian)
  "Patell",
  "Sharman",
  "Singhe",
  "Guptah",
  "Reddi",
  "Naire",
  "Iyar",
  "Mehtah",

  // East Asian (Chinese, Korean, Japanese, Indonesian)
  "Chenn",
  "Zhane",
  "Huangh",
  "Kimm",
  "Parke",
  "Choie",
  "Nakamuro",
  "Satoh",
  "Tanaki",
  "Wijayah",

  // Latin American
  "Fernandes",
  "Torrez",
  "Ramirex",
  "Moralez",
  "Castillio",
  "Vargaz",
  "Reyez",
  "Mendozah",

  // African
  "Okonkwa",
  "Adebaye",
  "Mensa",
  "Diallio",
  "Okafore",
  "Dlaminy",
  "Boatenge",
  "Mwangui",

  // Scandinavian
  "Johanssen",
  "Larssen",
  "Hanssen",
  "Nilssen",
  "Bergh",
  "Lindqvest",
  "Olsenn",
  "Halvorson",

  // Eastern European (Russian, Czech, Polish)
  "Ivanoff",
  "Petroff",
  "Volkoff",
  "Sokoloff",
  "Novakk",
  "Svobodah",
  "Kowalsky",
  "Lewandowsky",

  // Middle Eastern (Arabic, Persian)
  "Hassann",
  "Rahmann",
  "Nassir",
  "Khaleel",
  "Salehh",
  "Hosseyni",
  "Karimy",
  "Tehranni",
] as const;

export interface Place {
  city: string;
  state: string | null;
  country: string;
  /**
   * Real postal codes **for this city**, one of which each fake brother there
   * gets.
   *
   * ⚠ These must genuinely belong to the city beside them, and that is not
   * decoration. Proximity search locates a brother by his **ZIP**, never by his
   * written city (D172 decision 1, on design §8's finding that the written city
   * is the less trustworthy of the two). Before OFC-378's live test the generator
   * wrote `String(rng.int(10000, 99999))` — a random number, drawn independently
   * of the city it had just picked — and the consequence was not a slightly
   * scruffy fixture but a feature that could not be evaluated at all: a search
   * near San Francisco returned brothers displayed as living in Pittsburgh,
   * Washington and Boston, because their ZIPs were noise and the six hits were
   * simply the six random draws that happened to land near the Bay. The
   * arithmetic was exact — 399 real ZIPs within 50 miles of San Francisco out of
   * 90,000 drawable integers over 1,208 records predicts 5.4 hits, and 6 were
   * seen. It read as a broken filter and was a broken fixture.
   *
   * Two further consequences of that one line, both worth remembering: only 42%
   * of the drawable range are real ZIPs at all, so most brothers could not be
   * located; and starting the range at 10000 made **every leading-zero ZIP
   * unreachable**, which is the whole of New England — the region holding the
   * largest share of real brothers.
   *
   * `generate.test.ts` now asserts each of these against the committed proximity
   * tables, so a future edit cannot quietly put a Boston brother in Kansas.
   */
  postalCodes: readonly string[];
}

export const PLACES: readonly Place[] = [
  { city: "Boston", state: "MA", country: "US", postalCodes: ["02108", "02115", "02116", "02127"] },
  { city: "Cambridge", state: "MA", country: "US", postalCodes: ["02138", "02139", "02140"] },
  {
    city: "New York",
    state: "NY",
    country: "US",
    postalCodes: ["10001", "10011", "10023", "10128"],
  },
  {
    city: "San Francisco",
    state: "CA",
    country: "US",
    postalCodes: ["94103", "94110", "94114", "94122"],
  },
  { city: "Palo Alto", state: "CA", country: "US", postalCodes: ["94301", "94303", "94306"] },
  { city: "Seattle", state: "WA", country: "US", postalCodes: ["98101", "98103", "98115"] },
  { city: "Austin", state: "TX", country: "US", postalCodes: ["78701", "78704", "78745"] },
  { city: "Chicago", state: "IL", country: "US", postalCodes: ["60601", "60614", "60640"] },
  { city: "Denver", state: "CO", country: "US", postalCodes: ["80202", "80206", "80211"] },
  { city: "Portland", state: "OR", country: "US", postalCodes: ["97201", "97209", "97214"] },
  { city: "Atlanta", state: "GA", country: "US", postalCodes: ["30303", "30306", "30309"] },
  { city: "Washington", state: "DC", country: "US", postalCodes: ["20001", "20009", "20016"] },
  { city: "Pittsburgh", state: "PA", country: "US", postalCodes: ["15213", "15217", "15232"] },
  { city: "Ann Arbor", state: "MI", country: "US", postalCodes: ["48103", "48104", "48105"] },
  { city: "Minneapolis", state: "MN", country: "US", postalCodes: ["55401", "55408", "55414"] },
  // Non-US postal codes are left in their own national formats: validation
  // format-checks US ZIPs only (N38), and the shapes matter here because they are
  // what a non-US record actually looks like.
  { city: "Toronto", state: "ON", country: "CA", postalCodes: ["M5V 2T6", "M4W 1A8", "M6J 1H1"] },
  { city: "Vancouver", state: "BC", country: "CA", postalCodes: ["V6B 1A1", "V5K 0A1"] },
  { city: "London", state: null, country: "GB", postalCodes: ["SW1A 1AA", "EC1A 1BB", "N1 9GU"] },
  // ⚠ Munich's postal codes are five digits and therefore **collide with real US
  // ZIPs** — 80331 is a live Colorado ZIP. That is deliberate: it is the fixture
  // that exercises D177's country rule, under which a brother whose country says
  // he is not in the US is never located however ZIP-shaped his postal code
  // looks. Do not "tidy" these into something unmistakably foreign.
  { city: "Munich", state: null, country: "DE", postalCodes: ["80331", "80802"] },
  { city: "Singapore", state: null, country: "SG", postalCodes: ["018956", "238859"] },
] as const;

/**
 * Word pools for whimsical fraternity **mug names** — the house nickname, often a
 * playful, MIT-flavored phrase unrelated to a brother's real name (the PRD's
 * "Hilbert Space Pilot," "Lissajous Figure"). Deliberately drawn from
 * math/physics/engineering whimsy so they're obviously fake and never look like a
 * real name; composed into one to three words by the generator. They exercise
 * Name Search over the mug-name field, including multi-word mug names (D35).
 */
export const MUG_ADJECTIVES: readonly string[] = [
  "Quantum",
  "Tangential",
  "Recursive",
  "Asymptotic",
  "Stochastic",
  "Hyperbolic",
  "Orthogonal",
  "Photonic",
  "Entropic",
  "Inverted",
  "Spurious",
  "Damped",
  "Resonant",
  "Nonlinear",
  "Adiabatic",
  "Turbo",
  "Subsonic",
  "Cryogenic",
  "Fractal",
  "Ballistic",
];

export const MUG_NOUNS: readonly string[] = [
  "Pilot",
  "Figure",
  "Vector",
  "Gradient",
  "Manifold",
  "Cantilever",
  "Oscillator",
  "Goose",
  "Walrus",
  "Hovercraft",
  "Tesseract",
  "Capacitor",
  "Phoenix",
  "Mongoose",
  "Sasquatch",
  "Comet",
  "Gizmo",
  "Llama",
  "Dynamo",
  "Wombat",
];

export const MUG_SINGLE_WORDS: readonly string[] = [
  "Lissajous",
  "Hilbert",
  "Maxwell",
  "Schrodinger",
  "Bernoulli",
  "Babbage",
  "Fourier",
  "Archimedes",
  "Pythagoras",
  "Mjolnir",
  "Voltron",
  "Zeppelin",
  "Kraken",
  "Nimbus",
  "Boson",
  "Quark",
  "Photon",
  "Tardigrade",
  "Catalyst",
  "Paradox",
];
