// Harvested from Publicato-personal server/utils/ai-json.ts and server/utils/jsonrepair.ts.

const SINGLE_QUOTED_STRING = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
const UNQUOTED_KEY = /([,{]\s*)([A-Za-z0-9_]+)(\s*):/g;

/**
 * Lightweight JSON repair for common issues in AI output:
 * single-quoted strings, unquoted keys and trailing garbage.
 */
export function jsonrepair(input: string): string {
  let repaired = input;

  repaired = repaired.replace(SINGLE_QUOTED_STRING, (_match, value: string) => {
    const normalizedValue = value.replace(/"/g, '\\"');
    return `"${normalizedValue}"`;
  });

  repaired = repaired.replace(
    UNQUOTED_KEY,
    (_match, start: string, key: string, end: string) => `${start}"${key}"${end}:`,
  );

  const lastClosing = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
  if (lastClosing !== -1 && lastClosing < repaired.length - 1) {
    repaired = repaired.slice(0, lastClosing + 1);
  }

  return repaired;
}

function extractJsonCandidate(responseText: string): string {
  const cleaned = responseText.replace(/```json\s*|```/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  let jsonCandidate = '';
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    jsonCandidate = cleaned.slice(firstBracket, lastBracket + 1);
  }

  return jsonCandidate.trim();
}

function normalizeJson(jsonCandidate: string): string {
  let normalized = jsonCandidate
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');

  normalized = removeJsonComments(normalized);
  normalized = collapseDuplicateCommas(normalized);
  normalized = removeTrailingCommas(normalized);

  return normalized.trim();
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

function collapseDuplicateCommas(input: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i] ?? '';

    if (inString) {
      result += char;
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      i += 1;
      continue;
    }

    if (char === ',') {
      result += char;
      i += 1;

      let whitespace = '';
      while (i < input.length && isWhitespace(input[i])) {
        whitespace += input[i];
        i += 1;
      }

      let hadDuplicate = false;
      while (i < input.length && input[i] === ',') {
        hadDuplicate = true;
        i += 1;

        while (i < input.length && isWhitespace(input[i])) {
          whitespace += input[i];
          i += 1;
        }
      }

      result += hadDuplicate ? whitespace.replace(/[\t\v\f \r]/g, '') : whitespace;
      continue;
    }

    result += char;
    i += 1;
  }

  return result;
}

function removeJsonComments(input: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '';
    const next = input[i + 1];

    if (inString) {
      result += char;
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') {
        i += 1;
      }
      result += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) {
        i += 1;
      }
      i += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function removeTrailingCommas(input: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '';

    if (inString) {
      result += char;
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === ',') {
      let j = i + 1;
      while (j < input.length && isWhitespace(input[j])) {
        j += 1;
      }

      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        result += input.slice(i + 1, j);
        i = j - 1;
        continue;
      }
    }

    result += char;
  }

  return result;
}

export function parseAiJsonResponse(responseText: string): unknown {
  const jsonCandidate = extractJsonCandidate(responseText);

  if (!jsonCandidate) {
    throw new Error('AI response did not contain a JSON payload');
  }

  const normalized = normalizeJson(jsonCandidate);

  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return JSON.parse(jsonrepair(normalized));
    } catch (repairError) {
      const reason = repairError instanceof Error ? repairError.message : 'Unknown error';
      throw new Error(`AI response JSON could not be repaired: ${reason}`, { cause: repairError });
    }
  }
}
