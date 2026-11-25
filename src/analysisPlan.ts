import type { Dataset, DatasetField } from "./dataImport";
import { evaluateFormulaForRow, getFormulaFields, validateFormula } from "./formulaEngine";

export type AnalysisOperation = "sum" | "average" | "count" | "ratio";
export type AnalysisIntent = "single_metric" | "ranking" | "comparison" | "trend";
export type AnalysisSort = "highest" | "lowest" | "none";

export type AnalysisFilter = {
  field: string;
  value: string;
};

export type CalculatedMetric = {
  name: string;
  formula: string;
  aggregation: "ratioOfTotals" | "average";
  numeratorField?: string;
  denominatorField?: string;
  format: "percent" | "number";
};

export type AnalysisPlan = {
  intent: AnalysisIntent;
  operation: AnalysisOperation;
  measureField: string | null;
  calculatedMetric: CalculatedMetric | null;
  groupByField: string | null;
  filters: AnalysisFilter[];
  sort: AnalysisSort;
  limit: number;
  rationale: string;
};

export type AnalysisPlanResult = {
  status: "planned" | "unsupported";
  source: "ai" | "local";
  plan?: AnalysisPlan;
  reason?: string;
};

export type AnalysisPoint = {
  label: string;
  value: number;
  rowCount: number;
};

export type ExecutedAnalysis = {
  points: AnalysisPoint[];
  value: number;
  rowsAnalyzed: number;
  rowsBeforeQuestionFilters: number;
  numericCellsUsed: number;
};

export type AnalysisContext = {
  dataset: Dataset;
  rows: Record<string, string>[];
  filterLabel: string;
  calculatedMetrics: CalculatedMetric[];
};

const maxPlanLimit = 25;

export function createLocalAnalysisPlan(
  question: string,
  dataset: Dataset,
  calculatedMetrics: CalculatedMetric[] = [],
): AnalysisPlanResult {
  const normalizedQuestion = question.trim().toLowerCase();

  if (!normalizedQuestion) {
    return {
      status: "unsupported",
      source: "local",
      reason: "Ask a question about a measure, dimension, or trend in the current dataset.",
    };
  }

  const intent = inferIntent(normalizedQuestion);
  const calculatedMetric = findSavedCalculatedMetric(calculatedMetrics, normalizedQuestion) ?? inferCalculatedMetric(normalizedQuestion, dataset);
  const operation = calculatedMetric ? "ratio" : inferOperation(normalizedQuestion);
  const measure = operation === "count" ? findMeasure(dataset, normalizedQuestion, true) : findMeasure(dataset, normalizedQuestion);
  const dateField = dataset.fields.find((field) => field.type === "Date");
  const needsGroupBy = intent === "ranking" || intent === "comparison" || intent === "trend";
  const dimension = intent === "trend" ? dateField : needsGroupBy ? findDimension(dataset, normalizedQuestion) : undefined;

  if (!intent) {
    return {
      status: "unsupported",
      source: "local",
      reason: "Try asking for a total, average, count, comparison, trend, highest value, or lowest value.",
    };
  }

  if (operation !== "count" && operation !== "ratio" && !measure) {
    return {
      status: "unsupported",
      source: "local",
      reason: "I could not find a numeric measure to analyze.",
    };
  }

  if (operation === "ratio" && !calculatedMetric) {
    return {
      status: "unsupported",
      source: "local",
      reason: "I could not infer a valid calculated metric formula from the dataset fields.",
    };
  }

  if ((intent === "ranking" || intent === "comparison" || intent === "trend") && !dimension) {
    return {
      status: "unsupported",
      source: "local",
      reason: intent === "trend" ? "I could not find a date field for trend analysis." : "I could not find a dimension to group by.",
    };
  }

  return {
    status: "planned",
    source: "local",
    plan: {
      intent,
      operation,
      measureField: measure?.name ?? null,
      calculatedMetric,
      groupByField: dimension?.name ?? null,
      filters: inferQuestionFilters(normalizedQuestion, dataset, dimension?.name),
      sort: inferSort(normalizedQuestion, intent),
      limit: intent === "single_metric" ? 1 : 12,
      rationale: "Local keyword plan generated from the question and dataset fields.",
    },
  };
}

