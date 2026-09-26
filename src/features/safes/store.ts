import { Effect } from 'effect'
import { AddressBookEntry, addressBookKey, SafeRecord, safeKey } from '@/schemas/safes'
import type { StoreName } from '@/storage/db'
import { Storage } from '@/storage/service'
import type { SafeSnapshot } from './load-safe'

type SafeList = 'safes' | 'recent'

/** Stored Safes; invalid records are reported alongside, never used (SPEC §9.5). */
export const listSafes = (store: SafeList) =>
  Effect.flatMap(Storage, (s) => s.getAll(store, SafeRecord)).pipe(
    Effect.map(({ records, invalid }) => ({
      safes: records.map((r) => r.value).sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
      invalid,
    })),
  )

export const saveSafe = (store: SafeList, record: SafeRecord) =>
  Effect.flatMap(Storage, (s) =>
    s.put(store, safeKey(record.chainId, record.address), SafeRecord, record),
  )

/** The stored record for a Safe that passed the authenticity check, with what we last saw. */
export function safeRecord(safe: SafeSnapshot): SafeRecord | undefined {
  const a = safe.authenticity
  if (a.status !== 'verified') return undefined
  return {
    chainId: safe.chainId,
    address: safe.address,
    version: a.version,
    l2: a.l2,
    addedAt: new Date().toISOString(),
    ...(safe.nonce !== undefined && safe.threshold !== undefined && safe.owners
      ? {
          lastSeen: {
            block: safe.block.toString(),
            nonce: safe.nonce.toString(),
            threshold: safe.threshold.toString(),
            ownerCount: safe.owners.length,
          },
        }
      : {}),
  }
}

export const removeSafe = (store: SafeList, chainId: number, address: string) =>
  Effect.flatMap(Storage, (s) => s.remove(store as StoreName, safeKey(chainId, address)))

export const listAddressBook = Effect.flatMap(Storage, (s) =>
  s.getAll('addressbook', AddressBookEntry),
).pipe(Effect.map(({ records, invalid }) => ({ entries: records.map((r) => r.value), invalid })))

export const setLabel = (entry: AddressBookEntry) =>
  Effect.flatMap(Storage, (s) =>
    s.put('addressbook', addressBookKey(entry.chainId, entry.address), AddressBookEntry, entry),
  )

export const removeLabel = (chainId: number | '*', address: string) =>
  Effect.flatMap(Storage, (s) => s.remove('addressbook', addressBookKey(chainId, address)))

/** The label for an address: a chain-specific one first, then one for every chain. */
export const labelFor = (
  entries: readonly AddressBookEntry[],
  chainId: number,
  address: string,
): string | undefined => {
  const a = address.toLowerCase()
  return (
    entries.find((e) => e.chainId === chainId && e.address.toLowerCase() === a)?.label ??
    entries.find((e) => e.chainId === '*' && e.address.toLowerCase() === a)?.label
  )
}
