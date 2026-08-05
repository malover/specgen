import { describe, expect, it } from "vitest";
import { parseJudgeResponse } from "../src/llm-judge.js";

describe("optional LLM judge response", () => {
  it("accepts bounded JSON and rejects unstructured prose", () => {
    const parsed = parseJudgeResponse('```json\n{"judgments":[{"id":"x","faithfulness":5,"relevance":4,"completeness":3,"verdict":"pass","rationale":"Grounded."}]}\n```');
    expect(parsed.judgments[0].faithfulness).toBe(5);
    expect(() => parseJudgeResponse("looks fine")).toThrow();
  });
});
