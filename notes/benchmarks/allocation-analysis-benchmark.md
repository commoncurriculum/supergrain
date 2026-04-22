# Allocation Analysis Benchmark Code

> **Status**: Historical. Benchmark code archive -- identifies allocation/overhead sources in @supergrain/kernel.
> **TL;DR**: Measured function call overhead (Reflect.get 22x, getCurrentSub 14x, hasOwnProperty 3x), symbol access (37x), signal creation (18x), and per-object memory costs (~430+ bytes). Findings fed into the 4 optimizations in [safe-optimizations-benchmark.md](./safe-optimizations-benchmark.md).

## Benchmark Code

```typescript
import { bench, describe } from "vitest";
import { $RAW, $NODE, $VERSION } from "../src";
import { signal, getCurrentSub } from "alien-signals";

/**
 * Allocation Analysis Benchmark
 *
 * This benchmark focuses on identifying the specific allocations and overhead
 * sources that contribute to the performance degradation in @supergrain/kernel.
 */

describe("Allocation Analysis: Function Call Overhead", () => {
  const directObj = { count: 0, name: "test", nested: { value: 42 } };

  bench("Direct property access: 1M calls", () => {
    let sum = 0;
    for (let i = 0; i < 1_000_000; i++) {
      sum += directObj.count;
    }
    // sum used to prevent optimization
  });

  bench("Reflect.get calls: 1M calls", () => {
    let sum = 0;
    for (let i = 0; i < 1_000_000; i++) {
      sum += Reflect.get(directObj, "count");
    }
    // sum used to prevent optimization
  });

  bench("getCurrentSub: 1M calls", () => {
    let count = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const sub = getCurrentSub();
      count += sub ? 1 : 0;
    }
    // count used to prevent optimization
  });

  bench("Object.prototype.hasOwnProperty: 1M calls", () => {
    let count = 0;
    for (let i = 0; i < 1_000_000; i++) {
      count += Object.prototype.hasOwnProperty.call(directObj, "count") ? 1 : 0;
    }
    // count used to prevent optimization
  });
});

describe("Allocation Analysis: Symbol Access Performance", () => {
  const obj = { test: 42 };
  Object.defineProperty(obj, $NODE, { value: {}, enumerable: false });
  Object.defineProperty(obj, $RAW, { value: obj, enumerable: false });
  Object.defineProperty(obj, $VERSION, { value: 0, enumerable: false });

  bench("Regular property access: 1M calls", () => {
    let sum = 0;
    for (let i = 0; i < 1_000_000; i++) {
      sum += obj.test;
    }
    // sum used to prevent optimization
  });

  bench("Symbol property access ($NODE): 1M calls", () => {
    let count = 0;
    for (let i = 0; i < 1_000_000; i++) {
      count += (obj as any)[$NODE] ? 1 : 0;
    }
    // count used to prevent optimization
  });

  bench("Symbol property access ($RAW): 1M calls", () => {
    let count = 0;
    for (let i = 0; i < 1_000_000; i++) {
      count += (obj as any)[$RAW] ? 1 : 0;
    }
    // count used to prevent optimization
  });

  bench("Symbol property access ($VERSION): 1M calls", () => {
    let sum = 0;
    for (let i = 0; i < 1_000_000; i++) {
      sum += (obj as any)[$VERSION];
    }
    // sum used to prevent optimization
  });
});

describe("Allocation Analysis: Signal Creation Overhead", () => {
  bench("Create 100k plain objects", () => {
    const objects = [];
    for (let i = 0; i < 100_000; i++) {
      objects.push({ value: i });
    }
    // objects used to prevent optimization
  });

  bench("Create 100k signals", () => {
    const signals = [];
    for (let i = 0; i < 100_000; i++) {
      signals.push(signal(i));
    }
    // signals used to prevent optimization
  });

  bench("Create 100k signals with $ property", () => {
    const signals = [];
    for (let i = 0; i < 100_000; i++) {
      const sig = signal(i) as any;
      sig.$ = (v: any) => sig(v);
      signals.push(sig);
    }
    // signals used to prevent optimization
  });

  bench("Create 100k DataNodes objects", () => {
    const objects = [];
    for (let i = 0; i < 100_000; i++) {
      const nodes = Object.create(null);
      nodes.test = signal(i);
      objects.push(nodes);
    }
    // objects used to prevent optimization
  });
});

describe("Allocation Analysis: Proxy Creation Patterns", () => {
  const baseObj = { count: 42, name: "test" };

  bench("Create 10k plain objects", () => {
    const objects = [];
    for (let i = 0; i < 10_000; i++) {
      objects.push({ ...baseObj, id: i });
    }
    // objects used to prevent optimization
  });

  bench("Create 10k basic proxies", () => {
    const objects = [];
    for (let i = 0; i < 10_000; i++) {
      const obj = { ...baseObj, id: i };
      objects.push(new Proxy(obj, { get: (t, p) => t[p as keyof typeof t] }));
    }
    // objects used to prevent optimization
  });

  bench("Create 10k proxies with complex handler", () => {
    const objects = [];
    for (let i = 0; i < 10_000; i++) {
      const obj = { ...baseObj, id: i };
      objects.push(
        new Proxy(obj, {
          get(target, prop) {
            if (typeof prop === "symbol") return undefined;
            const value = target[prop as keyof typeof target];
            if (typeof value === "function") return value;
            if (!getCurrentSub()) return value;
            const own = Object.prototype.hasOwnProperty.call(target, prop);
            return value;
          },
        }),
      );
    }
    // objects used to prevent optimization
  });
});

describe("Allocation Analysis: Nested Object Creation", () => {
  const nestedTemplate = {
    level1: {
      level2: {
        level3: {
          value: 42,
        },
      },
    },
  };

  bench("Create 1k nested objects: direct", () => {
    const objects = [];
    for (let i = 0; i < 1_000; i++) {
      objects.push(JSON.parse(JSON.stringify(nestedTemplate)));
    }
    // objects used to prevent optimization
  });

  bench("Create 1k nested objects: with proxies at each level", () => {
    const objects = [];
    for (let i = 0; i < 1_000; i++) {
      const obj = JSON.parse(JSON.stringify(nestedTemplate));
      const proxy3 = new Proxy(obj.level1.level2.level3, { get: (t, p) => t[p as keyof typeof t] });
      const proxy2 = new Proxy(
        { ...obj.level1.level2, level3: proxy3 },
        { get: (t, p) => t[p as keyof typeof t] },
      );
      const proxy1 = new Proxy(
        { ...obj.level1, level2: proxy2 },
        { get: (t, p) => t[p as keyof typeof t] },
      );
      objects.push(new Proxy({ level1: proxy1 }, { get: (t, p) => t[p as keyof typeof t] }));
    }
    // objects used to prevent optimization
  });
});

describe("Allocation Analysis: WeakMap Overhead", () => {
  const cache = new WeakMap<object, object>();
  const objects = Array.from({ length: 1000 }, (_, i) => ({ id: i }));

  bench("WeakMap: 100k set operations", () => {
    for (let i = 0; i < 100_000; i++) {
      const obj = objects[i % objects.length];
      cache.set(obj, { cached: true });
    }
  });

  bench("WeakMap: 100k get operations", () => {
    let count = 0;
    for (let i = 0; i < 100_000; i++) {
      const obj = objects[i % objects.length];
      count += cache.has(obj) ? 1 : 0;
    }
    // count used to prevent optimization
  });

  bench("Plain object: 100k property set", () => {
    const cache = {} as any;
    for (let i = 0; i < 100_000; i++) {
      cache[`key_${i % 1000}`] = { cached: true };
    }
  });

  bench("Plain object: 100k property get", () => {
    const cache = {} as any;
    // Pre-populate
    for (let i = 0; i < 1000; i++) {
      cache[`key_${i}`] = { cached: true };
    }

    let count = 0;
    for (let i = 0; i < 100_000; i++) {
      count += cache[`key_${i % 1000}`] ? 1 : 0;
    }
    // count used to prevent optimization
  });
});

describe("Allocation Analysis: Memory Allocation Patterns", () => {
  bench("Simulate @supergrain/kernel object creation: 1k objects", () => {
    const objects = [];
    for (let i = 0; i < 1_000; i++) {
      const obj = { id: i, name: `item-${i}`, value: i * 2 };

      // Simulate DataNodes allocation
      const nodes = Object.create(null);
      nodes.id = signal(obj.id);
      nodes.name = signal(obj.name);
      nodes.value = signal(obj.value);

      // Add $ methods (overhead)
      nodes.id.$ = (v: any) => nodes.id(v);
      nodes.name.$ = (v: any) => nodes.name(v);
      nodes.value.$ = (v: any) => nodes.value(v);

      // Simulate symbol properties
      Object.defineProperty(obj, $NODE, { value: nodes });
      Object.defineProperty(obj, $VERSION, { value: 0 });

      // Create proxy
      const proxy = new Proxy(obj, {
        get(target, prop) {
          if (prop === $RAW) return target;
          const value = Reflect.get(target, prop);
          if (typeof value === "function") return value;
          if (!getCurrentSub()) return value;
          const own = Object.prototype.hasOwnProperty.call(target, prop);
          return value;
        },
      });

      objects.push(proxy);
    }
    // objects used to prevent optimization
  });

  bench("Equivalent direct object creation: 1k objects", () => {
    const objects = [];
    for (let i = 0; i < 1_000; i++) {
      objects.push({ id: i, name: `item-${i}`, value: i * 2 });
    }
    // objects used to prevent optimization
  });
});
```

