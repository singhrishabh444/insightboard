import { parseNumericCell as parseAnalysisNumericCell, type CalculatedMetric } from "./analysisPlan";
import { evaluateFormulaForRow } from "./formulaEngine";
import type { Dataset } from "./dataImport";

export type AggregatedPoint = {
  label: string;
  value: number;
};

export function aggregateRows(
  rows: Record<string, string>[],
  axisField: string,
  valueField: string,
): AggregatedPoint[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const label = row[axisField]?.trim() || "(blank)";
    const value = parseNumericCell(row[valueField]);
    totals.set(label, (totals.get(label) ?? 0) + value);
  }

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((first, second) => second.value - first.value)
    .slice(0, 12);
}

export function aggregateCalculatedMetricRows(
  rows: Record<string, string>[],
  axisField: string,
  metric: CalculatedMetric,
  dataset: Dataset,
): AggregatedPoint[] {
  const totals = new Map<string, { numerator: number; denominator: number; valueTotal: number; rowCount: number }>();

  for (const row of rows) {
    const label = row[axisField]?.trim() || "(blank)";
    const current = totals.get(label) ?? { numerator: 0, denominator: 0, valueTotal: 0, rowCount: 0 };

    if (metric.aggregation === "ratioOfTotals" && metric.numeratorField && metric.denominatorField) {
      const numeratorValue = parseAnalysisNumericCell(row[metric.numeratorField]);
      const denominatorValue = parseAnalysisNumericCell(row[metric.denominatorField]);

      if (numeratorValue == null || denominatorValue == null) {
        continue;
      }

      current.numerator += numeratorValue;
      current.denominator += denominatorValue;
      current.rowCount += 1;
    } else {
      const value = evaluateFormulaForRow(metric.formula, dataset, row);

      if (value == null) {
        continue;
      }

      current.valueTotal += value;
      current.rowCount += 1;
    }

    totals.set(label, current);
  }

  const scale = metric.format === "percent" ? 100 : 1;

  return Array.from(totals.entries())
    .map(([label, total]) => ({
      label,
      value:
        metric.aggregation === "ratioOfTotals"
          ? total.denominator === 0
            ? 0
            : (total.numerator / total.denominator) * scale
          : total.rowCount === 0
            ? 0
            : total.valueTotal / total.rowCount,
    }))
    .sort((first, second) => second.value - first.value)
    .slice(0, 12);
}

export function sumField(rows: Record<string, string>[], fieldName: string) {
  return rows.reduce((total, row) => total + parseNumericCell(row[fieldName]), 0);
}

export function parseNumericCell(value: string | undefined) {
  return parseAnalysisNumericCell(value) ?? 0;
}
