import Anthropic from "@anthropic-ai/sdk";
import { API_BASE_URL, ClaudeNotConfiguredError, isConfigured } from "./claude.js";

/**
 * One cheap web search through a small model – used to find the product page
 * of an alternative the research named without a link (Montenegrin olive oil
 * at Voli…). Only the URLs the search really returned are used, never text
 * the model writes. About 0,02 USD and 3–5 s per search.
 */
export const SEARCH_MODEL = process.env.SEARCH_MODEL?.trim() || "claude-haiku-5-5";

export interface WebHit {
  url: string;
  title: string;
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!isConfigured()) throw new ClaudeNotConfiguredError();
  if (!client) client = new Anthropic({ baseURL: API_BASE_URL, timeout: 20_000, maxRetries: 0 });
  return client;
}

export async function webSearchOnce(query: string, timeoutMs = 15_000): Promise<WebHit[]> {
  const res = await getClient().messages.create(
    {
      model: SEARCH_MODEL,
      max_tokens: 200,
      // the basic search variant: it returns plain result lists to a small model
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: `Najdi stránku tohoto výrobku v e-shopu nebo u výrobce: ${query}` }],
    },
    { timeout: timeoutMs },
  );
  const hits: WebHit[] = [];
  for (const block of res.content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.type === "web_search_result" && /^https:\/\//i.test(r.url)) hits.push({ url: r.url, title: r.title ?? "" });
    }
  }
  console.log(`[websearch] ${res.model} in ${res.usage.input_tokens} out ${res.usage.output_tokens}, ${hits.length} hits`);
  return hits;
}
