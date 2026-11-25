import { aggregateRows, sumField } from "./chartModel";
import type { Dataset } from "./dataImport";

export type BriefVisualKind = "Bar" | "Line" | "Pie" | "Table";

export type BriefVisualSuggestion = {
  title: string;
  kind: BriefVisualKind;
  axisField: string;
  valueField: string;
  reason: string;
};

export type AiBrief = {
  headline: string;
  summary: string;
  recommendedMetrics: string[];
  questions: string[];
  qualityWarnings: string[];
  suggestedVisuals: BriefVisualSuggestion[];
};

export function generateAiBrief(dataset: Dataset): AiBrief {
  const dimensions = dataset.fields.filter((field) => field.role === "Dimension");
  const measures = dataset.fields.filter((field) => field.role === "Measure");
  const dateField = dimensions.find((field) => field.type === "Date");
  const primaryDimension = dimensions.find((field) => field.type !== "Date") ?? dimensions[0];
  const primaryMeasure = measures[0];
  const secondaryMeasure = measures[1];
  const datasetTheme = inferDatasetTheme(dataset.fields.map((field) => field.name));
  const qualityWarnings = getQualityWarnings(dataset);
  const suggestedVisuals = getSuggestedVisuals(dataset);

  return {
    headline: `${datasetTheme} analysis brief`,
    summary: getSummary(dataset, datasetTheme, dimensions.length, measures.length),
    recommendedMetrics: getRecommendedMetrics(dataset, primaryMeasure?.name, secondaryMeasure?.name),
    questions: getRecommendedQuestions(primaryDimension?.name, primaryMeasure?.name, secondaryMeasure?.name, dateField?.name),
    qualityWarnings,
    suggestedVisuals,
  };
}

function inferDatasetTheme(fieldNames: string[]) {
  const normalizedFields = fieldNames.join(" ").toLowerCase();

  if (hasAny(normalizedFields, ["sales", "revenue", "profit", "order", "customer", "segment"])) {
    return "Sales performance";
  }

  if (hasAny(normalizedFields, ["ticket", "case", "resolution", "priority", "sla", "support"])) {
    return "Support operations";
  }

  if (hasAny(normalizedFields, ["campaign", "channel", "spend", "click", "conversion", "impression"])) {
    return "Marketing performance";
  }

  if (hasAny(normalizedFields, ["employee", "department", "salary", "hire", "attrition"])) {
    return "Workforce";
  }

  if (hasAny(normalizedFields, ["inventory", "stock", "sku", "warehouse", "shipment"])) {
    return "Operations";
  }

  return "Dataset";
}

function getSummary(dataset: Dataset, theme: string, dimensionCount: number, measureCount: number) {
  return `${theme} dataset with ${formatNumber(dataset.rowCount)} rows, ${dataset.fields.length} columns, ${dimensionCount} dimensions, and ${measureCount} measures.`;
}

function getRecommendedMetrics(dataset: Dataset, primaryMeasure?: string, secondaryMeasure?: string) {
  const fieldNames = new Set(dataset.fields.map((field) => field.name.toLowerCase()));
  const metrics: string[] = [];

  if (primaryMeasure) {
    metrics.push(`Total ${primaryMeasure}: ${formatNumber(sumField(dataset.rows, primaryMeasure))}`);
    metrics.push(`Average ${primaryMeasure} per row: ${formatNumber(sumField(dataset.rows, primaryMeasure) / Math.max(dataset.rowCount, 1))}`);
  }

  if (secondaryMeasure) {
    metrics.push(`Total ${secondaryMeasure}: ${formatNumber(sumField(dataset.rows, secondaryMeasure))}`);
  }

  if (fieldNames.has("profit") && fieldNames.has("sales")) {
    const profit = sumField(dataset.rows, findFieldName(dataset, "profit"));
    const sales = sumField(dataset.rows, findFieldName(dataset, "sales"));
    metrics.push(`Profit margin: ${formatPercent(sales === 0 ? 0 : profit / sales)}`);
  }

  return metrics.slice(0, 4);
}

