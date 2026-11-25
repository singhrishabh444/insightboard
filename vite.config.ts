import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

type PlannerField = {
  name: string;
  type: string;
  role: string;
  values?: string[];
};

type PlannerCalculatedMetric = {
  name: string;
  formula: string;
  aggregation: string;
  numeratorField?: string;
  denominatorField?: string;
  format: string;
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "intent",
    "operation",
    "measureField",
    "calculatedMetric",
    "groupByField",
    "filters",
    "sort",
    "limit",
    "rationale",
    "reason",
  ],
  properties: {
    status: { type: "string", enum: ["planned", "unsupported"] },
    intent: { type: "string", enum: ["single_metric", "ranking", "comparison", "trend"] },
    operation: { type: "string", enum: ["sum", "average", "count", "ratio"] },
    measureField: { type: ["string", "null"] },
    calculatedMetric: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "formula", "aggregation", "numeratorField", "denominatorField", "format"],
          properties: {
            name: { type: "string" },
            formula: { type: "string" },
            aggregation: { type: "string", enum: ["ratioOfTotals", "average"] },
            numeratorField: { type: ["string", "null"] },
            denominatorField: { type: ["string", "null"] },
            format: { type: "string", enum: ["percent", "number"] },
          },
        },
      ],
    },
    groupByField: { type: ["string", "null"] },
    filters: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value"],
        properties: {
          field: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    sort: { type: "string", enum: ["highest", "lowest", "none"] },
    limit: { type: "number", minimum: 1, maximum: 25 },
    rationale: { type: "string" },
    reason: { type: ["string", "null"] },
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), insightPlannerPlugin(env.OPENAI_API_KEY, env.OPENAI_MODEL ?? "gpt-5-mini")],
  };
});

function insightPlannerPlugin(apiKey: string | undefined, model: string): Plugin {
  const handlePlannerRequest = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { status: "error", reason: "Method not allowed." });
      return;
    }

    if (!apiKey) {
      sendJson(res, 200, {
        status: "unconfigured",
        reason: "OPENAI_API_KEY is not configured. InsightBoard used its local planner.",
      });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const question = typeof payload.question === "string" ? payload.question.trim() : "";
      const fields = Array.isArray(payload.fields) ? payload.fields.filter(isPlannerField).slice(0, 80) : [];
      const calculatedMetrics = Array.isArray(payload.calculatedMetrics)
        ? payload.calculatedMetrics.filter(isPlannerCalculatedMetric).slice(0, 20)
        : [];

      if (!question || fields.length === 0) {
        sendJson(res, 400, { status: "error", reason: "Question and dataset fields are required." });
        return;
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content:
                "You plan grounded data analysis for a BI app. Return only a supported JSON plan. Use exact field names and exact filter values from the provided schema. Never invent fields, filter values, or numeric answers.",
            },
            {
              role: "user",
              content: JSON.stringify({
                question,
                fields,
                calculatedMetrics,
                supportedOperations: ["sum", "average", "count", "ratio"],
                supportedIntents: ["single_metric", "ranking", "comparison", "trend"],
                calculatedMetricRules:
                  "Use operation ratio for saved calculated metrics or formula metrics. Use bracketed field formulas such as [Profit] / [Sales] * 100. For profit margin, use ratioOfTotals when Profit and Sales or Revenue exist.",
                filterRules:
                  "Use filters only when the question names a specific dimension value. Do not filter by the same field used for groupByField.",
              }),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "insightboard_analysis_plan",
              strict: true,
              schema: planSchema,
            },
          },
        }),
      });

      if (!response.ok) {
        sendJson(res, 200, {
          status: "error",
          reason: "AI planner request failed. InsightBoard used its local planner.",
        });
        return;
      }

      const responseBody = await response.json();
      const text = extractResponseText(responseBody);

      if (!text) {
        sendJson(res, 200, {
          status: "error",
          reason: "AI planner returned no plan text. InsightBoard used its local planner.",
        });
        return;
      }

      sendJson(res, 200, JSON.parse(text));
    } catch {
      sendJson(res, 200, {
        status: "error",
        reason: "AI planner could not complete. InsightBoard used its local planner.",
      });
    }
  };

  return {
    name: "insightboard-planner-api",
    configureServer(server) {
      server.middlewares.use("/api/insight-plan", handlePlannerRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/insight-plan", handlePlannerRequest);
    },
  };
}

function readJsonBody(req: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 50_000) {
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function isPlannerField(value: unknown): value is PlannerField {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.role === "string" &&
    (value.values === undefined || (Array.isArray(value.values) && value.values.every((item) => typeof item === "string")))
  );
}

function isPlannerCalculatedMetric(value: unknown): value is PlannerCalculatedMetric {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.formula === "string" &&
    typeof value.aggregation === "string" &&
    (value.numeratorField === undefined || typeof value.numeratorField === "string") &&
    (value.denominatorField === undefined || typeof value.denominatorField === "string") &&
    typeof value.format === "string"
  );
}

function extractResponseText(responseBody: unknown) {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.output)) {
    return "";
  }

  for (const output of responseBody.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) {
      continue;
    }

    for (const content of output.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
