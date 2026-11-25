# Architecture Notes

InsightBoard starts as a local browser app. The first architecture goal is to keep the main BI concepts visible in the code instead of hiding them behind early abstractions.

## Stage 1 Structure

- `src/main.tsx` mounts the React app.
- `src/App.tsx` contains the first workspace shell.
- `src/dataImport.ts` contains CSV parsing, row normalization, and field type inference.
- `src/styles.css` contains the first responsive layout and visual system.
- `docs/` records decisions and learning notes.

## Core Concepts To Grow Toward

The app will eventually separate these concepts:

- Dataset: imported source data and inferred fields.
- Field: a column with a type and analytical role.
- Visual: a chart, KPI, table, or slicer on the dashboard.
- Encoding: the mapping from fields to visual roles such as axis, values, color, and filters.
- Report: the saved dashboard, visuals, layout, and active dataset references.

Stage 1 used static sample data so we could design the workspace before introducing parsing and state management complexity.

## Stage 2 Data Import

CSV import uses PapaParse in the browser. When a user selects a CSV file, the app:

1. Reads the first row as column headers.
2. Normalizes every cell into a string.
3. Infers a field type from sample values.
4. Marks numeric fields as measures.
5. Marks text, date, and boolean fields as dimensions.
6. Stores the result as a `Dataset`.

The current `Dataset` shape is:

- `name`: source file or sample dataset name.
- `fields`: inferred columns with type and analytical role.
- `rows`: normalized row objects keyed by field name.
- `rowCount`: number of imported rows.

This keeps raw imported data and inferred metadata together, which makes the field list, preview table, filters, and simple metric cards read from the same source.

## Stage 3 Chart Builder

Charts use Apache ECharts through `echarts-for-react`.

The chart builder now has three pieces of state:

- `activeVisual`: the selected visual type, such as bar, line, pie, or table.
- `axisField`: the dimension used to group rows.
- `valueField`: the measure used to calculate totals.

The aggregation model lives in `src/chartModel.ts`. It groups rows by the axis field and sums the value field. For example, `Sales by Region` becomes:

1. Read every row.
2. Use `Region` as the grouping key.
3. Parse `Sales` as a number.
4. Sum sales for each region.
5. Send the aggregated points into ECharts.

This is the first real chart builder behavior. Later stages can add aggregation choices such as average, count, min, and max.

## Stage 4 Dashboard Canvas

The dashboard now stores visual tiles as report state. Each visual has:

- `id`: stable identifier for selection and updates.
- `title`: label shown on the dashboard card.
- `kind`: bar, line, pie, or table.
- `axisField`: dimension used for grouping.
- `valueField`: measure used for aggregation.
- `size`: `half` or `wide`.

The selected visual drives the right-side configuration panel. Clicking a visual selects it. Clicking a dimension field updates that visual's axis, and clicking a measure field updates that visual's values.

This comes before drag-and-resize because the app needs a clear report model first. Once visuals are represented as data, adding drag positions or resizable dimensions becomes an extension of the model rather than a rewrite.

## Stage 5 Filters And Local Reports

Filtering is report-level state, separate from the selected visual. A `ReportFilter` stores:

- `fieldName`: the dimension used as the shared slicer.
- `value`: the selected member, or `All`.

The dashboard applies this filter before calculating KPI cards, chart aggregates, and the data preview. Individual visuals still keep their own `axisField` and `valueField`, so a report can be filtered by one dimension while a chart groups by another.

Local persistence uses `localStorage` under `insightboard.report.v1`. The saved payload includes the imported dataset, dashboard visuals, selected visual, selected field, active report filter, and save timestamp. This is intentionally browser-local prototype persistence; later stages can replace the storage boundary without changing the visual model.

## Stage 7 AI Analyst Layer

The first AI-native product surface is the AI Brief. It is generated from the imported dataset and shown as a dashboard card before the manually created visuals.

The brief generator lives in `src/aiBrief.ts`. It currently uses deterministic analyst heuristics so the prototype works fully offline:

- infer the likely dataset theme from field names;
- summarize rows, columns, dimensions, and measures;
- recommend initial metrics;
- propose business questions;
- flag simple data quality risks such as blanks, missing dates, missing measures, and high-cardinality dimensions;
- recommend visual configurations that can be added to the dashboard with one click.

This is intentionally shaped like a boundary for a later LLM service. The UI consumes an `AiBrief` object, not raw prose, so an LLM-backed endpoint can eventually return the same structure with stronger semantic reasoning, receipts, and caveats.

Ask InsightBoard is the reactive AI surface. The question system is split into two layers:

- `src/analysisPlan.ts` defines structured analysis plans and executes them against the current filtered rows.
- `src/insightQuestions.ts` turns a valid plan into answer text, receipts, caveats, and optional visual suggestions.

The supported analytical intents are:

- totals;
- averages;
- counts;
- calculated ratio metrics such as Profit Margin;
- highest and lowest rankings;
- comparisons by a dimension;
- simple trends over a detected date field.

Analysis plans can also include question-level filters. For example, `What is total Sales for Consumer?` becomes a sum of `Sales` with `Segment = Consumer`, while the report-level filter remains separate. The executor applies report filters first and then applies validated question filters before calculating the answer.

Calculated metrics are represented inside the plan as validated formulas. The built-in Profit Margin metric still supports ratio-of-totals behavior, such as `[Profit] / [Sales] * 100`, where the executor sums the numerator and denominator separately before dividing.

The Metric Library now also accepts free-form arithmetic formulas with bracketed field references, such as `[Profit] - [Sales] * 0.1`. Formula parsing lives in `src/formulaEngine.ts` and only allows numeric literals, bracketed measure fields, `+`, `-`, `*`, `/`, and parentheses. Saved metrics are included in local report persistence, appear in the field list as calculated fields, can be selected as chart values, and are passed into the planner so users can ask about them by name.

The optional LLM planner is exposed through Vite middleware at `/api/insight-plan`. It receives the user's question, dataset field schema, and bounded dimension value lists, but not the uploaded row data. The endpoint asks the OpenAI Responses API for a strict JSON analysis plan. The browser validates that plan against the actual dataset schema and known dimension values before running the calculation locally.

This keeps the AI role deliberately bounded: the model chooses the analysis shape, while InsightBoard computes the numbers and produces receipts from the actual dataset, fields, rows, and filters. If no API key is configured, or if the remote plan is invalid, the app falls back to the local planner and still answers supported questions.