## Results Summary

### Function Call Overhead (1M calls each)

| Operation      | vs Direct Access |
| -------------- | ---------------- |
| Reflect.get    | ~22x slower      |
| getCurrentSub  | ~14x slower      |
| hasOwnProperty | ~3x slower       |

### Symbol Access (1M calls each)

| Operation              | vs Regular Property |
| ---------------------- | ------------------- |
| Symbol property access | ~37x slower         |

### Signal Creation (100k each)

| Operation                       | vs Plain Object             |
| ------------------------------- | --------------------------- |
| Signal creation                 | ~18x slower                 |
| Signal + $ property             | Additional closure overhead |
| DataNodes (Object.create(null)) | Additional overhead         |

### Memory Per Wrapped Object

| Component           | Bytes |
| ------------------- | ----- |
| Total per object    | ~430+ |
| Per-property signal | ~200  |
| WeakMap entry       | ~30   |
| Symbol properties   | ~50   |

## Optimizations Derived From This Analysis

1. Direct property access instead of Reflect.get (22x improvement potential)
2. Object literal instead of Object.create(null) (2.19x improvement)
3. Optimized signal $ method assignment (1.43x improvement)
4. Simplified proxy handler logic (reduced function call overhead)

Originally `packages/core/benchmarks/allocation-analysis.bench.ts`, moved to doc format.
