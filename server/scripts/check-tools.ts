import "../src/env.js";
import Anthropic from "@anthropic-ai/sdk";
import { API_BASE_URL } from "../src/claude.js";
import { INSIGHT_MODEL, QUICK_TOOL, SUBMIT_TOOL } from "../src/insight.js";
import { COMPARE_TOOL } from "../src/compare.js";
import { ALTERNATIVES_TOOL } from "../src/alternatives-research.js";

/**
 * Sends each strict tool to the API once with max_tokens 1. The API compiles
 * strict schemas into a grammar and rejects ones that are too large (HTTP 400
 * "The compiled grammar is too large") – unit tests cannot see that, it only
 * shows up in production. Costs about a cent per tool.
 *
 * Run before deploying any change to the AI tool schemas:  npm run check:tools
 */
const client = new Anthropic({ baseURL: API_BASE_URL, maxRetries: 1 });
const tools: [string, Anthropic.Messages.Tool][] = [
  ["submit_insight (důkladný průzkum)", SUBMIT_TOOL],
  ["submit_quick (rychlý názor)", QUICK_TOOL],
  ["submit_comparison (porovnání)", COMPARE_TOOL],
  ["submit_alternatives (alternativy v zemi)", ALTERNATIVES_TOOL],
];

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
