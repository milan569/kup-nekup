# Kup / Nekup: jak si aplikaci rozchodit u sebe

Tento soubor je pro člověka, který aplikaci dostal (jako zip, nebo jako odkaz na repozitář), a pro jeho Clauda.
Výsledkem je **vlastní, nezávislá kopie**: váš repozitář na GitHubu, vaše adresa na GitHub Pages, váš Claude klíč.
S původním autorem pak aplikaci nic nespojuje.

## Co dostáváte

- Aplikaci pro iPhone, která v obchodě odpoví na otázku „Mám to koupit?“: čárový kód, fotka etikety nebo název, verdikt se zdůvodněním, posudek AI, lepší alternativy, porovnání výrobků. Co přesně umí, je v [README.md](README.md).
- Je to webová stránka bez serveru. Běží zdarma z GitHub Pages a na iPhonu se přidá na plochu jako aplikace. Žádný App Store, žádný Apple Developer účet.
- Tón verdiktů je vtipný a místy hrubý; v Profilu jde zapnout Slušný režim.
- **V balíčku není** žádný Claude klíč, žádná historie ani profil původního uživatele. Vše osobní vzniká až ve vašem telefonu a zůstává v něm.

## Co potřebujete

| Co | K čemu | Cena |
|---|---|---|
| Účet na github.com | repozitář a hosting stránky | zdarma (repozitář musí být veřejný) |
| Claude Code na počítači (aplikace Claude, záložka Code, nebo `claude` v terminálu) | rozchození a pozdější úpravy | podle vašeho předplatného |
| `git` a GitHub CLI `gh` na tom počítači | Claude jimi vytvoří repozitář | zdarma; Claude poradí s instalací |
| iPhone se Safari | používání aplikace | – |
| Claude API klíč z platform.claude.com | posudky AI, čtení etiket z fotek | platí se podle použití, viz README §4; bez klíče funguje čárový kód a pravidla zdarma |

Vyzkoušeno je to na iPhonu. Na Androidu v Chromu by aplikace měla běžet stejně, ale nikdo to nezkoušel.

## Cesta A: přes Clauda (doporučeno)

1. **Dostaňte zdroják do složky na počítači.**
   - Máte zip: rozbalte ho, vznikne složka `kup-nekup`.
   - Máte jen odkaz: nic nestahujte, Claude si repozitář naklonuje sám (druhá varianta zprávy níže).
2. **Otevřete Claude Code v té složce** (v aplikaci Claude: záložka Code → vybrat složku).
3. **Pošlete Claudovi tuto zprávu:**

   ```
   Dostal jsem aplikaci Kup / Nekup. Přečti soubor PRENOS.md v této složce a proveď část
   „Zadání pro Clauda“. Chci vlastní nezávislou kopii na svém GitHubu, nasazenou na GitHub Pages.
   Repozitář pojmenuj kup-nekup. Na konci mi napiš adresu aplikace a co mám udělat na iPhonu.
   ```

   Varianta bez zipu (Claude Code otevřený v libovolné prázdné složce):

   ```
   Naklonuj https://github.com/milan569/kup-nekup do této složky, přečti v ní PRENOS.md a proveď
   část „Zadání pro Clauda“. Chci vlastní nezávislou kopii na svém GitHubu, nasazenou na GitHub Pages.
   Repozitář pojmenuj kup-nekup. Na konci mi napiš adresu aplikace a co mám udělat na iPhonu.
   ```

