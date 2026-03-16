import type { Rule } from 'eslint'

// readSignal() has been removed from the public API. This rule previously
// enforced that components calling readSignal() also called useTracked().
// It is kept as a no-op placeholder so existing ESLint configs that reference
// @supergrain/require-use-tracked don't break. It will be repurposed for
// $$() / useDirectBindings patterns in a future release.
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Formerly required useTracked() alongside readSignal(). Now a no-op (readSignal was removed).',
    },
    messages: {},
    schema: [],
  },
  create() {
    return {}
  },
}

export default rule
