# Comparison

The same operations in other React state libraries:

## Supergrain

```typescript
// [#DOC_TEST_52](packages/doc-tests/tests/readme-core.test.ts)

interface State { count: number; user: { profile: { name: string } } }
const store = createReactive<State>({ count: 0, user: { profile: { name: 'John' } } })

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — only re-renders when count changes
const Counter = tracked(() => {
  return <p>{store.count}</p>
})
```

## useState

```typescript
// [#DOC_TEST_53](packages/doc-tests/tests/readme-core.test.ts)

const [state, setState] = useState<State>({
  count: 0,
  user: { profile: { name: "John" } },
});

// Mutate
setState((prev) => ({ ...prev, count: 5 }));

// Deep nested
setState((prev) => ({
  ...prev,
  user: { ...prev.user, profile: { ...prev.user.profile, name: "Bob" } },
}));

// Fine-grained — ❌ not possible. Re-renders on ANY state change.
```

## Zustand

```typescript
// [#DOC_TEST_54](packages/doc-tests/tests/readme-core.test.ts)

const useStore = create<State>()((set) => ({
  count: 0,
  user: { profile: { name: 'John' } },
}))

// Mutate
set({ count: 5 })

// Deep nested — manual spreading
set(state => ({
  user: { ...state.user, profile: { ...state.user.profile, name: 'Bob' } }
}))

// Fine-grained — requires selector
const Counter = () => {
  const count = useStore(state => state.count)
  return <p>{count}</p>
}
```

## Redux / RTK

```typescript
// [#DOC_TEST_55](packages/doc-tests/tests/readme-core.test.ts)

const slice = createSlice({
  name: 'app',
  initialState: { count: 0, user: { profile: { name: 'John' } } } as State,
  reducers: {
    setCount: (state, action) => { state.count = action.payload },
    setName: (state, action) => { state.user.profile.name = action.payload },
  },
})

// Mutate — need a reducer for each mutation
dispatch(setCount(5))

// Deep nested — need a reducer for each path
dispatch(setName('Bob'))

// Fine-grained — requires useSelector
const Counter = () => {
  const count = useSelector((state: RootState) => state.app.count)
  return <p>{count}</p>
}
```

## MobX

```typescript
// [#DOC_TEST_56](packages/doc-tests/tests/readme-core.test.ts)

class AppStore {
  count = 0
  user = { profile: { name: 'John' } }
  constructor() { makeAutoObservable(this) }
}
const store = new AppStore()

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — requires observer + makeAutoObservable ceremony
const Counter = observer(() => {
  return <p>{store.count}</p>
})
```
