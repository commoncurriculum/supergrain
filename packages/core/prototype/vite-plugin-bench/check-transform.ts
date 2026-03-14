/**
 * Quick script to see what the vite plugin transforms.
 */
import { supergrainModelPlugin } from '../vite-plugin'

const plugin = supergrainModelPlugin()

const sample = `
import { model, effect } from './model'

const Todo = model({ title: 'string' })
const [store, update] = Todo.create({ title: 'hi' })

// leaf read
console.log(store.title)

// nested read
console.log(store.assignee.name)

// reactive read
effect(() => {
  store.title
  store.assignee.name
})

// assignment
store.title = 'new'
`

const result = (plugin as any).transform(sample, 'test.ts')
if (result) {
  console.log('=== TRANSFORMED ===')
  console.log(result.code)
} else {
  console.log('No transformation applied')
}
