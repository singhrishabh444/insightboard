# InsightBoard

InsightBoard is an AI-assisted analytics workspace for imported datasets. Instead of being a generic BI clone, it uses an analyst-planner model: natural-language questions become structured analysis plans, and the app computes the answer locally from the current dataset and filter context.

The goal is to build a new AI-native analytics flow while keeping the architecture understandable:

1. Import tabular data.
2. Preview and profile datasets.
3. Build charts from selected fields.
4. Add filters that affect multiple visuals.
5. Arrange visuals on a dashboard canvas.
6. Save and reload reports.
7. Ask grounded questions that return answers, receipts, caveats, and suggested charts.
8. Use an optional LLM endpoint to plan flexible questions without letting the model invent numbers.

## AI Setup

InsightBoard works without an API key by using the local fallback planner. To enable LLM-backed planning in local dev, create `.env.local`:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
```

Then run:

```bash
npm run dev
```

The browser sends only the question and field schema to `/api/insight-plan`. Uploaded CSV rows stay in the browser, and the app validates the returned plan before calculating the answer.

## Working Style

This project will be documented as we build. Each major decision should be recorded in `docs/build-journal.md`, including what changed, why it changed, and what we learned from it.

Code should stay small and readable at first. We will add stronger abstractions only when the app starts needing them.

## Product Shape

The first version should feel like a lightweight BI workspace:

- A left panel for datasets and fields.
- A center area for dashboards and charts.
- A right panel for visual configuration.
- A top bar for importing data, saving reports, and future export actions.
- An AI analyst card for totals, averages, counts, rankings, comparisons, and trends.

## Stack

- React and TypeScript for the app.
- Vite for development.
- Apache ECharts for dashboard visuals.
- PapaParse for CSV import.
- OpenAI Responses API for optional structured analysis planning.
- SheetJS later for Excel import.
- DuckDB-WASM later when we need a stronger in-browser analytics engine.
- IndexedDB later for saving local reports.

The stack may change as we learn what the product needs.

## Project Status

Status: AI analyst planning and the first Metric Library are working.

Try importing `sample-data/sales.csv` from the local app, create a formula metric like `[Profit] - [Sales] * 0.1` in the Metric Library, then ask questions like `Which Region has the highest Adjusted Profit?` or `Which Region has the highest Profit Margin?`.
