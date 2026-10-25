import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./anthropic";
import { SEARCH_MODEL } from "./config";
import { assertSpendAllowed, recordUsage } from "./usage";

/**
 * One cheap web search through a small model. Used to find a product in
 * Open Food Facts when the database's own search is unreachable from the
 * browser, and to find an alternative the research named without a link.
 * Only the URLs the search really returned are used, never text the model
 * writes. About 0,01–0,02 USD and 3–5 s per search.
 */

export interface WebHit {
  url: string;
  title: string;
}

export interface WebSearchOptions {
  /** restrict results to these domains, e.g. ["openfoodfacts.org"] */
  allowedDomains?: string[];
  /** the instruction for the model; default asks for the product's shop or maker page */
  prompt?: string;
  timeoutMs?: number;
}

export async function webSearchOnce(query: string, opts: WebSearchOptions = {}): Promise<WebHit[]> {
  assertSpendAllowed();
  const tool: Record<string, unknown> = { type: "web_search_20250305", name: "web_search", max_uses: 1 };
  if (opts.allowedDomains?.length) tool.allowed_domains = opts.allowedDomains;
  const res = await getClient("search").messages.create(
    {
      model: SEARCH_MODEL,
      max_tokens: 200,
      // the basic search variant: it returns plain result lists to a small model
      tools: [tool as unknown as Anthropic.Messages.ToolUnion],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: opts.prompt ?? `Najdi stránku tohoto výrobku v e-shopu nebo u výrobce: ${query}` }],
    },
    { timeout: opts.timeoutMs ?? 15_000 },
  );
  const hits: WebHit[] = [];
  for (const block of res.content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.type === "web_search_result" && /^https:\/\//i.test(r.url)) hits.push({ url: r.url, title: r.title ?? "" });
    }
  }
  recordUsage(res.usage, SEARCH_MODEL, "websearch");
  console.log(`[websearch] ${res.model}: ${hits.length} hits`);
  return hits;
}
