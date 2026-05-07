import { describe, it, expect } from "vitest";
import { tryRepairTruncatedJson } from "./json-repair";

describe("tryRepairTruncatedJson", () => {
  it("returnerer null for tom input", () => {
    expect(tryRepairTruncatedJson("")).toBe(null);
  });

  it("lar gyldig JSON være urørt (parses likt)", () => {
    const valid = '{"questions": ["a", "b"], "actions": []}';
    const repaired = tryRepairTruncatedJson(valid);
    expect(repaired).not.toBe(null);
    expect(JSON.parse(repaired!)).toEqual({ questions: ["a", "b"], actions: [] });
  });

  it("reparerer JSON som er kuttet midt i streng", () => {
    const truncated = '{"actions": [{"id": "a-1", "text": "Skri';
    const repaired = tryRepairTruncatedJson(truncated);
    expect(repaired).not.toBe(null);
    expect(() => JSON.parse(repaired!)).not.toThrow();
    const parsed = JSON.parse(repaired!);
    expect(parsed.actions).toBeDefined();
  });

  it("reparerer manglende lukke-bracket", () => {
    const truncated = '{"actions": [{"id": "a-1", "text": "Test"}, {"id": "a-2", "text": "X"}';
    const repaired = tryRepairTruncatedJson(truncated);
    expect(repaired).not.toBe(null);
    const parsed = JSON.parse(repaired!);
    expect(parsed.actions).toHaveLength(2);
  });

  it("strippet markdown code fence", () => {
    const wrapped = '```json\n{"a": 1}\n```';
    const repaired = tryRepairTruncatedJson(wrapped);
    expect(repaired).not.toBe(null);
    expect(JSON.parse(repaired!)).toEqual({ a: 1 });
  });

  it("fjerner hengende komma før lukking", () => {
    const truncated = '{"questions": ["a", "b",';
    const repaired = tryRepairTruncatedJson(truncated);
    expect(repaired).not.toBe(null);
    expect(() => JSON.parse(repaired!)).not.toThrow();
  });
});
