# Zadání: Potravinářská app (pracovní název „Kup / Nekup“)

Verze 0.1, návrh k doladění. Datum: 23. 10. 2026.
Věty označené **[předpoklad]** jsem si domyslel a lze je změnit. Body označené **[otázka]** čekají na vaši odpověď.

---

## 1. Vize

Aplikace pro iPhone, která v obchodě během pár sekund odpoví na otázku **„Mám to koupit?“**
Uživatel naskenuje čárový kód, vyfotí etiketu nebo napíše název produktu. Aplikace vrátí jasný verdikt,
stručné důvody, informace o výrobci a lepší alternativy, ideálně dostupné v řetězci, kde uživatel právě nakupuje.

Primárně potraviny, okrajově drogerie a spotřební zboží do domácnosti.
Země: nejdřív Česko a Černá Hora, pak Balkán (Srbsko, Chorvatsko, Bosna, Slovinsko, Severní Makedonie, Albánie), časem svět.

## 2. Uživatel a situace použití

- Jeden uživatel nebo malý okruh lidí, bez správy rolí.
- Používá se **v obchodě, ve spěchu, často se špatným signálem**. Z toho plyne: velké prvky, jeden hlavní úkon na obrazovce, odpověď do několika sekund, poslední výsledky dostupné offline.
- Jazyk rozhraní: čeština. **[předpoklad]** Angličtina jako druhý jazyk až ve fázi 3.
- Etikety mohou být česky, srbsky nebo černohorsky (latinka i cyrilice), chorvatsky, německy, anglicky a dalšími jazyky. Rozpoznání textu musí být vícejazyčné.

## 3. Vstupy

Pořadí podle spolehlivosti a rychlosti:

1. **Čárový kód (EAN)**. Nejrychlejší a nejpřesnější cesta. Kamera kód rozpozná automaticky, bez stisku tlačítka.
2. **Fotografie etikety**. Když kód chybí nebo produkt v databázi není. Fotku lze pořídit přímo v aplikaci **nebo nahrát z galerie telefonu** (dříve vyfocená etiketa). Aplikace fotku zmenší a pošle na server, kde ji přečte vizuální model (název, výrobce, složení, nutriční tabulka, země původu). Funguje pro cyrilici i latinku.
3. **Textové hledání**. Název produktu nebo výrobce, našeptávač z vlastní databáze a z Open Food Facts.
4. **[předpoklad]** Hlasové zadání až ve fázi 3.

Fotografie lze použít i jako doplněk ke kódu: když kód najde produkt bez složení, aplikace vyzve k vyfocení etikety a složení si doplní.

## 4. Výstup: verdikt a karty

### 4.1 Verdikt

Sedm stupňů a „Nevíme“ (rozšířeno 23. 10. 2026 podle přání: víc odstínů, s humorem). Každý stupeň má vtipný název a podtitulek, emoji a barvu. Slušný režim v Profilu přepne na seriózní názvy. Fakta v důvodech zůstávají věcná v obou režimech. Zdroj pravdy: `server/src/verdicts.ts`.

| Body | Vtipně | Slušně | Kdy |
|---|---|---|---|
| 88–100 | 💎 Poklad z regálu! | Výborná volba | jen produkt bez jediné výhrady: čisté složení, NOVA 1–2, Nutri-Score A/B |
| 74–87 | 👍 Ber a neřeš | Určitě kup | kvalitní volba |
| 60–73 | 🙂 Ujde to | Nic proti, ale jsou lepší | v pořádku, existují lepší |
| 46–59 | 😐 Nouzovka | Kup, jestli musíš | průmyslový výrobek, Nutri-Score E, rizikové aditivum |
| 32–45 | 🧪 Chemický šmejd | Raději ne | víc rizikových aditiv, náhražky, málo masa |
| 16–31 | ⛔ Šizená prasárna | Nekupuj! | závažné nedostatky, zakázané E171, alergen z profilu |
| 0–15 | 💩 Naprostá sračka | Naprosto nevhodné | to nejhorší: separát, hromada rizikových aditiv, podvod se složením |
| – | ❓ Hovno víme | Nevíme | chybí data, aplikace nabídne vyfocení etikety |

Verdikt vzniká ze skóre 0 až 100 a z pravidel, která ho mohou jen zhoršit (strop), nikdy zlepšit (viz 5.3). Posudek AI ho pak může posunout o jeden stupeň (viz 5.7).

