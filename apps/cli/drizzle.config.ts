import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/database/drizzle-schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: '.proletariat/workspace.db',
  },
  verbose: true,
  strict: true,
})
