// The only module that opens IndexedDB (SPEC §9.5). One database, one object store per domain.
import { type IDBPDatabase, type IDBPTransaction, openDB } from 'idb'

export const DB_NAME = 'plainsafe'

export const STORES = [
  'settings',
  'safes',
  'recent',
  'packages',
  'tokenlists',
  'mytokens',
  'addressbook',
  'descriptors',
  'abis',
  'cache_rpc_caps',
  'cache_descriptors',
] as const
export type StoreName = (typeof STORES)[number]

/** Stores that hold user data, and so are included in Back up (SPEC §9.5). */
export const USER_DATA_STORES: readonly StoreName[] = [
  'settings',
  'safes',
  'recent',
  'packages',
  'tokenlists',
  'mytokens',
  'addressbook',
  'descriptors',
  'abis',
]

type Db = IDBPDatabase<unknown>
type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>

/**
 * Explicit migrations, one per database version. Never edit a shipped migration; add a new one.
 * Records use out-of-line keys such as `chainId:address` (SPEC §9.5 store table).
 */
const MIGRATIONS: ReadonlyArray<(db: Db, tx: UpgradeTx) => void> = [
  // v1: every store
  (db) => {
    for (const name of STORES) db.createObjectStore(name)
  },
]

export const DB_VERSION = MIGRATIONS.length

let dbPromise: Promise<Db> | undefined

export function openDatabase(): Promise<Db> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      for (let v = oldVersion; v < MIGRATIONS.length; v++) MIGRATIONS[v]?.(db, tx)
    },
    blocking() {
      // Another tab needs a newer version: close so it can upgrade, and reopen on next use.
      void dbPromise?.then((db) => db.close())
      dbPromise = undefined
    },
  }).catch((err: unknown) => {
    dbPromise = undefined
    throw err
  })
  return dbPromise
}

/** The raw key-value operations the Storage service is built on. */
export interface Backend {
  get(store: StoreName, key: string): Promise<unknown>
  getAll(store: StoreName): Promise<ReadonlyArray<{ key: string; value: unknown }>>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  clear(store: StoreName): Promise<void>
}

export const idbBackend: Backend = {
  async get(store, key) {
    return (await openDatabase()).get(store, key)
  },
  async getAll(store) {
    const tx = (await openDatabase()).transaction(store, 'readonly')
    const out: { key: string; value: unknown }[] = []
    for await (const cursor of tx.store) out.push({ key: String(cursor.key), value: cursor.value })
    await tx.done
    return out
  },
  async put(store, key, value) {
    await (await openDatabase()).put(store, value, key)
  },
  async delete(store, key) {
    await (await openDatabase()).delete(store, key)
  },
  async clear(store) {
    await (await openDatabase()).clear(store)
  },
}

/** Ask the browser not to evict our data under storage pressure (SPEC §9.5). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
