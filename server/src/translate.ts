import Anthropic from "@anthropic-ai/sdk";
import { API_BASE_URL, ClaudeNotConfiguredError, MODEL, isConfigured } from "./claude.js";

/**
 * Ingredient lists from the database or the web are often Serbian, English
 * or German. A small fast model translates them for display; the result is
 * cached by text, so every list is paid for once (fractions of a cent).
 */
export const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL?.trim() || "claude-haiku-5-5";

const SYSTEM = `Překládáš složení potravin z etiket do češtiny pro české zákazníky.
- Přelož celý text věrně: nic nepřidávej ani nevynechávej, zachovej pořadí, čárky, středníky, závorky, procenta a čísla.
- E-čísla ponech (E 330 → E330).
- Používej českou terminologii z etiket: emulgátor, kypřicí látka, regulátor kyselosti, zahušťovadlo, stabilizátor, konzervant, antioxidant, barvivo, aroma, přírodní aroma, glukózový sirup, rostlinný tuk (palmový), sušené odstředěné mléko, syrovátka, pšeničná mouka, škrob, jedlá sůl, pitná voda.
- Alergeny zvýrazněné _podtržítky_ nebo VELKÝMI PÍSMENY zvýrazni v překladu stejně.
- Když text obsahuje víc jazykových verzí, přelož jen jednu, nejúplnější.
- Odpověz jen přeloženým složením, bez uvozovek, nadpisu a komentáře.`;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!isConfigured()) throw new ClaudeNotConfiguredError();
  if (!client) client = new Anthropic({ baseURL: API_BASE_URL, timeout: 30_000, maxRetries: 1 });
  return client;
}

export async function translateIngredients(text: string): Promise<string> {
  const c = getClient();
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
  const u = res.usage;
  console.log(`[translate] ${res.model} in ${u.input_tokens} out ${u.output_tokens}`);
  return out;
}
