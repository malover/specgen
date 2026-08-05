import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { z } from "zod";
import type { ProjectSpec } from "./project-spec-schema.js";

export const LlmJudgeInputSchema = z.object({
  schema: z.literal("deveco.specgen-llm-judge-input/v1"), repository: z.string(),
  items: z.array(z.object({
    id: z.string(), criterion: z.enum(["claim-grounding", "architecture-plausibility", "request-spec-compliance"]),
    claim: z.string().min(1), evidence: z.array(z.string()).min(1), reference: z.string().optional()
  })).min(1).max(50)
});
const JudgmentSchema = z.object({
  id: z.string(), faithfulness: z.number().int().min(1).max(5), relevance: z.number().int().min(1).max(5),
  completeness: z.number().int().min(1).max(5), verdict: z.enum(["pass", "fail", "uncertain"]), rationale: z.string().max(600)
});
const ResponseSchema = z.object({ judgments: z.array(JudgmentSchema) });
export type LlmJudgeInput = z.infer<typeof LlmJudgeInputSchema>;

export function generateLlmJudgeInput(spec: ProjectSpec, limit = 20): LlmJudgeInput {
  const items = spec.modules.flatMap(module => module.dependencies.map(dependency => ({
    id: `dependency:${module.id}:${dependency.targetId}`, criterion: "claim-grounding" as const,
    claim: `${module.name} depends on ${dependency.targetName} through ${dependency.relationKinds.join(", ")}.`,
    evidence: dependency.evidence.length ? dependency.evidence.map(ref => `${ref.filePath}:${ref.startLine}-${ref.endLine} (${ref.provenance})`) : [`Project SPEC dependency count: ${dependency.count}`]
  }))).slice(0, Math.max(1, limit));
  if (!items.length) items.push({
    id: "project:module-inventory", criterion: "claim-grounding",
    claim: `The repository contains ${spec.modules.length} discovered module(s).`,
    evidence: spec.modules.map(module => `${module.name}: ${module.files.length} indexed files`).slice(0, 20)
  });
  return LlmJudgeInputSchema.parse({ schema: "deveco.specgen-llm-judge-input/v1", repository: spec.repository.id, items });
}

export async function runLlmJudge(raw: unknown, environment: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const input = LlmJudgeInputSchema.parse(raw); const apiKey = environment.OPENROUTER_API_KEY;
  const model = environment.OPENROUTER_MODEL; if (!apiKey) throw new Error("OPENROUTER_API_KEY is required."); if (!model) throw new Error("OPENROUTER_MODEL is required.");
  if (environment.HTTPS_PROXY || environment.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
  const endpoint = `${(environment.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "SpecGen Evaluation" },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 6000,
      messages: [
        { role: "system", content: "You are a strict software-specification evaluator. Judge only from supplied evidence. Missing evidence must produce uncertain or fail. Return JSON only with a judgments array; each item has id, faithfulness/relevance/completeness integers 1-5, verdict pass|fail|uncertain, and a concise rationale." },
        { role: "user", content: JSON.stringify(input) }
      ]
    }), signal: AbortSignal.timeout(Number(environment.OPENROUTER_TIMEOUT_MS ?? 120_000))
  });
  const body = await response.text(); if (!response.ok) throw new Error(`LLM judge HTTP ${response.status}: ${body.slice(0, 1000)}`);
  const parsed = parseJudgeResponse(JSON.parse(body)?.choices?.[0]?.message?.content ?? "");
  const byId = new Map(parsed.judgments.map(item => [item.id, item]));
  const missing = input.items.filter(item => !byId.has(item.id)).map(item => item.id); if (missing.length) throw new Error(`LLM judge omitted item(s): ${missing.join(", ")}`);
  const scores = parsed.judgments.flatMap(item => [item.faithfulness, item.relevance, item.completeness]);
  return {
    schema: "deveco.specgen-llm-judge-result/v1", repository: input.repository, generatedAt: new Date().toISOString(),
    oracle: "llm-judge-non-authoritative", model, judgments: parsed.judgments,
    averageScore: scores.reduce((sum, item) => sum + item, 0) / scores.length,
    passRate: parsed.judgments.filter(item => item.verdict === "pass").length / parsed.judgments.length
  };
}

export function parseJudgeResponse(content: string): z.infer<typeof ResponseSchema> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return ResponseSchema.parse(JSON.parse(cleaned));
}