function getRecommendedQuestions(primaryDimension?: string, primaryMeasure?: string, secondaryMeasure?: string, dateField?: string) {
  const questions: string[] = [];

  if (primaryDimension && primaryMeasure) {
    questions.push(`Which ${primaryDimension} values drive the most ${primaryMeasure}?`);
    questions.push(`Where is ${primaryMeasure} concentrated or unusually low?`);
  }

  if (primaryDimension && secondaryMeasure) {
    questions.push(`Do ${primaryDimension} leaders change when comparing ${primaryMeasure} and ${secondaryMeasure}?`);
  }

  if (dateField && primaryMeasure) {
    questions.push(`How does ${primaryMeasure} trend over ${dateField}?`);
  }

  return questions.slice(0, 4);
}

function getQualityWarnings(dataset: Dataset) {
  const warnings: string[] = [];

  for (const field of dataset.fields) {
    const emptyCount = dataset.rows.filter((row) => !row[field.name]?.trim()).length;

    if (emptyCount > 0) {
      warnings.push(`${field.name} has ${formatNumber(emptyCount)} blank values.`);
    }
  }

  for (const field of dataset.fields.filter((candidate) => candidate.role === "Dimension")) {
    const distinctCount = new Set(dataset.rows.map((row) => row[field.name]).filter(Boolean)).size;

    if (dataset.rowCount > 0 && distinctCount / dataset.rowCount > 0.75 && distinctCount > 12) {
      warnings.push(`${field.name} has high cardinality, so it may be better for detail tables than charts.`);
    }
  }

  if (!dataset.fields.some((field) => field.role === "Measure")) {
    warnings.push("No numeric measures were detected.");
  }

  if (!dataset.fields.some((field) => field.type === "Date")) {
    warnings.push("No date field was detected, so trend analysis may be limited.");
  }

  return warnings.length > 0 ? warnings.slice(0, 4) : ["No immediate data quality issues found in the sampled rows."];
}

function getSuggestedVisuals(dataset: Dataset): BriefVisualSuggestion[] {
  const dimensions = dataset.fields.filter((field) => field.role === "Dimension");
  const measures = dataset.fields.filter((field) => field.role === "Measure");
  const dateField = dimensions.find((field) => field.type === "Date");
  const categoricalFields = dimensions.filter((field) => field.type !== "Date");
  const primaryMeasure = measures[0];

  if (!primaryMeasure) {
    return [];
  }

  const suggestions: BriefVisualSuggestion[] = [];

  for (const dimension of categoricalFields.slice(0, 3)) {
    const concentration = getConcentration(dataset, dimension.name, primaryMeasure.name);
    suggestions.push({
      title: `${primaryMeasure.name} by ${dimension.name}`,
      kind: concentration > 0.55 ? "Pie" : "Bar",
      axisField: dimension.name,
      valueField: primaryMeasure.name,
      reason:
        concentration > 0.55
          ? `One ${dimension.name} value contributes ${formatPercent(concentration)}, so concentration is worth checking.`
          : `${dimension.name} is a strong first grouping for ${primaryMeasure.name}.`,
    });
  }

  if (dateField) {
    suggestions.push({
      title: `${primaryMeasure.name} trend`,
      kind: "Line",
      axisField: dateField.name,
      valueField: primaryMeasure.name,
      reason: `${dateField.name} enables a time-based read of ${primaryMeasure.name}.`,
    });
  }

  return suggestions.slice(0, 4);
}

function getConcentration(dataset: Dataset, axisField: string, valueField: string) {
  const points = aggregateRows(dataset.rows, axisField, valueField);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  if (total === 0) {
    return 0;
  }

  return Math.max(...points.map((point) => point.value)) / total;
}

function findFieldName(dataset: Dataset, normalizedName: string) {
  return dataset.fields.find((field) => field.name.toLowerCase() === normalizedName)?.name ?? normalizedName;
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(Number.isFinite(value) ? value : 0);
}
