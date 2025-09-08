# Storable Architecture Notes

## Core Architecture Approach

### Signal-Based Reactivity
The library uses alien-signals as the core reactivity primitive. Every property access creates or retrieves a signal, enabling fine-grained tracking of dependencies.

### Proxy-Based Interception
JavaScript Proxies intercept all property access and mutations, allowing transparent reactivity without explicit annotations or special syntax.

### Normalized Store Structure
Data is organized in collections by type and ID (e.g., `posts['1']`), similar to normalized Redux stores, preventing data duplication and enabling efficient updates.

## Key Design Decisions

### 1. Automatic Signal Creation
- Signals are created lazily on first property access
- Reduces memory overhead for unused properties
- Enables gradual adoption without upfront schema definition

### 2. Nested Proxy Architecture
```
store.find('posts', '1')
  └─> Proxy { id, title, author }
       └─> author: Proxy { id, name }
            └─> name: Signal<string>
```

### 3. Array Handling Strategy
- Custom `ArraySignal` class extending native Array
- Index-level signals for fine-grained array element tracking
- Structural change tracking via version signal
- Method interception for push/splice/sort operations

### 4. Component Subscription Model
- Each component creates its own effect scope
- Property access during render automatically subscribes
- Cleanup happens on component unmount
- No manual subscription management required

### 5. Object Handling Strategy
Objects need special handling for:

#### Property Enumeration
```typescript
// These operations need to track "shape" changes
Object.keys(post)     // Should re-run when properties are added/removed
Object.values(post)   // Same
Object.entries(post)  // Same
for (let key in post) // Same
```

#### Dynamic Property Addition/Deletion
```typescript
// Need to track property existence
post.newField = 'value'  // Signal for shape change
delete post.oldField     // Signal for shape change
```

#### Object Spread and Destructuring
```typescript
// Spread accesses ALL properties - performance concern
const copy = {...post}  // Subscribes to every property!
const {title, ...rest} = post  // Same issue
```

#### Special Cases
- `Object.defineProperty` - need to intercept property descriptor changes
- Getters/setters on original object - proxy must preserve behavior
- Non-enumerable properties - should we track these?
- Symbol properties - need special handling
- Frozen/sealed objects - respect immutability

## Technical Implementation Details

### Signal Path Mapping
```typescript
// Path format: "collection.id.property.nested.path"
"posts.1.title" -> Signal<string>
"posts.1.tags.0" -> Signal<string>
"posts.1.author.name" -> Signal<string>
```

### Proxy Caching Strategy
- WeakMap for object -> proxy mapping
- Prevents duplicate proxy creation
- Allows garbage collection of unused proxies
- Maintains referential stability

### Array Signal Architecture
```typescript
class ArraySignal<T> {
  // Track individual elements
  itemSignals: Map<number, Signal<T>>

  // Track array metadata
  lengthSignal: Signal<number>
  versionSignal: Signal<number>

  // Operation-specific signals
  additionSignal: Signal<Addition>
  removalSignal: Signal<Removal>
}
```

## Unknowns

### 1. Performance at Scale
- How many signals can alien-signals efficiently handle?
- Memory overhead with thousands of entities
- Proxy creation cost for deeply nested objects
- Impact on React's reconciliation algorithm

### 2. Edge Cases
- Circular references in data structures
- Symbol properties and exotic objects
- Non-enumerable properties
- Getter/setter properties
- WeakMap/WeakSet reactivity

### 3. Framework Integration
- Vue's reactivity system conflicts
- React 18 concurrent features compatibility
- Server-side rendering behavior
- React Native support
- Web Worker usage

### 4. Type Safety
- Recursive type inference limits
- Generic constraint propagation
- Discriminated union handling
- Optional property tracking

### 5. Memory Management
- Signal cleanup strategies
- Handling removed entities
- Subscription leak detection
- Large array performance

## Things to Watch For

### 1. Memory Leaks
- **Risk**: Signals not being cleaned up when entities are removed
- **Mitigation**: Implement aggressive cleanup on entity deletion
- **Testing**: Long-running application tests with entity churn

### 2. Infinite Loops
- **Risk**: Computed signals triggering their own dependencies
- **Mitigation**: Cycle detection in signal graph
- **Testing**: Circular dependency test cases

### 3. Performance Cliffs
- **Risk**: Accessing all properties of large objects
- **Mitigation**: Warn about spread operators in dev mode
- **Testing**: Benchmark with realistic data sizes

### 4. React Strict Mode
- **Risk**: Double rendering causing duplicate subscriptions
- **Mitigation**: Proper effect cleanup
- **Testing**: All tests run in StrictMode

### 5. Stale Closures
- **Risk**: Event handlers capturing old values
- **Mitigation**: Document best practices
- **Testing**: Async update scenarios

### 6. Array Index Stability
- **Risk**: Array mutations changing index meanings
- **Mitigation**: Track items by identity when possible
- **Testing**: Array splice/sort scenarios

### 7. Cross-Realm Objects
- **Risk**: Objects from iframes or workers
- **Mitigation**: Serialize/deserialize at boundaries
- **Testing**: Multi-window applications

### 8. Development vs Production
- **Risk**: Dev-only checks impacting performance
- **Mitigation**: Build-time flags
- **Testing**: Production build benchmarks

## Performance Considerations

### Hot Paths
1. Property access in render functions
2. Array iteration during render
3. Signal value retrieval
4. Proxy handler execution

### Optimization Strategies
1. Signal pooling for primitives
2. Batch updates within single tick
3. Lazy proxy creation
4. Subscription deduplication

### Benchmarking Targets
- 10,000 entities with 10 properties each
- 1,000 concurrent component subscriptions
- 60fps during rapid updates
- <16ms for full re-render
