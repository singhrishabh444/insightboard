import type { Dataset } from "./dataImport";

export type FormulaValidation =
  | { valid: true; fields: string[] }
  | { valid: false; reason: string };

type FormulaToken =
  | { type: "number"; value: number }
  | { type: "field"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" };

export function validateFormula(formula: string, dataset: Dataset): FormulaValidation {
  const tokenResult = tokenizeFormula(formula, dataset);

  if (!tokenResult.valid) {
    return tokenResult;
  }

  const rpnResult = toReversePolishNotation(tokenResult.tokens);

  if (!rpnResult.valid) {
    return rpnResult;
  }

  const fields = Array.from(
    new Set(tokenResult.tokens.filter((token): token is { type: "field"; value: string } => token.type === "field").map((token) => token.value)),
  );

  if (fields.length === 0) {
    return { valid: false, reason: "Formula must reference at least one numeric field using brackets, such as [Sales]." };
  }

  return { valid: true, fields };
}

export function evaluateFormulaForRow(formula: string, dataset: Dataset, row: Record<string, string>) {
  const tokenResult = tokenizeFormula(formula, dataset);

  if (!tokenResult.valid) {
    return null;
  }

  const rpnResult = toReversePolishNotation(tokenResult.tokens);

  if (!rpnResult.valid) {
    return null;
  }

  const stack: number[] = [];

  for (const token of rpnResult.tokens) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    if (token.type === "field") {
      const value = parseNumericCell(row[token.value]);

      if (value == null) {
        return null;
      }

      stack.push(value);
      continue;
    }

    if (token.type === "operator") {
      const right = stack.pop();
      const left = stack.pop();

      if (left == null || right == null) {
        return null;
      }

      if (token.value === "+") {
        stack.push(left + right);
      } else if (token.value === "-") {
        stack.push(left - right);
      } else if (token.value === "*") {
        stack.push(left * right);
      } else {
        stack.push(right === 0 ? 0 : left / right);
      }
    }
  }

  const result = stack[0];
  return stack.length === 1 && Number.isFinite(result) ? result : null;
}

export function getFormulaFields(formula: string, dataset: Dataset) {
  const validation = validateFormula(formula, dataset);
  return validation.valid ? validation.fields : [];
}

function tokenizeFormula(formula: string, dataset: Dataset): { valid: true; tokens: FormulaToken[] } | { valid: false; reason: string } {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "[") {
      const endIndex = formula.indexOf("]", index + 1);

      if (endIndex === -1) {
        return { valid: false, reason: "Field references must close with ]." };
      }

      const fieldName = formula.slice(index + 1, endIndex).trim();
      const field = dataset.fields.find((candidate) => candidate.name === fieldName);

      if (!field) {
        return { valid: false, reason: `${fieldName} is not a field in the dataset.` };
      }

      if (field.role !== "Measure") {
        return { valid: false, reason: `${fieldName} is not a numeric measure.` };
      }

      tokens.push({ type: "field", value: field.name });
      index = endIndex + 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = formula.slice(index).match(/^\d*\.?\d+/);

      if (!match) {
        return { valid: false, reason: "Invalid number in formula." };
      }

      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (isOperator(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    return { valid: false, reason: `Unsupported formula character: ${char}` };
  }

  return tokens.length > 0 ? { valid: true, tokens } : { valid: false, reason: "Enter a formula before saving the metric." };
}

function toReversePolishNotation(tokens: FormulaToken[]): { valid: true; tokens: FormulaToken[] } | { valid: false; reason: string } {
  const output: FormulaToken[] = [];
  const operators: FormulaToken[] = [];
  let previousToken: FormulaToken | undefined;

  for (const token of tokens) {
    if ((token.type === "number" || token.type === "field") && (previousToken?.type === "number" || previousToken?.type === "field")) {
      return { valid: false, reason: "Formula is missing an operator." };
    }

    if (token.type === "number" || token.type === "field") {
      output.push(token);
    } else if (token.type === "operator") {
      if (!previousToken || previousToken.type === "operator" || (previousToken.type === "paren" && previousToken.value === "(")) {
        return { valid: false, reason: "Formula has an operator in an invalid position." };
      }

      while (operators.length > 0) {
        const top = operators[operators.length - 1];

        if (top.type !== "operator" || precedence(top.value) < precedence(token.value)) {
          break;
        }

        output.push(operators.pop() as FormulaToken);
      }

      operators.push(token);
    } else if (token.value === "(") {
      operators.push(token);
    } else {
      while (operators.length > 0 && operators[operators.length - 1].type !== "paren") {
        output.push(operators.pop() as FormulaToken);
      }

      if (operators.length === 0) {
        return { valid: false, reason: "Formula has mismatched parentheses." };
      }

      operators.pop();
    }

    previousToken = token;
  }

  if (previousToken?.type === "operator") {
    return { valid: false, reason: "Formula cannot end with an operator." };
  }

  while (operators.length > 0) {
    const token = operators.pop() as FormulaToken;

    if (token.type === "paren") {
      return { valid: false, reason: "Formula has mismatched parentheses." };
    }

    output.push(token);
  }

  return { valid: true, tokens: output };
}

function precedence(operator: "+" | "-" | "*" | "/") {
  return operator === "*" || operator === "/" ? 2 : 1;
}

function isOperator(value: string): value is "+" | "-" | "*" | "/" {
  return value === "+" || value === "-" || value === "*" || value === "/";
}

function parseNumericCell(value: string | undefined): number | null {
  const normalized = (value ?? "").replace(/[$,%]/g, "").replace(/,/g, "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