export function validateAnalysisPlan(
  plan: unknown,
  dataset: Dataset,
  calculatedMetrics: CalculatedMetric[] = [],
): AnalysisPlanResult {
  if (!isRecord(plan)) {
    return unsupportedAiPlan("The AI planner returned an unreadable plan.");
  }

  const intent = readEnum(plan.intent, ["single_metric", "ranking", "comparison", "trend"] as const);
  const operation = readEnum(plan.operation, ["sum", "average", "count", "ratio"] as const);
  const sort = readEnum(plan.sort, ["highest", "lowest", "none"] as const);
  const measureField = typeof plan.measureField === "string" ? plan.measureField : null;
  const calculatedMetric = readCalculatedMetric(plan.calculatedMetric, dataset, calculatedMetrics);
  const groupByField = typeof plan.groupByField === "string" ? plan.groupByField : null;
  const filters = readFilters(plan.filters, dataset, groupByField);
  const rationale = typeof plan.rationale === "string" && plan.rationale.trim() ? plan.rationale.trim() : "AI-generated analysis plan.";
  const limit = clampLimit(typeof plan.limit === "number" ? plan.limit : Number(plan.limit));

  if (!intent || !operation || !sort) {
    return unsupportedAiPlan("The AI planner selected an unsupported analysis shape.");
  }

  if (operation !== "count" && operation !== "ratio" && !findField(dataset, measureField, "Measure")) {
    return unsupportedAiPlan("The AI planner referenced a measure that is not in the dataset.");
  }

  if (operation === "ratio" && !calculatedMetric.valid) {
    return unsupportedAiPlan(calculatedMetric.reason);
  }

  if ((intent === "ranking" || intent === "comparison" || intent === "trend") && !findField(dataset, groupByField)) {
    return unsupportedAiPlan("The AI planner referenced a grouping field that is not in the dataset.");
  }

  if (intent === "trend" && groupByField && findField(dataset, groupByField)?.type !== "Date") {
    return unsupportedAiPlan("The AI planner tried to build a trend without a date field.");
  }

  if (!filters.valid) {
    return unsupportedAiPlan(filters.reason);
  }

  return {
    status: "planned",
    source: "ai",
    plan: {
      intent,
      operation,
      measureField,
      calculatedMetric: calculatedMetric.value ?? null,
      groupByField,
      filters: filters.values,
      sort,
      limit,
      rationale,
    },
  };
}

export function executeAnalysisPlan(plan: AnalysisPlan, context: AnalysisContext): ExecutedAnalysis {
  const rows = applyPlanFilters(context.rows, plan.filters);

  if (plan.intent === "single_metric") {
    const summary = summarizeRows(rows, plan.operation, plan.measureField, plan.calculatedMetric, context.dataset);

    return {
      points: [],
      value: summary.value,
      rowsAnalyzed: rows.length,
      rowsBeforeQuestionFilters: context.rows.length,
      numericCellsUsed: summary.numericCellsUsed,
    };
  }

  const grouped = new Map<string, { total: number; denominatorTotal: number; count: number; rowCount: number; firstSeen: number }>();
  const groupByField = plan.groupByField ?? "";

  rows.forEach((row, rowIndex) => {
    const label = row[groupByField]?.trim() || "(blank)";
    const current = grouped.get(label) ?? { total: 0, denominatorTotal: 0, count: 0, rowCount: 0, firstSeen: rowIndex };
    current.rowCount += 1;

    if (plan.operation === "count") {
      current.count += 1;
    } else if (plan.operation === "ratio" && plan.calculatedMetric) {
      const metricValue = evaluateCalculatedMetricForRow(plan.calculatedMetric, context.dataset, row);

      if (metricValue != null) {
        if (plan.calculatedMetric.aggregation === "ratioOfTotals" && plan.calculatedMetric.numeratorField && plan.calculatedMetric.denominatorField) {
          const numeratorValue = parseNumericCell(row[plan.calculatedMetric.numeratorField]);
          const denominatorValue = parseNumericCell(row[plan.calculatedMetric.denominatorField]);

          if (numeratorValue != null && denominatorValue != null) {
            current.total += numeratorValue;
            current.denominatorTotal += denominatorValue;
          }
        } else {
          current.total += metricValue;
        }

        current.count += getCalculatedMetricFieldCount(plan.calculatedMetric, context.dataset);
      }
    } else {
      const numericValue = parseNumericCell(row[plan.measureField ?? ""]);

      if (numericValue != null) {
        current.total += numericValue;
        current.count += 1;
      }
    }

    grouped.set(label, current);
  });

  const field = findField(context.dataset, groupByField);
  const points = Array.from(grouped.entries()).map(([label, group]) => ({
    label,
    value:
      plan.operation === "average"
        ? safeDivide(group.total, group.count)
        : plan.operation === "count"
          ? group.rowCount
          : plan.operation === "ratio"
            ? getGroupedCalculatedMetricValue(group, plan.calculatedMetric)
            : group.total,
    rowCount: group.rowCount,
    firstSeen: group.firstSeen,
  }));

  const sortedPoints = sortPoints(points, plan.sort, field).slice(0, clampLimit(plan.limit));

  return {
    points: sortedPoints.map(({ firstSeen: _firstSeen, ...point }) => point),
    value: sortedPoints[0]?.value ?? 0,
    rowsAnalyzed: rows.length,
    rowsBeforeQuestionFilters: context.rows.length,
    numericCellsUsed: Array.from(grouped.values()).reduce((count, group) => count + group.count, 0),
  };
}

