# Build Journal

This journal records the decisions, tradeoffs, and learning notes for InsightBoard.

## 2026-09-18: Project Start

We decided to build a Power BI-inspired data analysis tool as a learning project. The first priority is understanding the product layers before writing too much code.

The app will be built in stages:

1. Project setup.
2. CSV import and data preview.
3. Field list and type detection.
4. Basic chart builder.
5. Dashboard canvas.
6. Filters and cross-visual interactions.
7. Persistence and export.

### Product Decision

We will build a dashboard-first app with Power BI-style field selection. This keeps the experience familiar while avoiding the complexity of Power BI's full modeling engine on day one.

### Technical Decision

We will likely start with React, TypeScript, and Vite because that combination gives us a fast development loop and a clean foundation for a browser-based analysis tool.

DuckDB-WASM is a strong candidate for the analytics layer, but we will not introduce it immediately. Starting with parsed in-memory data will make the early learning path clearer.

### Learning Goals

By building this project, we should learn:

- How BI tools represent datasets, fields, measures, charts, and dashboards.
- How frontend state should be shaped for data-heavy applications.
- How to parse and inspect tabular data in the browser.
- How chart configuration maps data fields to visual encodings.
- How filters propagate across a dashboard.
- How to structure a project so it can grow without becoming hard to reason about.

## 2026-09-18: Stage 1 App Foundation

We created the first runnable app skeleton using Vite, React, and TypeScript.

### What Changed

- Added package metadata and development scripts.
- Added a Vite config and TypeScript configs.
- Added the first React entry point.
- Built a static BI workspace shell with:
  - dataset and field sidebar,
  - report top bar,
  - dashboard canvas area,
  - sample KPI cards,
  - sample bar chart placeholder,
  - data preview table,
  - visual configuration sidebar.
- Added `docs/architecture.md` to explain the initial file structure and the concepts the app will grow toward.

### Why This Comes First

BI tools have a lot of moving pieces. Starting with the workspace shell gives us a place to attach features one at a time. The static sample data lets us focus on layout and product shape before we add file parsing, chart libraries, and dashboard state.

### Learning Notes

React components describe interface state. At this stage, the data is hard-coded arrays, but the shape already hints at future app state: fields, visuals, preview rows, and visual settings.

The layout uses a three-column app shell because BI tools usually need persistent access to fields, the canvas, and settings at the same time.

### Verification

The production build passes with `npm run build`.

## 2026-09-23: Stage 4 Dashboard Canvas

We moved from one fixed chart to a dashboard canvas with multiple configurable visual tiles.

### What Changed

- Added a `DashboardVisual` model for report visuals.
- Added visual selection by clicking a dashboard tile.
- Added an `Add visual` button.
- Added duplicate and remove actions for the selected visual.
- Added a size toggle for half-width and full-width visual cards.
- Made the right-side visual picker update only the selected visual.
- Made field clicks update the selected visual's axis or value field.
- Kept filters, metric cards, preview table, and all dashboard visuals connected to the same filtered rows.

### Learning Notes

A dashboard is data too. The important shift is that visuals are no longer only JSX on the page. They are records in state, and React renders the dashboard from those records.

This is the same pattern used in real report builders: the canvas is a saved report definition, and the UI is an editor for that definition.

We did not add drag-and-resize yet. The report model now has enough structure to support it cleanly in a later step.

### Verification

The production build passes with `npm run build`.

## 2026-09-23: Stage 3 Chart Builder

We replaced the chart placeholders with real charts powered by imported data.

### What Changed

- Installed ECharts and `echarts-for-react`.
- Added `src/chartModel.ts` for grouping rows and summing numeric values.
- Split visual configuration into separate axis and value fields.
- Dimension field clicks now update the chart axis.
- Measure field clicks now update the chart value.
- Bar, line, and pie visuals now render with ECharts.
- The table visual now shows aggregated chart data.
- Filters now update the chart, preview table, and metric totals from the same filtered rows.

### Learning Notes

A BI chart is usually built from aggregated data, not raw rows. The app now performs a small version of this workflow:

1. Filter rows.
2. Group rows by a dimension.
3. Convert measure cells into numbers.
4. Sum values inside each group.
5. Render the result with a chart library.

This explains why BI tools separate dimensions from measures. Dimensions answer "by what?" Measures answer "how much?"

### Tradeoff

ECharts gives us strong chart types quickly, but it increases the JavaScript bundle size. Vite now warns that the chart bundle is large. That is acceptable for this learning stage, and we can optimize with modular ECharts imports or code splitting later.

### Verification

The production build passes with `npm run build`.

During setup, npm optional dependencies were incomplete after an interrupted install. Vite depends on Rollup, and Rollup uses a native package on macOS. Installing `@rollup/rollup-darwin-arm64` fixed the missing native package and made the build pass.

## 2026-09-23: Make Stage 1 Testable

The first app shell looked good but most controls were static. We made the prototype testable in the browser without adding full data ingestion yet.

### What Changed

- Import dataset opens a file picker and records the selected file name in the UI.
- The dataset heading collapses and expands the field list.
- Field buttons select a field and update the field wells.
- Visual buttons switch the main preview between bar, line, pie, and table views.
- The filter button opens a region filter panel.
- Region filter chips update visible state and the dashboard status.
- Save report writes a timestamped prototype status message.

### Learning Notes

This is the first move from static markup to UI state. React's `useState` stores small pieces of interface state, and the rendered UI becomes a function of that state.

The app still uses sample data. That is intentional: making buttons testable first gives us a clear surface for Stage 2, where file import will start parsing real CSV rows.

## 2026-09-23: Stage 2 CSV Import

We added real CSV import and connected uploaded data to the workspace.

### What Changed

- Installed PapaParse for browser-based CSV parsing.
- Added `src/dataImport.ts` for parsing, row normalization, and type inference.
- Introduced a `Dataset` model with fields, rows, row count, and dataset name.
- Replaced the static field list with fields inferred from the imported CSV.
- Replaced the static preview table with the first rows from the imported CSV.
- Added row and column counts under the dataset name.
- Updated simple metric cards to use imported numeric columns when available.
- Made filter chips come from the active dimension field and apply to the preview rows and metric totals.

### Learning Notes

BI tools do not only store rows. They also need metadata about columns. In InsightBoard, each field has a type and role:

- `Number` fields become measures because they can be aggregated.
- `Text`, `Date`, and `Boolean` fields become dimensions because they describe or group records.

This split is the first small version of a semantic model. Power BI has a much richer version of the same idea.

### Verification

The production build passes with `npm run build`.