4. Claude se nejvýš jednou zeptá (přihlášení ke GitHubu, jméno repozitáře). Za 5–10 minut máte adresu.
5. Pokračujte částí [Po instalaci](#po-instalaci-na-iphonu).

## Cesta B: ručně, bez Clauda a bez počítače

Stačí prohlížeč. Aplikace poběží stejně, jen ji pak nemá kdo upravovat.

1. Přihlaste se na github.com a otevřete https://github.com/new/import.
2. Jako zdroj zadejte `https://github.com/milan569/kup-nekup`, zvolte jméno (třeba `kup-nekup`), **Public**, a spusťte import.
3. V novém repozitáři: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Záložka **Actions → Deploy web app → Run workflow** (větev `main`). Běh trvá 2–4 minuty.
5. Adresu ukáže **Settings → Pages**: `https://VÁŠ-ÚČET.github.io/JMÉNO-REPOZITÁŘE/`.

Místo importu jde použít i tlačítko **Fork**; pak je na záložce Actions nejdřív potřeba povolit spouštění workflow.

## Po instalaci na iPhonu

1. V **Safari** otevřete svou adresu a přes Sdílet → **Přidat na plochu** si aplikaci dejte na plochu.
2. Projděte úvodní průvodce (země, obchody, alergeny).
3. Kamera: iPhone se u aplikace na ploše ptá na povolení při každém spuštění, to je vlastnost iOS. Kdo to nechce, zapne **Profil → Sken bez dotazu na kameru** a fotí fotoaparátem iPhonu.
4. Claude klíč (volitelné, pro AI): na https://platform.claude.com vytvořte klíč v **API keys → Create key**, zkopírujte ho a vložte v aplikaci do **Profil → Zadat Claude API klíč → Uložit a otestovat**. Klíč zůstává jen v telefonu.
5. V Console nechte vypnuté automatické dobíjení a v aplikaci si nastavte denní strop útraty (výchozí 5 USD). Orientační ceny: čárový kód zdarma, rychlý názor AI jednotky centů, důkladný průzkum desítky centů. Podrobně README §4.

Řešení potíží při používání je v README §5.

---

## Zadání pro Clauda

Jsi Claude Code. Tvůj uživatel dostal tuto složku od známého a chce z ní **vlastní nezávislou kopii**: nový repozitář na svém GitHubu, nasazený na jeho GitHub Pages. Potom budeš správcem té kopie. Mluv česky a stručně, uživatel nemusí být programátor. Ptej se jen na to, co nejde zjistit jinak. Pracuj samostatně až do hotového a ověřeného výsledku.

**Co o projektu vědět předem**

- `README.md` popisuje aplikaci, vývoj, náklady a řešení problémů. `app/AGENTS.md` jsou pravidla pro úpravy kódu. `ZADANI.md` je zadání a historie rozhodnutí.
- Aplikace je Expo web export v `app/`. Sestavení a nasazení dělá `.github/workflows/pages.yml` při každém push do `main`. Základní cestu stránky si workflow odvodí ze jména repozitáře, takže kopie běží pod jakýmkoli účtem a jménem beze změny kódu.
- Nikde v repozitáři není a nesmí být Claude klíč. Uživatel ho zadá až v aplikaci na telefonu.

**Postup**

1. Zkontroluj nástroje: `git --version`, `gh --version`, `gh auth status`. Když `gh` chybí nebo není přihlášené, řekni uživateli přesně, co udělat (instalace z https://cli.github.com, pak `gh auth login`: GitHub.com, HTTPS, přihlášení v prohlížeči). Node.js je potřeba jen pro místní testy; nasazení sestavuje GitHub.
2. Zjisti jméno repozitáře (výchozí `kup-nekup`) a účet (`gh api user --jq .login`). Repozitář musí být **veřejný**: GitHub Pages jsou u bezplatného účtu jen pro veřejné repozitáře. Když už repozitář toho jména existuje, zeptej se uživatele, nic nepřepisuj.
3. Založ čistou historii, aby kopie nenesla cizí commity:
   - složka ze zipu nemá `.git`: `git init -b main`
   - klon původního repozitáře: ověř `git remote -v` (ukazuje na cizí repozitář, ne na uživatelův), pak smaž složku `.git` a `git init -b main`
   - `git add -A`, před commitem zkontroluj `git status --short`: nesmí tam být `.env`, `node_modules` ani `dist`
   - `git commit -m "Kup / Nekup: vlastní kopie"`
4. Vytvoř repozitář a pošli do něj kód: `gh repo create JMÉNO --public --source . --remote origin --push`.
   Když push odmítne soubor workflow kvůli chybějícímu oprávnění `workflow`: `gh auth refresh -h github.com -s workflow` a `git push -u origin main`.
5. Zapni GitHub Pages se zdrojem GitHub Actions: `gh api -X POST repos/ÚČET/JMÉNO/pages -f build_type=workflow`.
   Odpověď 409 znamená, že Pages už existují; pak `gh api -X PUT repos/ÚČET/JMÉNO/pages -f build_type=workflow`. Když API selže, ať to uživatel nastaví ručně: Settings → Pages → Build and deployment → Source: GitHub Actions.
6. První běh workflow spuštěný pushem nejspíš skončil chybou v kroku deploy, protože Pages ještě nebyly zapnuté. Spusť nový: `gh workflow run pages.yml`, potom `gh run watch` (2–4 minuty). Krok build obsahuje typovou kontrolu a testy; když selže on, přečti log (`gh run view --log-failed`) a oprav příčinu.
7. Ověř výsledek: `gh api repos/ÚČET/JMÉNO/pages --jq .html_url` vrátí adresu. Stránka musí odpovědět 200 a v prohlížeči ukázat úvodního průvodce aplikace. Soubory `_expo/static/js/web/*.js` se musí načítat z cesty `/JMÉNO/`.
8. Oprav adresu v dokumentaci kopie: v `README.md`, `app/AGENTS.md` a `ZADANI.md` nahraď `https://milan569.github.io/kup-nekup/` a `milan569/kup-nekup` novou adresou a repozitářem. Commit, push, počkej na nasazení.
9. Napiš uživateli krátce: adresu aplikace, kroky z části „Po instalaci na iPhonu“ výše a kde najde náklady (README §4).
10. Ulož si do paměti projektu, že jsi správcem této aplikace, kde je repozitář a adresa, a že pravidla jsou v `app/AGENTS.md`.

**Pravidla pro další práci (správce)**

- Klíč Claude nikdy do kódu, do `EXPO_PUBLIC_*`, do commitu, logu ani chatu. Pro skripty na počítači (`npm run smoke`, `npm run check:tools`) patří do git-ignorovaného `app/scripts/.env` jako `ANTHROPIC_API_KEY=…`; nikdy ho nevypisuj a do prohlížeče při testování nepiš.
- Před každým pushem v `app/`: `npm ci` (jednou), `npm test`, `npx tsc --noEmit`. Změnu vyzkoušej v prohlížeči (`npx expo start --web`). Push do `main` je nasazení.
- Každé spuštění skutečného AI ze skriptů uživateli předem oznam s odhadem ceny. Model AI neměň bez jeho souhlasu.
- Open Food Facts: nerozšiřuj ani neobcházej omezovač požadavků v `app/src/core/off.ts`. dTest: jen odkaz, nikdy stahování obsahu.
- Ostatní pravidla a zvláštnosti (limity schémat AI, cache, sken) jsou v `app/AGENTS.md`. Přečti je před první úpravou.

**Novinky z původní verze (jen na přání uživatele)**

Kopie je nezávislá a sama se neaktualizuje. Původní repozitář je veřejný: `git remote add puvodni https://github.com/milan569/kup-nekup`, `git fetch puvodni`, pak porovnej `git log puvodni/main` a vybrané změny přenes (`git cherry-pick`), otestuj a nasaď.

## Když přenos nejde

| Co se děje | Co s tím |
|---|---|
| Adresa vrací 404 | Počkejte 2–4 minuty po doběhnutí workflow. Zkontrolujte Settings → Pages: Source musí být GitHub Actions a repozitář veřejný. |
| Workflow se nespustil | U forku je potřeba na záložce Actions povolit workflow. Jinak Actions → Deploy web app → Run workflow. |
| Běh selže v kroku deploy | Pages nebyly zapnuté dřív, než běh začal. Zapněte je a spusťte workflow znovu. |
| Stránka je bílá, v konzoli chybí soubory z `/_expo/` | Stránka běží na vlastní doméně nebo jiné cestě, než je jméno repozitáře. Upravte krok „Base path of the site“ v `.github/workflows/pages.yml`. |
| `gh repo create` hlásí chybějící oprávnění `workflow` | `gh auth refresh -h github.com -s workflow` a push znovu. |
