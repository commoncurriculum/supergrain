import { createGrain } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { update } from "@supergrain/mill";

// Create a store with separate properties for different component levels
const store = createGrain({
  grandparent: {
    value: 1,
    label: "Grandparent",
  },
  parent: {
    value: 10,
    label: "Parent",
  },
  child: {
    value: 100,
    label: "Child",
  },
  shared: {
    theme: "light",
    fontSize: 14,
  },
});

// Track render counts for demonstration
let grandparentRenders = 0;
let parentRenders = 0;
let childRenders = 0;

// Child component - only tracks child.value
const Child = tracked(() => {
  childRenders++;

  return (
    <div
      style={{
        padding: "10px",
        margin: "10px",
        border: "1px solid blue",
        borderRadius: "4px",
      }}
    >
      <h3>Child Component</h3>
      <p>Value: {store.child.value}</p>
      <p>Render count: {childRenders}</p>
      <button onClick={() => update(store, { $set: { "child.value": store.child.value + 1 } })}>
        Increment Child
      </button>
    </div>
  );
});

// Parent component - tracks parent.value and renders Child
const Parent = tracked(() => {
  parentRenders++;

  return (
    <div
      style={{
        padding: "10px",
        margin: "10px",
        border: "1px solid green",
        borderRadius: "4px",
      }}
    >
      <h2>Parent Component</h2>
      <p>Value: {store.parent.value}</p>
      <p>Render count: {parentRenders}</p>
      <button onClick={() => update(store, { $set: { "parent.value": store.parent.value + 10 } })}>
        Increment Parent
      </button>
      <Child />
    </div>
  );
});

// Grandparent component - tracks grandparent.value and renders Parent
const GrandParent = tracked(() => {
  grandparentRenders++;

  return (
    <div
      style={{
        padding: "10px",
        margin: "10px",
        border: "1px solid red",
        borderRadius: "4px",
      }}
    >
      <h1>Grandparent Component</h1>
      <p>Value: {store.grandparent.value}</p>
      <p>Render count: {grandparentRenders}</p>
      <p>Theme: {store.shared.theme}</p>
      <button
        onClick={() =>
          update(store, {
            $set: { "grandparent.value": store.grandparent.value + 100 },
          })
        }
      >
        Increment Grandparent
      </button>
      <button
        onClick={() => {
          const newTheme = store.shared.theme === "light" ? "dark" : "light";
          update(store, { $set: { "shared.theme": newTheme } });
        }}
      >
        Toggle Theme (affects only Grandparent)
      </button>
      <Parent />
    </div>
  );
});

// Sibling components example - demonstrating independent tracking
const SiblingA = tracked(() => {
  return (
    <div
      style={{
        padding: "10px",
        border: "1px solid purple",
        borderRadius: "4px",
      }}
    >
      <h3>Sibling A</h3>
      <p>Parent Value: {store.parent.value}</p>
    </div>
  );
});

const SiblingB = tracked(() => {
  return (
    <div
      style={{
        padding: "10px",
        border: "1px solid orange",
        borderRadius: "4px",
      }}
    >
      <h3>Sibling B</h3>
      <p>Child Value: {store.child.value}</p>
    </div>
  );
});

function SiblingContainer() {
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        margin: "10px",
        padding: "10px",
        border: "1px solid gray",
        borderRadius: "4px",
      }}
    >
      <SiblingA />
      <SiblingB />
    </div>
  );
}

// Main App component
export function NestedComponentsExample() {
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "20px" }}>
      <h1>Nested Components with Isolated Tracking</h1>

      <div
        style={{
          marginBottom: "20px",
          padding: "10px",
          background: "#f0f0f0",
          borderRadius: "4px",
        }}
      >
        <h3>Instructions:</h3>
        <ul>
          <li>Click buttons to update different properties</li>
          <li>Notice that only components tracking the changed property re-render</li>
          <li>Child updates don't cause parent re-renders</li>
          <li>Parent updates cause child re-renders (due to React's component tree)</li>
          <li>Theme toggle only affects Grandparent (the only component accessing it)</li>
        </ul>
      </div>

      <GrandParent />

      <h2>Sibling Components (Independent Tracking)</h2>
      <SiblingContainer />

      <div
        style={{
          marginTop: "20px",
          padding: "10px",
          background: "#e0e0e0",
          borderRadius: "4px",
        }}
      >
        <h3>Global Actions:</h3>
        <button
          onClick={() => {
            // Reset all values
            update(store, {
              $set: {
                "grandparent.value": 1,
                "parent.value": 10,
                "child.value": 100,
                "shared.theme": "light",
              },
            });
            grandparentRenders = 0;
            parentRenders = 0;
            childRenders = 0;
          }}
        >
          Reset All Values and Counters
        </button>
      </div>
    </div>
  );
}

// Export a standalone app for testing
export default function App() {
  return <NestedComponentsExample />;
}
