import {
  createLocalAnalysisPlan,
  executeAnalysisPlan,
  getPlanMeasureLabel,
  validateAnalysisPlan,
  type AnalysisContext,
  type CalculatedMetric,
  type AnalysisPlan,
  type AnalysisPlanResult,
} from "./analysisPlan";

export type InsightVisualSuggestion = {
  title: string;
  kind: "Bar" | "Line" | "Pie" | "Table";
  axisField: string;
  valueField: string;
};

export type InsightAnswer = {
  status: "answered" | "unsupported";
  answer: string;
  receipts: string[];
  caveats: string[];
  visualSuggestion?: InsightVisualSuggestion;
};

export type PlannerState = "ai" | "local" | "unconfigured" | "error";

type AnswerOptions = {
  plannedBy?: PlannerState;
  planResult?: AnalysisPlanResult;
  plannerMessage?: string;
};

export function answerInsightQuestion(question: string, context: AnalysisContext, options: AnswerOptions = {}): InsightAnswer {
  const planResult = getUsablePlan(question, context, options);

  if (planResult.status !== "planned" || !planResult.plan) {
    return getUnsupportedAnswer(planResult.reason ?? "I could not plan an analysis for that question.", options.plannerMessage);
  }

  const executedAnalysis = executeAnalysisPlan(planResult.plan, context);

  if (planResult.plan.intent === "single_metric") {
    return {
      status: "answered",
      answer: `${capitalize(getPlanMeasureLabel(planResult.plan))} is ${formatMetricValue(executedAnalysis.value, planResult.plan)}${formatAnswerScope(planResult.plan)}.`,
      receipts: buildReceipts(planResult.plan, context, planResult, executedAnalysis.rowsAnalyzed, options.plannerMessage),
      caveats: buildCaveats(planResult.plan, executedAnalysis.numericCellsUsed),
    };
  }

  const leadPoint = executedAnalysis.points[0];

  if (!leadPoint) {
    return getUnsupportedAnswer("There are not enough rows to calculate that answer.", options.plannerMessage);
  }

  if (planResult.plan.intent === "trend") {
    const lastPoint = executedAnalysis.points[executedAnalysis.points.length - 1] ?? leadPoint;

    return {
      status: "answered",
      answer: `${formatPlanMetric(planResult.plan)} moves from ${formatMetricValue(leadPoint.value, planResult.plan)} on ${leadPoint.label} to ${formatMetricValue(lastPoint.value, planResult.plan)} on ${lastPoint.label}.`,
      receipts: buildReceipts(planResult.plan, context, planResult, executedAnalysis.rowsAnalyzed, options.plannerMessage),
      caveats: buildCaveats(planResult.plan, executedAnalysis.numericCellsUsed),
      visualSuggestion: buildVisualSuggestion(planResult.plan),
    };
  }

  if (planResult.plan.intent === "ranking") {
    const direction = planResult.plan.sort === "lowest" ? "lowest" : "highest";

    return {
      status: "answered",
      answer: `${leadPoint.label} has the ${direction} ${formatPlanMetric(planResult.plan)} at ${formatMetricValue(leadPoint.value, planResult.plan)}.`,
      receipts: buildReceipts(planResult.plan, context, planResult, executedAnalysis.rowsAnalyzed, options.plannerMessage),
      caveats: buildCaveats(planResult.plan, executedAnalysis.numericCellsUsed),
      visualSuggestion: buildVisualSuggestion(planResult.plan),
    };
  }

  return {
    status: "answered",
    answer: `${planResult.plan.groupByField} comparison starts with ${leadPoint.label} at ${formatMetricValue(leadPoint.value, planResult.plan)} in ${formatPlanMetric(planResult.plan)}.`,
    receipts: buildReceipts(planResult.plan, context, planResult, executedAnalysis.rowsAnalyzed, options.plannerMessage),
    caveats: buildCaveats(planResult.plan, executedAnalysis.numericCellsUsed),
    visualSuggestion: buildVisualSuggestion(planResult.plan),
  };
}