### 4.2 Obrazovka výsledku

Shora dolů:

1. Velký barevný odznak s verdiktem, název produktu, výrobce, fotka.
2. **Tři až pět důvodů** jednou větou, například „Obsahuje 3 aditiva s vyšším rizikem“, „Rodinná firma z Vysočiny“, „Ocenění Regionální potravina 2025“.
3. Karty, které lze rozbalit:
   - **Složení**: seznam přísad s barevným označením, aditiva s vysvětlením, cukr, sůl, tuky, stupeň průmyslového zpracování, alergeny.
   - **Výrobce**: typ firmy, země, vlastník, ocenění, certifikace, kauzy a stažení z trhu, vždy s odkazem na zdroj.
   - **Hodnocení**: výsledky spotřebitelských testů, shrnutí recenzí z internetu, počet a tón hodnocení.
   - **Alternativy**: lepší produkty ve stejné kategorii, s verdiktem, filtr podle řetězce.
   - **Udržitelnost**: obal, původ, ekologické a etické značky. **[předpoklad]** Volitelně, lze vypnout v nastavení.
4. Tlačítka: Uložit, Nahlásit chybu, Sdílet.

Důvody a karty se načítají postupně. Verdikt ze složení přijde první, informace o výrobci a recenze se donačtou na pozadí, obrazovka mezitím ukazuje kostru a nečeká.

## 5. Kritéria hodnocení

### 5.1 Složení (váha 40 %)

- **Aditiva**: každé E-číslo má v naší tabulce úroveň rizika (žádné, nízké, střední, vysoké) a krátké vysvětlení se zdrojem. Tabulku si vytvoříme z veřejných hodnocení (EFSA, taxonomie Open Food Facts, spotřebitelské organizace).
- **Stupeň zpracování** (NOVA 1 až 4): ultrazpracované potraviny dostanou srážku.
- **Nutriční profil**: Nutri-Score nebo vlastní výpočet z cukru, soli, nasycených tuků, vlákniny a bílkovin na 100 g.
- **Délka a čitelnost složení**: méně přísad a srozumitelné názvy bodují lépe.
- **Konkrétní nežádoucí látky**: palmový olej, ztužené tuky, glukózo-fruktózový sirup, umělá sladidla, dusitany, glutamát, umělá barviva, „aroma“ bez upřesnění, nadbytek cukru v dětských produktech.
- **Náhražky**: analogy sýra, separát, „šunka“ s nízkým podílem masa, ředěné šťávy.
- **Alergeny a diety** podle profilu uživatele.

### 5.2 Výrobce (váha 25 %)

- **Typ firmy**: řemeslná nebo rodinná, střední regionální, velký průmyslový zpracovatel, privátní značka řetězce.
- **Vlastník a původ**: kdo firmu vlastní, kde vyrábí, zda jde o lokální produkci.
- **Ocenění a certifikace**: Klasa, Regionální potravina, Česká chuťovka, Great Taste, DLG, Superior Taste Award, BIO, Fairtrade, MSC, Demeter a podobné.
- **Kauzy**: záznamy v databázi Potraviny na pranýři (SZPI), stažení z trhu (RASFF), medializované problémy. Každé tvrzení má datum a odkaz. Staré kauzy mají menší váhu než čerstvé.
- **Transparentnost**: uvádí složení a původ jasně, má web s informacemi o výrobě.

### 5.3 Tvrdá pravidla (přebijí skóre)

- Alergen z profilu uživatele → **Nekupuj!** s výrazným upozorněním.
- Aktivní stažení z trhu nebo varování úřadu → **Nekupuj!**
- Chybí složení i výrobce → **Nevíme**, nikdy neodhadovat verdikt naslepo.

### 5.4 Hodnocení (váha 20 %)

- Výsledky spotřebitelských testů (dTest, Stiftung Warentest, ÖKO-TEST), pokud jsou veřejně dohledatelné.
- **dTest s předplatným** (máte k dispozici, doplněno 23. 10. 2026): pro české výrobky hlavní zdroj karty Hodnocení ve fázi 2. Před automatickým načítáním ověříme podmínky předplatného; záložní varianta je ruční import výsledků testů do naší databáze.
- Shrnutí online recenzí a diskuzí vizuálním a jazykovým modelem: celkový tón, opakované výtky, opakovaná chvála.
- Hodnocení komunity Open Food Facts a našich uživatelů.

