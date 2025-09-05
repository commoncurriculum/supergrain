# Performance Plan: Achieving State-of-the-Art Reactive Read Speed

## 1. Primary Goal

The single most important objective of this plan is to **eliminate the performance bottleneck for property reads within a reactive context.**

Our benchmarks revealed a catastrophic performance gap: `ReactiveStore` performs at ~3,500 operations/sec, while a comparable Solid.js store performs at ~17,000,000 operations/sec. This is a **~5,000x difference**. This plan is focused exclusively on closing that gap. Other optimizations, such as write performance, are secondary.

## 2. Root Cause Analysis: The Hot Path Bottleneck

The massive discrepancy stems from a fundamental architectural difference in the "hot path"—the code that runs on every single tracked property access.

### `ReactiveStore` (Current, Slow Architecture)

For every tracked read (e.g., `user.name` inside an `effect`):

1.  The Proxy `get` trap is invoked.
2.  The `getSignal(key)` function is called.
3.  This function performs a **`Map.get(key)` lookup** within a closure-scoped `Map` to find the corresponding signal. This is the **primary bottleneck**. While fast in isolation, a `Map` lookup is orders of magnitude slower than a direct property access when performed millions of times per second.
4.  The signal's `.value` is accessed, which finally registers the dependency.

### Solid.js Store (Optimized Architecture)

For every tracked read:

1.  The Proxy `get` trap is invoked.
2.  It accesses a hidden object attached to the raw data via a `Symbol` (e.g., `target[$NODE]`).
3.  It performs a **direct property access** on that hidden object to get the signal (e.g., `target[$NODE][key]`). This is the critical optimization; it replaces the slow `Map` lookup with a native, JIT-optimizable property access.
4.  If the signal doesn't exist, it is created "just-in-time."
5.  The signal is read, registering the dependency.

**Conclusion:** The root cause of the performance deficit is the use of a `Map` lookup in the hot path for every single read, instead of a more direct and optimizable storage mechanism.

---

## 3. The Action Plan: Refactor for a Direct-Access Model

To achieve our performance goal, we must refactor `ReactiveStore` to eliminate the `Map` lookup and mirror Solid's direct-access architecture.

### Step 1: Redesign Signal Storage (The Core Task)

This step replaces the closure-scoped `Map` with a direct-access signal cache attached to the data itself.

1.  **Introduce a Symbol:** Define a global `Symbol` that will serve as the hidden key for our signal cache.
    ```typescript
    const $SIGNALS = Symbol('storable-signals')
    ```
2.  **Create a New Helper Function:** Create a new function, `getSignal(target, key)`, which will replace the old `getSignal`. This function will be the new heart of the reactive read mechanism.

    ```typescript
    function getSignal(target, key) {
      // Get or create the hidden signal cache on the raw object.
      let signals = target[$SIGNALS]
      if (!signals) {
        signals = Object.create(null)
        Object.defineProperty(target, $SIGNALS, { value: signals })
      }

      // Get or create the signal for the specific property.
      let signal = signals[key]
      if (!signal) {
        signal = createSignal(target[key]) // Assuming a createSignal primitive
        signals[key] = signal
      }
      return signal
    }
    ```

3.  **Deprecate the Old `Map`:** The `signals = new Map()` line inside `createReactiveProxy` must be removed.

### Step 2: Update the Proxy `get` Handler

The proxy `get` trap will be simplified to use the new, efficient signal retrieval function.

1.  **Refactor the `get` Trap:**

    ```typescript
    // Inside createReactiveProxy...
    const handler = {
      get(target, key, receiver) {
        // If the key is our symbol, return the raw signal cache.
        if (key === $SIGNALS) return Reflect.get(target, key, receiver)

        // Use the new, fast helper to get the signal.
        const [readSignal, writeSignal] = getSignal(target, key)

        // Read the signal to track the dependency.
        const value = readSignal()

        // Recursive wrapping logic remains the same.
        if (isWrappable(value)) {
          return createReactiveProxy(value)
        }
        return value
      },
      // ... other traps
    }
    ```

### Step 3: Implement the "Non-Reactive Fast Path" (Crucial for Overall Performance)

To fully match Solid's architecture, we must also optimize for reads that happen _outside_ of a reactive context.

1.  **Expose the Active Effect:** The underlying signals library (`alien-signals`) must provide a function to check if an effect is currently running (e.g., `getActiveEffect()`).
2.  **Add the Fast-Path Check:** Add a conditional check at the top of the `get` handler.

    ```typescript
    get(target, key, receiver) {
      // FAST PATH: If not in a reactive context, do nothing but return the raw value.
      if (!getActiveEffect()) {
        const value = Reflect.get(target, key, receiver);
        // Still need to return a proxy for nested objects.
        return isWrappable(value) ? createReactiveProxy(value) : value;
      }

      // SLOW PATH (Reactive): The logic from Step 2 goes here.
      // ...
    }
    ```

## 4. Expected Outcome

- **Primary Goal Met:** The benchmark for reactive reads will increase from ~3,500 hz to a level competitive with Solid's ~17,000,000 hz, as the primary architectural bottleneck will be resolved.
- **Reduced Overhead:** The new model is more memory-efficient, as it no longer creates a new `Map` and closure for every single proxied object.
- **State-of-the-Art Architecture:** The library will be aligned with modern, best-in-class reactive design principles.
