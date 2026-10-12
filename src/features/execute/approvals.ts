// Onchain approvals (SPEC §5.2, P1): owners who called approveHash(safeTxHash) count as signers.
import { Effect } from 'effect'
import { type Address, type Hex, parseAbi } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'

export const approveHashAbi = parseAbi([
  'function approveHash(bytes32 hashToApprove)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
])

/**
 * For each safeTxHash, the owners with approvedHashes(owner, safeTxHash) != 0, read at the Safe's
 * pinned block in one multicall (owners × hashes calls). Keys are lowercase safeTxHashes.
 */
export const readApprovalsMany = (
  chainId: number,
  safe: Address,
  owners: readonly Address[],
  safeTxHashes: readonly Hex[],
  block: bigint,
) =>
  Effect.gen(function* () {
    const out = new Map<string, Address[]>()
    if (owners.length === 0 || safeTxHashes.length === 0) return out
    const rpc = yield* Rpc
    const chain = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'approvals')
    const pairs = safeTxHashes.flatMap((hash) => owners.map((owner) => [owner, hash] as const))
    const results = yield* rpcCall(endpointOf(chain), () =>
      client.multicall({
        contracts: pairs.map(([owner, hash]) => ({
          address: safe,
          abi: approveHashAbi,
          functionName: 'approvedHashes' as const,
          args: [owner, hash] as const,
        })),
        blockNumber: block,
        allowFailure: false,
        deployless: needsDeployless(toViemChain(chain)),
      }),
    )
    pairs.forEach(([owner, hash], i) => {
      const key = hash.toLowerCase()
      if (!out.has(key)) out.set(key, [])
      if (results[i] !== 0n) out.get(key)?.push(owner)
    })
    return out
  })

/** Owners with approvedHashes(owner, safeTxHash) != 0, read at the Safe's pinned block. */
export const readApprovals = (
  chainId: number,
  safe: Address,
  owners: readonly Address[],
  safeTxHash: Hex,
  block: bigint,
) =>
  Effect.map(
    readApprovalsMany(chainId, safe, owners, [safeTxHash], block),
    (byHash) => byHash.get(safeTxHash.toLowerCase()) ?? [],
  )