export function parseNumericCell(value: string | undefined): number | null {
  const normalized = (value ?? "").replace(/[$,%]/g, "").replace(/,/g, "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPlanMeasureLabel(plan: AnalysisPlan) {
  if (plan.operation === "count") {
    return "row count";
  }

  if (plan.operation === "ratio" && plan.calculatedMetric) {
    return plan.calculatedMetric.name;
  }

  return `${plan.operation} of ${plan.measureField}`;
}

function summarizeRows(
  rows: Record<string, string>[],
  operation: AnalysisOperation,
  measureField: string | null,
  calculatedMetric: CalculatedMetric | null,
  dataset: Dataset,
) {
  if (operation === "count") {
    return { value: rows.length, numericCellsUsed: rows.length };
  }

  if (operation === "ratio" && calculatedMetric) {
    let numeratorTotal = 0;
    let denominatorTotal = 0;
    let formulaTotal = 0;
    let formulaCount = 0;
    let count = 0;

    for (const row of rows) {
      const metricValue = evaluateCalculatedMetricForRow(calculatedMetric, dataset, row);

      if (metricValue != null) {
        if (calculatedMetric.aggregation === "ratioOfTotals" && calculatedMetric.numeratorField && calculatedMetric.denominatorField) {
          const numeratorValue = parseNumericCell(row[calculatedMetric.numeratorField]);
          const denominatorValue = parseNumericCell(row[calculatedMetric.denominatorField]);

          if (numeratorValue != null && denominatorValue != null) {
            numeratorTotal += numeratorValue;
            denominatorTotal += denominatorValue;
          }
        } else {
          formulaTotal += metricValue;
          formulaCount += 1;
        }

        count += getCalculatedMetricFieldCount(calculatedMetric, dataset);
      }
    }

    return {
      value:
        calculatedMetric.aggregation === "ratioOfTotals"
          ? safeDivide(numeratorTotal, denominatorTotal) * getRatioScale(calculatedMetric)
          : safeDivide(formulaTotal, formulaCount),
      numericCellsUsed: count,
    };
  }

  let total = 0;
  let count = 0;

  for (const row of rows) {
    const value = parseNumericCell(row[measureField ?? ""]);

    if (value != null) {
      total += value;
      count += 1;
    }
  }

  return {
    value: operation === "average" ? safeDivide(total, count) : total,
    numericCellsUsed: count,
  };
}

function inferIntent(question: string): AnalysisIntent | null {
  if (hasAny(question, ["trend", "over time", "change over", "by date", "timeline"])) {
    return "trend";
  }

  if (hasAny(question, ["highest", "most", "largest", "best", "top", "lowest", "least", "smallest", "worst", "underperform"])) {
    return "ranking";
  }

  if (hasAny(question, ["compare", "breakdown", "by ", "across", "per "])) {
    return "comparison";
  }

  if (
    hasAny(question, [
      "total",
      "sum",
      "overall",
      "how much",
      "average",
      "avg",
      "mean",
      "count",
      "how many",
      "number of",
      "margin",
      "rate",
      "ratio",
    ])
  ) {
    return "single_metric";
  }

  return null;
}

function inferOperation(question: string): AnalysisOperation {
  if (hasAny(question, ["average", "avg", "mean"])) {
    return "average";
  }

  if (hasAny(question, ["count", "how many", "number of", "rows"])) {
    return "count";
  }

  return "sum";
}

function inferCalculatedMetric(question: string, dataset: Dataset): CalculatedMetric | null {
  if (!hasAny(question, ["profit margin", "margin", "profitability"])) {
    return null;
  }

  const numeratorField = findMeasureByTerms(dataset, ["profit", "income", "earnings"]);
  const denominatorField = findMeasureByTerms(dataset, ["sales", "revenue", "net sales"]);

  if (!numeratorField || !denominatorField || numeratorField.name === denominatorField.name) {
    return null;
  }

  return {
    name: "Profit Margin",
    formula: `[${numeratorField.name}] / [${denominatorField.name}] * 100`,
    aggregation: "ratioOfTotals",
    numeratorField: numeratorField.name,
    denominatorField: denominatorField.name,
    format: "percent",
  };
}

function findSavedCalculatedMetric(calculatedMetrics: CalculatedMetric[], question: string) {
  return calculatedMetrics.find((metric) => question.includes(metric.name.toLowerCase())) ?? null;
}

function inferSort(question: string, intent: AnalysisIntent): AnalysisSort {
  if (hasAny(question, ["lowest", "least", "smallest", "worst", "underperform"])) {
    return "lowest";
  }

  if (intent === "ranking" || hasAny(question, ["highest", "most", "largest", "best", "top"])) {
    return "highest";
  }

  return "none";
}

function findMeasure(dataset: Dataset, question: string, optional = false) {
  const measures = dataset.fields.filter((field) => field.role === "Measure");
  const exactMatch = findMentionedField(measures, question);

  if (exactMatch) {
    return exactMatch;
  }

  if (question.includes("profitable") || question.includes("profitability") || question.includes("margin")) {
    return measures.find((field) => field.name.toLowerCase().includes("profit")) ?? measures[0];
  }

  if (question.includes("revenue")) {
    return measures.find((field) => field.name.toLowerCase().includes("sales")) ?? measures[0];
  }

  return optional ? measures[0] : measures[0];
}

function findDimension(dataset: Dataset, question: string) {
  const dimensions = dataset.fields.filter((field) => field.role === "Dimension");
  const exactMatch = findMentionedField(dimensions, question);

  if (exactMatch) {
    return exactMatch;
  }

  return dimensions.find((field) => field.type !== "Date") ?? dimensions[0];
}

function findMeasureByTerms(dataset: Dataset, terms: string[]) {
  const measures = dataset.fields.filter((field) => field.role === "Measure");
  return measures.find((field) => terms.some((term) => field.name.toLowerCase().includes(term)));
}

function inferQuestionFilters(question: string, dataset: Dataset, groupByField?: string | null): AnalysisFilter[] {
  const filters: AnalysisFilter[] = [];

  for (const field of dataset.fields) {
    if (field.role !== "Dimension" || field.name === groupByField || field.type === "Date") {
      continue;
    }

    const value = findMentionedValue(dataset.rows, field.name, question);

    if (value) {
      filters.push({ field: field.name, value });
    }
  }

  return filters.slice(0, 4);
}

function findMentionedValue(rows: Record<string, string>[], fieldName: string, question: string) {
  const values = Array.from(new Set(rows.map((row) => row[fieldName]).filter(Boolean))).sort((first, second) => second.length - first.length);
  return values.find((value) => question.includes(value.toLowerCase()));
}

function findMentionedField(fields: DatasetField[], question: string) {
  return fields.find((field) => question.includes(field.name.toLowerCase()));
}

function applyPlanFilters(rows: Record<string, string>[], filters: AnalysisFilter[]) {
  return rows.filter((row) =>
    filters.every((filter) => normalizeForCompare(row[filter.field]) === normalizeForCompare(filter.value)),
  );
}

function sortPoints<T extends AnalysisPoint & { firstSeen: number }>(points: T[], sort: AnalysisSort, field?: DatasetField) {
  const sorted = [...points];

  if (sort === "highest") {
    return sorted.sort((first, second) => second.value - first.value);
  }

  if (sort === "lowest") {
    return sorted.sort((first, second) => first.value - second.value);
  }

  if (field?.type === "Date") {
    return sorted.sort((first, second) => {
      const firstTime = Date.parse(first.label);
      const secondTime = Date.parse(second.label);

      if (Number.isFinite(firstTime) && Number.isFinite(secondTime)) {
        return firstTime - secondTime;
      }

      return first.label.localeCompare(second.label);
    });
  }

  return sorted.sort((first, second) => first.firstSeen - second.firstSeen);
}

function findField(dataset: Dataset, fieldName: string | null, role?: DatasetField["role"]) {
  return dataset.fields.find((field) => field.name === fieldName && (!role || field.role === role));
}

function readFilters(filters: unknown, dataset: Dataset, groupByField: string | null) {
  if (!Array.isArray(filters)) {
    return { valid: true as const, values: [] };
  }

  const values: AnalysisFilter[] = [];

  for (const filter of filters.slice(0, 4)) {
    if (!isRecord(filter) || typeof filter.field !== "string" || typeof filter.value !== "string") {
      return { valid: false as const, reason: "The AI planner returned an invalid filter." };
    }

    const filterField = filter.field;
    const filterValue = filter.value;
    const field = findField(dataset, filterField);

    if (!field) {
      return { valid: false as const, reason: "The AI planner referenced a filter field that is not in the dataset." };
    }

    if (filterField === groupByField) {
      return { valid: false as const, reason: "The AI planner tried to filter and group by the same field." };
    }

    const hasValue = dataset.rows.some((row) => normalizeForCompare(row[filterField]) === normalizeForCompare(filterValue));

    if (!hasValue) {
      return { valid: false as const, reason: "The AI planner referenced a filter value that is not in the dataset." };
    }

    values.push({ field: filterField, value: filterValue });
  }

  return { valid: true as const, values };
}

function readCalculatedMetric(value: unknown, dataset: Dataset, calculatedMetrics: CalculatedMetric[]) {
  if (value == null) {
    return { valid: true as const, value: null };
  }

  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.formula !== "string" ||
    !["percent", "number"].includes(typeof value.format === "string" ? value.format : "")
  ) {
    return { valid: false as const, reason: "The AI planner returned an invalid calculated metric." };
  }

  const metricName = value.name;
  const formula = value.formula;
  const aggregation = value.aggregation === "ratioOfTotals" ? "ratioOfTotals" : "average";
  const numeratorField = typeof value.numeratorField === "string" ? value.numeratorField : undefined;
  const denominatorField = typeof value.denominatorField === "string" ? value.denominatorField : undefined;
  const metricFormat = value.format as CalculatedMetric["format"];
  const validation = validateFormula(formula, dataset);

  if (!validation.valid) {
    return { valid: false as const, reason: validation.reason };
  }

  if (
    aggregation === "ratioOfTotals" &&
    (!numeratorField || !denominatorField || !findField(dataset, numeratorField, "Measure") || !findField(dataset, denominatorField, "Measure"))
  ) {
    return { valid: false as const, reason: "The AI planner returned an invalid ratio-of-totals metric." };
  }

  const savedMetric = calculatedMetrics.find(
    (metric) =>
      normalizeForCompare(metric.name) === normalizeForCompare(metricName) &&
      normalizeForCompare(metric.formula) === normalizeForCompare(formula),
  );

  if (numeratorField && denominatorField && numeratorField === denominatorField) {
    return { valid: false as const, reason: "The AI planner used the same field on both sides of a calculated metric." };
  }

  return {
    valid: true as const,
    value: savedMetric ?? {
      name: metricName,
      formula,
      aggregation,
      numeratorField,
      denominatorField,
      format: metricFormat,
    },
  };
}

