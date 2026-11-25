import Papa from "papaparse";

export type FieldType = "Text" | "Number" | "Date" | "Boolean";
export type FieldRole = "Dimension" | "Measure";

export type DatasetField = {
  name: string;
  type: FieldType;
  role: FieldRole;
};

export type Dataset = {
  name: string;
  fields: DatasetField[];
  rows: Record<string, string>[];
  rowCount: number;
};

type ParsedCsvRow = Record<string, string | number | boolean | null | undefined>;

export function parseCsvFile(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        if (result.errors.length > 0) {
          reject(new Error(result.errors[0].message));
          return;
        }

        const rows = normalizeRows(result.data);
        const fields = inferFields(rows);

        if (fields.length === 0) {
          reject(new Error("No columns were found in this CSV."));
          return;
        }

        resolve({
          name: file.name,
          fields,
          rows,
          rowCount: rows.length,
        });
      },
      error: (error) => reject(error),
    });
  });
}
export function inferFields(rows: Record<string, string>[]): DatasetField[] {
  const fieldNames = Object.keys(rows[0] ?? {});

  return fieldNames.map((name) => {
    const values = rows
      .map((row) => row[name])
      .filter((value) => value.trim().length > 0)
      .slice(0, 50);
    const type = inferFieldType(values);

    return {
      name,
      type,
      role: type === "Number" ? "Measure" : "Dimension",
    };
  });
}

function normalizeRows(rows: ParsedCsvRow[]): Record<string, string>[] {
  return rows.map((row) => {
    const normalizedRow: Record<string, string> = {};

    for (const [key, value] of Object.entries(row)) {
      const columnName = key.trim();

      if (!columnName) {
        continue;
      }

      normalizedRow[columnName] = value == null ? "" : String(value).trim();
    }

    return normalizedRow;
  });
}

function inferFieldType(values: string[]): FieldType {
  if (values.length === 0) {
    return "Text";
  }

  if (values.every(isBooleanLike)) {
    return "Boolean";
  }

  if (values.every(isNumberLike)) {
    return "Number";
  }

  if (values.every(isDateLike)) {
    return "Date";
  }

  return "Text";
}

function isBooleanLike(value: string) {
  return ["true", "false", "yes", "no"].includes(value.toLowerCase());
}

function isNumberLike(value: string) {
  const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "");
  return normalized.trim() !== "" && Number.isFinite(Number(normalized));
}

function isDateLike(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Number.isNaN(Number(value));
}
