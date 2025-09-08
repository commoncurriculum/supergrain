# Solid.js Store Architecture

Solid.js's store is a powerful and performant state management solution. It achieves its impressive results through a combination of fine-grained reactivity, a compiled approach, and the use of proxies.

## Core Principles

*   **Fine-Grained Reactivity:** Solid's reactivity is built on a system of signals, effects, and memos. This allows for very precise updates. When a piece of state changes, only the specific parts of the UI that depend on that state are re-rendered. This is in contrast to virtual DOM-based libraries, which often re-render entire components.
*   **Compiled Approach:** Solid is a compiled library. It compiles its JSX-like templates into highly optimized JavaScript code. This compilation step allows Solid to create a direct mapping between state and the DOM, eliminating the need for a virtual DOM and its associated overhead.
*   **Proxies for State:** Solid's store uses proxies to track changes to state. When you access or modify a property on a store object, the proxy intercepts the operation and notifies any subscribers (effects) that depend on that property.

## Key Implementation Details

*   **`createSignal`:** This is the fundamental building block of Solid's reactivity. It creates a pair of functions: a getter and a setter. The getter returns the current value of the signal, and the setter updates the value.
*   **`createEffect`:** This function creates a computation that runs whenever one of its dependencies changes. For example, you can use `createEffect` to update the DOM whenever a signal's value changes.
*   **`createStore`:** This function creates a reactive store object. It takes an initial state object and returns a proxy-wrapped version of that object.
*   **`produce`:** Solid's store uses a `produce` function (similar to Immer) to enable immutable updates to state. This makes it easier to reason about state changes and avoids common pitfalls of mutable state.

## How it All Comes Together

When you create a Solid store, you're essentially creating a tree of signals. Each property in the store is a signal. When you update a property, you're calling the setter for that signal. This triggers any effects that depend on that signal, which in turn updates the DOM.

The compiled nature of Solid is what makes this so efficient. The compiler knows exactly which parts of the DOM need to be updated when a particular signal changes. This allows Solid to bypass the virtual DOM and update the DOM directly, resulting in significant performance gains.
