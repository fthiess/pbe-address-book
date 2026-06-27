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
}

export const PLACES: readonly Place[] = [
  { city: "Boston", state: "MA", country: "US" },
  { city: "Cambridge", state: "MA", country: "US" },
  { city: "New York", state: "NY", country: "US" },
  { city: "San Francisco", state: "CA", country: "US" },
  { city: "Palo Alto", state: "CA", country: "US" },
  { city: "Seattle", state: "WA", country: "US" },
  { city: "Austin", state: "TX", country: "US" },
  { city: "Chicago", state: "IL", country: "US" },
  { city: "Denver", state: "CO", country: "US" },
  { city: "Portland", state: "OR", country: "US" },
  { city: "Atlanta", state: "GA", country: "US" },
  { city: "Washington", state: "DC", country: "US" },
  { city: "Pittsburgh", state: "PA", country: "US" },
  { city: "Ann Arbor", state: "MI", country: "US" },
  { city: "Minneapolis", state: "MN", country: "US" },
  { city: "Toronto", state: "ON", country: "CA" },
  { city: "Vancouver", state: "BC", country: "CA" },
  { city: "London", state: null, country: "GB" },
  { city: "Munich", state: null, country: "DE" },
  { city: "Singapore", state: null, country: "SG" },
] as const;
