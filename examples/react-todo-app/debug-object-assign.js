// Test what happens when we do Object.assign like DocumentStore does
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing Object.assign behavior with deep signals...')

const document = {
  id: 'test',
  todos: ['item1', 'item2']
}

// Create signal like DocumentStore does initially
const initialValue = {}
const deepSig = deepSignal(initialValue)
console.log('1. Created empty deep signal:', deepSig)

// Try to watch the empty signal
try {
  let watchCount = 0
  const unwatch = watch(deepSig, (value) => {
    watchCount++
    console.log(`2.${watchCount}. Watch triggered! Value:`, value)
  }, {
    deep: true,
    immediate: true
  })

  setTimeout(() => {
    console.log('3. Doing Object.assign like DocumentStore.setDocument does...')

    // This is what DocumentStore.setDocument does
    Object.keys(deepSig).forEach(k => {
      if (k !== '_isEmpty') delete deepSig[k]
    })
    Object.assign(deepSig, document)
    delete deepSig._isEmpty

    console.log('4. After Object.assign:', deepSig)

    setTimeout(() => {
      console.log('5. Trying to modify signal...')
      deepSig.todos.push('item3')

      setTimeout(() => {
        console.log('6. Final todos:', deepSig.todos.length)
        console.log('7. Watch called', watchCount, 'times')
        unwatch()
      }, 100)
    }, 100)
  }, 100)

} catch (error) {
  console.error('Error:', error)
}
