// Requests to the Safe Transaction Service (SPEC §3.15, §8.2), sent through netguard with the
// `safe-tx-service` tag and allowed only while the capability is on (or for one explicit "check
// once"). Responses are decoded with Schema; nothing in them is trusted beyond that.
import { Effect, Either, ParseResult, Schema } from 'effect'
import type { Address, Hex } from 'viem'
import { proposeBody, txServiceUrls } from '@/core/tx-service'
import { BlockedByNetguard, TxServiceError } from '@/effect/errors'
import { netguard } from '@/netguard'
import { NetguardBlockedError } from '@/netguard/guard'
import type { PackageSignature, SafeTxPackage } from '@/schemas/package'
import { ServiceSafe, ServiceTx, ServiceTxPage } from '@/schemas/tx-service'

export const TX_SERVICE_TAG = 'safe-tx-service'

const request = (url: string, init?: RequestInit) =>
  Effect.tryPromise({
    try: () => netguard.fetchFor(TX_SERVICE_TAG)(url, init),
    catch: (e) =>
      e instanceof NetguardBlockedError
        ? new BlockedByNetguard({ host: e.host })
        : new TxServiceError({ message: e instanceof Error ? e.message : String(e) }),
  })

const failure = (res: Response) =>
  Effect.flatMap(
    Effect.promise(() => res.text().catch(() => '')),
    (body) =>
      new TxServiceError({
        status: res.status,
        message:
          res.status === 429
            ? 'rate limit reached (Safe allows a few thousand requests a month without an API key). Try again later, or share a link instead.'
            : `answered HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
      }),
  )

const decode = <A, I>(schema: Schema.Schema<A, I>, res: Response) =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => res.json() as Promise<unknown>,
      catch: () => new TxServiceError({ message: 'sent an answer that is not JSON' }),
    }),
    (body) => {
      const r = Schema.decodeUnknownEither(schema)(body)
      return Either.isRight(r)
        ? Effect.succeed(r.right)
        : Effect.fail(
            new TxServiceError({
              message: `sent an answer in an unexpected shape: ${ParseResult.TreeFormatter.formatErrorSync(r.left).slice(0, 300)}`,
            }),
          )
    },
  )

const getJson = <A, I>(schema: Schema.Schema<A, I>, url: string, allow404 = false) =>
  Effect.gen(function* () {
    const res = yield* request(url)
    if (allow404 && res.status === 404) return null
    if (!res.ok) return yield* failure(res)
    return yield* decode(schema, res)
  })

/** Pending transactions from `fromNonce` on, lowest nonce first. */
export const fetchPending = (chainId: number, safe: Address, fromNonce: bigint) =>
  Effect.map(
    getJson(ServiceTxPage, txServiceUrls.pending(chainId, safe, fromNonce)),
    (page) => page?.results ?? [],
  )

/** One transaction by safeTxHash, or null when the service doesn't have it. */
export const fetchServiceTx = (chainId: number, safeTxHash: Hex) =>
  getJson(ServiceTx, txServiceUrls.tx(chainId, safeTxHash), true)

/** The Safe's version as the service reports it (a claim; checked by code hash later). */
export const fetchServiceSafe = (chainId: number, safe: Address) =>
  getJson(ServiceSafe, txServiceUrls.safe(chainId, safe))

const post = (url: string, body: unknown) =>
  Effect.gen(function* () {
    const res = yield* request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return yield* failure(res)
  })

export const proposeTx = (pkg: SafeTxPackage, proposer: PackageSignature) =>
  post(txServiceUrls.propose(pkg.chainId, pkg.safe), proposeBody(pkg, proposer))

export const confirmTx = (chainId: number, safeTxHash: Hex, signature: PackageSignature) =>
  post(txServiceUrls.confirm(chainId, safeTxHash), { signature: signature.data })
