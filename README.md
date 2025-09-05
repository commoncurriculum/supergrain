# Storable

A reactive store library with fine-grained reactivity powered by alien-signals. Transparently put objects into a store, mutate them naturally, and have your UI automatically update with surgical precision.

## AI Agent Instructions

When working on this codebase, please refer to the following documentation files in order:

### 1. Read USAGE.md First

This file contains comprehensive examples of how the library is intended to be used. Study the usage patterns, API design, and expected behaviors before implementing any features.

### 2. Follow PLAN.md for Implementation

This file outlines the phased implementation approach. Each phase builds on the previous one. Do not skip ahead - implement features in the order specified to ensure a stable foundation.

### 3. Consult NOTES.md for Architecture Decisions

This file contains important architectural insights, design rationale, and critical warnings about potential pitfalls. Pay special attention to:

- The "Unknowns" section for areas requiring investigation
- The "Things to Watch For" section to avoid common mistakes
- Performance considerations for optimization decisions

### 4. Review BENCHMARKS.md for Performance Testing

This file outlines how to measure performance and what to compare against. It includes step-by-step instructions on how to run the benchmarks. It also includes:

- Key metrics to track (proxy creation, mutations, memory usage)
- Comparison targets (MobX, Valtio, Zustand, native React/Vue)
- Benchmark scenarios and anti-patterns to test

## Key Principles

1. **Fine-Grained Reactivity**: Only components using changed data should re-render
2. **Natural Mutations**: Direct property assignment (`post.title = 'New'`) should just work
3. **No Configuration**: Zero boilerplate, no schema definitions required
4. **Type Safety**: Full TypeScript support with inference
5. **Framework Agnostic**: Core works everywhere, with React and Vue adapters

## Project Structure

```
storable/
├── packages/
│   ├── core/           # Core store implementation
│   ├── react/          # React adapter with hooks
│   └── vue/            # Vue adapter with composables
├── examples/           # Demo applications
├── USAGE.md           # How to use the library
├── PLAN.md            # Implementation roadmap
├── NOTES.md           # Architecture notes
└── README.md          # This file
```

## Core Concepts

### Collections

Data is organized into collections (e.g., 'posts', 'users') with entities indexed by ID.

### Transparent Proxies

JavaScript Proxies automatically wrap objects to track property access and enable reactivity.

### Alien Signals

The underlying signal library provides efficient, fine-grained change detection.

### Natural Mutations

Mutate data directly without special syntax:

- `post.title = 'New Title'`
- `post.tags.push('new-tag')`
- `delete post.draft`

## Implementation Guidelines

1. **Start Small**: Implement core functionality before optimizations
2. **Test Everything**: Each feature needs comprehensive tests
3. **Maintain Type Safety**: Use TypeScript's type system effectively
4. **Consider Performance**: But don't optimize prematurely
5. **Document Decisions**: Update NOTES.md with important findings

## Development Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Start development
npm run dev
```

## When Adding Features

1. Check if it's in the current phase of PLAN.md
2. Review USAGE.md to understand expected behavior
3. Consult NOTES.md for architectural constraints
4. Write tests first
5. Implement the feature
6. Update documentation if needed
7. Ensure all tests pass

## Common Pitfalls to Avoid

- Don't create new arrays for mutations (defeats fine-grained reactivity)
- Don't forget to clean up signals when entities are deleted
- Don't access all properties unnecessarily (e.g., spreading)
- Don't ignore TypeScript errors - they often indicate real issues
- Don't skip the planning phase - architecture decisions matter

## Questions to Ask

Before implementing a feature, consider:

- How does this affect performance at scale?
- What happens with circular references?
- Is the API intuitive without documentation?
- Does it maintain fine-grained reactivity?
- Will it work in both React and Vue?

Remember: The goal is transparent reactivity with zero boilerplate. If a solution requires configuration or special syntax, reconsider the approach.
