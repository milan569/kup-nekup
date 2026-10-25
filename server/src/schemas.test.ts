import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ManualAssessment, ManufacturerSchema, PhotoExtraction } from "./claude.js";
import { SUBMIT_TOOL } from "./insight.js";

/**
 * The Claude API rejects structured-output / strict-tool schemas with more
 * than 16 parameters whose type is a union (type arrays like ["string","null"]
 * or anyOf). This bit us in production on the label-photo schema (18).
 */
const API_UNION_LIMIT = 16;

function countUnionParams(schema: unknown): number {
  let n = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.type) || Array.isArray(obj.anyOf) || Array.isArray(obj.oneOf)) n++;
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (typeof v === "object") visit(v);
    }
  };
  visit(schema);
  return n;
}

describe("AI schemas stay within the API's union-parameter limit", () => {
  const cases: [string, unknown][] = [
    ["photo label extraction", zodOutputFormat(PhotoExtraction).schema],
    ["manual assessment", zodOutputFormat(ManualAssessment).schema],
    ["manufacturer", zodOutputFormat(ManufacturerSchema).schema],
    ["insight submit tool", SUBMIT_TOOL.input_schema],
  ];
  for (const [name, schema] of cases) {
    it(`${name}: ≤ ${API_UNION_LIMIT}`, () => {
      expect(countUnionParams(schema)).toBeLessThanOrEqual(API_UNION_LIMIT);
    });
  }

  it("the counter would have caught the original photo schema (18)", () => {
    const props = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`f${i}`, { type: ["string", "null"] }]));
    expect(countUnionParams({ type: "object", properties: props })).toBe(18);
  });
});
