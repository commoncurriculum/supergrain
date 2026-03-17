# Performance Plan: Achieving State-of-the-Art Reactive Read Speed

## 1. Primary Goal

The single most important objective of this plan is to **eliminate the performance bottleneck for property reads within a reactive context.**

Our benchmarks revealed a catastrophic performance gap: `@supergrain/core` performs at **~2,700 operations/sec**, while a comparable Solid.js store performs at **~17,300,000 operations/sec**. This is a **~6,400x difference**. This plan is focused exclusively on closing that gap.

## 2. Root Cause Analysis: The Hot Path Bottleneck

The massive discrepancy stems from a fundamental architectural difference in the "hot path"—the code that executes on every single tracked property access.

### `@supergrain/core` (Current, Slow Architecture)

For every tracked read (e.g., `user.name` inside an `effect`):

1.  The Proxy `get` trap is invoked.
2.  The `getSignal(key)` function is called.
3.  This function performs a **`Map.get(key)` lookup** within a closure-scoped `Map` to find the corresponding signal. This is the **primary bottleneck**. A `Map` lookup, while fast in isolation, is orders of magnitude slower than a direct property access when performed millions of times per second.
4.  The signal's value is accessed, which registers the dependency.

### Solid.js Store (Optimized Architecture)

For every tracked read:

1.  The Proxy `get` trap is invoked.
2.  It accesses a hidden object attached to the raw data via a `Symbol`.
3.  It performs a **direct property access** on that hidden object to get the signal. This is the critical optimization; it replaces the slow `Map` lookup with a native, JIT-optimizable property access.
4.  The signal is read, registering the dependency.

**Conclusion:** The root cause of the performance deficit is the `Map` lookup in the hot path. We must refactor the store to eliminate it.

---

## 3. The Action Plan: Refactor for a Direct-Access Model

We will refactor `@supergrain/core` to mirror Solid's direct-access architecture. This involves attaching a hidden cache for signals directly to the state object.

### Step 1: Implement the "Non-Reactive Fast Path"

The most significant optimization is to bypass all reactive machinery when not inside a tracking context (e.g., an `effect`). This requires a mechanism from the underlying signals library to check the current context.

1.  **Expose `isTracking` from Signals Library:** The `alien-signals` package must export a function, let's call it `isTracking()`, that returns `true` if code is currently running inside a reactive scope, and `false` otherwise.

2.  **Update the Proxy `get` Handler:** Add a conditional check at the very top of the `get` trap.

    ```typescript
    // In createReactiveProxy...
    const handler = {
      get(target, key, receiver) {
        // FAST PATH: If not in a reactive context, return the raw value immediately.
        if (!isTracking()) {
          const value = Reflect.get(target, key, receiver)
          // Important: We still need to wrap nested objects to ensure
          // any future reactive access within them is caught.
          return isWrappable(value) ? createReactiveProxy(value) : value
        }

        // SLOW PATH (REACTIVE): The logic from Step 2 goes here.
        // ...
      },
      // ... other traps
    }
    ```

### Step 2: Redesign Signal Storage

This is the core task: replacing the `Map` with a direct-access signal cache attached to the data object itself.

1.  **Introduce a Symbol:** Define a global `Symbol` to serve as the hidden key for our signal cache. Using a symbol prevents collisions with user-defined properties.

    ```typescript
    const $NODE = Symbol('storable-signals-node')
    ```

2.  **Deprecate the `Map`:** The `const signals = new Map()` line inside `createReactiveProxy` must be removed.

3.  **Create a New `getSignal` Helper:** This new function will be the heart of the reactive read mechanism. It gets or creates signals on demand and stores them on the target object.

    ```typescript
    function getSignal(target, key) {
      // Get or create the hidden signal cache on the raw object.
      let node = target[$NODE]
      if (!node) {
        // Use Object.create(null) for a prototype-less object, avoiding potential prototype chain issues.
        node = Object.create(null)
        // Define the property as non-enumerable so it doesn't show up in Object.keys() etc.
        Object.defineProperty(target, $NODE, { value: node })
      }

      // Get or create the signal for the specific property.
      let signal = node[key]
      if (!signal) {
        // createSignal is the primitive from the signals library.
        signal = createSignal(target[key])
        node[key] = signal
      }
      return signal
    }
    ```

### Step 3: Update Proxy Handlers for the Reactive Path

With the fast path and the new signal storage in place, we update the proxy handlers to use them.

1.  **Refactor the `get` Trap (Reactive Path):**

    ```typescript
    get(target, key, receiver) {
      if (!isTracking()) {
        // ... fast path from Step 1 ...
        const value = Reflect.get(target, key, receiver);
        return isWrappable(value) ? createReactiveProxy(value) : value;
      }

      // If we are tracking, use the new helper to get the signal.
      const signal = getSignal(target, key);
      const value = signal(); // Read the signal to track the dependency.

      // Recursive wrapping logic remains the same.
      return isWrappable(value) ? createReactiveProxy(value) : value;
    }
    ```

2.  **Refactor the `set` Trap:** The `set` handler must now use the new architecture to update values.

    ```typescript
    set(target, key, newValue, receiver) {
      const hadKey = Reflect.has(target, key);
      const oldValue = Reflect.get(target, key, receiver);
      const result = Reflect.set(target, key, newValue, receiver);

      // Only update signal if the value has actually changed.
      if (result && oldValue !== newValue) {
        // This will create the signal if it doesn't exist.
        const signal = getSignal(target, key);
        signal(newValue); // Update the signal's value.
      }

      // Handle shape changes for `ownKeys` tracking.
      if (!hadKey) {
        const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'));
        ownKeysSignal(ownKeysSignal() + 1);
      }
      return result;
    }
    ```

3.  **Refactor `ownKeys`, `deleteProperty`:** These handlers must also be updated to use the new `getSignal` model with a dedicated symbol for tracking shape changes.

    ```typescript
    deleteProperty(target, key) {
      const hadKey = Reflect.has(target, key);
      const result = Reflect.deleteProperty(target, key);
      if (hadKey && result) {
        // Trigger shape change signal.
        const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'));
        ownKeysSignal(ownKeysSignal() + 1);
      }
      return result;
    },

    ownKeys(target) {
      // Depend on the shape signal.
      const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'));
      ownKeysSignal();
      return Reflect.ownKeys(target);
    }
    ```

## 4. Expected Outcome

- **Primary Goal Met:** The benchmark for reactive property reads (`Proxy Reactivity: property access`) will increase from ~2,700 hz to a level competitive with Solid's ~17,000,000 hz. The primary architectural bottleneck will be resolved.
- **Improved Overall Performance:** The "Non-Reactive Fast Path" will make all property reads outside of an `effect` nearly as fast as a plain object access, dramatically improving the library's general-purpose performance.
- **State-of-the-Art Architecture:** The library will be aligned with modern, best-in-class reactive design principles, ensuring its long-term viability and performance.
