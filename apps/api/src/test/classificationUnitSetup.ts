import { vi } from 'vitest'

// HTTP unit tests replace their repositories and have no database. The real
// startup check is covered by classifications-upgrade.db.test.ts in the DB suite.
vi.mock('../db/classifications.js', async importOriginal => ({
  ...await importOriginal<typeof import('../db/classifications.js')>(),
  assertClassificationInvariants: async () => undefined,
}))
