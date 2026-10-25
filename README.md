# Kup / Nekup

Aplikace pro iPhone, která v obchodě odpoví na otázku „Mám to koupit?“.
Zadání a rozhodnutí jsou v [ZADANI.md](ZADANI.md).

Od 25. 10. 2026 je to webová aplikace bez serveru: běží z GitHub Pages na adrese
**https://milan569.github.io/kup-nekup/**, na iPhonu se přidá na plochu a Open Food Facts
i Claude API volá přímo z telefonu. Klíč Claude se vloží jednou do Profilu a zůstává jen v telefonu.

```
app/            Expo (React Native) aplikace; `npx expo export -p web` z ní dělá statický web
app/src/core/   jádro: Open Food Facts, pravidla, posudky AI, překlady, cache (bývalý server)
app/src/core/data/   tabulky E-čísel, nežádoucích přísad, alergenů a zdravotních textů
.github/workflows/pages.yml   build a nasazení na GitHub Pages při každém push do main
server/         původní Node server (Fly.io); po ověření webové verze se maže
```

## 1. Jak verdikt vzniká

1. **Pravidla, do 2 sekund.** Složení z Open Food Facts nebo z fotky etikety projde pravidly v `app/src/core/scoring.ts` a `category.ts`: rizika E-čísel, NOVA, Nutri-Score, nežádoucí přísady, cukr na prvním místě, alergeny a diety z profilu. Pro uzeniny, mléčné výrobky a cukrovinky platí odborná pravidla: podíl masa, voda a kůže v uzeninách, rostlinný tuk v „másle“, zahušťovadla v jogurtu, kakaová poleva a rostlinné tuky v čokoládě, značky kvality.
2. **Rychlý názor AI, 12–20 sekund, vždy s webem.** Spustí se sám po otevření výsledku. Claude udělá nejvýš 3 vyhledávání a vrátí titulek, krátký názor, verdikt a 1–3 zdroje. Když model nic nevyhledá, aplikace ho jednou pobídne; když zdroje neocituje, ukáže 2 nejlepší výsledky vyhledávání (`quickInsight` v `app/src/core/insight.ts`).
3. **Důkladný průzkum, jen na tlačítko „🔎 Důkladný průzkum (1–2 min)“, pak z cache okamžitě.** Když složení chybí, Claude ho dohledá na webu (e-shopy, výrobce, Open Food Facts), přečte stránku a pravidla pak hodnotí skutečné složení. Navrhne 2–4 lepší výrobky dostupné ve vašich zemích. Každou alternativu aplikace dohledá v Open Food Facts: s nalezeným EAN dostane fotku balení a verdikt z našich pravidel, jinak odhad AI bez fotky (`app/src/core/alternatives-enrich.ts`). Dále prohledá web: kdo výrobek vyrábí a vlastní, převzetí a prodeje značky, zhoršení receptury a zmenšování balení, ocenění, Potraviny na pranýři a stažení z trhu, spotřebitelské testy. Vrátí jasný názor se zdroji. Odkazy, které vyhledávání skutečně nevrátilo, se zahodí, stejně jako kauzy bez zdroje.
4. **Spojení.** Posudek AI smí verdikt z etikety posunout nejvýš o jeden stupeň. U ručního zadání bez etikety rozhoduje posudek. Alergen z profilu nikdy nezlepší.

Škála má 7 stupňů a „Nevíme“. Popis, barvy a pásma bodů jsou v `app/src/core/verdicts.ts`:

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

U alkoholu má vtipný režim vlastní stupnici (`ALCOHOL_HUMOR` ve `verdicts.ts`): Nektar bohů · Dobrej chlast · Dá se vypít · Slabej odvar · Bolehlav · Šizený chcanky · Technickej líh. Hodnocení nápoje nese pole `labelSet`, aplikace podle něj vybere popisky.

„Poklad“ dostane jen produkt bez jediné výhrady. Slušný režim se zapíná v Profilu. Vtipný režim mluví záměrně sprostě, aby byla pointa jasná na první pohled; sprostota míří jen na produkt (`toneInstruction` v `app/src/core/claude.ts`).

**dTest.** Podmínky užívání dtest.cz (ověřeno 24. 10. 2026) dovolují odkazovat, ale zakazují zveřejňovat nebo jinak užívat výsledky testů bez souhlasu dTestu; web navíc chrání antibotová ochrana a robots.txt žádá nejvýš 10 požadavků za minutu. Aplikace proto na dTest jen odkazuje: řádek „dTest“ ve výsledku otevře nalezenou stránku testu, nebo vyhledávání výrobku (`https://www.dtest.cz/search?q=…`) v prohlížeči, kde je předplatitel přihlášený a vidí hodnocení. Průzkum i rychlý názor zjišťují, zda dTest v posledních letech testoval daný druh výrobku, a veřejně známá zjištění promítnou do názoru a verdiktu; řádek dTest ukáže název testu, rok, zjištění a zdroj (`dtestRef` v `insight.ts`). Hodnocení za přihlášením se neodhadují ani nekopírují. Aplikace stránky dTestu sama nestahuje.

