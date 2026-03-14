import { describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import rule from '../src/rules/require-use-tracked'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

describe('require-use-tracked', () => {
  it('passes valid and catches invalid cases', () => {
    ruleTester.run('require-use-tracked', rule, {
      valid: [
        // Has useTracked before readSignal — OK
        {
          code: `
            function TodoItem({ item }) {
              item = useTracked(item)
              const title = readSignal(item, 'title')()
              return title
            }
          `,
        },
        // No readSignal — OK (not a compiled component)
        {
          code: `
            function PlainComponent() {
              return 'hello'
            }
          `,
        },
        // readSignal in a non-component helper is fine if useTracked is present
        {
          code: `
            function useCustomHook(store) {
              const tracked = useTracked(store)
              return readSignal(tracked, 'count')()
            }
          `,
        },
        // Arrow function with useTracked
        {
          code: `
            const TodoItem = ({ item }) => {
              item = useTracked(item)
              return readSignal(item, 'title')()
            }
          `,
        },
      ],
      invalid: [
        // readSignal without useTracked — ERROR
        {
          code: `
            function TodoItem({ item }) {
              const title = readSignal(item, 'title')()
              return title
            }
          `,
          errors: [{ messageId: 'missingUseTracked' }],
        },
        // Arrow function missing useTracked
        {
          code: `
            const TodoItem = ({ item }) => {
              return readSignal(item, 'title')()
            }
          `,
          errors: [{ messageId: 'missingUseTracked' }],
        },
        // Multiple readSignal calls, no useTracked
        {
          code: `
            function TodoItem({ item }) {
              const title = readSignal(item, 'title')()
              const done = readSignal(item, 'completed')()
              return title
            }
          `,
          errors: [{ messageId: 'missingUseTracked' }],
        },
      ],
    })
  })
})
