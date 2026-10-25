/**
 * Sends each strict AI tool to the API once with max_tokens 1. The API compiles
 * strict schemas into a grammar and rejects ones that are too large (HTTP 400
 * "The compiled grammar is too large") – unit tests cannot see that, it only
 * shows up in production. Costs about a cent per tool.
 *
 * Run before shipping any change to the AI tool schemas:
 *   npm run check:tools        (reads ANTHROPIC_API_KEY from scripts/.env or the shell)
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient, setApiKey } from "../src/core/anthropic";
import { ALTERNATIVES_TOOL } from "../src/core/alternatives-research";
import { COMPARE_TOOL } from "../src/core/compare";
import { INSIGHT_MODEL } from "../src/core/config";
import { QUICK_TOOL, SUBMIT_TOOL } from "../src/core/insight";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY is not set (put it in app/scripts/.env or the shell)");
  process.exit(1);
}
setApiKey(key);

const tools: [string, Anthropic.Messages.Tool][] = [
  ["submit_insight (důkladný průzkum)", SUBMIT_TOOL],
  ["submit_quick (rychlý názor)", QUICK_TOOL],
  ["submit_comparison (porovnání)", COMPARE_TOOL],
  ["submit_alternatives (alternativy v zemi)", ALTERNATIVES_TOOL],
];

async function main(): Promise<void> {
  const client = getClient("default");
  let failed = false;
  for (const [label, tool] of tools) {
    try {
      const res = await client.messages.create({
        model: INSIGHT_MODEL,
        max_tokens: 1,
        tools: [tool],
        messages: [{ role: "user", content: "Odpověz jedním slovem: ok" }],
      });
      console.log(`OK    ${label} – ${res.usage.input_tokens} vstupních tokenů`);
    } catch (err) {
      failed = true;
      console.error(`CHYBA ${label}: ${(err as Error).message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
