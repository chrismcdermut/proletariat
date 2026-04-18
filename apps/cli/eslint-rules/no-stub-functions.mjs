/**
 * ESLint rule: no-stub-functions
 *
 * Detects "soft stub" anti-pattern — functions whose body only throws an error
 * or delegates to a dead-method helper. These stubs hide removal from the
 * compiler and defer failures to runtime.
 *
 * Policy: when removing code, delete it entirely. The TypeScript compiler
 * will catch every caller at build time, which is cheaper and faster than
 * discovering runtime explosions in production.
 *
 * @see PRLT-1320
 */

/** Keywords that indicate a throw-only function is a removal stub, not a legitimate assertion. */
const STUB_KEYWORDS = [
  'removed',
  'deprecated',
  'not implemented',
  'stub',
  'deleted',
  'no longer',
  'dead',
  'obsolete',
]

const STUB_PATTERN = new RegExp(STUB_KEYWORDS.join('|'), 'i')

/** Method names that are dead-method helpers (delegate to a throw). */
const DEAD_METHOD_NAMES = /\b(deadMethod|throwRemoved|throwDeprecated|throwStub)\b/

/**
 * Extract a string literal value from an AST node, handling concatenation
 * and template literals shallowly.
 */
function extractStringContent(node) {
  if (!node) return ''
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((q) => q.value.raw).join('')
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return extractStringContent(node.left) + extractStringContent(node.right)
  }
  return ''
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow soft-stub functions that only throw removal/deprecation errors',
      recommended: true,
    },
    messages: {
      throwOnlyStub:
        'Function body only throws a removal/deprecation error. ' +
        'Delete the function entirely — the compiler will catch missed callers. ' +
        'See docs/patterns.md "Hard Remove Policy".',
      deadMethodCall:
        'Function body only delegates to a dead-method helper. ' +
        'Delete the function entirely — the compiler will catch missed callers. ' +
        'See docs/patterns.md "Hard Remove Policy".',
    },
    schema: [],
  },

  create(context) {
    /**
     * Check if a function body is a single throw statement with stub keywords.
     */
    function checkForThrowOnlyStub(body, node) {
      if (!body || body.type !== 'BlockStatement') return
      const statements = body.body.filter((s) => s.type !== 'EmptyStatement')
      if (statements.length !== 1) return

      const stmt = statements[0]

      // Pattern 1: throw new Error('...removed...')
      if (stmt.type === 'ThrowStatement') {
        const arg = stmt.argument
        let message = ''
        if (arg && arg.type === 'NewExpression' && arg.arguments.length > 0) {
          message = extractStringContent(arg.arguments[0])
        } else if (arg) {
          message = extractStringContent(arg)
        }
        if (STUB_PATTERN.test(message)) {
          context.report({ node, messageId: 'throwOnlyStub' })
        }
        return
      }

      // Pattern 2: this.deadMethod('name') or deadMethod('name')
      if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression') {
        const callee = stmt.expression.callee
        let methodName = ''
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          methodName = callee.property.name
        } else if (callee.type === 'Identifier') {
          methodName = callee.name
        }
        if (DEAD_METHOD_NAMES.test(methodName)) {
          context.report({ node, messageId: 'deadMethodCall' })
        }
      }
    }

    return {
      FunctionDeclaration(node) {
        checkForThrowOnlyStub(node.body, node)
      },
      FunctionExpression(node) {
        checkForThrowOnlyStub(node.body, node)
      },
      ArrowFunctionExpression(node) {
        if (node.body && node.body.type === 'BlockStatement') {
          checkForThrowOnlyStub(node.body, node)
        }
      },
      // Class methods: the function is node.value
      MethodDefinition(node) {
        if (node.value) {
          checkForThrowOnlyStub(node.value.body, node)
        }
      },
    }
  },
}

export default rule
