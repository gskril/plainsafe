// A package in the `packages` store (SPEC §9.5), with what we saw of its execution.
import { Schema } from 'effect'
import { Hex } from './common'
import { SafeTxPackage } from './package'

export const Execution = Schema.Struct({
  status: Schema.Literal('executed', 'failed'),
  txHash: Hex.pipe(Schema.filter((h) => h.length === 66 || 'Expected a transaction hash')),
  at: Schema.String.pipe(Schema.maxLength(40)),
})

/**
 * Where this browser first got the package (SPEC §3.9): built and signed here, imported from a
 * link, code or file, or pulled from the Safe Transaction Service. Absent on records saved before
 * it was added. For display only: every package is verified the same way whatever its source.
 */
export const PackageSource = Schema.Literal('created', 'imported', 'tx-service')
export type PackageSource = typeof PackageSource.Type

export const StoredPackage = Schema.Struct({
  package: SafeTxPackage,
  execution: Schema.optional(Execution),
  source: Schema.optional(PackageSource),
  updatedAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type StoredPackage = typeof StoredPackage.Type

export const packageKey = (chainId: number, safe: string, safeTxHash: string) =>
  `${chainId}:${safe.toLowerCase()}:${safeTxHash.toLowerCase()}`
