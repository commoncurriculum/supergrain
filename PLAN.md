# Storable Implementation Plan

> **Note for AI Assistants:** Before committing any changes, please update this `PLAN.md` file by checking off the completed tasks (`- [x]`).
>
> **TDD Approach:** For each new feature, please commit tests _before_ implementing the feature itself.

## Overview

This document outlines the phased implementation plan for the Storable library - a reactive store with fine-grained reactivity powered by alien-signals.

## Phase 1: Core Foundation

### 1.1 Project Setup

- [x] Initialize monorepo with pnpm workspaces
- [x] Configure TypeScript for all packages
- [x] Set up build tooling (vite)
- [x] Configure testing framework (vitest)
- [x] Add alien-signals dependency

### 1.2 Basic Store Implementation

- [x] Create `ReactiveStore` class with collection management
- [x] Implement `collection(name)` method
- [x] Implement `set(type, id, data)` method
- [x] Implement `find(type, id)` method
- [x] Basic signal creation for entities

### 1.3 Proxy System

- [ ] Create proxy handler for automatic signal wrapping
- [ ] Implement property access tracking
- [ ] Implement property mutation handling
- [ ] Add proxy caching with WeakMap
- [ ] Handle nested object proxying

### 1.4 Object Handling

- [ ] Implement property addition/deletion tracking
- [ ] Add shape change signals for dynamic properties
- [ ] Handle Object.keys/values/entries enumeration
- [ ] Implement proper handling for Object.defineProperty
- [ ] Add support for getter/setter preservation
- [ ] Handle Symbol properties
- [ ] Implement spread operator warnings in dev mode
- [ ] Add for...in loop tracking

## Phase 2: Array Support

### 2.1 Array Signal Implementation

- [ ] Create `ArraySignal` class extending Array
- [ ] Implement index-level signals
- [ ] Add length signal tracking
- [ ] Add version signal for structural changes

### 2.2 Array Method Overrides

- [ ] Override `push`, `pop`, `shift`, `unshift`
- [ ] Override `splice` with signal remapping
- [ ] Override `sort` and `reverse`
- [ ] Implement iteration tracking for `map`, `filter`, `forEach`
- [ ] Add fine-grained array change notifications

### 2.3 Array Proxy Integration

- [ ] Integrate ArraySignal with main proxy system
- [ ] Handle numeric index access
- [ ] Track array method calls
- [ ] Optimize signal creation/cleanup

## Phase 3: React Adapter

### 3.1 Core React Hook

- [ ] Implement `useFind(store, type, id)` hook
- [ ] Add automatic effect cleanup
- [ ] Implement dependency tracking per component
- [ ] Handle component unmounting

### 3.2 Additional React Utilities

- [ ] Implement `useStore()` for multiple entities
- [ ] Add `useFindWhere()` for queries
- [ ] Add `useFindAll()` for collections
- [ ] Implement `batch()` for grouped updates

### 3.3 React Performance Optimizations

- [ ] Add React.memo integration
- [ ] Implement subscription deduplication
- [ ] Add development mode warnings
- [ ] Create React DevTools integration

## Phase 4: Vue Adapter

### 4.1 Core Vue Composable

- [ ] Implement `useFind()` composable
- [ ] Bridge alien-signals with Vue reactivity
- [ ] Handle Vue lifecycle integration
- [ ] Add TypeScript support

### 4.2 Vue-Specific Features

- [ ] Add template ref support
- [ ] Implement computed property integration
- [ ] Add watch/watchEffect compatibility
- [ ] Handle Vue 3 suspense

### 4.3 Vue Performance

- [ ] Optimize reactive conversions
- [ ] Add shallowRef optimizations
- [ ] Implement Vue
      DevTools integration

## Success Metrics

### Performance Goals

- Sub-millisecond updates for single property changes
- Linear performance scaling with number of entities
- Memory usage proportional to active subscriptions
- Zero memory leaks in long-running applications

### Developer Experience Goals

- Full TypeScript inference
- Intuitive API

### Technical Goals

- 100% test coverage for core
- Compatible with all major bundlers
- Tree-shakeable exports

## Risk Mitigation

### Technical Risks

1. **Proxy Performance**: Benchmark early and often
2. **Memory Leaks**: Implement aggressive cleanup testing
3. **Framework Integration**: Test with real-world applications
4. **Browser Compatibility**: Test on older browsers

### Adoption Risks

1. **Learning Curve**: Focus on familiar patterns
2. **Migration Cost**: Provide automated codemods
3. **Performance Concerns**: Publish benchmarks early
4. **Documentation**: Invest heavily in examples

## Implementation Summary

This plan can be adjusted based on feedback and priorities. The key is to maintain a working, shippable state after each phase.
