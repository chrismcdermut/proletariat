import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  {
    rules: {
      // Disable all perfectionist sorting rules
      // These slow down development without catching real issues
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

      // Relax stylistic rules that conflict with common patterns
      '@stylistic/lines-between-class-members': 'off',
      '@stylistic/padding-line-between-statements': 'off',

      // Allow process.exit in CLI entry points
      'n/no-process-exit': 'off',

      // Relax unicorn rules that are stylistic preferences, not real issues
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

      // Stylistic rules that don't catch real bugs
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
      'perfectionist/sort-intersection-types': 'off',
      'mocha/max-top-level-suites': 'off',

      // Allow require imports for CJS compatibility
      '@typescript-eslint/no-require-imports': 'off',

      // Relax complexity rules - real issues but shouldn't block development
      'complexity': 'off',
      'max-depth': 'off',
      'max-params': 'off',

      // These are sometimes necessary in loops for sequential operations
      'no-await-in-loop': 'warn',

      // Allow explicit any with warning - real issue but shouldn't block
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow case declarations - common pattern
      'no-case-declarations': 'off',

      // Keep prefer-destructuring as a warning, not error
      'prefer-destructuring': 'off',

      // Allow process.exit in CLI contexts
      'unicorn/no-process-exit': 'off',

      // Disable no-undef as TypeScript handles this better
      // and it has false positives with CJS require() in ESM files
      'no-undef': 'off',
    },
  },
]
