// A small stand-in for the parts of Vitest this project's tests use, so tests
// can run with plain Node when Vitest (and its native bundler) can't install.
// Unsupported features throw ShimUnsupported; the runner reports those as SKIP,
// never as PASS.
import { isDeepStrictEqual, inspect } from "node:util";

export class ShimUnsupported extends Error {}
const unsupported = (what) => () => {
  throw new ShimUnsupported(`offline runner does not support ${what}`);
};

const tests = [];
const prefix = [];
const befores = [],
  afters = [];
export function it(name, fn, timeout) {
  tests.push({ name: [...prefix, name].join(" › "), fn, timeout });
}
it.each = (rows) => (name, fn) =>
  rows.forEach((row, i) =>
    it(`${name.replace("%s", String(Array.isArray(row) ? row[0] : row))} [${i}]`, () =>
      Array.isArray(row) ? fn(...row) : fn(row),
    ),
  );
it.skip = (name) => tests.push({ name: [...prefix, name].join(" › "), skip: "it.skip" });
it.only = it;
it.todo = () => {};
it.concurrent = it;
export const test = it;
export function describe(name, fn) {
  prefix.push(name);
  try {
    fn();
  } finally {
    prefix.pop();
  }
}
describe.skip = () => {};
describe.each = (rows) => (name, fn) =>
  rows.forEach((row, i) =>
    describe(`${name} [${i}]`, () => (Array.isArray(row) ? fn(...row) : fn(row))),
  );
export const beforeEach = (f) => befores.push(f);
export const afterEach = (f) => afters.push(f);
export const beforeAll = (f) => befores.push(onceFn(f));
export const afterAll = () => {};
function onceFn(f) {
  let done = false;
  return async () => {
    if (!done) {
      done = true;
      await f();
    }
  };
}

const mocks = new Set();
function mockFn(impl) {
  const f = function (...args) {
    f.mock.calls.push(args);
    f.mock.lastCall = args;
    const once = f._once.shift();
    const run = once ?? f._impl;
    const value = run ? run.apply(this, args) : undefined;
    f.mock.results.push({ type: "return", value });
    return value;
  };
  f.mock = { calls: [], results: [], lastCall: undefined };
  f._impl = impl;
  f._once = [];
  f._isMockFunction = true;
  f.mockImplementation = (i) => ((f._impl = i), f);
  f.mockImplementationOnce = (i) => (f._once.push(i), f);
  f.mockReturnValue = (v) => ((f._impl = () => v), f);
  f.mockReturnValueOnce = (v) => (f._once.push(() => v), f);
  f.mockResolvedValue = (v) => ((f._impl = () => Promise.resolve(v)), f);
  f.mockRejectedValue = (v) => ((f._impl = () => Promise.reject(v)), f);
  f.mockResolvedValueOnce = (v) => (f._once.push(() => Promise.resolve(v)), f);
  f.mockRejectedValueOnce = (v) => (f._once.push(() => Promise.reject(v)), f);
  f.mockClear = () => ((f.mock.calls = []), (f.mock.results = []), f);
  f.mockReset = () => (f.mockClear(), (f._impl = undefined), f);
  f.mockRestore = () => {};
  f.getMockName = () => "vi.fn()";
  mocks.add(f);
  return f;
}
const globalsStubbed = new Map();
export const vi = {
  fn: mockFn,
  spyOn(object, key) {
    const original = object[key];
    const m = mockFn(function (...a) {
      return original.apply(this, a);
    });
    m.mockRestore = () => {
      object[key] = original;
    };
    object[key] = m;
    return m;
  },
  async waitFor(fn, options = {}) {
    const timeout = typeof options === "number" ? options : (options.timeout ?? 1000);
    const interval = options.interval ?? 20;
    const end = Date.now() + timeout;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (Date.now() > end) throw e;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  },
  stubGlobal(key, value) {
    if (!globalsStubbed.has(key)) globalsStubbed.set(key, globalThis[key]);
    globalThis[key] = value;
  },
  unstubAllGlobals() {
    for (const [k, v] of globalsStubbed) globalThis[k] = v;
    globalsStubbed.clear();
  },
  restoreAllMocks() {
    for (const m of mocks) m.mockRestore();
  },
  clearAllMocks() {
    for (const m of mocks) m.mockClear();
  },
  resetAllMocks() {
    for (const m of mocks) m.mockReset();
  },
  useFakeTimers: unsupported("vi.useFakeTimers"),
  useRealTimers() {},
  advanceTimersByTime: unsupported("fake timers"),
  runAllTimers: unsupported("fake timers"),
  setSystemTime: unsupported("vi.setSystemTime"),
  mock: unsupported("vi.mock"),
  doMock: unsupported("vi.doMock"),
  hoisted: (f) => f(),
  mocked: (x) => x,
  resetModules: unsupported("vi.resetModules"),
  importActual: unsupported("vi.importActual"),
};

