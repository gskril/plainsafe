// The Storage service (SPEC §9.5): every record is encoded with its schema on write and decoded
// on read. Invalid records are reported, never silently used.
import { Context, Effect, Layer, Option, ParseResult, Schema } from 'effect'
import { InvalidRecord, StorageError } from '@/effect/errors'
import { type Backend, idbBackend, type StoreName } from './db'

export interface Loaded<A> {
  readonly records: ReadonlyArray<{ readonly key: string; readonly value: A }>
  readonly invalid: ReadonlyArray<InvalidRecord>
}

export interface StorageApi {
  readonly get: <A, I>(
    store: StoreName,
    key: string,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<Option.Option<A>, StorageError | InvalidRecord>
  readonly getAll: <A, I>(
    store: StoreName,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<Loaded<A>, StorageError>
  readonly put: <A, I>(
    store: StoreName,
    key: string,
    schema: Schema.Schema<A, I>,
    value: A,
  ) => Effect.Effect<void, StorageError | InvalidRecord>
  readonly remove: (store: StoreName, key: string) => Effect.Effect<void, StorageError>
  readonly clear: (store: StoreName) => Effect.Effect<void, StorageError>
}

export class Storage extends Context.Tag('Storage')<Storage, StorageApi>() {}

const message = (e: ParseResult.ParseError) => ParseResult.TreeFormatter.formatErrorSync(e)

export function makeStorage(backend: Backend): StorageApi {
  const run = <T>(op: string, store: StoreName, f: () => Promise<T>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ op, store, cause }) })

  const decode = <A, I>(store: StoreName, key: string, schema: Schema.Schema<A, I>, raw: unknown) =>
    Schema.decodeUnknown(schema)(raw).pipe(
      Effect.mapError((e) => new InvalidRecord({ store, key, message: message(e) })),
    )

  return {
    get: (store, key, schema) =>
      Effect.gen(function* () {
        const raw = yield* run('get', store, () => backend.get(store, key))
        if (raw === undefined) return Option.none()
        return Option.some(yield* decode(store, key, schema, raw))
      }),

    getAll: (store, schema) =>
      Effect.gen(function* () {
        const rows = yield* run('getAll', store, () => backend.getAll(store))
        const records: { key: string; value: Schema.Schema.Type<typeof schema> }[] = []
        const invalid: InvalidRecord[] = []
        for (const row of rows) {
          const result = yield* Effect.either(decode(store, row.key, schema, row.value))
          if (result._tag === 'Right') records.push({ key: row.key, value: result.right })
          else invalid.push(result.left)
        }
        return { records, invalid }
      }),

    put: (store, key, schema, value) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encode(schema)(value).pipe(
          Effect.mapError((e) => new InvalidRecord({ store, key, message: message(e) })),
        )
        yield* run('put', store, () => backend.put(store, key, encoded))
      }),

    remove: (store, key) => run('delete', store, () => backend.delete(store, key)),
    clear: (store) => run('clear', store, () => backend.clear(store)),
  }
}

export const StorageLive = Layer.succeed(Storage, makeStorage(idbBackend))

/** An in-memory backend, for tests. */
export function memoryBackend(): Backend & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  const k = (store: string, key: string) => `${store}\u0000${key}`
  return {
    data,
    get: async (store, key) => structuredClone(data.get(k(store, key))),
    getAll: async (store) =>
      [...data.entries()]
        .filter(([key]) => key.startsWith(`${store}\u0000`))
        .map(([key, value]) => ({
          key: key.slice(store.length + 1),
          value: structuredClone(value),
        })),
    put: async (store, key, value) => void data.set(k(store, key), structuredClone(value)),
    delete: async (store, key) => void data.delete(k(store, key)),
    clear: async (store) => {
      for (const key of [...data.keys()]) if (key.startsWith(`${store}\u0000`)) data.delete(key)
    },
  }
}
