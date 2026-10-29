// Responses from the Safe Transaction Service (SPEC §8.2, §3.15). Everything in them is
// untrusted: only the SafeTx fields and EOA signatures are used, the safeTxHash is recomputed,
// and every signature is recovered. `dataDecoded` and the service's other opinions are ignored.
import { Schema } from 'effect'
import { Address, Hex, Uint256String } from './common'

/**
 * The service sends some uint256 fields as JSON numbers. Those are accepted only as safe
 * nonnegative integers: anything larger has already lost precision in JSON.parse.
 */
const UintOrNumber = Schema.Union(Uint256String, Schema.NonNegativeInt)
const Bytes32 = Hex.pipe(Schema.filter((h) => h.length === 66 || 'Expected 32 bytes'))

export const ServiceConfirmation = Schema.Struct({
  owner: Address,
  /**
   * Null for some confirmation types; only `EOA` ones are used. Contract signatures can be long,
   * so the bound is generous: a record is skipped for its type, not rejected for its length.
   */
  signature: Schema.NullOr(Hex.pipe(Schema.maxLength(2 + 2 * 64 * 1024))),
  signatureType: Schema.String.pipe(Schema.maxLength(40)),
})
export type ServiceConfirmation = typeof ServiceConfirmation.Type

export const ServiceTx = Schema.Struct({
  safe: Address,
  to: Address,
  value: Uint256String,
  data: Schema.NullOr(Hex.pipe(Schema.maxLength(2 + 2 * 256 * 1024))),
  operation: Schema.Literal(0, 1),
  gasToken: Schema.NullOr(Address),
  safeTxGas: UintOrNumber,
  baseGas: UintOrNumber,
  gasPrice: Uint256String,
  refundReceiver: Schema.NullOr(Address),
  nonce: UintOrNumber,
  safeTxHash: Bytes32,
  isExecuted: Schema.Boolean,
  /** Safe{Wallet} puts the proposer's note here, as JSON text. */
  origin: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(64 * 1024)))),
  confirmations: Schema.Array(ServiceConfirmation).pipe(Schema.maxItems(100)),
})
export type ServiceTx = typeof ServiceTx.Type

/** Records are decoded one by one (see fetchPending), so one bad record can't hide the rest. */
export const ServiceTxPage = Schema.Struct({
  count: Schema.Int,
  results: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(100)),
})

export const ServiceSafe = Schema.Struct({
  address: Address,
  version: Schema.NullOr(Schema.String.pipe(Schema.maxLength(32))),
})