### 5.5 Udržitelnost a etika (váha 15 %, volitelné)

- Eco-Score, obal (recyklovatelnost, množství plastu), vzdálenost původu, značky dobrých životních podmínek zvířat.

### 5.6 Cena

**[předpoklad]** V první verzi ne. Nemáme spolehlivý zdroj cen. Ve fázi 3 uživatel může cenu zadat ručně a aplikace spočítá cenu za kilogram a porovná s alternativami.

### 5.7 Odborná pravidla podle kategorie (doplněno 23. 10. 2026)

Nejčastější nákupy: uzeniny, regionální potraviny, mléčné výrobky, cukrovinky. Kategorie se pozná podle tagů Open Food Facts nebo podle názvu (`server/src/category.ts`).

- **Uzeniny**: podíl masa podle deklarace (≥ 90 % plus, 50–69 % minus, pod 50 % strop „Raději ne“), chybějící deklarace masa, voda na druhém místě, kůže a kolagen jako plnidla, separát (strop „Raději ne“), dusitany a fosfáty.
- **Mléčné výrobky**: mléko nebo smetana na prvním místě, zahušťovadla a cukr v jogurtu, „máslo“ s rostlinným tukem (strop), rostlinný tuk místo mléčného.
- **Cukrovinky**: podíl kakaa, kakaová poleva místo čokolády, rostlinné tuky místo kakaového másla, skutečné máslo jako plus.
- **Regionální a kvalitní**: Klasa, Regionální potravina, Česká chuťovka, CHOP/CHZO/ZTS jako plus.

### 5.8 Posudek AI online (doplněno 23. 10. 2026)

Požadavek: jasné názory spojené s analýzou historie značky a zhoršování receptur (např. převzetí Opavie koncernem Mondelez), vše online ve spolupráci s AI.

