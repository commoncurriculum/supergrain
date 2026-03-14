import type { Rule } from 'eslint'

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require useTracked() in components that use readSignal()',
    },
    messages: {
      missingUseTracked:
        'This component uses readSignal() but does not call useTracked(). ' +
        'Add useTracked() to set up reactive tracking for compiled store reads.',
    },
    schema: [],
  },
  create(context) {
    // Track function scopes
    const functionStack: { hasReadSignal: boolean; hasUseTracked: boolean; node: Rule.Node }[] = []

    function enterFunction(node: Rule.Node) {
      functionStack.push({ hasReadSignal: false, hasUseTracked: false, node })
    }

    function exitFunction() {
      const scope = functionStack.pop()
      if (!scope) return

      // Check if any ancestor scope has useTracked
      const ancestorHasUseTracked = functionStack.some((s) => s.hasUseTracked)

      if (scope.hasReadSignal && !scope.hasUseTracked && !ancestorHasUseTracked) {
        context.report({
          node: scope.node,
          messageId: 'missingUseTracked',
        })
      }

      // Propagate readSignal flag to parent so it knows about nested usage
      if (scope.hasReadSignal && functionStack.length > 0) {
        functionStack[functionStack.length - 1]!.hasReadSignal = true
      }
    }

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      'FunctionExpression:exit': exitFunction,
      'ArrowFunctionExpression:exit': exitFunction,

      CallExpression(node) {
        if (functionStack.length === 0) return
        const current = functionStack[functionStack.length - 1]!

        // Check for readSignal() calls
        if (node.callee.type === 'Identifier' && node.callee.name === 'readSignal') {
          current.hasReadSignal = true
        }
        // Check for useTracked() calls
        if (node.callee.type === 'Identifier' && node.callee.name === 'useTracked') {
          current.hasUseTracked = true
        }
      },
    }
  },
}

export default rule
