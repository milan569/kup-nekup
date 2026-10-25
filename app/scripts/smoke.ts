/**
 * End-to-end smoke test of the engine in Node, with the Claude key from the
 * shell environment (never printed). Spends real credit: about 0.05–0.15 USD.
 *
 *   $env:ANTHROPIC_API_KEY = "sk-ant-…"; npx tsx scripts/smoke.ts
 *   ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/smoke.ts
 */
import { setApiKey } from "../src/core/anthropic";
import * as lookup from "../src/core/lookup";
import { EMPTY_PROFILE } from "../src/core/types";
import { setUsageListener } from "../src/core/usage";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY is not set");
  process.exit(1);
}
setApiKey(key);
let total = 0;
setUsageListener((e) => {
  total += e.usd;
});
const profile = { ...EMPTY_PROFILE, countries: ["cz"] };
const t0 = Date.now();
const step = (name: string) => console.log(`\n--- ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

async function main(): Promise<void> {
  step("lookupEan 3017620422003");
  const r = await lookup.lookupEan({ ean: "3017620422003", profile });
  console.log(r.product.name, r.product.brand, r.assessment.verdict, r.assessment.score, r.timing);

  step("ingredientInfo");
  const info = await lookup.ingredientInfo({ q: "palmový olej", context: r.product.ingredientsText });
  console.log(info.matches.map((m) => `${m.kind}:${m.id}`).join(", "));

  step("search 'nutella'");
  try {
    const s = await lookup.search("nutella", ["cz"]);
    console.log("via", s.via, s.candidates.slice(0, 3).map((c) => `${c.name} (${c.ean})`).join(" | "));
  } catch (err) {
    console.log("search failed:", (err as Error).message);
  }

  step("translateIngredients");
  const tr = await lookup.translateIngredients({ text: "Zucker, Palmöl, HASELNÜSSE 13%, MAGERMILCHPULVER 8,7%, fettarmer Kakao 7,4%, Emulgator Lecithine (SOJA), Vanillin." });
  console.log(tr.translated, tr.cached, tr.text.slice(0, 120), tr.items.length, "items");

  step("quickInsight");
  const q = await lookup.quickInsight({ product: r.product, assessment: r.assessment, profile });
  console.log(q.quick.verdict, "|", q.quick.headline, "| sources", q.quick.sources.length, "| cached", q.cached, "| ms", q.ms);
  console.log(q.quick.opinion.slice(0, 200));

  step("quickInsight again (cache)");
  const q2 = await lookup.quickInsight({ product: r.product, assessment: r.assessment, profile });
  console.log("cached", q2.cached, "ms", q2.ms);

  console.log(`\nestimated spend: ${total.toFixed(4)} USD`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
