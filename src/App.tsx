import { useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Copy,
  Database,
  FileUp,
  Filter,
  FolderOpen,
  Lightbulb,
  LayoutDashboard,
  LineChart,
  PieChart,
  Plus,
  Save,
  Send,
  Settings2,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import { type BriefVisualSuggestion, generateAiBrief } from "./aiBrief";
import { aggregateCalculatedMetricRows, aggregateRows, sumField } from "./chartModel";
import { type Dataset, parseCsvFile } from "./dataImport";
import { validateFormula } from "./formulaEngine";
import {
  answerInsightQuestion,
  validateRemoteAnalysisPlan,
  type InsightAnswer,
  type InsightVisualSuggestion,
  type PlannerState,
} from "./insightQuestions";
import type { CalculatedMetric } from "./analysisPlan";

type VisualKind = "Bar" | "Line" | "Pie" | "Table";
type VisualSize = "half" | "wide";
type FilterValue = string | "All";

type DashboardVisual = {
  id: string;
  title: string;
  kind: VisualKind;
  axisField: string;
  valueField: string;
  size: VisualSize;
};

type ReportFilter = {
  fieldName: string;
  value: FilterValue;
};

type SavedReport = {
  dataset: Dataset;
  dashboardVisuals: DashboardVisual[];
  selectedVisualId: string;
  selectedField: string;
  reportFilter: ReportFilter;
  calculatedMetrics: CalculatedMetric[];
  savedAt: string;
};

const savedReportKey = "insightboard.report.v1";
const starterQuestions = [
  "Which Region has the highest Profit?",
  "Which Region has the highest Profit Margin?",
  "What is total Sales for Consumer?",
  "Show Sales trend over time",
];

const sampleDataset: Dataset = {
  name: "Sample Sales",
  fields: [
    { name: "Order Date", type: "Date", role: "Dimension" },
    { name: "Region", type: "Text", role: "Dimension" },
    { name: "Segment", type: "Text", role: "Dimension" },
    { name: "Sales", type: "Number", role: "Measure" },
    { name: "Profit", type: "Number", role: "Measure" },
  ],
  rows: [
    {
      "Order Date": "2026-01-04",
      Region: "East",
      Segment: "Consumer",
      Sales: "$14,520",
      Profit: "$3,248",
    },
    {
      "Order Date": "2026-01-05",
      Region: "West",
      Segment: "Enterprise",
      Sales: "$21,340",
      Profit: "$4,180",
    },
    {
      "Order Date": "2026-01-06",
      Region: "South",
      Segment: "Small Business",
      Sales: "$9,840",
      Profit: "$1,205",
    },
    {
      "Order Date": "2026-01-07",
      Region: "North",
      Segment: "Consumer",
      Sales: "$16,310",
      Profit: "$2,907",
    },
  ],
  rowCount: 4,
};

const visuals = [
  { label: "Bar", icon: BarChart3 },
  { label: "Line", icon: LineChart },
  { label: "Pie", icon: PieChart },
  { label: "Table", icon: Table2 },
];

const initialDashboardVisuals: DashboardVisual[] = [
  {
    id: "visual-1",
    title: "Sales by Region",
    kind: "Bar",
    axisField: "Region",
    valueField: "Sales",
    size: "wide",
  },
];

const initialCalculatedMetrics: CalculatedMetric[] = [
  {
    name: "Profit Margin",
    formula: "[Profit] / [Sales] * 100",
    aggregation: "ratioOfTotals",
    numeratorField: "Profit",
    denominatorField: "Sales",
    format: "percent",
  },
];

export function App() {
  const [dataset, setDataset] = useState<Dataset>(sampleDataset);
  const [dashboardVisuals, setDashboardVisuals] = useState<DashboardVisual[]>(initialDashboardVisuals);
  const [calculatedMetrics, setCalculatedMetrics] = useState<CalculatedMetric[]>(initialCalculatedMetrics);
  const [selectedVisualId, setSelectedVisualId] = useState(initialDashboardVisuals[0].id);
  const [selectedField, setSelectedField] = useState("Region");
  const [fieldsExpanded, setFieldsExpanded] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportFilter, setReportFilter] = useState<ReportFilter>({ fieldName: "Region", value: "All" });
  const [insightQuestion, setInsightQuestion] = useState(starterQuestions[0]);
  const [insightAnswer, setInsightAnswer] = useState<InsightAnswer | null>(null);
  const [plannerState, setPlannerState] = useState<PlannerState>("local");
  const [statusMessage, setStatusMessage] = useState("Ready to analyze sample data.");
  const [isImporting, setIsImporting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [metricDraft, setMetricDraft] = useState({
    name: "Profit Margin",
    formula: "[Profit] / [Sales] * 100",
    aggregation: "ratioOfTotals" as CalculatedMetric["aggregation"],
    numeratorField: "Profit",
    denominatorField: "Sales",
    format: "percent" as CalculatedMetric["format"],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askRequestRef = useRef(0);

  const firstMeasure = dataset.fields.find((field) => field.role === "Measure")?.name ?? dataset.fields[0]?.name ?? "";
  const firstDimension = dataset.fields.find((field) => field.role === "Dimension")?.name ?? dataset.fields[0]?.name ?? "";
  const selectedVisual = dashboardVisuals.find((visual) => visual.id === selectedVisualId) ?? dashboardVisuals[0];
  const activeMetric = calculatedMetrics.find((metric) => metric.name === selectedVisual?.valueField);
  const activeVisualKind = selectedVisual?.kind ?? "Bar";
  const activeAxisField = resolveFieldName(dataset, selectedVisual?.axisField, firstDimension);
  const activeValueField = activeMetric?.name ?? resolveFieldName(dataset, selectedVisual?.valueField, firstMeasure);
  const filterField = resolveFieldName(dataset, reportFilter.fieldName, firstDimension);
  const filteredRows = applyReportFilter(dataset.rows, filterField, reportFilter.value);
  const previewRows = filteredRows.slice(0, 8);
  const hasRows = previewRows.length > 0;
  const numericFields = dataset.fields.filter((field) => field.role === "Measure");
  const dimensionFields = dataset.fields.filter((field) => field.role === "Dimension");
  const primaryMetric = numericFields[0]?.name ?? "Rows";
  const secondaryMetric = numericFields[1]?.name ?? "Columns";
  const primaryMetricValue = numericFields[0] ? formatNumber(sumField(filteredRows, primaryMetric)) : formatNumber(filteredRows.length);
  const secondaryMetricValue = numericFields[1]
    ? formatNumber(sumField(filteredRows, secondaryMetric))
    : formatNumber(dataset.fields.length);
  const filterValues = getFilterValues(dataset.rows, filterField);
  const aiBrief = generateAiBrief(dataset);

  async function handleFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);
    setStatusMessage(`Importing ${file.name}...`);

    try {
      const importedDataset = await parseCsvFile(file);
      const importedAxisField = importedDataset.fields.find((field) => field.role === "Dimension")?.name ?? importedDataset.fields[0]?.name ?? "";
      const importedValueField = importedDataset.fields.find((field) => field.role === "Measure")?.name ?? importedDataset.fields[0]?.name ?? "";
      setDataset(importedDataset);
      setSelectedField(importedDataset.fields[0]?.name ?? "");
      const nextVisual: DashboardVisual = {
        id: `visual-${Date.now()}`,
        title: `${importedValueField || "Value"} by ${importedAxisField || "Field"}`,
        kind: "Bar",
        axisField: importedAxisField,
        valueField: importedValueField,
        size: "wide",
      };
      setDashboardVisuals([nextVisual]);
      setCalculatedMetrics(createDefaultCalculatedMetrics(importedDataset));
      setMetricDraft(createDefaultMetricDraft(importedDataset));
      setSelectedVisualId(nextVisual.id);
      setReportFilter({ fieldName: importedAxisField, value: "All" });
      setInsightAnswer(null);
      setPlannerState("local");
      setStatusMessage(
        `Imported ${importedDataset.name}: ${importedDataset.rowCount} rows and ${importedDataset.fields.length} columns.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The CSV could not be parsed.";
      setStatusMessage(`Import failed: ${message}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleSaveReport() {
    const savedAt = new Date().toISOString();
    const savedLabel = new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(savedAt));

    const savedReport: SavedReport = {
      dataset,
      dashboardVisuals,
      selectedVisualId,
      selectedField,
      reportFilter: { fieldName: filterField, value: reportFilter.value },
      calculatedMetrics,
      savedAt,
    };

    localStorage.setItem(savedReportKey, JSON.stringify(savedReport));
    setStatusMessage(`Report saved in this browser at ${savedLabel}.`);
  }

  function handleLoadReport() {
    const savedReport = readSavedReport();

    if (!savedReport) {
      setStatusMessage("No saved report was found in this browser.");
      return;
    }

    setDataset(savedReport.dataset);
    setDashboardVisuals(savedReport.dashboardVisuals);
    setCalculatedMetrics(savedReport.calculatedMetrics ?? createDefaultCalculatedMetrics(savedReport.dataset));
    setMetricDraft(createDefaultMetricDraft(savedReport.dataset));
    setSelectedVisualId(savedReport.selectedVisualId);
    setSelectedField(savedReport.selectedField);
    setReportFilter(savedReport.reportFilter);
    setInsightAnswer(null);
    setPlannerState("local");
    setStatusMessage(`Loaded saved report from ${formatSavedDate(savedReport.savedAt)}.`);
  }

  function updateSelectedVisual(changes: Partial<DashboardVisual>) {
    setDashboardVisuals((currentVisuals) =>
      currentVisuals.map((visual) => (visual.id === selectedVisualId ? { ...visual, ...changes } : visual)),
    );
  }

  function addVisual() {
    const nextVisual: DashboardVisual = {
      id: `visual-${Date.now()}`,
      title: `${firstMeasure || "Value"} by ${firstDimension || "Field"}`,
      kind: "Bar",
      axisField: firstDimension,
      valueField: firstMeasure,
      size: "half",
    };

    setDashboardVisuals((currentVisuals) => [...currentVisuals, nextVisual]);
    setSelectedVisualId(nextVisual.id);
    setStatusMessage("Added a new visual to the dashboard canvas.");
  }

  function applyBriefSuggestion(suggestion: BriefVisualSuggestion) {
    const nextVisual: DashboardVisual = {
      id: `visual-${Date.now()}`,
      title: suggestion.title,
      kind: suggestion.kind,
      axisField: suggestion.axisField,
      valueField: suggestion.valueField,
      size: "half",
    };

    setDashboardVisuals((currentVisuals) => [...currentVisuals, nextVisual]);
    setSelectedVisualId(nextVisual.id);
    setStatusMessage(`Created ${suggestion.title} from the AI brief.`);
  }

  function applyInsightSuggestion(suggestion: InsightVisualSuggestion) {
    const nextVisual: DashboardVisual = {
      id: `visual-${Date.now()}`,
      title: suggestion.title,
      kind: suggestion.kind,
      axisField: suggestion.axisField,
      valueField: suggestion.valueField,
      size: "half",
    };

    setDashboardVisuals((currentVisuals) => [...currentVisuals, nextVisual]);
    setSelectedVisualId(nextVisual.id);
    setStatusMessage(`Created ${suggestion.title} from the answer.`);
  }

  async function handleAskInsightBoard(questionOverride?: string) {
    const question = questionOverride ?? insightQuestion;
    const requestId = askRequestRef.current + 1;
    askRequestRef.current = requestId;
    const context = {
      dataset,
      rows: filteredRows,
      filterLabel: `${filterField} = ${reportFilter.value}`,
      calculatedMetrics,
    };

    setInsightQuestion(question);
    setIsAsking(true);
    setStatusMessage("Planning a grounded analysis...");

    const plannerResponse = await requestRemoteAnalysisPlan(question, dataset, calculatedMetrics);

    if (askRequestRef.current !== requestId) {
      return;
    }

    const validatedPlan = plannerResponse.plan ? validateRemoteAnalysisPlan(plannerResponse.plan, context, calculatedMetrics) : undefined;
    const answer = answerInsightQuestion(question, context, {
      plannedBy: plannerResponse.state,
      planResult: validatedPlan?.status === "planned" ? validatedPlan : undefined,
      plannerMessage: plannerResponse.message,
    });

    setInsightAnswer(answer);
    setPlannerState(validatedPlan?.status === "planned" ? "ai" : plannerResponse.state);
    setStatusMessage(
      answer.status === "answered"
        ? validatedPlan?.status === "planned"
          ? "InsightBoard answered from an AI-generated plan with receipts."
          : "InsightBoard answered from the local analysis engine."
        : "InsightBoard needs a more specific question.",
    );
    setIsAsking(false);
  }

  function duplicateSelectedVisual() {
    if (!selectedVisual) {
      return;
    }

    const duplicate: DashboardVisual = {
      ...selectedVisual,
      id: `visual-${Date.now()}`,
      title: `${selectedVisual.title} copy`,
      size: "half",
    };

    setDashboardVisuals((currentVisuals) => [...currentVisuals, duplicate]);
    setSelectedVisualId(duplicate.id);
    setStatusMessage("Duplicated the selected visual.");
  }

  function removeSelectedVisual() {
    if (dashboardVisuals.length === 1) {
      setStatusMessage("Keep at least one visual on the dashboard.");
      return;
    }

    const selectedIndex = dashboardVisuals.findIndex((visual) => visual.id === selectedVisualId);
    const nextVisuals = dashboardVisuals.filter((visual) => visual.id !== selectedVisualId);
    setDashboardVisuals(nextVisuals);
    setSelectedVisualId(nextVisuals[Math.max(0, selectedIndex - 1)].id);
    setStatusMessage("Removed the selected visual.");
  }

  function handleFieldSelected(fieldName: string) {
    const field = dataset.fields.find((candidate) => candidate.name === fieldName);

    if (!field) {
      return;
    }

    setSelectedField(field.name);

    if (field.role === "Measure") {
      updateSelectedVisual({
        valueField: field.name,
        title: `${field.name} by ${activeAxisField}`,
      });
      setStatusMessage(`${field.name} is now the value field.`);
      return;
    }

    updateSelectedVisual({
      axisField: field.name,
      title: `${activeValueField} by ${field.name}`,
    });
    setStatusMessage(`${field.name} is now the axis field.`);
  }

  function handleMetricSelected(metric: CalculatedMetric) {
    updateSelectedVisual({
      valueField: metric.name,
      title: `${metric.name} by ${activeAxisField}`,
    });
    setSelectedField(metric.name);
    setStatusMessage(`${metric.name} is now the value field.`);
  }

  function addCalculatedMetric() {
    const trimmedName = metricDraft.name.trim();

    if (!trimmedName) {
      setStatusMessage("Name the calculated metric before adding it.");
      return;
    }

    const validation = validateFormula(metricDraft.formula, dataset);

    if (!validation.valid) {
      setStatusMessage(`Formula error: ${validation.reason}`);
      return;
    }

    if (metricDraft.aggregation === "ratioOfTotals" && metricDraft.numeratorField === metricDraft.denominatorField) {
      setStatusMessage("Choose different numerator and denominator fields.");
      return;
    }

    const metric: CalculatedMetric = {
      name: trimmedName,
      formula: metricDraft.formula.trim(),
      aggregation: metricDraft.aggregation,
      numeratorField: metricDraft.aggregation === "ratioOfTotals" ? metricDraft.numeratorField : undefined,
      denominatorField: metricDraft.aggregation === "ratioOfTotals" ? metricDraft.denominatorField : undefined,
      format: metricDraft.format,
    };

    setCalculatedMetrics((currentMetrics) => [
      ...currentMetrics.filter((currentMetric) => currentMetric.name.toLowerCase() !== metric.name.toLowerCase()),
      metric,
    ]);
    setStatusMessage(`Saved calculated metric ${metric.name}.`);
  }

  function removeCalculatedMetric(metricName: string) {
    setCalculatedMetrics((currentMetrics) => currentMetrics.filter((metric) => metric.name !== metricName));
    setDashboardVisuals((currentVisuals) =>
      currentVisuals.map((visual) =>
        visual.valueField === metricName ? { ...visual, valueField: firstMeasure, title: `${firstMeasure} by ${visual.axisField}` } : visual,
      ),
    );
    setStatusMessage(`Removed calculated metric ${metricName}.`);
  }

  function renderChartVisual(visual: DashboardVisual) {
    const visualAxisField = resolveFieldName(dataset, visual.axisField, firstDimension);
    const metric = calculatedMetrics.find((candidate) => candidate.name === visual.valueField);
    const visualValueField = metric?.name ?? resolveFieldName(dataset, visual.valueField, firstMeasure);
    const chartData = metric
      ? aggregateCalculatedMetricRows(filteredRows, visualAxisField, metric, dataset)
      : aggregateRows(filteredRows, visualAxisField, visualValueField);

    if (!visualAxisField || !visualValueField) {
      return <div className="empty-chart">Import a CSV with at least one field to build a chart.</div>;
    }

    if (visual.kind === "Table") {
      return (
        <div className="table-preview" aria-label="Table visual preview">
          <table>
            <thead>
              <tr>
                <th>{visualAxisField}</th>
                <th>{visualValueField}</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((point) => (
                <tr key={point.label}>
                  <td>{point.label}</td>
                  <td>{formatNumber(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return <ReactECharts className="echart" option={getChartOption(visual.kind, chartData, visualAxisField, visualValueField)} />;
  }

  function renderVisualIcon(kind: VisualKind) {
    if (kind === "Bar") {
      return <BarChart3 size={20} aria-hidden="true" />;
    }

    if (kind === "Line") {
      return <LineChart size={20} aria-hidden="true" />;
    }

    if (kind === "Pie") {
      return <PieChart size={20} aria-hidden="true" />;
    }

    return <Table2 size={20} aria-hidden="true" />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar sidebar-left" aria-label="Datasets and fields">
        <div className="brand">
          <LayoutDashboard size={24} aria-hidden="true" />
          <div>
            <h1>InsightBoard</h1>
            <p>Local BI workspace</p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => handleFileSelected(event.target.files)}
        />
        <button
          className="primary-action"
          type="button"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp size={18} aria-hidden="true" />
          {isImporting ? "Importing..." : "Import dataset"}
        </button>

        <section className="panel-section">
          <button
            className="section-heading section-heading-button"
            type="button"
            aria-expanded={fieldsExpanded}
            onClick={() => setFieldsExpanded((current) => !current)}
          >
            <Database size={16} aria-hidden="true" />
            <h2>{dataset.name}</h2>
            <ChevronDown className={fieldsExpanded ? "chevron expanded" : "chevron"} size={16} aria-hidden="true" />
          </button>

          <div className="dataset-summary">
            <span>{dataset.rowCount} rows</span>
            <span>{dataset.fields.length} columns</span>
            <span>{calculatedMetrics.length} metrics</span>
          </div>

          {fieldsExpanded ? (
            <div className="field-list">
              {dataset.fields.map((field) => (
                <button
                  className={selectedField === field.name ? "field-pill selected" : "field-pill"}
                  key={field.name}
                  type="button"
                  onClick={() => handleFieldSelected(field.name)}
                >
                  <span className="field-name">{field.name}</span>
                  <span className={field.role === "Measure" ? "field-role measure" : "field-role"}>
                    {field.type}
                  </span>
                </button>
              ))}
              {calculatedMetrics.map((metric) => (
                <button
                  className={selectedField === metric.name ? "field-pill selected" : "field-pill"}
                  key={metric.name}
                  type="button"
                  onClick={() => handleMetricSelected(metric)}
                >
                  <span className="field-name">{metric.name}</span>
                  <span className="field-role calculated">Calc</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </aside>

      <section className="workspace" aria-label="Dashboard workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Report</p>
            <h2>Executive Sales Overview</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-action" type="button" onClick={addVisual}>
              <Plus size={17} aria-hidden="true" />
              Add visual
            </button>
            <button
              className={filtersOpen ? "icon-button active" : "icon-button"}
              type="button"
              aria-label="Filters"
              aria-pressed={filtersOpen}
              onClick={() => {
                setFiltersOpen((current) => !current);
                setStatusMessage("Filter panel toggled.");
              }}
            >
              <Filter size={18} aria-hidden="true" />
            </button>
            <button className="secondary-action" type="button" onClick={handleSaveReport}>
              <Save size={17} aria-hidden="true" />
              Save report
            </button>
            <button className="icon-button" type="button" aria-label="Load saved report" onClick={handleLoadReport}>
              <FolderOpen size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="status-strip" role="status">
          <span>{statusMessage}</span>
          <strong>
            Selected: {selectedVisual?.title ?? "None"} | Axis: {activeAxisField} | Values: {activeValueField} | Filter: {filterField} = {reportFilter.value}
          </strong>
        </div>

        {filtersOpen ? (
          <section className="filter-panel" aria-label={`${filterField} filters`}>
            <div className="filter-field-list" aria-label="Filter field">
              {dimensionFields.map((field) => (
                <button
                  className={filterField === field.name ? "filter-field active" : "filter-field"}
                  key={field.name}
                  type="button"
                  onClick={() => {
                    setReportFilter({ fieldName: field.name, value: "All" });
                    setStatusMessage(`${field.name} is now the report filter.`);
                  }}
                >
                  {field.name}
                </button>
              ))}
            </div>
            <div className="filter-value-group">
              <span>{filterField} values</span>
              <div className="filter-options">
                {["All", ...filterValues].map((value) => (
                  <button
                    className={reportFilter.value === value ? "filter-chip active" : "filter-chip"}
                    key={value}
                    type="button"
                    onClick={() => {
                      setReportFilter({ fieldName: filterField, value });
                      setStatusMessage(value === "All" ? "Showing all values." : `Filtered ${filterField} to ${value}.`);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <div className="dashboard-grid">
          <article className="ask-card wide" aria-label="Ask InsightBoard">
            <div className="ask-header">
              <div>
                <p className="eyebrow">Ask InsightBoard</p>
                <h3>AI analyst planner</h3>
                <p>Ask for totals, averages, counts, calculated metrics, rankings, comparisons, or trends. Plans are validated against the dataset before any answer is calculated.</p>
              </div>
              <div className={`planner-badge ${plannerState}`}>
                <Sparkles size={15} aria-hidden="true" />
                <span>{getPlannerLabel(plannerState)}</span>
              </div>
            </div>

            <form
              className="ask-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleAskInsightBoard();
              }}
            >
              <input
                aria-label="Ask a data question"
                value={insightQuestion}
                disabled={isAsking}
                onChange={(event) => setInsightQuestion(event.target.value)}
              />
              <button className="primary-action" type="submit" disabled={isAsking}>
                <Send size={16} aria-hidden="true" />
                {isAsking ? "Planning..." : "Ask"}
              </button>
            </form>

            <div className="starter-question-row" aria-label="Starter questions">
              {starterQuestions.map((question) => (
                <button
                  className="starter-question"
                  key={question}
                  type="button"
                  disabled={isAsking}
                  onClick={() => handleAskInsightBoard(question)}
                >
                  {question}
                </button>
              ))}
            </div>

            {insightAnswer ? (
              <div className={insightAnswer.status === "answered" ? "answer-panel" : "answer-panel unsupported"}>
                <div className="answer-main">
                  <strong>{insightAnswer.status === "answered" ? "Answer" : "Needs clarification"}</strong>
                  <p>{insightAnswer.answer}</p>
                  {insightAnswer.visualSuggestion ? (
                    <button
                      className="secondary-action compact"
                      type="button"
                      onClick={() => applyInsightSuggestion(insightAnswer.visualSuggestion as InsightVisualSuggestion)}
                    >
                      <Plus size={15} aria-hidden="true" />
                      Add chart
                    </button>
                  ) : null}
                </div>

                <div className="answer-evidence-grid">
                  <section>
                    <h4>Receipts</h4>
                    <ul>
                      {insightAnswer.receipts.map((receipt) => (
                        <li key={receipt}>{receipt}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h4>Caveats</h4>
                    <ul>
                      {insightAnswer.caveats.map((caveat) => (
                        <li key={caveat}>{caveat}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            ) : null}
          </article>

          <article className="ai-brief-card wide" aria-label="AI dataset brief">
            <div className="ai-brief-header">
              <div>
                <p className="eyebrow">AI Brief</p>
                <h3>{aiBrief.headline}</h3>
                <p>{aiBrief.summary}</p>
              </div>
              <Sparkles size={22} aria-hidden="true" />
            </div>

            <div className="ai-brief-grid">
              <section className="ai-brief-section">
                <div className="ai-brief-section-title">
                  <Sigma size={15} aria-hidden="true" />
                  <h4>Metrics</h4>
                </div>
                <ul>
                  {aiBrief.recommendedMetrics.map((metric) => (
                    <li key={metric}>{metric}</li>
                  ))}
                </ul>
              </section>

              <section className="ai-brief-section">
                <div className="ai-brief-section-title">
                  <Lightbulb size={15} aria-hidden="true" />
                  <h4>Questions</h4>
                </div>
                <ul>
                  {aiBrief.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </section>

              <section className="ai-brief-section">
                <div className="ai-brief-section-title">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <h4>Data Checks</h4>
                </div>
                <ul>
                  {aiBrief.qualityWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            </div>

            {aiBrief.suggestedVisuals.length > 0 ? (
              <div className="ai-suggestion-row" aria-label="AI visual suggestions">
                {aiBrief.suggestedVisuals.map((suggestion) => (
                  <button
                    className="ai-suggestion"
                    key={`${suggestion.title}-${suggestion.kind}`}
                    type="button"
                    onClick={() => applyBriefSuggestion(suggestion)}
                  >
                    <span>{suggestion.kind}</span>
                    <strong>{suggestion.title}</strong>
                    <small>{suggestion.reason}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </article>

          <article className="metric-card">
            <span>{numericFields[0] ? `Total ${primaryMetric}` : "Rows"}</span>
            <strong>{primaryMetricValue}</strong>
            <small>{reportFilter.value === "All" ? "All values" : `${filterField}: ${reportFilter.value}`}</small>
          </article>
          <article className="metric-card">
            <span>{numericFields[1] ? `Total ${secondaryMetric}` : "Columns"}</span>
            <strong>{secondaryMetricValue}</strong>
            <small>{dataset.name}</small>
          </article>
          {dashboardVisuals.map((visual) => {
            const visualAxisField = resolveFieldName(dataset, visual.axisField, firstDimension);
            const visualMetric = calculatedMetrics.find((metric) => metric.name === visual.valueField);
            const visualValueField = visualMetric?.name ?? resolveFieldName(dataset, visual.valueField, firstMeasure);

            return (
              <article
                className={selectedVisualId === visual.id ? `visual-card ${visual.size} selected` : `visual-card ${visual.size}`}
                key={visual.id}
                onClick={() => setSelectedVisualId(visual.id)}
              >
                <div className="visual-header">
                  <div>
                    <h3>{visual.title}</h3>
                    <p>{getVisualSubtitle(visualValueField, visualAxisField, calculatedMetrics)}</p>
                  </div>
                  {renderVisualIcon(visual.kind)}
                </div>
                {renderChartVisual(visual)}
              </article>
            );
          })}
          <article className="visual-card">
            <div className="visual-header">
              <div>
                <h3>Data Preview</h3>
                <p>First rows from the active dataset</p>
              </div>
              <Table2 size={20} aria-hidden="true" />
            </div>
            <table>
              <thead>
                <tr>
                  {dataset.fields.map((field) => (
                    <th key={field.name}>{field.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasRows ? (
                  previewRows.map((row, rowIndex) => (
                    <tr key={`${dataset.name}-${rowIndex}`}>
                      {dataset.fields.map((field) => (
                        <td key={`${field.name}-${rowIndex}`}>{row[field.name]}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={dataset.fields.length || 1}>No rows found in this dataset.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </article>
        </div>
      </section>

      <aside className="sidebar sidebar-right" aria-label="Visual configuration">
        <section className="panel-section">
          <div className="section-heading">
            <Settings2 size={16} aria-hidden="true" />
            <h2>Visual</h2>
          </div>

          <div className="visual-picker">
            {visuals.map((visual) => {
              const Icon = visual.icon;
              return (
                <button
                  className={activeVisualKind === visual.label ? "visual-option active" : "visual-option"}
                  key={visual.label}
                  type="button"
                  title={`${visual.label} visual`}
                  aria-pressed={activeVisualKind === visual.label}
                  onClick={() => {
                    updateSelectedVisual({ kind: visual.label as VisualKind });
                    setStatusMessage(`${visual.label} visual selected.`);
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{visual.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading">
            <Sigma size={16} aria-hidden="true" />
            <h2>Field Wells</h2>
          </div>

          <div className="drop-zone">
            <span>Axis</span>
            <strong>{activeAxisField}</strong>
            <small>Select a dimension field</small>
          </div>
          <div className="drop-zone">
            <span>Values</span>
            <strong>{activeValueField}</strong>
            <small>Select a measure or calculated metric</small>
          </div>
          <div className="drop-zone empty">
            <span>Filters</span>
            <strong>{filterField}</strong>
            <small>{reportFilter.value === "All" ? "All values" : reportFilter.value}</small>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading">
            <Sigma size={16} aria-hidden="true" />
            <h2>Metric Library</h2>
          </div>

          <div className="metric-builder">
            <label>
              <span>Name</span>
              <input
                value={metricDraft.name}
                onChange={(event) => setMetricDraft((currentDraft) => ({ ...currentDraft, name: event.target.value }))}
              />
            </label>
            <label>
              <span>Formula</span>
              <input
                value={metricDraft.formula}
                onChange={(event) => setMetricDraft((currentDraft) => ({ ...currentDraft, formula: event.target.value }))}
              />
            </label>
            <label>
              <span>Aggregation</span>
              <select
                value={metricDraft.aggregation}
                onChange={(event) =>
                  setMetricDraft((currentDraft) => ({
                    ...currentDraft,
                    aggregation: event.target.value as CalculatedMetric["aggregation"],
                  }))
                }
              >
                <option value="average">Average formula result</option>
                <option value="ratioOfTotals">Ratio of totals</option>
              </select>
            </label>
            <label>
              <span>Ratio numerator</span>
              <select
                disabled={metricDraft.aggregation !== "ratioOfTotals"}
                value={metricDraft.numeratorField}
                onChange={(event) => setMetricDraft((currentDraft) => ({ ...currentDraft, numeratorField: event.target.value }))}
              >
                {numericFields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Ratio denominator</span>
              <select
                disabled={metricDraft.aggregation !== "ratioOfTotals"}
                value={metricDraft.denominatorField}
                onChange={(event) => setMetricDraft((currentDraft) => ({ ...currentDraft, denominatorField: event.target.value }))}
              >
                {numericFields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Format</span>
              <select
                value={metricDraft.format}
                onChange={(event) =>
                  setMetricDraft((currentDraft) => ({ ...currentDraft, format: event.target.value as CalculatedMetric["format"] }))
                }
              >
                <option value="percent">Percent</option>
                <option value="number">Number</option>
              </select>
            </label>
            <button className="secondary-action compact" type="button" onClick={addCalculatedMetric}>
              <Plus size={15} aria-hidden="true" />
              Save metric
            </button>
          </div>

          <div className="metric-library-list">
            {calculatedMetrics.map((metric) => (
              <div className="metric-library-item" key={metric.name}>
                <button type="button" onClick={() => handleMetricSelected(metric)}>
                  <strong>{metric.name}</strong>
                  <span>{metric.formula}</span>
                </button>
                <button className="icon-button danger" type="button" aria-label={`Remove ${metric.name}`} onClick={() => removeCalculatedMetric(metric.name)}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading">
            <LayoutDashboard size={16} aria-hidden="true" />
            <h2>Canvas</h2>
          </div>

          <div className="visual-actions">
            <button className="secondary-action compact" type="button" onClick={() => updateSelectedVisual({ size: selectedVisual?.size === "wide" ? "half" : "wide" })}>
              {selectedVisual?.size === "wide" ? "Half width" : "Full width"}
            </button>
            <button className="icon-button" type="button" aria-label="Duplicate visual" onClick={duplicateSelectedVisual}>
              <Copy size={17} aria-hidden="true" />
            </button>
            <button className="icon-button danger" type="button" aria-label="Remove visual" onClick={removeSelectedVisual}>
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        </section>
      </aside>
    </main>
  );
}

function resolveFieldName(dataset: Dataset, fieldName: string | undefined, fallback: string) {
  return dataset.fields.some((field) => field.name === fieldName) ? fieldName ?? fallback : fallback;
}

function getFilterValues(rows: Record<string, string>[], fieldName: string) {
  return Array.from(new Set(rows.map((row) => row[fieldName]).filter(Boolean))).slice(0, 8);
}

function applyReportFilter(rows: Record<string, string>[], fieldName: string, value: FilterValue) {
  if (value === "All") {
    return rows;
  }

  return rows.filter((row) => row[fieldName] === value);
}

async function requestRemoteAnalysisPlan(
  question: string,
  dataset: Dataset,
  calculatedMetrics: CalculatedMetric[],
): Promise<{ state: PlannerState; message: string; plan?: unknown }> {
  try {
    const response = await fetch("/api/insight-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        fields: dataset.fields.map((field) => ({
          name: field.name,
          type: field.type,
          role: field.role,
          values: field.role === "Dimension" ? getFieldValues(dataset.rows, field.name, 30) : undefined,
        })),
        calculatedMetrics,
      }),
    });

    if (!response.ok) {
      return {
        state: "error",
        message: "AI planner endpoint was unavailable; local planner used.",
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;

    if (payload.status === "planned") {
      return {
        state: "ai",
        message: "AI planner selected the analysis shape.",
        plan: payload,
      };
    }

    if (payload.status === "unconfigured") {
      return {
        state: "unconfigured",
        message: typeof payload.reason === "string" ? payload.reason : "OPENAI_API_KEY is not configured; local planner used.",
      };
    }

    return {
      state: "error",
      message: typeof payload.reason === "string" ? payload.reason : "AI planner could not return a usable plan; local planner used.",
    };
  } catch {
    return {
      state: "error",
      message: "AI planner request failed; local planner used.",
    };
  }
}

function getPlannerLabel(state: PlannerState) {
  if (state === "ai") {
    return "AI plan";
  }

  if (state === "unconfigured") {
    return "No API key";
  }

  if (state === "error") {
    return "Fallback";
  }

  return "Local plan";
}

function getFieldValues(rows: Record<string, string>[], fieldName: string, limit: number) {
  return Array.from(new Set(rows.map((row) => row[fieldName]).filter(Boolean))).slice(0, limit);
}

function createDefaultCalculatedMetrics(dataset: Dataset): CalculatedMetric[] {
  const profitField = dataset.fields.find((field) => field.role === "Measure" && field.name.toLowerCase().includes("profit"));
  const salesField = dataset.fields.find((field) => field.role === "Measure" && field.name.toLowerCase().includes("sales"));

  if (!profitField || !salesField || profitField.name === salesField.name) {
    return [];
  }

  return [
    {
      name: "Profit Margin",
      formula: `[${profitField.name}] / [${salesField.name}] * 100`,
      aggregation: "ratioOfTotals",
      numeratorField: profitField.name,
      denominatorField: salesField.name,
      format: "percent",
    },
  ];
}

function createDefaultMetricDraft(dataset: Dataset) {
  const numericFields = dataset.fields.filter((field) => field.role === "Measure");
  const defaultMetric = createDefaultCalculatedMetrics(dataset)[0];

  return {
    name: defaultMetric?.name ?? "New Metric",
    formula: defaultMetric?.formula ?? `[${numericFields[0]?.name ?? ""}]`,
    aggregation: defaultMetric?.aggregation ?? ("average" as CalculatedMetric["aggregation"]),
    numeratorField: defaultMetric?.numeratorField ?? numericFields[0]?.name ?? "",
    denominatorField: defaultMetric?.denominatorField ?? numericFields[1]?.name ?? numericFields[0]?.name ?? "",
    format: defaultMetric?.format ?? ("percent" as CalculatedMetric["format"]),
  };
}

function getVisualSubtitle(valueField: string, axisField: string, calculatedMetrics: CalculatedMetric[]) {
  const metric = calculatedMetrics.find((candidate) => candidate.name === valueField);

  if (metric) {
    return `${metric.name} grouped by ${axisField}`;
  }

  return `Summed ${valueField} grouped by ${axisField}`;
}

function readSavedReport(): SavedReport | null {
  const savedValue = localStorage.getItem(savedReportKey);

  if (!savedValue) {
    return null;
  }

  try {
    return JSON.parse(savedValue) as SavedReport;
  } catch {
    return null;
  }
}

function formatSavedDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(value);
}

function getChartOption(
  visual: Exclude<VisualKind, "Table">,
  chartData: { label: string; value: number }[],
  axisField: string,
  valueField: string,
) {
  const textColor = "#17202a";
  const mutedColor = "#687482";
  const chartColor = "#195f6f";

  if (visual === "Pie") {
    return {
      color: ["#195f6f", "#3c88a3", "#8fbf9f", "#d8a657", "#7a678f", "#d96f5d"],
      tooltip: {
        trigger: "item",
        valueFormatter: (value: number) => formatNumber(value),
      },
      series: [
        {
          name: valueField,
          type: "pie",
          radius: ["42%", "72%"],
          center: ["50%", "52%"],
          data: chartData.map((point) => ({ name: point.label, value: point.value })),
          label: {
            color: textColor,
            formatter: "{b}",
          },
        },
      ],
    };
  }

  return {
    color: [chartColor],
    grid: {
      left: 54,
      right: 24,
      top: 32,
      bottom: 58,
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: number) => formatNumber(value),
    },
    xAxis: {
      type: "category",
      name: axisField,
      nameLocation: "middle",
      nameGap: 42,
      axisLabel: {
        color: mutedColor,
        interval: 0,
        rotate: chartData.length > 5 ? 28 : 0,
      },
      axisLine: {
        lineStyle: {
          color: "#d9dee5",
        },
      },
      data: chartData.map((point) => point.label),
    },
    yAxis: {
      type: "value",
      name: valueField,
      axisLabel: {
        color: mutedColor,
        formatter: (value: number) => formatNumber(value),
      },
      splitLine: {
        lineStyle: {
          color: "#e7ecf2",
        },
      },
    },
    series: [
      {
        name: valueField,
        type: visual === "Line" ? "line" : "bar",
        smooth: visual === "Line",
        symbolSize: 8,
        barMaxWidth: 48,
        data: chartData.map((point) => point.value),
      },
    ],
  };
}
