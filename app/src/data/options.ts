export interface Option {
  key: string;
  label: string;
}

export const COUNTRIES: Option[] = [
  { key: "cz", label: "Česko" },
  { key: "sk", label: "Slovensko" },
  { key: "me", label: "Černá Hora" },
  { key: "rs", label: "Srbsko" },
  { key: "hr", label: "Chorvatsko" },
  { key: "ba", label: "Bosna a Hercegovina" },
  { key: "si", label: "Slovinsko" },
  { key: "mk", label: "Severní Makedonie" },
  { key: "al", label: "Albánie" },
  { key: "de", label: "Německo" },
  { key: "at", label: "Rakousko" },
  { key: "pl", label: "Polsko" },
  { key: "hu", label: "Maďarsko" },
];

export const STORES_BY_COUNTRY: Record<string, Option[]> = {
  cz: [
    { key: "lidl", label: "Lidl" },
    { key: "kaufland", label: "Kaufland" },
    { key: "albert", label: "Albert" },
    { key: "billa", label: "Billa" },
    { key: "tesco", label: "Tesco" },
    { key: "penny", label: "Penny" },
    { key: "globus", label: "Globus" },
  ],
  me: [
    { key: "voli", label: "Voli" },
    { key: "idea", label: "Idea" },
    { key: "mega-market", label: "Mega Market" },
    { key: "hdl", label: "HDL" },
    { key: "aroma", label: "Aroma" },
  ],
  sk: [
    { key: "lidl", label: "Lidl" },
    { key: "kaufland", label: "Kaufland" },
    { key: "tesco", label: "Tesco" },
    { key: "billa", label: "Billa" },
  ],
  rs: [
    { key: "maxi", label: "Maxi" },
    { key: "lidl", label: "Lidl" },
    { key: "roda", label: "Roda" },
    { key: "idea", label: "Idea" },
  ],
  hr: [
    { key: "konzum", label: "Konzum" },
    { key: "lidl", label: "Lidl" },
    { key: "kaufland", label: "Kaufland" },
    { key: "plodine", label: "Plodine" },
    { key: "spar", label: "Spar" },
  ],
};

export function storeLabel(key: string): string {
  for (const list of Object.values(STORES_BY_COUNTRY)) {
    const found = list.find((s) => s.key === key);
    if (found) return found.label;
  }
  return key;
}

export function countryLabel(key: string): string {
  return COUNTRIES.find((c) => c.key === key)?.label ?? key.toUpperCase();
}

export const ALLERGENS: Option[] = [
  { key: "gluten", label: "lepek" },
  { key: "crustaceans", label: "korýši" },
  { key: "eggs", label: "vejce" },
  { key: "fish", label: "ryby" },
  { key: "peanuts", label: "arašídy" },
  { key: "soybeans", label: "sója" },
  { key: "milk", label: "mléko" },
  { key: "nuts", label: "skořápkové plody" },
  { key: "celery", label: "celer" },
  { key: "mustard", label: "hořčice" },
  { key: "sesame-seeds", label: "sezam" },
  { key: "sulphur-dioxide-and-sulphites", label: "siřičitany" },
  { key: "lupin", label: "vlčí bob" },
  { key: "molluscs", label: "měkkýši" },
];

export function allergenLabel(tag: string): string {
  const clean = tag.replace(/^[a-z]{2}:/, "");
  return ALLERGENS.find((a) => a.key === clean)?.label ?? clean;
}

export const DIETS: Option[] = [
  { key: "vegan", label: "veganská" },
  { key: "vegetarian", label: "vegetariánská" },
  { key: "gluten-free", label: "bezlepková" },
  { key: "lactose-free", label: "bez laktózy" },
  { key: "low-sugar", label: "málo cukru" },
];

export const AVOID: Option[] = [
  { key: "palm-oil", label: "palmový olej" },
  { key: "sweeteners", label: "sladidla" },
  { key: "colours", label: "barviva" },
  { key: "flavours", label: "aromata" },
  { key: "msg", label: "glutamát" },
  { key: "nitrites", label: "dusitany" },
  { key: "hfcs", label: "glukózo-fruktózový sirup" },
  { key: "hydrogenated-fats", label: "ztužené tuky" },
];
