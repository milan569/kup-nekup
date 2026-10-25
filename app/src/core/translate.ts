import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./anthropic";
import { MODEL, TRANSLATE_MODEL } from "./config";
import { assertSpendAllowed, recordUsage } from "./usage";

/**
 * Ingredient lists from the database or the web are often Serbian, English
 * or German. A small fast model translates them for display; the result is
 * cached by text, so every list is paid for once (fractions of a cent).
 */

const SYSTEM = `Překládáš složení potravin z etiket do češtiny pro české zákazníky.
- Přelož celý text věrně: nic nepřidávej ani nevynechávej, zachovej pořadí, čárky, středníky, závorky, procenta a čísla.
- E-čísla ponech (E 330 → E330).
- Používej českou terminologii z etiket: emulgátor, kypřicí látka, regulátor kyselosti, zahušťovadlo, stabilizátor, konzervant, antioxidant, barvivo, aroma, přírodní aroma, glukózový sirup, rostlinný tuk (palmový), sušené odstředěné mléko, syrovátka, pšeničná mouka, škrob, jedlá sůl, pitná voda.
- Alergeny zvýrazněné _podtržítky_ nebo VELKÝMI PÍSMENY zvýrazni v překladu stejně.
- Když text obsahuje víc jazykových verzí, přelož jen jednu, nejúplnější.
- Odpověz jen přeloženým složením, bez uvozovek, nadpisu a komentáře.`;

export async function translateIngredients(text: string): Promise<string> {
  assertSpendAllowed();
  const c = getClient("translate");
  const run = (model: string) =>
    c.messages.create({
      model,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 4000) }],
    });
  let res: Anthropic.Messages.Message;
  try {
    res = await run(TRANSLATE_MODEL);
  } catch (err) {
    // the small model may not be available for this key: fall back to the main one
    if (TRANSLATE_MODEL !== MODEL && err instanceof Anthropic.APIError && (err.status === 404 || err.status === 403)) {
      console.warn(`[translate] ${TRANSLATE_MODEL} unavailable (${err.status}), using ${MODEL}`);
      res = await run(MODEL);
    } else {
      throw err;
    }
  }
  const out = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^(složení|ingredients)\s*:\s*/i, "")
    .replace(/^["„“]+|["“”]+$/g, "")
    .trim();
  if (!out) throw new Error("Překlad složení se nepodařil.");
  recordUsage(res.usage, res.model, "translate");
  return out;
}