const show = (v) => inspect(v, { depth: 4, breakLength: 160 }).slice(0, 400);
const ANY = Symbol("any");
function matches(actual, expected) {
  if (expected && expected[ANY]) return expected.test(actual);
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    if (!actual || typeof actual !== "object") return false;
    return Object.keys(expected).every((k) => matches(actual[k], expected[k]));
  }
  if (Array.isArray(expected))
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e));
  return Object.is(actual, expected) || isDeepStrictEqual(actual, expected);
}
function equal(a, b) {
  if (isDeepStrictEqual(a, b)) return true;
  return loose(a, b);
}
// toEqual semantics: ignores undefined properties and prototypes, recurses
// into Maps, Sets, arrays and typed arrays, and honours asymmetric matchers.
function loose(a, b) {
  if (b && b[ANY]) return b.test(a);
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    return [...b].every(([k, v]) => a.has(k) && loose(a.get(k), v));
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    return [...b].every((v) => [...a].some((x) => loose(x, v)));
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b) || Array.isArray(a) || Array.isArray(b)) {
    if (a.length !== b.length || Array.isArray(a) !== Array.isArray(b)) return false;
    for (let i = 0; i < a.length; i++) if (!loose(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Date || b instanceof Date) return +a === +b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] === undefined && b[k] === undefined) continue;
    if (!loose(a[k], b[k])) return false;
  }
  return true;
}
function matchers(actual, negate) {
  const check = (pass, message) => {
    if (!!pass === negate) throw new Error((negate ? "expected NOT: " : "") + message);
  };
  const callsOf = () => {
    if (!actual?._isMockFunction) throw new Error("expected a mock function");
    return actual.mock.calls;
  };
  return {
    toBe: (b) => check(Object.is(actual, b), `${show(actual)} toBe ${show(b)}`),
    toEqual: (b) => check(equal(actual, b), `${show(actual)} toEqual ${show(b)}`),
    toStrictEqual: (b) => check(isDeepStrictEqual(actual, b), `${show(actual)} toStrictEqual ${show(b)}`),
    toMatchObject: (b) => check(matches(actual, b), `${show(actual)} toMatchObject ${show(b)}`),
    toBeCloseTo: (b, digits = 2) => check(Math.abs(actual - b) < 10 ** -digits / 2, `${actual} toBeCloseTo ${b} (${digits})`),
    toBeGreaterThan: (b) => check(actual > b, `${actual} > ${b}`),
    toBeGreaterThanOrEqual: (b) => check(actual >= b, `${actual} >= ${b}`),
    toBeLessThan: (b) => check(actual < b, `${actual} < ${b}`),
    toBeLessThanOrEqual: (b) => check(actual <= b, `${actual} <= ${b}`),
    toContain: (b) => check(actual?.includes?.(b), `${show(actual)} toContain ${show(b)}`),
    toContainEqual: (b) => check([...actual].some((x) => equal(x, b)), `${show(actual)} toContainEqual ${show(b)}`),
    toMatch: (b) => check(typeof b === "string" ? actual.includes(b) : b.test(actual), `${show(actual)} toMatch ${b}`),
    toHaveLength: (n) => check(actual?.length === n, `length ${actual?.length} toHaveLength ${n}`),
    toHaveProperty: (k, v) => {
      const path = Array.isArray(k) ? k : String(k).split(".");
      let o = actual, ok = true;
      for (const p of path) {
        if (o == null || !(p in Object(o))) { ok = false; break; }
        o = o[p];
      }
      check(ok && (v === undefined || equal(o, v)), `toHaveProperty ${k}`);
    },
    toBeInstanceOf: (b) => check(actual instanceof b, `instance of ${b?.name}`),
    toBeTruthy: () => check(actual, `${show(actual)} truthy`),
    toBeFalsy: () => check(!actual, `${show(actual)} falsy`),
    toBeNull: () => check(actual === null, `${show(actual)} null`),
    toBeUndefined: () => check(actual === undefined, `${show(actual)} undefined`),
    toBeDefined: () => check(actual !== undefined, "defined"),
    toBeNaN: () => check(Number.isNaN(actual), "NaN"),
    toBeTypeOf: (t) => check(typeof actual === t, `typeof ${typeof actual} is ${t}`),
    toBeOneOf: (list) => check(list.some((x) => equal(actual, x)), `${show(actual)} one of ${show(list)}`),
    toThrow: (m) => {
      let thrown = false, error;
      try {
        actual();
      } catch (e) {
        thrown = true;
        error = e;
      }
      const msg = String(error?.message ?? error);
      const ok = thrown && (m === undefined || (typeof m === "string" ? msg.includes(m) : m instanceof RegExp ? m.test(msg) : typeof m === "function" ? error instanceof m : true));
      check(ok, `toThrow ${m ?? ""} (got ${thrown ? msg : "no throw"})`);
    },
    toHaveBeenCalled: () => check(callsOf().length > 0, "called"),
    toHaveBeenCalledOnce: () => check(callsOf().length === 1, `called once (got ${callsOf().length})`),
    toHaveBeenCalledTimes: (n) => check(callsOf().length === n, `called ${n} times (got ${callsOf().length})`),
    toHaveBeenCalledWith: (...x) => check(callsOf().some((c) => equal(c, x)), `called with ${show(x)}; calls ${show(callsOf())}`),
    toHaveBeenCalledExactlyOnceWith: (...x) => check(callsOf().length === 1 && equal(callsOf()[0], x), `called exactly once with ${show(x)}; calls ${show(callsOf())}`),
    toHaveBeenLastCalledWith: (...x) => check(equal(callsOf().at(-1), x), `last called with ${show(x)}; got ${show(callsOf().at(-1))}`),
    toHaveBeenNthCalledWith: (n, ...x) => check(equal(callsOf()[n - 1], x), `call ${n} with ${show(x)}`),
    toHaveReturnedWith: (v) => check(actual.mock.results.some((r) => equal(r.value, v)), `returned ${show(v)}`),
    toMatchSnapshot: unsupported("snapshots"),
    toMatchInlineSnapshot: unsupported("snapshots"),
  };
}
matchers.alias = { toThrowError: "toThrow", toBeCalled: "toHaveBeenCalled", toBeCalledTimes: "toHaveBeenCalledTimes", toBeCalledWith: "toHaveBeenCalledWith" };
function withAliases(m) {
  for (const [a, b] of Object.entries(matchers.alias)) m[a] = m[b];
  return m;
}
export function expect(actual, _message) {
  const api = withAliases(matchers(actual, false));
  api.not = withAliases(matchers(actual, true));
  api.resolves = new Proxy({}, { get: (_, k) => async (...a) => withAliases(matchers(await actual, false))[k](...a) });
  api.rejects = new Proxy({}, {
    get: (_, k) => async (...a) => {
      let error, thrown = false;
      try {
        await actual;
      } catch (e) {
        thrown = true;
        error = e;
      }
      if (!thrown) throw new Error("expected promise to reject");
      if (k === "toThrow" || k === "toThrowError") {
        const m = a[0], msg = String(error?.message ?? error);
        if (m && (typeof m === "string" ? !msg.includes(m) : m instanceof RegExp && !m.test(msg)))
          throw new Error(`rejected with ${msg}, expected ${m}`);
        return;
      }
      return withAliases(matchers(error, false))[k](...a);
    },
  });
  return api;
}
const anyOf = (test) => ({ [ANY]: true, test });
expect.any = (Type) => anyOf((v) => v != null && (v.constructor === Type || v instanceof Type || typeof v === Type.name.toLowerCase()));
expect.anything = () => anyOf((v) => v != null);
expect.objectContaining = (o) => anyOf((v) => matches(v, o));
expect.arrayContaining = (arr) => anyOf((v) => Array.isArray(v) && arr.every((x) => v.some((y) => equal(y, x))));
expect.stringContaining = (s) => anyOf((v) => typeof v === "string" && v.includes(s));
expect.closeTo = (n, d = 2) => anyOf((v) => Math.abs(v - n) < 10 ** -d / 2);
expect.soft = expect;

// Runs after the test file's top level has registered everything.
process.on("beforeExit", async () => {
  if (globalThis.__offlineRan) return;
  globalThis.__offlineRan = true;
  // Async work such as WebAssembly compilation does not hold the event loop
  // open by itself; keep it alive until every test has finished.
  const keepAlive = setInterval(() => {}, 1000);
  const results = [];
  for (const t of tests) {
    if (t.skip) {
      results.push({ name: t.name, status: "skip", reason: t.skip });
      continue;
    }
    const started = performance.now();
    try {
      for (const b of befores) await b();
      await t.fn();
      results.push({ name: t.name, status: "pass", ms: Math.round(performance.now() - started) });
    } catch (e) {
      const status = e instanceof ShimUnsupported ? "skip" : "fail";
      results.push({ name: t.name, status, reason: String(e?.message ?? e).split("\n")[0].slice(0, 300) });
    } finally {
      for (const a of afters)
        try {
          await a();
        } catch {}
      vi.unstubAllGlobals();
    }
  }
  clearInterval(keepAlive);
  console.log("@@OFFLINE-RESULTS@@" + JSON.stringify(results));
  process.exitCode = results.some((r) => r.status === "fail") ? 1 : 0;
});
