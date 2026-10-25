# Kup / Nekup – prototyp

Aplikace pro iPhone, která v obchodě odpoví na otázku „Mám to koupit?“.
Zadání a rozhodnutí jsou v [ZADANI.md](ZADANI.md).

```
app/      Expo (React Native) aplikace – běží v Expo Go na iPhonu
server/   Node.js server – Open Food Facts, pravidla, posudek AI, cache
```

## 1. Jak verdikt vzniká

1. **Pravidla, do 2 sekund.** Složení z Open Food Facts nebo z fotky etikety projde pravidly v `server/src/scoring.ts` a `server/src/category.ts`: rizika E-čísel, NOVA, Nutri-Score, nežádoucí přísady, cukr na prvním místě, alergeny a diety z profilu. Pro uzeniny, mléčné výrobky a cukrovinky platí odborná pravidla: podíl masa, voda a kůže v uzeninách, rostlinný tuk v „másle“, zahušťovadla v jogurtu, kakaová poleva a rostlinné tuky v čokoládě, značky kvality.
2. **Rychlý názor AI, 12–20 sekund, vždy s webem.** Spustí se sám po otevření výsledku. Claude udělá nejvýš 3 vyhledávání a vrátí titulek, krátký názor, verdikt a 1–3 zdroje. Když model nic nevyhledá, server ho jednou pobídne; když zdroje neocituje, ukáže 2 nejlepší výsledky vyhledávání (`quickInsight` v `server/src/insight.ts`).
3. **Důkladný průzkum, jen na tlačítko „🔎 Důkladný průzkum (1–2 min)“, pak z cache okamžitě.** Když složení chybí, Claude ho dohledá na webu (e-shopy, výrobce, Open Food Facts), přečte stránku a pravidla pak hodnotí skutečné složení. Navrhne 2–4 lepší výrobky dostupné ve vašich zemích. Každou alternativu server dohledá v Open Food Facts: s nalezeným EAN dostane fotku balení a verdikt z našich pravidel, jinak fotku ze stránky obchodu a odhad AI. Karta ukazuje, jestli je alternativa lepší, podobná nebo horší (`server/src/alternatives-enrich.ts`). Dále prohledá web: kdo výrobek vyrábí a vlastní, převzetí a prodeje značky, zhoršení receptury a zmenšování balení, ocenění, Potraviny na pranýři a stažení z trhu, spotřebitelské testy. Vrátí jasný názor se zdroji. Odkazy, které vyhledávání skutečně nevrátilo, server zahodí, stejně jako kauzy bez zdroje (`server/src/insight.ts`).
4. **Spojení.** Když je posudek AI přísnější než pravidla, platí celý (AI četla skutečné složení, zdroje a cenu); když je mírnější, verdikt se zlepší jen o jeden stupeň. Dřívější pravidlo „nejvýš o jeden stupeň oběma směry“ vedlo k tomu, že nad textem o cukrové bombě svítilo „Ber a neřeš“. U ručního zadání bez etikety rozhoduje posudek. Alergen z profilu nikdy nezlepší. Složení dohledané na webu nikdy nedá „Poklad“ a cukr schovaný jako první složka závorky („ovocná složka 18 % (cukr, …)“) se počítá jako cukr vysoko ve složení.

Škála má 7 stupňů a „Nevíme“. Popis, barvy a pásma bodů jsou v `server/src/verdicts.ts`:

| Stupeň | Vtipně | Slušný režim | Body |
|---|---|---|---|
| 💎 | Poklad z regálu! | Výborná volba | 88–100 |
| 👍 | Ber a neřeš | Určitě kup | 74–87 |
| 🙂 | Ujde to | Nic proti, ale jsou lepší | 60–73 |
| 😐 | Nouzovka | Kup, jestli musíš | 46–59 |
| 🧪 | Chemický šmejd | Raději ne | 32–45 |
| ⛔ | Šizená prasárna | Nekupuj! | 16–31 |
| 💩 | Naprostá sračka | Naprosto nevhodné | 0–15 |
| ❓ | Hovno víme | Nevíme | – |

U alkoholu má vtipný režim vlastní stupnici (`ALCOHOL_HUMOR` v `server/src/verdicts.ts`): Nektar bohů · Dobrej chlast · Dá se vypít · Slabej odvar · Bolehlav · Šizený chcanky · Technickej líh. Server označí hodnocení nápoje polem `labelSet`, aplikace podle něj vybere popisky.