export function validateRemoteAnalysisPlan(
  plan: unknown,
  context: AnalysisContext,
  calculatedMetrics: CalculatedMetric[] = [],
): AnalysisPlanResult {
  return validateAnalysisPlan(plan, context.dataset, calculatedMetrics);
}

function getUsablePlan(question: string, context: AnalysisContext, options: AnswerOptions): AnalysisPlanResult {
  if (options.planResult?.status === "planned") {
    return options.planResult;
  }

  return createLocalAnalysisPlan(question, context.dataset, context.calculatedMetrics);
}

function buildReceipts(
  plan: AnalysisPlan,
  context: AnalysisContext,
  planResult: AnalysisPlanResult,
  rowsAnalyzed: number,
  plannerMessage?: string,
) {
  const receipts = [
    `Planner: ${planResult.source === "ai" ? "AI structured plan" : "local fallback plan"}`,
    `Metric: ${getPlanMeasureLabel(plan)}`,
    `Rows included: ${formatNumber(rowsAnalyzed)} of ${formatNumber(context.dataset.rowCount)}`,
    `Filter context: ${context.filterLabel}`,
  ];

  if (plan.groupByField) {
    receipts.splice(2, 0, `Grouped by: ${plan.groupByField}`);
  }

  if (plan.filters.length > 0) {
    receipts.push(`Question filters: ${formatPlanFilters(plan)}`);
  }

  if (plan.calculatedMetric) {
    receipts.push(`Formula: ${plan.calculatedMetric.name} = ${plan.calculatedMetric.formula}`);
  }

  if (plannerMessage) {
    receipts.push(plannerMessage);
  }

  receipts.push(`Plan: ${plan.rationale}`);
  return receipts;
}

function buildCaveats(plan: AnalysisPlan, numericCellsUsed: number) {
  const caveats = [
    plan.operation === "count"
      ? "Count uses rows in the current report context."
      : `${formatNumber(numericCellsUsed)} numeric cells were parsed from imported CSV values.`,
  ];

  if (plan.intent === "trend") {
    caveats.push("Trend uses the imported date grain as-is; dates are not grouped into weeks, months, or quarters yet.");
  }

  if (plan.operation === "average") {
    caveats.push("Average ignores blank or non-numeric cells.");
  }

  if (plan.operation === "ratio") {
    caveats.push(
      plan.calculatedMetric?.aggregation === "ratioOfTotals"
        ? "Calculated metric uses ratio of totals, not an average of row-level ratios."
        : "Calculated metric averages the row-level formula result inside the current context.",
    );
  }

  return caveats;
}

function buildVisualSuggestion(plan: AnalysisPlan): InsightVisualSuggestion | undefined {
  if (!plan.groupByField || !plan.measureField || plan.calculatedMetric) {
    return undefined;
  }

  return {
    title: `${plan.measureField} by ${plan.groupByField}`,
    kind: plan.intent === "trend" ? "Line" : "Bar",
    axisField: plan.groupByField,
    valueField: plan.measureField,
  };
}

function getUnsupportedAnswer(reason: string, plannerMessage?: string): InsightAnswer {
  return {
    status: "unsupported",
    answer: reason,
    receipts: plannerMessage ? ["No analysis was run.", plannerMessage] : ["No analysis was run."],
    caveats: ["InsightBoard supports totals, averages, counts, calculated metrics, comparisons, rankings, and simple trends."],
  };
}

function formatPlanMetric(plan: AnalysisPlan) {
  if (plan.operation === "count") {
    return "row count";
  }

  if (plan.calculatedMetric) {
    return plan.calculatedMetric.name;
  }

  return `${plan.operation} ${plan.measureField}`;
}

function formatAnswerScope(plan: AnalysisPlan) {
  return plan.filters.length > 0 ? ` for ${formatPlanFilters(plan)}` : " for the current report context";
}

function formatPlanFilters(plan: AnalysisPlan) {
  return plan.filters.map((filter) => `${filter.field} = ${filter.value}`).join(", ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatMetricValue(value: number, plan: AnalysisPlan) {
  const formatted = formatNumber(value);
  return plan.calculatedMetric?.format === "percent" ? `${formatted}%` : formatted;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
