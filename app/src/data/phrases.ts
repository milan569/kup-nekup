import type { Verdict } from "../api/types";
import type { VerdictText } from "../api/verdicts";

/**
 * What the hero says while the AI is still working on a product the rules
 * could not judge. Rotates every few seconds so the wait feels alive.
 */
export const WORKING_HUMOR: VerdictText[] = [
  { label: "Hrabeme se v tom…", subtitle: "Etiketa, web, výrobce. Chvilku to trvá." },
  { label: "Pracujeme, skoč si na keramiku", subtitle: "Až se vrátíš, bude jasno." },
  { label: "Trpělivost…", subtitle: "Prohrabáváme web, co je tohle za výrobek." },
  { label: "Počítej ovečky", subtitle: "Do dvaceti to stihneme." },
  { label: "Luštíme etiketu", subtitle: "Výrobce to nenapsal zrovna čitelně." },
  { label: "Lustrujeme výrobce", subtitle: "Kdo to dělá a co má za ušima." },
  { label: "Googlíme jak o život", subtitle: "Recenze, testy, kauzy." },
  { label: "Čteme drobný písmo", subtitle: "To, co výrobce schoval úplně dolů." },
  { label: "Hledáme kostlivce ve skříni", subtitle: "Stažení z trhu, změny receptury, průšvihy." },
  { label: "Dej si zatím kafe", subtitle: "Bleskový průzkum na webu běží." },
  { label: "Šťouráme do toho", subtitle: "Složení, cena, pověst." },
  { label: "Rozbalujeme to", subtitle: "Co je uvnitř a co to stojí." },
  { label: "Ptáme se internetu", subtitle: "Ten ví všechno, jen mu to trvá." },
  { label: "Nahlížíme pod pokličku", subtitle: "Co se do reklamy nevešlo." },
  { label: "Zatím hovno víme", subtitle: "Ale za chvilku budeme." },
  { label: "Vyslýcháme etiketu", subtitle: "Mluví neochotně, ale mluví." },
];

export const WORKING_SERIOUS: VerdictText[] = [
  { label: "Zjišťujeme…", subtitle: "Ověřujeme výrobek na webu." },
  { label: "Pracujeme na tom", subtitle: "Složení, výrobce, recenze." },
  { label: "Ještě chvilku", subtitle: "Rychlý průzkum běží." },
  { label: "Hledáme podklady", subtitle: "Testy, hodnocení, výrobce." },
];

/** When even the AI came back empty-handed: one of these, picked by the product (not changing on every render). */
export const NEVIME_HUMOR: VerdictText[] = [
  { label: "Hovno víme", subtitle: "Vyfoť etiketu a rozlouskneme to." },
  { label: "Záhada v obalu", subtitle: "Bez etikety jsme slepí. Vyfoť ji." },
  { label: "Tma jako v pytli", subtitle: "Složení nikde. Zkus fotku zadní strany." },
  { label: "Etiketa mlčí", subtitle: "Dej nám složení a bude řeč." },
  { label: "Ani ťuk", subtitle: "Databáze ani web nic. Fotka etikety pomůže." },
  { label: "Sfinga v regálu", subtitle: "Nic nevydala. Vyfoť ji zezadu." },
];

/** stable pick for a product: the same product always shows the same phrase */
export function pickStable<T>(list: T[], seed: string | undefined): T {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}

/**
 * Companion lines under the main verdict (humour tone). One is picked at
 * random when a result opens and they slowly rotate, so the same verdict
 * does not always say the same thing. The first entry is the classic one.
 */
