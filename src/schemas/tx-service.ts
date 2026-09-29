// Responses from the Safe Transaction Service (SPEC §8.2, §3.15). Everything in them is
// untrusted: only the SafeTx fields and EOA signatures are used, the safeTxHash is recomputed,
// and every signature is recovered. `dataDecoded` and the service's other opinions are ignored.
import { Schema } from 'effect'
import { Address, Hex } from './common'

const Uint = Schema.String.pipe(Schema.pattern(/^(0|[1-9]\d{0,77})$/))
const Bytes32 = Hex.pipe(Schema.filter((h) => h.length === 66 || 'Expected 32 bytes'))

export const ServiceConfirmation = Schema.Struct({
  owner: Address,
  /** Null for some confirmation types; only `EOA` ones are used. */
  signature: Schema.NullOr(Hex.pipe(Schema.maxLength(2 + 2 * 1024))),
  signatureType: Schema.String.pipe(Schema.maxLength(40)),
})
export type ServiceConfirmation = typeof ServiceConfirmation.Type

export const ServiceTx = Schema.Struct({
  safe: Address,
  to: Address,
  value: Uint,
  data: Schema.NullOr(Hex.pipe(Schema.maxLength(2 + 2 * 256 * 1024))),
  operation: Schema.Literal(0, 1),
  gasToken: Schema.NullOr(Address),
  safeTxGas: Schema.Union(Uint, Schema.Int),
  baseGas: Schema.Union(Uint, Schema.Int),
  gasPrice: Uint,
  refundReceiver: Schema.NullOr(Address),
  nonce: Schema.Union(Uint, Schema.Int),
  safeTxHash: Bytes32,
  isExecuted: Schema.Boolean,
  /** Safe{Wallet} puts the proposer's note here, as JSON text. */
  origin: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(2000)))),
  confirmations: Schema.Array(ServiceConfirmation).pipe(Schema.maxItems(100)),
})
export type ServiceTx = typeof ServiceTx.Type

export const ServiceTxPage = Schema.Struct({
  count: Schema.Int,
  results: Schema.Array(ServiceTx).pipe(Schema.maxItems(100)),
})

export const ServiceSafe = Schema.Struct({
  address: Address,
  version: Schema.NullOr(Schema.String.pipe(Schema.maxLength(32))),
})
