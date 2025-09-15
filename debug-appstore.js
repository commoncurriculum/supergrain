// Quick debug script to test AppStore behavior
import { AppStore } from './packages/app-store/src/app-store.js'

console.log('Testing AppStore...')

const store = new AppStore()
console.log('Created AppStore')

const doc = store.findDoc('users', 1)
console.log('Called findDoc')
console.log('isPending:', doc.isPending)
console.log('content:', doc.content)
console.log('documentState result:', doc.documentState?.())