„Poklad“ dostane jen produkt bez jediné výhrady. Slušný režim se zapíná v Profilu. Vtipný režim mluví záměrně sprostě, aby byla pointa jasná na první pohled; sprostota míří jen na produkt (`toneInstruction` v `server/src/claude.ts`).

**Hledání podle názvu.** Databáze (search-a-licious) hledá kterékoli slovo dotazu, proto server výsledky řadí podle podílu slov dotazu nalezených v názvu a značce bez ohledu na diakritiku (`rankCandidates` v `server/src/off.ts`) a posílá `match` 0–1. Když žádný kandidát neobsahuje všechna slova, aplikace řekne, že přesná shoda chybí, a nabídne posouzení výrobku podle názvu AI (ruční cesta) nebo fotku etikety; mnoho českých výrobků (např. Zlaté Koka) v databázi vůbec není.

**Alternativy jsou vždy lepší.** Uživatel hledá alternativu, aby koupil lépe: AI má začít tím nejlepším v daném druhu (máslo a kakaové máslo místo palmy, bez ztužených tuků, krátké složení, poctivý výrobce) a navrhnout aspoň 3 výrobky; server po dohledání verdiktů vyřadí vše, co není lepší než posuzovaný výrobek (`keepNotWorse` v `server/src/alternatives-enrich.ts`), a aplikace řekne, kolik návrhů vyřadil. Alternativy z databáze musí sdílet nejpřesnější kategorii výrobku (snídaňová sušenka není alternativa oplatky).

**Nejbližší alternativy v zemi.** V sekci Alternativy jde vybrat zemi (vaše země první, pak zbytek regionu) a spustit cílené hledání (`POST /api/alternatives/research`, do 1 min, asi 0,1–0,2 USD): AI si nejdřív ujasní přesný druh výrobku a hledá jen stejný druh a stejné použití v e-shopech řetězců dané země (za čokoládovou oplatku jinou oplatku, ne tabulku čokolády), výsledky dostanou fotku a verdikt stejně jako tipy z průzkumu (`server/src/alternatives-research.ts`).

**Zničení tradiční značky.** Když značku vlastní koncern nebo změnila majitele, důkladný průzkum musí doložit: co bylo ve složení dřív a co je teď, změny gramáže, reakce zákazníků (Heureka, Vitalia, diskuse, bojkot), sourozenecké výrobky se stejným osudem a postoj výrobce; výsledek je v kartě Historie a receptura.

**⚖️ Porovnat** je záložka pro 2–4 výrobky z košíku (sken, fotka, galerie, ruční zadání, historie, nebo tlačítko „Porovnat s jiným výrobkem“ u výsledku). Rychlé porovnání (`POST /api/compare/quick`, 10–20 s, asi 0,03–0,06 USD) řekne, zda jsou výrobky srovnatelné (stejný druh, jen orientačně, nesrovnatelné), seřadí je, u každého uvede plus, minus a verdikt (nejvýš o stupeň od pravidel) a vítěze. Důkladné porovnání (`POST /api/compare`, 1–3 min) nejdřív udělá průzkum každého výrobku (z cache, pokud už proběhl) a srovná je podle historie, receptur, testů a ceny; stojí součet průzkumů. Každé porovnání se uloží do Historie (filtr „Porovnání“), dá se označit hvězdičkou a znovu otevřít; úložiště je `app/src/storage/comparisons.ts`. Logika je v `server/src/compare.ts`, košík v `app/src/compare.tsx`.

**dTest.** Podmínky užívání dtest.cz (ověřeno 24. 10. 2026) dovolují odkazovat, ale zakazují zveřejňovat nebo jinak užívat výsledky testů bez souhlasu dTestu; web navíc chrání antibotová ochrana a robots.txt žádá nejvýš 10 požadavků za minutu. Aplikace proto na dTest jen odkazuje: řádek „dTest“ ve výsledku otevře nalezenou stránku testu, nebo vyhledávání výrobku (`https://www.dtest.cz/search?q=…`) v prohlížeči, kde je předplatitel přihlášený a vidí hodnocení. Průzkum i rychlý názor zjišťují, zda dTest v posledních letech testoval daný druh výrobku, a veřejně známá zjištění (shrnutí testu, tisková zpráva, články médií) promítnou do názoru a verdiktu; řádek dTest ukáže název testu, rok, zjištění a zdroj (`dtestRef` v `server/src/insight.ts`). Hodnocení za přihlášením se neodhadují ani nekopírují. Server stránky dTestu sám nestahuje.

