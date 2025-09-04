import { DocumentStore } from './dist/index.mjs'

console.log('Testing null document handling...')

const store = new DocumentStore()

console.log('1. Getting signal for non-existent document...')
const signal = store.getDocumentSignal('userTodoList', 'non-existent')
console.log('2. Signal value:', signal.value)

console.log('3. Setting document to null...')
signal.value = null
console.log('4. After setting to null, signal value:', signal.value)

console.log('5. Setting document to actual data...')
const testDoc = {
  id: 'test',
  name: 'Test Document'
}
signal.value = testDoc
console.log('6. After setting data, signal value:', signal.value)
