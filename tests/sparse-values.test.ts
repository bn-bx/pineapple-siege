import { expect, it } from "vitest";
import { SparseValues } from "../src/sim/sparse-values";

it("retains exact journal values, zeroes and overwritten samples across page boundaries", () => {
  const entries = [
    [0, 0],
    [31, -0],
    [32, -3.25],
    [255, 1 / 3],
    [256, -100],
    [3073 * 3073 - 1, -104],
  ] as const;
  const values = new SparseValues(entries),
    expected = new Map<number, number>(entries);
  values.set(255, -11.123456789);
  expected.set(255, -11.123456789);
  expect(values.size).toBe(expected.size);
  for (const [index, value] of expected) {
    expect(values.has(index)).toBe(true);
    expect(values.get(index)).toBe(value);
  }
  expect(values.has(33)).toBe(false);
  expect(values.get(33)).toBeUndefined();
  expect(new Map(values)).toEqual(expected);
  const visited = new Map<number, number>();
  values.forEach((value, index) => visited.set(index, value));
  expect(visited).toEqual(expected);
  expect(new Set(values.keys())).toEqual(new Set(expected.keys()));
  expect([...values.values()]).toHaveLength(expected.size);
  const copy = new SparseValues(values);
  values.clear();
  expect(values.size).toBe(0);
  expect(values.byteLength).toBe(0);
  expect([...values]).toEqual([]);
  expect(copy.get(255)).toBe(-11.123456789);
});

it("bounds dense journal storage by pages rather than the number of writes", () => {
  const values = new SparseValues();
  for (let index = 0; index < 65536; index++) values.set(index, -index);
  expect(values.size).toBe(65536);
  expect(values.byteLength).toBe(256 * (256 * 8 + 8 * 4));
  const bytes = values.byteLength;
  for (let index = 0; index < 65536; index++) values.set(index, -index - 0.5);
  expect(values.size).toBe(65536);
  expect(values.byteLength).toBe(bytes);
  expect(values.get(65535)).toBe(-65535.5);
});