**Alkohol, káva, čaj a koření** se nehodnotí podle zdraví. Alkohol (pivo, víno, cider, destiláty, likéry) škodí stejně v každé lahvi. Pravidla posuzují poctivost výroby (pivo ze sladu vs. s cukrem, sirupem nebo kukuřicí, pravý destilát vs. líh s aromatem, aromatizované víno, označení původu) bez Nutri-Score a NOVA. Verdikt vede AI podle recenzí, hodnocení chuti a reputace. Zdraví se ozve jen u rizikových výrobků (alkohol s kofeinem nebo energetickými látkami, velmi sladké likéry); to AI nepřebije (`alcoholRules` v `server/src/category.ts`). Káva: 100 % arabika, zrnková, původ, bez aromatizace a cikorky. Čaj: sypaný list, původ, bez aromatizace, ovocné čaje hlavně z ibišku, sena v „detox“ čajích. Koření: čistota bez soli, plnidel, glutamátu a barviv, kumarin v kasii. Slazené nápoje jako ledový čaj nebo „3v1“ zůstávají u běžných pravidel (`QUALITY_FIRST`).

**💸 Vyhozený prachy** je cenový štítek vedle verdiktu kvality. AI při rychlém názoru i průzkumu hledá ceny (e-shopy řetězců, letáky) a porovná je za kg nebo litr se stejně kvalitními výrobky. Když se platí hlavně za značku, obal nebo marketing (předražená voda je pořád H2O), ukáže štítek s cenou, levnější volbou a odkazem na cenu a verdikt sníží nejvýš na „Ujde to“. Bez stránky s cenou z vyhledávání se štítek nezobrazí. Opačný štítek je 💰 „Za ty prachy dobrý“ (`applyValue` v `server/src/insight.ts`).

**Složení česky.** Cizojazyčné složení (srbsky, anglicky, německy…) přeloží malý rychlý model `claude-haiku-5-5` přes `POST /api/ingredients/translate` do 1–3 s, asi za 0,001 USD. Každý text se překládá jen jednou, pak jde z cache. V aplikaci se dá přepnout na originál. Model lze změnit proměnnou `TRANSLATE_MODEL` v `server/.env`.

**Klepnutí na složku** ukáže, co složka dělá s tělem při nadměrné konzumaci, jak moc vadí jednou za čas, limit (ADI) a rizikové skupiny. Texty jsou napsané předem v `server/data/health/` (aditiva, nežádoucí složky, běžné suroviny), takže klepnutí nic nestojí. Server je hledá v `server/src/health.ts` přes `POST /api/ingredient`.

**Už hodnoceno.** Když má historie stejný výrobek (název a značka, bez ohledu na gramáž, objem, ročník nebo balení) s posudkem AI, výsledek se ukáže z historie bez nové analýzy, s datem a tlačítkem „Analyzovat znovu“ (`findSimilar` v `app/src/storage/history.ts`). Mezitím, co AI pracuje, hero i karta posudku rotují vtipné hlášky (`app/src/data/phrases.ts`), a „Hovno víme“ má šest variant vybraných podle výrobku. Pod každým hlavním verdiktem ve vtipném režimu je jedna z deseti doprovodných hlášek (alkohol šest), vybraná náhodně a střídaná každých sedm sekund (`VERDICT_SUBTITLES` tamtéž).

**📷 Doplnit fotku** ve výsledku přidá další fotku téhož výrobku (zadní etiketu se složením, přední stranu s názvem, tabulku živin). Server ji sloučí s tím, co už ví (`supplementProduct` v `server/src/claude.ts`) a řekne, co fotka přidala. Je to upřesnění, ne nový posudek: když fotka nic nového nepřinese, názory i verdikt zůstanou. Když přinese složení nebo údaje, AI dostane svůj předchozí rychlý názor a upraví ho jen tam, kde nové údaje něco mění, nejvýš o jeden stupeň; dřívější zdroje zůstanou. Důkladný průzkum se převezme bez nového placení. Doplněný výrobek se uloží i pod čárovým kódem, takže příští sken už není „neznámý“.