- **Dvě rychlosti (upraveno 23. 10. 2026 na přání):** po verdiktu z pravidel se sám spustí rychlý názor AI, vždy s webovým vyhledáváním (nejvýš 3 hledání, 12–20 s, 1–3 zdroje). Důkladný průzkum běží jen na tlačítko „🔎 Důkladný průzkum (1–2 min)“, aby bylo zřejmé, že trvá déle.
- Důkladný průzkum je průzkum Clauda s webovým vyhledáváním: výrobce a vlastník, převzetí a prodeje, přesuny výroby, změny receptury a zmenšování balení, ocenění, Potraviny na pranýři a stažení z trhu, dTest a další testy, recenze.
- Výstup: úderný titulek, jasný názor, časová osa historie, změna receptury, problémy, ocenění, testy, seznam zdrojů a vlastní verdikt AI na stejné škále.
- Ochrana proti smyšlenkám: každý odkaz musí pocházet z výsledků vyhledávání, kauzy a změny receptury bez zdroje se zahazují.
- Spojení s pravidly (upraveno 24. 10. 2026 po chybě u Balans obrok): přísnější posudek AI platí celý, mírnější zlepší verdikt jen o jeden stupeň. U ručního zadání bez etikety rozhoduje AI. Alergen se nikdy nezlepší.
- Dřív hodnocený výrobek (stejný název a značka, jiná gramáž či balení) se znovu neanalyzuje; ukáže se uložený výsledek s možností analýzy znovu. Čekání doprovází rotující vtipné hlášky.
- Alternativy z průzkumu mají fotku balení (z Open Food Facts, jinak ze stránky obchodu), verdikt na stejné škále a štítek lepší / podobná / horší oproti skenovanému výrobku. Alternativa s EAN se klepnutím otevře jako plný rozbor.
- Skenování běží bez rámečku, kód se čte v celém záběru.
- **Doplněno 23. 10. 2026 na přání:** klepnutí na kteroukoli složku (i na aditivum nebo upozornění) ukáže zdarma, co dělá s organismem při nadměrné konzumaci a nakolik škodí, když se jí jednou za čas (čtyři stupně od „v pořádku i pravidelně“ po „raději vůbec“). Data jsou předem sepsaná podle EFSA, WHO a IARC, bez volání AI.
- Fotky balení výsledku i alternativ se klepnutím zvětší, včetně dalších fotek (složení, nutriční hodnoty, obal), pokud je databáze má.
- Vtipný režim je ostřejší a sprostší, aby pointa byla jasná; slušný režim zůstává.
- **Složení vždy česky (doplněno 23. 10. 2026 na přání):** cizojazyčné složení se automaticky přeloží do češtiny, originál je o klepnutí dál. Když fotka etikety přečte české složení a databáze má jen cizí, ukáže se české z etikety.
- **Doplňková fotka (doplněno 24. 10. 2026 na přání):** ke každému výsledku jde přidat další fotku obalu; údaje se sloučí, nic známého se neztratí. Jde o upřesnění téhož výsledku, ne o nové hodnocení od nuly: bez nových údajů zůstane vše, s novými údaji AI upraví svůj předchozí názor nejvýš o jeden stupeň a průzkum se znovu neplatí. Řeší případ, kdy čárový kód v databázi není a přední etiketa zná jen název.
- **Káva, čaj a koření (doplněno 24. 10. 2026 na přání):** stejně jako alkohol se hodnotí podle kvality, původu, poctivosti a testů, ne podle Nutri-Score a NOVA; slazené nápoje (ledový čaj, 3v1) zůstávají u běžných pravidel.
- **Alternativy nikdy horší (24. 10. 2026 po Tortice):** alternativa je k tomu, aby člověk koupil lépe; výběr začíná u nejlepších výrobků daného druhu, nabízí se aspoň 3 a nic stejné nebo horší úrovně. Chyba u Romantic mešavina odhalila i mezeru v pravidlech: srbské „hidrogenovana biljna mast“ a „skrobni sirup“ se nepoznaly.
- **Alternativy podle země (24. 10. 2026 na přání):** u alternativ jde zvolit zemi nebo region a cíleným průzkumem najít nejbližší výrobky přesně stejného druhu v dané zemi; přesnost druhu je podmínka (ne čokoláda místo čokoládové sušenky).
- **Hloubka u tradičních značek (24. 10. 2026 po Fidorce):** průzkum musí doložit zhoršení receptury po převzetí konkrétně: změny složení dřív/teď, gramáž, reakce zákazníků, sourozenecké výrobky.
- **Porovnání výrobků (24. 10. 2026 na přání):** záložka Porovnat se 2–4 výrobky (fotka, galerie, sken, ruční zadání, historie). Nejdřív rychlý verdikt, který je lepší a proč, nebo stanovisko, že jsou nesrovnatelné (různý druh); důkladný rozbor až na tlačítko.
- **dTest (24. 10. 2026):** předplatné je osobní a podmínky webu zakazují užití výsledků bez souhlasu; aplikace proto pracuje s veřejnými informacemi: AI zjistí, zda dTest v posledních letech testoval daný druh výrobku, přihlédne k veřejně známým zjištěním a uvede je se zdrojem; na hodnocení dovede uživatele na dtest.cz, kde se přihlásí sám. Hlubší integrace jen se souhlasem dTestu (kontakt přes www.dtest.cz/kontakt).
- **Vlastní vtipná stupnice pro alkohol (24. 10. 2026 na přání):** „Hlady nechcípneš“ u lahve nedává smysl; nápoje mají hlášky o slabém chlastu a bolehlavu, slušný režim zůstává společný.
- **Alkohol (doplněno 24. 10. 2026 na přání):** škodlivost alkoholu je známá a stejná pro všechny, proto se alkohol hodnotí podle recenzí, hodnocení chuti, reputace a poctivosti výroby. Zdravotní vliv se uplatní jen u rizikových výrobků (alkohol s energetickými látkami, extrémně sladké likéry, podezřelý původ).
- **Kategorie „Vyhozený prachy“ (doplněno 23. 10. 2026 na přání):** předražené výrobky, které jdou ve stejné kvalitě koupit výrazně levněji, a značky známé předraženým šuntem. Jde o samostatný cenový štítek 💸 vedle verdiktu kvality, protože cena a kvalita jsou dvě různé osy (předražená voda je pořád kvalitní H2O). Předražený výrobek dostane nejvýš „Nic proti, ale jsou lepší“. Ceny hledá AI na webu; tvrzení o předražení platí jen se stránkou s cenou ze skutečného vyhledávání. Pevný seznam „předražených značek“ záměrně nemáme (nespravedlivé a právně riskantní).
- Výsledek se ukládá do cache na 14 dní, opakované otevření je okamžité. Naměřeno 23. 10. 2026: první posudek 67–84 s, z cache 0,2 s.

