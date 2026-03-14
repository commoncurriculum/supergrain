// Simulates what user code would look like after createStore returns Branded<T>

declare const $BRAND: unique symbol

type Branded<T> =
  T extends Array<infer U>
    ? Array<Branded<U>>
    : T extends object
      ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]: true }
      : T

declare function createStore<T extends object>(data: T): [Branded<T>, (ops: any) => void]

// --- User code ---

interface Todo {
  title: string
  completed: boolean
  assignee: { name: string; avatar: string }
  tags: string[]
}

const [store, update] = createStore<Todo>({
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
})

// These should be detected as branded reads:
const a = store.title
const b = store.assignee.name
const c = store.assignee

// This should NOT be detected (plain object):
const plain = { name: 'hello' }
const d = plain.name

// Dynamic access — should NOT be detected:
const key = 'title' as string
const e = (store as any)[key]