**Alternativy bez čárového kódu** dohledá server jedním levným webovým vyhledáváním (stránka výrobku v e-shopu řetězce, z ní fotka). Klepnutí na kartu vždy otevře rozbor v aplikaci.

**Fotky balení** u výsledku i u alternativ se klepnutím otevřou přes celou obrazovku. Z Open Food Facts přijde přední strana, složení, nutriční hodnoty a obal; přejetím se listuje a roztažením prstů přibližuje.

## 2. Server doma na PC

Požadavky: Node 24+ (je nainstalován).

```bash
cd server
copy .env.example .env
```

Do `server/.env` doplňte svůj Claude API klíč z Claude Console:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Klíč zůstává jen v tomto souboru. Soubor `.env` je v `.gitignore`. Server posílá klíč výhradně na `https://api.anthropic.com`.

Spuštění:

```bash
cd server
npm run dev
```

Server vypíše adresu ve tvaru `http://192.168.x.x:8787`. Kontrola: `http://localhost:8787/api/health` má vrátit `"hasKey": true`.

**NordVPN:** při testování na telefonu VPN pozastavte, nebo v NordVPN zapněte „Local network discovery“. Jinak iPhone PC v síti nevidí.

**Windows Firewall:** při prvním spuštění povolte Node.js pro soukromé sítě. Pokud dotaz nepřišel, spusťte jednou v PowerShellu jako správce:

```powershell
netsh advfirewall firewall add rule name="KupNekup server" dir=in action=allow protocol=TCP localport=8787
netsh advfirewall firewall add rule name="Expo Metro" dir=in action=allow protocol=TCP localport=8081
```

## 3. Aplikace na iPhonu (doma)

1. Na iPhone nainstalujte z App Store aplikaci **Expo Go** (zdarma).
2. iPhone i PC musí být na stejné Wi-Fi.
3. Spusťte:

```bash
cd app
npx expo start
```

4. QR kód z terminálu naskenujte kamerou iPhonu, otevře se v Expo Go.
5. V aplikaci: **Profil → Nastavení serveru**, zadejte adresu serveru a stiskněte **Otestovat spojení**.

## 4. Provoz online (v obchodě bez PC)

Doma aplikace potřebuje zapnuté PC dvakrát: server a vývojový server Expo. Pro obchod se obojí přesune online.

**Jednorázově (dělá uživatel):**