## 6. Alternativy a řetězce

- Alternativa je produkt stejné kategorie s lepším verdiktem, dostupný ve stejné zemi.
- Uživatel si v profilu zvolí země a řetězce, kde nakupuje. Při výsledku může jedním klepnutím přepnout „jsem teď v Lidlu“.
- **Realita dat**: řetězce nemají veřejné API sortimentu. V první verzi filtrujeme podle štítku obchodu z Open Food Facts a podle hlášení uživatelů („viděl jsem v Kauflandu“). Ve fázi 2 doplníme automatické sledování nabídek z veřejných letákových webů a e-shopů řetězců, pokud to jejich podmínky dovolí.
- **[otázka]** Které řetězce máte zahrnout jako první? Návrh: CZ Lidl, Kaufland, Albert, Billa, Tesco, Penny, Globus. ME Voli, Idea, Mega Market, HDL, Aroma.

## 7. Datové zdroje a jejich realita

| Zdroj | Co dává | Dostupnost | Poznámka |
|---|---|---|---|
| Open Food Facts | složení, Nutri-Score, NOVA, aditiva, alergeny, značky, obchody, fotky | volné API, zdarma | silné v západní EU, Česko řádově desítky tisíc produktů, Srbsko jednotky tisíc, Černá Hora velmi slabé. Dnes při ověřování vracel chybu 503, proto nutná vlastní cache |
| Open Beauty Facts, Open Products Facts | drogerie a spotřební zboží | volné API | stejná rodina jako výše |
| Vizuální a jazykový model (Claude) | čtení etikety, rozbor složení, shrnutí recenzí, text důvodů | API, platba za použití | jádro aplikace pro produkty mimo databáze a pro Balkán |
| Vlastní tabulka aditiv | riziko E-čísel se zdroji | vytvoříme | roste s používáním |
| Potraviny na pranýři (SZPI) | závadné potraviny v ČR s názvy a prodejci | veřejný web, bez API | čteme přes RSS nebo pravidelné stahování |
| RASFF Window | varování a stažení z trhu v EU | veřejný web | většinou bez značek, hodí se pro kategorii a zemi původu |
| Webové vyhledávání | výrobce, vlastník, ocenění, kauzy, recenze | API za poplatek | výsledky shrne model, uložíme do cache na výrobce, obnovujeme jednou za měsíc |
| dTest (předplatné) | výsledky testů českých výrobků | máte předplatné | fáze 2, ověřit podmínky použití, případně ruční import |
| Seznamy ocenění | Klasa, Regionální potravina, Česká chuťovka | veřejné weby | stáhneme a udržujeme |
| Vlastní databáze | každý sken a každá přečtená etiketa | naše | tím se postupně zaplní díra na Balkáně |

Pravidlo: **každé tvrzení o výrobci, které by mohlo poškodit jeho jméno, má u sebe odkaz na zdroj a datum.** Bez zdroje se nezobrazí.

## 8. Rychlost a offline

| Cesta | Cíl |
|---|---|
| čárový kód, produkt v naší cache | do 2 s |
| čárový kód, produkt jen v Open Food Facts | do 4 s |
| fotka etikety | do 8 s |
| výrobce a recenze (na pozadí) | do 15 s, poté navždy v cache |

- Kostra obrazovky se ukáže hned, verdikt ze složení první, zbytek postupně.
- Posledních 200 výsledků je uloženo v telefonu a lze je otevřít bez signálu.
- Fotku zmenšíme v telefonu na zhruba 1 000 px delší strany, aby se rychle odeslala.

## 9. Osobní profil

- Země, kde nakupuji, a oblíbené řetězce.
- Alergie a intolerance (lepek, laktóza, ořechy, …).
- Diety (vegan, vegetarián, bez cukru, …).
- Čemu se chci vyhnout (palmový olej, sladidla, barviva, …).
- Zobrazovat kartu Udržitelnost: ano / ne.
- **[otázka]** Má být profil součástí první verze, nebo až později?

Bez přihlášení. Profil i historie jsou v telefonu. **[předpoklad]** Záloha přes iCloud ve fázi 3.

## 10. Obrazovky

