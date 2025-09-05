# Storable Usage Guide

A reactive store library with fine-grained reactivity powered by alien-signals.

## Basic Setup

```typescript
import { createStore } from '@storable/core';
import { useFind, useStore } from '@storable/react';
// or
import { useFind, useStore } from '@storable/vue';

// Create a store instance
const store = createStore();

// Define collections
store.collection('posts');
store.collection('users');
store.collection('comments');
```

## Adding Data

```typescript
// Add a single entity
store.set('posts', '1', {
  id: '1',
  title: 'Hello World',
  content: 'This is my first post',
  tags: ['introduction', 'hello'],
  author: {
    id: 'user-1',
    name: 'Scott'
  },
  publishedAt: '2024-01-01'
});

// Add multiple entities
store.setMany('users', [
  { id: 'user-1', name: 'Scott', email: 'scott@example.com' },
  { id: 'user-2', name: 'Alice', email: 'alice@example.com' }
]);
```

## React Usage

### Finding Single Entities

```typescript
function PostView({ postId }: { postId: string }) {
  const post = useFind(store, 'posts', postId);

  if (!post) return <div>Post not found</div>;

  // Component only re-renders when accessed properties change
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
      <AuthorInfo author={post.author} />
      <TagList tags={post.tags} />
    </article>
  );
}

// This component has its own fine-grained subscriptions
function AuthorInfo({ author }: { author: { id: string; name: string } }) {
  // Only re-renders when author.name changes
  return <div>By {author.name}</div>;
}

function TagList({ tags }: { tags: string[] }) {
  // Only re-renders when tags array changes
  return (
    <ul>
      {tags.map((tag, i) => (
        <li key={i}>{tag}</li>
      ))}
    </ul>
  );
}
```


### Direct Mutations

```typescript
function PostEditor({ postId }: { postId: string }) {
  const post = useFind(store, 'posts', postId);

  if (!post) return null;

  // Direct property mutation
  const updateTitle = (newTitle: string) => {
    post.title = newTitle; // ✓ This works!
  };

  // Array mutations
  const addTag = (tag: string) => {
    post.tags.push(tag); // ✓ This works!
  };

  const removeTag = (index: number) => {
    post.tags.splice(index, 1); // ✓ This works!
  };

  // Nested object mutations
  const updateAuthorName = (name: string) => {
    post.author.name = name; // ✓ This works!
  };

  return (
    <div>
      <input
        value={post.title}
        onChange={(e) => updateTitle(e.target.value)}
      />
      {/* ... */}
    </div>
  );
}
```

## Vue Usage

### Composition API

```vue
<script setup lang="ts">
import { useFind } from '@storable/vue';

const props = defineProps<{ postId: string }>();
const post = useFind(store, 'posts', props.postId);

// Direct mutations work in Vue too!
const addTag = (tag: string) => {
  post.value?.tags.push(tag);
};
</script>

<template>
  <article v-if="post">
    <h1>{{ post.title }}</h1>
    <p>{{ post.content }}</p>
    <ul>
      <li v-for="(tag, i) in post.tags" :key="i">
        {{ tag }}
      </li>
    </ul>
  </article>
</template>
```

## Advanced Patterns

### Computed Values

```typescript
function PostStats({ postId }: { postId: string }) {
  const post = useFind(store, 'posts', postId);

  // This computation only runs when tags change
  const tagCount = computed(() => post?.tags.length ?? 0);

  return <div>Tags: {tagCount.value}</div>;
}
```

### Queries and Filtering

```typescript
function ActivePosts() {
  const { findWhere } = useStore(store);

  // Find all published posts
  const activePosts = findWhere('posts', post =>
    post.status === 'published' &&
    new Date(post.publishedAt) <= new Date()
  );

  return (
    <div>
      {activePosts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
```

### Relationships

```typescript
function PostWithComments({ postId }: { postId: string }) {
  const post = useFind(store, 'posts', postId);
  const { findWhere } = useStore(store);

  // Find related comments
  const comments = findWhere('comments', c => c.postId === postId);

  return (
    <article>
      <h1>{post?.title}</h1>
      <CommentList comments={comments} />
    </article>
  );
}
```


### TypeScript Support

```typescript
// Define your entity types
interface Post {
  id: string;
  title: string;
  content: string;
  tags: string[];
  author: {
    id: string;
    name: string;
  };
  status: 'draft' | 'published' | 'archived';
  publishedAt?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

// Create typed store
const store = createStore<{
  posts: Post;
  users: User;
}>();

// Full type safety
const post = useFind<Post>(store, 'posts', '1');
if (post) {
  post.title = 'New Title'; // ✓ Type-safe
  post.status = 'published'; // ✓ Type-safe
  post.invalid = 'value'; // ✗ TypeScript error
}
```

## Performance Tips

1. **Component Splitting**: Split components by the data they access for finest granularity
   ```typescript
   // ❌ Less optimal - entire component re-renders on any change
   function Post({ id }) {
     const post = useFind(store, 'posts', id);
     return (
       <div>
         <h1>{post.title}</h1>
         <p>{post.content}</p>
         <ul>{post.tags.map(tag => <li>{tag}</li>)}</ul>
       </div>
     );
   }

   // ✓ Better - components re-render independently
   function Post({ id }) {
     const post = useFind(store, 'posts', id);
     return (
       <div>
         <PostTitle title={post.title} />
         <PostContent content={post.content} />
         <PostTags tags={post.tags} />
       </div>
     );
   }
   ```

2. **Avoid Spreading**: Don't spread objects as it accesses all properties
   ```typescript
   // ❌ Subscribes to all post properties
   <PostComponent {...post} />

   // ✓ Only subscribes to used properties
   <PostComponent post={post} />
   ```

3. **Use Specific Finds**: Access only the data you need
   ```typescript
   // ❌ Loads entire collection
   const posts = findAll('posts');
   const published = posts.filter(p => p.status === 'published');

   // ✓ Only loads matching entities
   const published = findWhere('posts', p => p.status === 'published');
   ```