export const VERDICT_SUBTITLES: Record<Exclude<Verdict, "nevime">, string[]> = {
  poklad: [
    "Poctivá práce bez keců. Ber, dokud to mají.",
    "Tohle by ti pochválila i babička, a ta byla přísná.",
    "Složení jak modlitba: krátké a všichni mu rozumějí.",
    "Konečně někdo, kdo si z nás nedělá prdel.",
    "Kup dvě, jedna se domů nedoveze.",
    "Tady výrobce nešetřil. Šetřil jenom chemií.",
    "Vzácný úkaz: etiketa, u které se nemusíš křižovat.",
    "Zlatej regál, že tohle ještě existuje.",
    "Žádná palma, žádný éčka, žádný fígle.",
    "Takhle to má vypadat. Ostatní, učte se.",
  ],
  urcite_kup: [
    "Žádné triky, žádný šmejd. Klidně dvakrát.",
    "Slušná věc, ber a nepřemýšlej.",
    "Výrobce se nestyděl napsat, co tam je. Dobře dělá.",
    "Tohle hodíš do košíku s čistým svědomím.",
    "Pár drobností, ale nic, co by stálo za řeč.",
    "Poctivě uděláno, žádná laboratoř.",
    "Jo, tohle jo. Ber.",
    "Nehledej lepší, moc jich není.",
    "Složení dává smysl i bez slovníku.",
    "Když váháš, neváhej.",
  ],
  jsou_lepsi: [
    "Žádná tragédie, ale o regál vedle mají lepší.",
    "Dá se. Ale za stejný prachy jde koupit líp.",
    "Průměr. Solidní, nudný průměr.",
    "Nezklame, nenadchne, nezůstane v paměti.",
    "Když není nic jiného, posloužíš si.",
    "Ujde to jak pondělí. Přežiješ ho.",
    "Pár fíglů ve složení, ale nic kriminálního.",
    "Tohle koupíš, když ti je to jedno.",
    "Mohlo to být horší. Mohlo to být i lepší.",
    "Lepší než nic, horší než soused v regálu.",
  ],
  kup_jestli_musis: [
    "Hlady nechcípneš, ale radost z toho mít nebudeš.",
    "Když hoří a všude jinde je zavřeno.",
    "Výrobce ušetřil, ty to sníš.",
    "Dobré leda na výlet, kde není nic jiného.",
    "Tohle kupuj jen s plným žaludkem.",
    "Průmyslovka jak vyšitá. Sníst se to dá, s odpuštěním.",
    "Chuť nahradila chemie a cukr. Funguje to, bohužel.",
    "Jednou za čas tě to nezabije. Dvakrát už přemýšlej.",
    "Nouzovka na pultě i v žaludku.",
    "Kup, když musíš. Ale musíš fakt?",
  ],
  radsi_ne: [
    "Víc laboratoř než kuchyně. Nech to tam.",
    "Složení delší než tvoje novoroční předsevzetí.",
    "Éčka v tom mají večírek a ty jsi na seznamu hostů.",
    "Tohle nevařil kuchař, ale technolog s kalkulačkou.",
    "Vrať to do regálu a umyj si ruce.",
    "Výrobce ti lže už obalem.",
    "Chuť z pytlíku s aromatem, výživa žádná.",
    "Jídlo je to jen podle zákona.",
    "Kdyby to mohlo mluvit, omluvilo by se.",
    "Chemickej koktejl za cenu jídla.",
  ],
  nekupuj: [
    "Ošizené jak prase. Ruce pryč!",
    "Za tohle by měl někdo sedět.",
    "Náhražka náhražky. Nech to ležet.",
    "Výrobce šetřil na všem kromě reklamy.",
    "To není jídlo, to je podvod v celofánu.",
    "Tohle nekupuj ani naschvál.",
    "Prasárna, co stojí jako poctivá věc.",
    "Separát, voda a kouzla s etiketou.",
    "Vyhoď ty prachy radši z okna, aspoň někomu uděláš radost.",
    "Prázdný regál by byl lepší volba.",
  ],
  sracka: [
    "Tohle by nežral ani hladovej pes. Utíkej!",
    "Dno. Pod tím už je jen kanál.",
    "Spal to a popel zakopej.",
    "Kdyby existovalo něco horšího, vymyslí to ten samý výrobce.",
    "To není jídlo, to je útok na organismus.",
    "Vrať to a chtěj omluvu.",
    "Horší už jen kdyby ti to naúčtovali dvakrát.",
    "Ani v nouzi. Hlad je lepší.",
    "Složení jak policejní protokol.",
    "Sračka s velkým S a tučným písmem.",
  ],
};

/** The same for drink (alcohol label set). */
export const ALCOHOL_SUBTITLES: Record<Exclude<Verdict, "nevime">, string[]> = {
  poklad: [
    "Tohle se neleje, tohle se vychutnává. Ber, dokud to mají.",
    "Řemeslo, co voní z láhve ještě přes sklo.",
    "Na tohle se neřve, na tohle se připíjí.",
    "Takhle to chutná, když to někdo umí.",
    "Schovej to před návštěvou.",
    "Jedna flaška, žádná výčitka.",
  ],
  urcite_kup: [
    "Poctivě vyrobený, chutná a ráno z něj hlava nebolí.",
    "Žádnej patok, klidně otevři druhou.",
    "Slad, chmel, voda a řemeslo. Tak to má být.",
    "Pije se samo a bez výčitek.",
    "Dobrá volba na stůl i do tašky.",
    "Nic, za co by ses musel stydět.",
  ],
  jsou_lepsi: [
    "Žádná tragédie, ale za stejný prachy ti nalejou lepší.",
    "Uhasí žízeň, duši ne.",
    "Pivo jak pondělí. Dá se.",
    "Dopiješ, ale druhý si nedáš.",
    "Průměr, co nikoho neurazí ani nenadchne.",
    "Na zapití jo, na vychutnání ne.",
  ],
  kup_jestli_musis: [
    "Patok na žízeň. Když není nic lepšího, přežiješ to.",
    "Chutná jak voda, co prošla kolem sladu.",
    "Kup, když je zavřeno a žízeň velká.",
    "Řidší než výmluvy ráno po.",
    "Spláchneš a zapomeneš.",
    "Pití pro ty, kterým je to jedno.",
  ],
  radsi_ne: [
    "Líh, aroma a cukr. Ráno ti to spočítá.",
    "Kocovina v akci, dnes za polovic.",
    "Chuť z laboratoře, následky z pekla.",
    "Láhev říká destilát, složení říká aroma.",
    "Tohle pijou jen ti, co už nic nepoznají.",
    "Bolí to už při čtení etikety.",
  ],
  nekupuj: [
    "Ošizené jak prase. Ruce pryč!",
    "Barvený líh za cenu poctivé flašky.",
    "Tohle nalejou jen tomu, kdo nekouká.",
    "Prasárna, co uráží i to sklo.",
    "Vylij, umyj, zapomeň.",
    "Za tohle by se styděl i pančovaný rum.",
  ],
  sracka: [
    "Na čištění oken ano, do huby ne. Utíkej!",
    "Játra si zaslouží lepší konec.",
    "To není chlast, to je rozpouštědlo.",
    "Horší by bylo jen pít rovnou z kanystru.",
    "Tím se neopíjej, tím se odmašťuj.",
    "Dno láhve i dno trhu.",
  ],
};
