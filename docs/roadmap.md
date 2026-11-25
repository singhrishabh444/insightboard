# Roadmap

## Stage 1: Foundation

- Create the app skeleton. Done.
- Add a basic shell layout. Done.
- Document the file structure. Done.
- Prepare Git-friendly defaults. In progress.

## Stage 2: Data Import

- Import CSV files. Done.
- Parse rows and columns. Done.
- Show a data preview table. Done.
- Infer simple field types: text, number, date, boolean. Done.

## Stage 3: Chart Builder

- Add a field list. Done.
- Let users select dimensions and measures. Done.
- Render bar, line, pie, KPI, and table visuals. Partially done: bar, line, pie, table, and KPI cards are working.
- Store chart configuration separately from raw data. Done for active axis, value, and visual type.

## Stage 4: Dashboard Canvas

- Add a resizable dashboard grid. Partially done: visuals can switch between half and full width.
- Place multiple visuals on the canvas. Done.
- Edit visual settings from a side panel. Done.
- Save dashboard layout state. Done for local browser report state.

## Stage 5: Filtering

- Add slicers and filter controls. Done for one shared report filter.
- Apply filters across multiple visuals. Done.
- Document the filter model. Done.

## Stage 6: Persistence

- Save reports locally. Done.
- Reload saved reports. Done.
- Export dashboard snapshots.

## Stage 7: AI Analyst Layer

- Generate a dataset brief after import. Done with local analyst heuristics.
- Suggest useful metrics, questions, and data quality checks. Done.
- Recommend visuals from the detected schema. Done.
- Create visuals from AI suggestions. Done.
- Ask grounded dataset questions. Done for totals, averages, counts, rankings, comparisons, and trends.
- Add answer receipts with rows, fields, filters, planner source, and caveats. Done.
- Add an LLM-backed insight endpoint. Done for local Vite dev/preview with local fallback.
- Validate remote analysis plans against the imported schema. Done.
- Keep uploaded row data out of the LLM request. Done.
- Add question-level filters such as `Sales in East` or `Sales for Consumer`. Done.
- Add calculated metrics such as `Profit Margin = Profit / Sales`. Done for ratio-of-totals metrics.
- Add a Metric Library for saved ratio metrics that can be reused in Q&A and charts. Done.
- Add free-form formula metrics with bracketed fields and safe arithmetic validation. Done.
- Add richer semantic planning for date grains and multi-step questions.

## Stage 8: Git And Polish

- Review the codebase.
- Clean up documentation.
- Create meaningful commits.
- Push to Git when ready.