function unsupportedAiPlan(reason: string): AnalysisPlanResult {
  return {
    status: "unsupported",
    source: "ai",
    reason,
  };
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 12;
  }

  return Math.min(maxPlanLimit, Math.max(1, Math.round(limit)));
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDivide(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

function getGroupedCalculatedMetricValue(
  group: { total: number; denominatorTotal: number; rowCount: number },
  calculatedMetric: CalculatedMetric | null,
) {
  if (calculatedMetric?.aggregation === "ratioOfTotals") {
    return safeDivide(group.total, group.denominatorTotal) * getRatioScale(calculatedMetric);
  }

  return safeDivide(group.total, group.rowCount);
}

function getRatioScale(calculatedMetric: CalculatedMetric | null) {
  return calculatedMetric?.format === "percent" ? 100 : 1;
}

function evaluateCalculatedMetricForRow(metric: CalculatedMetric, dataset: Dataset, row: Record<string, string>) {
  if (metric.aggregation === "ratioOfTotals" && metric.numeratorField && metric.denominatorField) {
    const numeratorValue = parseNumericCell(row[metric.numeratorField]);
    const denominatorValue = parseNumericCell(row[metric.denominatorField]);

    if (numeratorValue == null || denominatorValue == null || denominatorValue === 0) {
      return null;
    }

    return (numeratorValue / denominatorValue) * getRatioScale(metric);
  }

  return evaluateFormulaForRow(metric.formula, dataset, row);
}

function getCalculatedMetricFieldCount(metric: CalculatedMetric, dataset: Dataset) {
  const fields = getFormulaFields(metric.formula, dataset);
  return Math.max(fields.length, metric.numeratorField && metric.denominatorField ? 2 : 1);
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function normalizeForCompare(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}