**Alkohol, káva, čaj a koření** se nehodnotí podle zdraví. Alkohol škodí stejně v každé lahvi. Pravidla posuzují poctivost výroby (pivo ze sladu vs. s cukrem, sirupem nebo kukuřicí, pravý destilát vs. líh s aromatem, aromatizované víno, označení původu) bez Nutri-Score a NOVA. Verdikt vede AI podle recenzí, hodnocení chuti a reputace. Zdraví se ozve jen u rizikových výrobků (`alcoholRules` v `category.ts`). Káva: 100 % arabika, zrnková, původ, bez aromatizace a cikorky. Čaj: sypaný list, původ, bez aromatizace, ovocné čaje hlavně z ibišku, sena v „detox“ čajích. Koření: čistota bez soli, plnidel, glutamátu a barviv, kumarin v kasii. Slazené nápoje zůstávají u běžných pravidel (`QUALITY_FIRST`).

**💸 Vyhozený prachy** je cenový štítek vedle verdiktu kvality. AI při rychlém názoru i průzkumu hledá ceny (e-shopy řetězců, letáky) a porovná je za kg nebo litr se stejně kvalitními výrobky. Když se platí hlavně za značku, obal nebo marketing, ukáže štítek s cenou, levnější volbou a odkazem na cenu a verdikt sníží nejvýš na „Ujde to“. Bez stránky s cenou z vyhledávání se štítek nezobrazí. Opačný štítek je 💰 „Za ty prachy dobrý“ (`applyValue` v `insight.ts`).

**Složení česky.** Cizojazyčné složení přeloží malý rychlý model `claude-haiku-5-5` do 1–3 s, asi za 0,001 USD. Každý text se překládá jen jednou, pak jde z cache. V aplikaci se dá přepnout na originál. Model se mění v `app/src/core/config.ts`.

**Klepnutí na složku** ukáže, co složka dělá s tělem při nadměrné konzumaci, jak moc vadí jednou za čas, limit (ADI) a rizikové skupiny. Texty jsou napsané předem v `app/src/core/data/health/`, takže klepnutí nic nestojí (`app/src/core/health.ts`).

**📷 Doplnit fotku** ve výsledku přidá další fotku téhož výrobku (zadní etiketu se složením, přední stranu s názvem, tabulku živin). Aplikace ji sloučí s tím, co už ví (`supplementProduct` v `claude.ts`) a řekne, co fotka přidala. Je to upřesnění, ne nový posudek. Doplněný výrobek se uloží i pod čárovým kódem, takže příští sken už není „neznámý“.

**Hledání podle názvu** jde nejdřív do databáze Open Food Facts; ta z prohlížeče často neodpovídá, pak se jedním levným vyhledáváním (Haiku, asi 0,01 USD) najdou stránky výrobku v databázi a z nich kódy. Hledá se až po stisknutí Hledat, ne při psaní.

**Fotky balení** u výsledku i u alternativ se klepnutím otevřou přes celou obrazovku. Z Open Food Facts přijde přední strana, složení, nutriční hodnoty a obal.

## 2. Aplikace na iPhonu

1. V Safari otevřete https://milan569.github.io/kup-nekup/ a přes Sdílet → **Přidat na plochu** si ji dejte na plochu jako samostatnou aplikaci s ikonou.
2. Při prvním skenu povolte kameru.
3. Na iPhonu se přihlaste do https://platform.claude.com, v **Keys & access → Create key** vytvořte klíč třeba „Kup-nekup iPhone“, zkopírujte ho a v aplikaci vložte do **Profil → Zadat Claude API klíč → Uložit a otestovat**. Klíč zůstává jen v telefonu a posílá se výhradně na api.anthropic.com. Kdykoli ho můžete v Console zrušit.

Bez klíče funguje čárový kód a pravidla. Fotky etiket, posudky AI, překlady a hledání podle názvu při výpadku databáze potřebují klíč.

Nová verze aplikace: Expo Go ani žádný obchod už nejsou potřeba. Po každém pushi do `main` GitHub Actions web znovu sestaví a nasadí (2–4 minuty); aplikace na ploše si novou verzi stáhne při dalším otevření.

## 3. Vývoj na PC

Požadavky: Node 24+.

```bash
cd app
npm install
npx expo start --web          # http://localhost:8081 (nebo spouštěcí konfigurace „app-web“)
npm test                      # vitest, 134 testů jádra
npm run typecheck
```

Statický export jako na GitHub Pages (z Git Bash je nutné `MSYS_NO_PATHCONV=1`, jinak Git převede `/kup-nekup` na cestu):

```bash
cd app
MSYS_NO_PATHCONV=1 EXPO_BASE_URL=/kup-nekup npx expo export -p web
mkdir -p dist-web/kup-nekup && cp -r dist/. dist-web/kup-nekup/
npx serve dist-web -l 3000    # http://localhost:3000/kup-nekup/ (konfigurace „web-export“)
```

