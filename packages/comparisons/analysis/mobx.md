# MobX State Management Analysis

## Overview

MobX is a mature reactive state management library that uses observables, actions, and reactions to create predictable state management. Unlike Storable's proxy-based approach, MobX uses decorator-based observability with a sophisticated dependency tracking system built around the observer pattern.

## React Integration

### Core Hook: observer

MobX's primary React integration is through the `observer` higher-order component and `useObserver` hook:

**Source: [`node_modules/mobx-react-lite/src/observer.ts:121-123`](node_modules/mobx-react-lite/src/observer.ts#L121-L123)**

```typescript
let observerComponent = (props: any, ref: React.Ref<TRef>) => {
    return useObserver(() => render(props, ref), baseComponentName)
}
```

The `observer` wrapper automatically tracks observable dependencies and re-renders when they change.

### useObserver Implementation

**Source: [`node_modules/mobx-react-lite/src/useObserver.ts:35-119`](node_modules/mobx-react-lite/src/useObserver.ts#L35-L119)**

```typescript
export function useObserver<T>(render: () => T, baseComponentName: string = "observed"): T {
    const admRef = React.useRef<ObserverAdministration | null>(null)

    if (!admRef.current) {
        // First render
        const adm: ObserverAdministration = {
            reaction: null,
            onStoreChange: null,
            stateVersion: Symbol(),
            name: baseComponentName,
            subscribe(onStoreChange: () => void) {
                // Setup reaction and subscription logic
                if (!adm.reaction) {
                    createReaction(adm)
                    adm.stateVersion = Symbol()
                }
                return () => {
                    adm.onStoreChange = null
                    adm.reaction?.dispose()
                    adm.reaction = null
                }
            },
            getSnapshot() {
                return adm.stateVersion
            }
        }
        admRef.current = adm
    }

    const adm = admRef.current!
    
    useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot)

    // Track observable access during render
    let renderResult!: T
    adm.reaction!.track(() => {
        renderResult = render()
    })

    return renderResult
}
```

**Key Integration Features:**

1. **React 18/19 Compatible**: Uses `useSyncExternalStore` from `use-sync-external-store/shim`
2. **Reaction-based Tracking**: Uses MobX's `Reaction` system to track observable dependencies during render
3. **Automatic Disposal**: Handles reaction cleanup via FinalizationRegistry for memory management
4. **Concurrent Mode Support**: Handles React's concurrent features and strict mode properly

## State Management Architecture

### Observable Creation

**Source: [`node_modules/mobx/src/api/observable.ts:102-146`](node_modules/mobx/src/api/observable.ts#L102-L146)**

```typescript
function createObservable(v: any, arg2?: any, arg3?: any) {
    // already observable - ignore
    if (isObservable(v)) {
        return v
    }

    // plain object
    if (isPlainObject(v)) {
        return observable.object(v, arg2, arg3)
    }

    // Array
    if (Array.isArray(v)) {
        return observable.array(v, arg2)
    }

    // Map/Set
    if (isES6Map(v)) return observable.map(v, arg2)
    if (isES6Set(v)) return observable.set(v, arg2)

    // other object - ignore
    if (typeof v === "object" && v !== null) {
        return v
    }

    // anything else - create boxed observable
    return observable.box(v, arg2)
}
```

### Dependency Tracking System

**Source: [`node_modules/mobx/src/core/observable.ts:135-160`](node_modules/mobx/src/core/observable.ts#L135-L160)**

MobX uses a sophisticated observer pattern:

```typescript
export function reportObserved(observable: IObservable): boolean {
    const derivation = globalState.trackingDerivation
    if (derivation !== null) {
        /**
         * Simple optimization, give each derivation run an unique id (runId)
         * Check if last time this observable was accessed the same runId is used
         * if this is the case, the relation is already known
         */
        if (derivation.runId_ !== observable.lastAccessedBy_) {
            observable.lastAccessedBy_ = derivation.runId_
            derivation.newObserving_![derivation.unboundDepsCount_++] = observable
            if (!observable.isBeingObserved && globalState.trackingContext) {
                observable.isBeingObserved = true
                observable.onBO()
            }
        }
        return observable.isBeingObserved
    }
    return false
}
```

### Change Propagation

**Source: [`node_modules/mobx/src/core/observable.ts:185-203`](node_modules/mobx/src/core/observable.ts#L185-L203)**

```typescript
export function propagateChanged(observable: IObservable) {
    if (observable.lowestObserverState_ === IDerivationState_.STALE_) {
        return
    }
    observable.lowestObserverState_ = IDerivationState_.STALE_

    observable.observers_.forEach(d => {
        if (d.dependenciesState_ === IDerivationState_.UP_TO_DATE_) {
            d.onBecomeStale_()
        }
        d.dependenciesState_ = IDerivationState_.STALE_
    })
}
```

## Performance Comparison with Storable

### Advantages of MobX

1. **Mature Ecosystem**: Extensive tooling, dev tools, and community support
2. **Selective Observability**: Can choose which properties to make observable vs automatic proxying
3. **Class-based Support**: First-class support for class-based state management
4. **Action Enforcement**: Built-in action system prevents accidental state mutations

### Performance Tradeoffs

1. **Setup Overhead**: Requires explicit `observable` calls or decorators
   **Source: [`node_modules/mobx/src/api/observable.ts:197-243`](node_modules/mobx/src/api/observable.ts#L197-L243)**
   ```typescript
   const observableFactories: IObservableFactory = {
       box<T = any>(value: T, options?: CreateObservableOptions): IObservableValue<T> {
           const o = asCreateObservableOptions(options)
           return new ObservableValue(value, getEnhancerFromOptions(o), o.name, true, o.equals)
       },
       object<T extends object = any>(
           props: T,
           decorators?: AnnotationsMap<T, never>,
           options?: CreateObservableOptions
       ): T {
           return initObservable(() =>
               extendObservable(
                   globalState.useProxies === false || options?.proxy === false
                       ? asObservableObject({}, options)
                       : asDynamicObservableObject({}, options),
                   props,
                   decorators
               )
           )
       }
   }
   ```

2. **Memory Usage**: Maintains complex observer-observable relationships and derivation states
   **Source: [`node_modules/mobx/src/core/observable.ts:19-39`](node_modules/mobx/src/core/observable.ts#L19-L39)**
   ```typescript
   export interface IObservable extends IDepTreeNode {
       diffValue: number
       lastAccessedBy_: number
       isBeingObserved: boolean
       lowestObserverState_: IDerivationState_
       isPendingUnobservation: boolean
       observers_: Set<IDerivation>
       onBUO(): void
       onBO(): void
       onBUOL: Set<Lambda> | undefined
       onBOL: Set<Lambda> | undefined
   }
   ```

3. **Batching System**: Uses manual batching via `startBatch`/`endBatch`
   **Source: [`node_modules/mobx/src/core/observable.ts:106-133`](node_modules/mobx/src/core/observable.ts#L106-L133)**

### Clear Wins

1. **Computed Values**: Built-in memoized computed properties with automatic dependency tracking
2. **Action System**: Enforced action boundaries prevent state corruption
3. **DevTools Integration**: Excellent debugging tools and state inspection
4. **Mature API**: Well-tested patterns for complex state management scenarios
5. **Flexible Observability**: Can make specific properties observable rather than entire objects

## Architectural Differences from Storable

| Aspect | MobX | Storable |
|--------|------|----------|
| **Observable Creation** | Explicit via `observable()` or decorators | Automatic in `createStore()` |
| **React Integration** | `observer` HOC + `useSyncExternalStore` | `use-sync-external-store` + alien-signals |
| **Dependency Tracking** | Reaction-based observer pattern | Proxy traps + signal subscriptions |
| **Memory Model** | Observable-observer relationships + derivation states | Single reactive proxy with signal nodes |
| **Nested Objects** | Requires explicit `observable` calls | Auto-proxied via `wrap()` function |
| **State Updates** | Actions + direct mutation | Update operators (currently) |
| **Batching** | Manual `runInAction` or automatic in actions | Automatic via `startBatch`/`endBatch` |
| **Type System** | Class-based + functional patterns | Functional patterns with proxies |

## TypeScript Support

**Source: [`node_modules/mobx/dist/mobx.d.ts:1-2`](node_modules/mobx/dist/mobx.d.ts#L1-L2)**

MobX provides comprehensive TypeScript support with complete type inference for observables, actions, and computed values:

```typescript
export { 
    IObservable, IDepTreeNode, Reaction, IReactionPublic, IReactionDisposer, 
    untracked, IAtom, createAtom, spy, IComputedValue, IEqualsComparer, 
    comparer, IEnhancer, IInterceptable, IInterceptor, // ... many more types
} from "./internal";
```

## Conclusion

MobX offers a fundamentally different approach to reactive state management compared to Storable. While both provide fine-grained reactivity and React 18/19 compatibility, MobX uses an explicit observable system with mature tooling and patterns, whereas Storable provides automatic reactivity through proxies.

MobX's strength lies in its explicit control over observability, mature ecosystem, and sophisticated debugging tools. However, this comes with the cost of more setup overhead and conceptual complexity compared to Storable's automatic proxy-based approach.

The choice between MobX and Storable depends on team preferences for explicit vs automatic observability, the need for class-based patterns, and requirements for mature tooling ecosystems.

**Best suited for**: Teams comfortable with explicit state management patterns, applications requiring complex computed values and actions, projects benefiting from mature debugging tools, and codebases using class-based state management.