1. **Úvod** (3 kroky): co aplikace umí, volba země a řetězců, alergie.
2. **Sken**: hledáček kamery, automatické čtení kódu, tlačítko „Vyfotit etiketu“, pole pro název.
3. **Výsledek**: viz 4.2.
4. **Alternativy**: seznam s odznaky verdiktu, filtr podle řetězce.
5. **Výrobce**: detail se zdroji.
6. **Historie**: poslední skeny, uložené produkty.
7. **Nastavení**: profil, jazyk, smazání dat.

Grafika: čistá, hodně bílé, barva verdiktu dominuje. Velké písmo, ovladatelné jednou rukou. Tmavý režim.

## 11. Technické řešení (návrh)

### Aplikace

- **Expo (React Native, TypeScript)**. Důvod: vývoj a testování na Windows, běh na iPhonu okamžitě přes aplikaci Expo Go, sestavení pro App Store v cloudu EAS bez Macu. Později stejný kód pro Android.
- Kamera a čtení kódů: expo-camera. Zmenšení fotek: expo-image-manipulator. Lokální úložiště: SQLite.
- Testování: na fyzickém iPhonu (kamera v simulátoru nefunguje).

### Server

Server je nutný: schovává API klíče, drží sdílenou cache (rychlost a úspora), hromadí vlastní databázi produktů.

- **Node.js, TypeScript**, malý HTTP server (Hono nebo Fastify).
- Databáze **Postgres** (bezplatná úroveň u Supabase nebo Neon) pro produkty, výrobce, aditiva, hlášení uživatelů.
- Hosting: bezplatná nebo nejnižší úroveň (Fly.io, Railway nebo Cloudflare Workers).
- Integrace: Open Food Facts, Claude API (vizuální i textový model, rychlá varianta pro odpovědi v obchodě), API webového vyhledávání.
- Úlohy na pozadí: stahování Potraviny na pranýři, seznamů ocenění, obnova profilů výrobců.

### Kód a sestavení

- **GitHub**: repozitář, GitHub Actions pro kontrolu kódu a testy.
- **EAS Build a EAS Submit**: sestavení a odeslání do TestFlight z Windows.

### Higgsfield

Ověřil jsem: Higgsfield je hlavně platforma pro generování videa a obrázků. Jeho „Apps“ staví webové aplikace nad vlastními generativními modely a uživatelé se do nich hlásí účtem Higgsfield. Pro nativní iOS aplikaci s kamerou a externími daty se nehodí. **Doporučení**: nepoužít pro stavbu, případně jen pro ikonu, obrázky do App Store a propagační video.

## 12. Datový model (zjednodušeně)

- **Produkt**: EAN, název, značka, výrobce, kategorie, země, složení (seznam přísad), nutriční hodnoty, fotky, zdroj dat, datum aktualizace.
- **Výrobce**: název, vlastník, typ, země, web, ocenění, certifikace, kauzy (text, datum, odkaz), shrnutí, datum obnovy.
- **Aditivum**: E-číslo, název, riziko, vysvětlení, zdroje.
- **Hodnocení produktu**: skóre složení, výrobce, hodnocení, udržitelnost, celkové skóre, verdikt, důvody, verze pravidel.
- **Alternativa**: vazba produkt → produkt, důvod, obchody.
- **Hlášení uživatele**: produkt, typ (chyba, viděl jsem v obchodě, cena), text.
- **Sken** (jen v telefonu): produkt, čas, verdikt.

## 13. Fáze

### Fáze 0: prototyp (cíl: ověřit, že to dává smysl)

- Expo aplikace se **všemi třemi vstupy**: čárový kód, fotka etikety, ruční zadání názvu a výrobce (například v řeznictví, kde kód není).
- Dotaz na Open Food Facts, pravidla pro složení, tabulka aditiv, verdikt s důvody.
- Malý server pro Claude API (čtení fotky, posouzení ručně zadaného produktu) a cache. Klíč zůstává na serveru.
- Orientační karta Výrobce z modelu, označená jako neověřená, bez kauz.
- Profil s alergiemi a dietami, historie, alternativy podle kategorie.
- Běží v Expo Go na vašem iPhonu. Rozhodnuto 23. 10. 2026.
- **Přesunuto z fáze 2 do fáze 0 na přání (23. 10. 2026):** posudek AI s webovým průzkumem historie značky a receptur, sedmistupňová škála s humorem a slušným režimem, odborná pravidla pro uzeniny, mléčné výrobky a cukrovinky, příprava provozu online (Fly.io, EAS Update, přístupový klíč, limit dotazů).