Kouřový test jádra proti skutečnému API (asi 0,1 USD), klíč jen z proměnné prostředí:

```bash
cd app
node --env-file=../server/.env --import tsx scripts/smoke.ts
```

Kontrola velikosti přísných schémat nástrojů AI (API je odmítá až za běhu; asi cent): `npm run check:tools` se stejným klíčem v prostředí.

Při změně datových tabulek v `app/src/core/data/` se cache produktů obnoví sama (verze dat je hash tabulek).

## 4. Náklady a limity

- **Kredity z Maxu.** Plán Claude Max dává každý měsíc API kredity (Max 5x 100 USD, Max 20x 200 USD): na claude.ai v Settings → Billing → API credits → Link organization propojte svou organizaci v Console. Kredity se čerpají před koupenými a koncem cyklu propadají.
- **Automatické dobíjení** v Console nechte vypnuté; po vyčerpání kreditu API jen přestane odpovídat. Měsíční strop útraty nastavte v Console na stránce Billing.
- **Denní strop v aplikaci** (Profil → Claude API klíč, výchozí 5 USD): po dosažení odhadu útraty za den se AI funkce zastaví do půlnoci. Počítadlo útraty je odhad z ceníku podle skutečně spotřebovaných tokenů; přesnou částku ukazuje Console.

| Operace | Kdy | Odhad za jeden produkt |
|---|---|---|
| Čárový kód + pravidla | pokaždé | zdarma |
| Fotka etikety | když chybí v databázi | cca 0,02–0,05 USD |
| Rychlý názor AI s webem | první otevření produktu | naměřeno 0,03–0,07 USD (1–3 vyhledávání) |
| Důkladný průzkum | jen na tlačítko | naměřeno 0,11–0,36 USD (až 12 vyhledávání, 1–4 přečtené stránky) |
| Hledání podle názvu při výpadku databáze | na stisk Hledat | cca 0,01 USD |
| Obojí z cache | 14 dní po prvním | zdarma |

Odhady vycházejí z ceníku Claude Opus 5.5 a webového vyhledávání. Levnější varianta je `INSIGHT_MODEL = "claude-sonnet-5-5"` v `app/src/core/config.ts`, přibližně za poloviční cenu.

## 5. Řešení problémů

| Co vidíte | Příčina a řešení |
|---|---|
| „Chybí Claude API klíč“ | V Profilu zadejte klíč z Claude Console (Keys & access → Create key). |
| „Claude odmítl API klíč“ | Klíč je zrušený, z jiné organizace, nebo organizace nemá kredit. Zkontrolujte Console → Billing. |
| „Klíč platí, ale model … není dostupný“ | Organizace nemá kredit nebo přístup k modelu; v Console → Billing dobijte kredit nebo propojte Max. |
| „Denní strop útraty za AI je vyčerpán“ | Zvyšte strop v Profil → Claude API klíč, nebo počkejte do zítřka. |
| Databáze produktů neodpovídá | Open Food Facts má výpadek nebo omezuje dotazy. Vyfoťte etiketu; hledání podle názvu si poradí přes AI. |
| Dlouhý průzkum skončil chybou sítě | iPhone uspal aplikaci po zamknutí obrazovky. Nechte obrazovku zapnutou a spusťte průzkum znovu (z cache se vezme, co už doběhlo). |
| Po týdnu nepoužívání chybí klíč i historie | Safari maže úložiště webové aplikace nepoužívané 7 dní. Vložte klíč znovu. |
| Kamera nejde ve webové aplikaci | Nastavení → Safari → Kamera (u aplikace na ploše Nastavení → Kup / Nekup) → Povolit; nebo použijte „Nahrát z galerie“, které umí i vyfotit. |
| Na ploše je stará verze | Zavřete aplikaci (přejetím nahoru v přepínači) a otevřete znovu; při nasazení trvá 2–4 minuty, než je nová verze online. |

## 6. Známá omezení

- Textové vyhledávání Open Food Facts z prohlížeče odmítá; staré vyhledávání bývá mimo provoz. Náhrada přes AI stojí asi cent za dotaz.
- Alternativy bez shody v Open Food Facts nemají fotku (stránky e-shopů z prohlížeče stáhnout nejdou).
- Pokrytí Černé Hory a Balkánu v databázi je slabé. Tam je hlavní cestou fotka etikety, posudek AI pak doplní kontext.
- Posudek AI je tak dobrý, jak dobré zdroje najde. Kauzy a změny receptury bez zdroje se zahazují.
- Výsledky testů dTestu jsou jen z veřejně dostupných článků. Napojení na předplatné vyžaduje souhlas dTestu.
- Dekodér čárových kódů pro Safari (zxing-wasm) se při prvním skenu stahuje z CDN jsDelivr.
- Dlouhý průzkum (1–2 min) potřebuje zapnutou obrazovku; po uspání se požadavek přeruší a Anthropic ho přesto naúčtuje.