1. Účet na [fly.io](https://fly.io/app/sign-up) a platební karta v sekci Billing. Malý stále připravený stroj s diskem stojí řádově jednotky USD měsíčně.
2. Instalace nástroje `fly`:

```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

3. V novém terminálu přihlášení: `fly auth login`.
4. Účet na [expo.dev](https://expo.dev/signup), pak ve složce `app`: `npx expo login`.
5. Na iPhonu v Expo Go přihlášení ke stejnému účtu (ikona účtu vpravo nahoře). Expo Go načítá publikovanou aplikaci jen členům účtu, který ji vlastní.

**Server na Fly.io:** ve složce `server` spusťte `.\fly-deploy.ps1`. Skript založí aplikaci a disk pro cache, předá Fly.io Claude klíč ze `server/.env` a přístupový klíč ze `server/.env.fly` (nic nevypisuje) a server nasadí. Sestavení běží na serverech Fly.io, Docker na PC není potřeba. Název serveru a přístupový klíč jsou v `server/.env.fly`, který se nikam nenahrává.

**Aplikace přes EAS Update:** publikuje se do kanálu `production` s adresou serveru na Fly.io. `app.json` má `runtimeVersion` s politikou `sdkVersion`, jinak by ji Expo Go nenačetl. Po publikování ji otevřete naskenováním QR kódu na stránce aktualizace na expo.dev.

**Nasazeno 23. 10. 2026:**

| Co | Kde |
|---|---|
| Server | `https://kup-nekup-ntjn.fly.dev` (Fly.io, Frankfurt) |
| Projekt Expo | `@msch0l2/kup-nekup`, kanál `production`, runtime `exposdk:58.0.0` |
| Otevření v Expo Go | QR kód `kup-nekup-expo-go-qr.svg` nebo odkaz `exp://u.expo.dev/bc04395f-e91d-4a7f-9b1a-023c63eadf7f?runtime-version=exposdk%3A58.0.0&channel-name=production` |

Nová verze aplikace se publikuje příkazem ve složce `app` (adresu serveru doplní proměnná `EXPO_PUBLIC_API_URL` uložená v projektu Expo):

```powershell
$env:EAS_NO_VCS = "1"   # dokud projekt není v gitu
npx eas-cli update --channel production --environment production --platform ios --message "popis změny"
```

Nová verze serveru: znovu `server/fly-deploy.ps1`.

V aplikaci pak jednou zadejte **Profil → Nastavení serveru → Přístupový klíč** ze `server/.env.fly`. Bez něj server odmítne vše kromě kontroly zdraví. Dotazy na AI jsou navíc omezené na 60 za hodinu.

Pro samostatnou ikonu na ploše místo Expo Go je potřeba Apple Developer účet a TestFlight (`eas build` + `eas submit`).

## 5. Náklady na AI (odhad)

| Operace | Kdy | Odhad za jeden produkt |
|---|---|---|
| Čárový kód + pravidla | pokaždé | zdarma |
| Fotka etikety | když chybí v databázi | cca 0,02–0,05 USD |
| Rychlý názor AI s webem | první otevření produktu | naměřeno 0,03–0,07 USD (1–3 vyhledávání) |
| Důkladný průzkum | jen na tlačítko | naměřeno 0,11–0,36 USD (až 10 vyhledávání, 1–4 přečtené stránky); skutečnou cenu vypisuje log serveru |
| Obojí z cache | 14 dní po prvním | zdarma |

Odhady vycházejí z ceníku Claude Opus 5.5 a webového vyhledávání a liší se podle délky nalezených stránek. Levnější varianta je `INSIGHT_MODEL=claude-sonnet-5-5` v `server/.env`, přibližně za poloviční cenu.

## 6. Vývoj a testy

```bash
cd server && npm run typecheck && npm test
cd app && npx tsc --noEmit
```

Datové tabulky: `server/data/additives.json` (rizika 294 E-čísel), `unwanted.json` (33 nežádoucích přísad ve více jazycích včetně cyrilice), `allergens.json` (14 alergenů EU). Cache je v `server/data/cache.sqlite` a lze ji kdykoli smazat. Při změně tabulek se cache produktů obnoví sama.

Před nasazením změny schémat AI nástrojů spusťte v `server/` kontrolu, kterou unit testy nepokryjí (API odmítá příliš velké přísné schéma až za běhu; stojí asi cent):

```bash
npm run check:tools
```

## 7. Řešení problémů

| Co vidíte | Příčina a řešení |
|---|---|
| „Server odmítl přístup“, nebo se po skenu či fotce nic nestane | Chybí nebo nesedí přístupový klíč. V Profil → Nastavení serveru opište `APP_TOKEN` ze `server/.env.fly` a stiskněte **Uložit a otestovat**. Má se ukázat „✓ Přístupový klíč platí“. |
| V Expo Go je pořád stará verze | Expo Go stáhne novou verzi při otevření a použije ji při dalším otevření. Aplikaci zavřete (přejetím nahoru v přepínači aplikací) a otevřete znovu, případně dvakrát. |
| „Serveru chybí Claude klíč“ | Na Fly.io chybí tajná hodnota. Spusťte znovu `server/fly-deploy.ps1`. |
| Co se na serveru děje | `fly logs --app kup-nekup-ntjn` ukáže každý dotaz a odmítnutý klíč (bez jeho hodnoty). |

## 8. Známá omezení

- Starší vyhledávání Open Food Facts vrací většinou chybu 503. Server hledá přes novější službu search.openfoodfacts.org a starou používá jen jako zálohu.
- Pokrytí Černé Hory a Balkánu v databázi je slabé. Tam je hlavní cestou fotka etikety, posudek AI pak doplní kontext.
- Posudek AI je tak dobrý, jak dobré zdroje najde. Kauzy a změny receptury bez zdroje server zahazuje, takže u málo známých značek bude posudek stručnější.
- Výsledky testů dTestu jsou zatím jen z veřejně dostupných článků. Napojení na vaše předplatné vyžaduje ověřit podmínky dTestu.
