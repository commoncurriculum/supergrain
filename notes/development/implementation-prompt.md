# MongoDB Update Operators Implementation Task

You are working on a reactive store library called Storable that uses JavaScript Proxies and signals for fine-grained reactivity. Your task is to implement MongoDB-style update operators that work with the existing reactive system.

## Context

The Storable library currently has:
- A `createStore()` function that creates reactive proxies for objects
- Fine-grained reactivity using signals from the 'alien-signals' library
- Batching support via `startBatch()` and `endBatch()` functions
- TypeScript support

## Your Task

Implement MongoDB-style update operators as specified in the `MONGODB_UPDATE_OPERATORS.md` file. This file contains:
1. A detailed implementation checklist at the top - update it as you complete tasks
2. Complete specifications for each operator
3. Code examples and architecture details
4. Integration patterns with the existing store

## Key Requirements

1. **Create a new file**: `packages/core/src/operators.ts`
2. **Import existing functions**: Use `startBatch` and `endBatch` from `./store`
3. **Maintain reactivity**: All mutations must go through the proxy to trigger signals
4. **Support dot notation**: Handle paths like `'author.name'` and `'tags.0'`
5. **No external dependencies**: Use only vanilla JavaScript/TypeScript

## Implementation Order

1. Start by reading `MONGODB_UPDATE_OPERATORS.md` completely
2. Create the operators file with basic structure
3. Implement path resolution utilities first
4. Then implement operators in this order: `$set`, `$unset`, `$inc`, `$push`, `$pull`
5. Write tests for each operator
6. Update the checklist in the markdown file as you progress

## Example Usage

The final API should work like this:

```typescript
import { update } from '@storable/core'

const post = store.get('posts').get('1')
update(post, {
  $set: { title: 'New Title' },
  $inc: { viewCount: 1 },
  $push: { tags: 'featured' }
})
```

## Important Notes

- All update operations must be wrapped in `startBatch()` and `endBatch()` for performance
- The `update()` function should work with ANY reactive object from createStore
- Don't modify the proxy implementation - work with the existing reactive system
- Follow the exact TypeScript interfaces specified in the documentation

Begin by reviewing the existing code structure and the MONGODB_UPDATE_OPERATORS.md file, then start implementing the operators module.
