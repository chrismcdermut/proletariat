import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import noStubFunctions from './eslint-rules/no-stub-functions.mjs'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  {
    plugins: {
      'proletariat': {
        rules: {
          'no-stub-functions': noStubFunctions,
        },
      },
    },
    rules: {
      // ── Hard-remove policy (PRLT-1320) ────────────────────────────
      // Functions that only throw 'removed'/'deprecated' errors are soft stubs.
      // Delete the function entirely — the compiler catches missed callers.
      'proletariat/no-stub-functions': 'error',

      // ── Strict quality rules (errors) ─────────────────────────────
      // Empty catch blocks silently swallow errors — always log or rethrow
      'no-empty': ['error', {allowEmptyCatch: false}],
      // Dead code: unreachable statements after return/throw/break
      'no-unreachable': 'error',
      // Unused variables/imports — prefix with _ to acknowledge intentional disuse
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // ── Pre-existing violations downgraded to warnings ────────────
      'no-void': 'warn',
      'no-useless-return': 'warn',
      'no-eq-null': 'warn',
      'eqeqeq': 'warn',
      'prefer-const': 'warn',
      'n/no-unsupported-features/node-builtins': 'warn',
      'unicorn/no-useless-undefined': 'warn',
      'unicorn/no-useless-fallback-in-spread': 'warn',
      'unicorn/no-hex-escape': 'warn',
      'unicorn/prefer-native-coercion-functions': 'warn',
      'unicorn/consistent-existence-index-check': 'warn',
      'unicorn/escape-case': 'warn',
      'unicorn/prefer-default-parameters': 'warn',
      'unicorn/no-object-as-default-parameter': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',

      // ── Disable all perfectionist sorting rules ───────────────────
      'perfectionist/sort-classes': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-named-imports': 'off',
      'perfectionist/sort-objects': 'off',
      'perfectionist/sort-object-types': 'off',
      'perfectionist/sort-union-types': 'off',
      'perfectionist/sort-switch-case': 'off',
      'perfectionist/sort-named-exports': 'off',
      'perfectionist/sort-jsx-props': 'off',
      'perfectionist/sort-array-includes': 'off',
      'perfectionist/sort-exports': 'off',
      'perfectionist/sort-sets': 'off',
      'perfectionist/sort-intersection-types': 'off',

      // ── Relax stylistic rules ─────────────────────────────────────
      '@stylistic/lines-between-class-members': 'off',
      '@stylistic/padding-line-between-statements': 'off',
      'n/no-process-exit': 'off',

      // ── Unicorn rules ─────────────────────────────────────────────
      'unicorn/import-style': 'off',
      'unicorn/prefer-node-protocol': 'warn',
      'unicorn/prefer-optional-catch-binding': 'off',
      'unicorn/prefer-regexp-test': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      'unicorn/switch-case-braces': 'off',
      'unicorn/no-useless-switch-case': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/no-array-push-push': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/prefer-set-has': 'warn',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/prefer-array-flat-map': 'off',
      'unicorn/prefer-array-flat': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-code-point': 'off',
      'unicorn/prefer-switch': 'off',
      'unicorn/explicit-length-check': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-for-loop': 'off',
      'unicorn/prefer-string-slice': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/prefer-string-raw': 'off',
      'unicorn/no-useless-spread': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/prefer-structured-clone': 'off',
      'unicorn/prefer-logical-operator-over-ternary': 'off',
      'unicorn/prefer-export-from': 'off',
      'unicorn/prefer-array-some': 'off',
      'unicorn/no-lonely-if': 'off',

      // ── Other stylistic rules ─────────────────────────────────────
      'camelcase': 'off',
      'no-useless-escape': 'off',
      'object-shorthand': 'off',
      'no-template-curly-in-string': 'off',
      'no-implicit-coercion': 'off',
      'no-else-return': 'off',
      'radix': 'off',
      'no-warning-comments': 'off',
      'arrow-body-style': 'off',
      'dot-notation': 'off',
      'jsdoc/check-param-names': 'off',
      'no-lonely-if': 'off',
      'new-cap': 'off',
      'no-return-await': 'off',
      'no-promise-executor-return': 'off',
      'mocha/max-top-level-suites': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'complexity': 'off',
      'max-depth': 'off',
      'max-params': 'off',
      'no-await-in-loop': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-case-declarations': 'off',
      'prefer-destructuring': 'off',
      'unicorn/no-process-exit': 'off',
      'no-undef': 'off',
    },
  },
]
