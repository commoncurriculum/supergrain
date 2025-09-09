// Quick test to verify WeakMap optimization
import { createStore } from './packages/core/dist/index.js'

console.time('Create 1000 stores with nested objects')
for (let i = 0; i < 1000; i++) {
  const [store] = createStore({
    user: { 
      profile: { 
        settings: { 
          notifications: { email: true, sms: false } 
        } 
      } 
    },
    data: { items: [1, 2, 3] }
  })
  
  // Access nested properties to trigger node creation
  const _ = store.user.profile.settings.notifications.email
  const __ = store.data.items[0]
}
console.timeEnd('Create 1000 stores with nested objects')