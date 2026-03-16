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
  it('is a no-op (readSignal was removed)', () => {
    ruleTester.run('require-use-tracked', rule, {
      valid: [
        // Previously invalid, now passes because the rule is a no-op
        {
          code: `
            function TodoItem({ item }) {
              const title = readSignal(item, 'title')()
              return title
            }
          `,
        },
        // Normal component — always valid
        {
          code: `
            function PlainComponent() {
              return 'hello'
            }
          `,
        },
      ],
      invalid: [],
    })
  })
})
