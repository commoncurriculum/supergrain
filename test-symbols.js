const { createStore, $NODE, $VERSION } = require('./packages/core/dist/index.cjs.js');

const [store, update] = createStore({
  count: 0,
  items: [
    { id: 1, value: 10 },
    { id: 2, value: 20 }
  ]
});

console.log('=== EXPLORING SYMBOL COMPARISON ===\n');

console.log('Initial state:');
console.log('Has $NODE:', $NODE in store);
console.log('Has $VERSION:', $VERSION in store);
console.log('Version:', store[$VERSION]);

// Access the nodes (signals)
const nodes = store[$NODE];
console.log('\nNodes object:', typeof nodes);
console.log('Count node:', typeof nodes?.count);

// Get the signal for count
const countSignal = nodes?.count;
if (countSignal) {
  console.log('Count signal value:', countSignal());
  console.log('Count signal type:', typeof countSignal);
  console.log('Count signal reference:', countSignal);
}

// Store references for comparison
const initialVersion = store[$VERSION];
const initialCountSignal = nodes?.count;
const initialCountValue = countSignal?.();

// Get item signal
const firstItem = store.items[0];
const firstItemNodes = firstItem[$NODE];
const firstItemVersion = firstItem[$VERSION];
console.log('\nFirst item version:', firstItemVersion);
console.log('First item nodes:', typeof firstItemNodes);

// Store item references
const initialItemVersion = firstItem[$VERSION];
const itemValueSignal = firstItemNodes?.value;
const initialItemValue = itemValueSignal?.();

console.log('\n=== UPDATING COUNT ===');
update({ $set: { count: 1 } });

console.log('After update:');
console.log('Version changed?', store[$VERSION] !== initialVersion);
console.log('Count signal same reference?', nodes?.count === initialCountSignal);
console.log('Count value changed?', countSignal?.() !== initialCountValue);

console.log('\n=== UPDATING NESTED ITEM ===');
update({ $set: { 'items.0.value': 15 } });

console.log('After nested update:');
console.log('Store version changed?', store[$VERSION] !== initialVersion);
console.log('Item version changed?', firstItem[$VERSION] !== initialItemVersion);
console.log('Item value signal same reference?', firstItemNodes?.value === itemValueSignal);
console.log('Item value changed?', itemValueSignal?.() !== initialItemValue);

console.log('\n=== COMPARISON STRATEGIES ===');
console.log('1. Version comparison: Compare $VERSION values');
console.log('   - Pros: Simple number comparison');
console.log('   - Cons: Requires version tracking');

console.log('\n2. Signal value comparison: Compare signal() values');
console.log('   - Pros: Direct value comparison');
console.log('   - Cons: Need to track which signals to compare');

console.log('\n3. Signal reference comparison: Compare signal references');
console.log('   - Result: References appear to be stable (don\'t change)');

// Test what happens with completely new object
console.log('\n=== REPLACING ENTIRE ITEM ===');
const item0VersionBefore = store.items[0][$VERSION];
update({ $set: { 'items.0': { id: 1, value: 100 } } });
const item0VersionAfter = store.items[0][$VERSION];

console.log('Item version before:', item0VersionBefore);
console.log('Item version after:', item0VersionAfter);
console.log('Same item proxy?', store.items[0] === firstItem);

console.log('\n=== CONCLUSION ===');
console.log('The $VERSION symbol provides a simple way to detect changes.');
console.log('Signal references are stable, so we cannot use reference comparison.');
console.log('We could compare signal values, but that would require calling every signal.');
console.log('Version tracking seems to be the most efficient approach.');