### Fáze 1: MVP

- Server s cache a vlastní databází.
- Fotka etikety přes vizuální model.
- Tabulka aditiv se zdroji.
- Základní karta Výrobce (typ, země, ocenění z našich seznamů, záznamy z Potraviny na pranýři).
- Historie, profil, alternativy podle kategorie.
- TestFlight na vašem iPhonu.

### Fáze 2: plná verze

- Hloubkový profil výrobce z webového vyhledávání, kauzy se zdroji, vlastník.
- Shrnutí recenzí a testů.
- Alternativy podle řetězce, hlášení uživatelů.
- Drogerie a spotřební zboží.

### Fáze 3: růst

- Angličtina, Android, iCloud záloha, ruční cena, hlasové zadání.
- Automatické sledování nabídek řetězců.
- Balkán: cílené plnění vlastní databáze.

**[otázka]** Chcete začít fází 0 jako rychlým ověřením, nebo rovnou fází 1?

## 14. Účty a provozní náklady

| Položka | Nutné od | Poznámka |
|---|---|---|
| GitHub účet | fáze 0 | máte |
| Expo účet (zdarma) | fáze 0 | pro Expo Go a EAS |
| Apple Developer Program | fáze 1 (TestFlight) | placený roční poplatek, nutný i pro instalaci mimo Expo Go |
| Claude API klíč | fáze 1 | **máte** (Claude Console, kredit k dispozici). Klíč žije jen na serveru nebo v místním souboru `.env`, nikdy v aplikaci v telefonu ani v repozitáři. Platba za použití, řádově drobné částky za sken, přesnou kalkulaci udělám po volbě modelu |
| Webové vyhledávání | fáze 0 | součást Claude API (nástroj web_search), účtuje se z Claude kreditu. Posudek AI nového produktu odhadem 0,25–0,45 USD, pak 14 dní z cache zdarma |
| Hosting serveru | provoz online | Fly.io nebo podobný, řádově jednotky USD měsíčně za stále připravený malý stroj s diskem pro cache |
| Expo účet | provoz online | zdarma, pro EAS Update (aplikace v Expo Go bez zapnutého PC) |

**[otázka]** Máte Apple Developer účet, nebo jste ochoten ho zařídit? Máte k dispozici Mac? Pro fázi 0 není nutné ani jedno.

## 15. Rizika a omezení

- **Pokrytí dat na Balkáně** je slabé. Řešení: fotka etikety a vlastní databáze. První týdny v Černé Hoře bude verdikt „Nevíme“ častější.
- **Informace o výrobcích** nejsou nikde strukturovaně. Shrnutí z webu může být nepřesné. Proto vždy zdroj, datum a možnost nahlásit chybu.
- **Řetězce** nedávají data o sortimentu. Filtr podle řetězce bude zpočátku neúplný.
- **Právní stránka**: aplikace dává spotřebitelský názor, ne zdravotní radu. Tvrzení o výrobcích jen se zdrojem. V aplikaci bude krátké prohlášení. Vulgární název nejhoršího stupně je pro osobní použití v pořádku; při veřejném vydání nebo sdílení zvážit slušný režim jako výchozí (hodnocení obsahu v App Store, riziko sporu s výrobcem).
- **Závislost na externích službách**: Open Food Facts má výpadky (dnes 503). Cache a vlastní databáze jsou povinné, ne volitelné.
- **Apple App Store**: pro veřejné vydání projde kontrolou. Pro vlastní použití stačí TestFlight.

## 16. Co není v zadání (záměrně)

- Přihlašování a účty uživatelů.
- Nákupní seznam, sledování útraty.
- Sociální funkce, sdílení hodnocení mezi uživateli.
- Platby v aplikaci.

Cokoli z toho lze přidat později, ale první verze se na to nespoléhá.

## 17. Otevřené otázky (souhrn)

1. Účty: Apple Developer, dostupnost Macu. Claude API klíč je vyřešen.
2. Začít fází 0, nebo rovnou fází 1?
3. Osobní profil (alergie, diety) v první verzi?
4. Které řetězce zahrnout jako první?
