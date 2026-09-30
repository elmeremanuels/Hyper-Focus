import { describe, expect, it } from 'vitest';
import { jsonrepair, parseAiJsonResponse } from '../src/ai/json.js';

describe('parseAiJsonResponse', () => {
  it('parses JSON inside a code fence with surrounding text', () => {
    expect(parseAiJsonResponse('Hier:\n```json\n{"a": 1}\n```\nKlaar.')).toEqual({ a: 1 });
  });

  it('removes comments, duplicate and trailing commas', () => {
    const input = '{"a": 1,, // note\n "b": [1, 2,],}';
    expect(parseAiJsonResponse(input)).toEqual({ a: 1, b: [1, 2] });
  });

  it('normalizes smart quotes', () => {
    expect(parseAiJsonResponse('{“title”: “hoi”}')).toEqual({ title: 'hoi' });
  });

  it('repairs single quotes and unquoted keys', () => {
    expect(parseAiJsonResponse("{title: 'offerte'}")).toEqual({ title: 'offerte' });
  });

  it('throws when there is no JSON', () => {
    expect(() => parseAiJsonResponse('geen json hier')).toThrow(/did not contain/);
  });
});

describe('jsonrepair', () => {
  it('drops trailing garbage', () => {
    expect(jsonrepair('{"a":1} extra')).toBe('{"a":1}');
  });
});
