import { Either, Schema } from 'effect'
import { type Address, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { ServiceTx } from '@/schemas/tx-service'
import { verifyPackage } from './package'
import { safeTxTypedData } from './safe-tx'
import {
  decodeServiceRecords,
  packageFromService,
  parseSafeWalletLink,
  planPost,
  proposeBody,
  serviceNote,
  serviceSafeTx,
  serviceSignatures,
  serviceVersion,
  TX_SERVICE_CHAINS,
  txServiceUrls,
} from './tx-service'
import { RECORD } from './tx-service.fixtures'

const decode = (x: unknown) => Schema.decodeUnknownSync(ServiceTx)(x)

describe('packageFromService', () => {
  it('rebuilds a real Safe{Wallet} transaction with the same safeTxHash and signer', async () => {
    const { pkg, skipped } = packageFromService(1, '1.3.0', decode(RECORD))
    expect(pkg.hashes.safeTx).toBe(RECORD.safeTxHash)
    expect(skipped).toBe(0) // the APPROVED_HASH confirmation is read onchain, not skipped
    const v = await verifyPackage(pkg)
    if (Either.isLeft(v)) throw new Error(v.left._tag)
    expect(v.right.signatures.map((s) => s.signer)).toEqual([
      '0x75d91395CD36f24f990bbdE69993cB20B96EcFa6',
    ])
    expect(v.right.rejected).toEqual([])
  })

  it('rejects a signature whose claimed owner is not the signer', async () => {
    const [first] = RECORD.confirmations
    const lying = {
      ...RECORD,
      confirmations: [{ ...first, owner: '0x7Bd3AB8fA37d63c04a8d0BeE3298088C0f366709' }],
    }
    const v = await verifyPackage(packageFromService(1, '1.3.0', decode(lying)).pkg)
    if (Either.isLeft(v)) throw new Error(v.left._tag)
    expect(v.right.signatures).toEqual([])
    expect(v.right.rejected).toHaveLength(1)
  })

  it('computes its own hash, so changed contents no longer match the claimed one', () => {
    const tampered = decode({ ...RECORD, value: '1' })
    expect(packageFromService(1, '1.3.0', tampered).pkg.hashes.safeTx).not.toBe(RECORD.safeTxHash)
  })

  it('treats null data, gas token and refund receiver as empty', () => {
    const { pkg } = packageFromService(
      1,
      '1.4.1',
      decode({ ...RECORD, data: null, gasToken: null, refundReceiver: null }),
    )
    expect(pkg.tx.data).toBe('0x')
    expect(pkg.tx.gasToken).toBe('0x0000000000000000000000000000000000000000')
  })
})

describe('serviceSignatures', () => {
  it('keeps EOA signatures and counts the kinds Plain Safe does not use', () => {
    const eoa = RECORD.confirmations[0] as (typeof RECORD.confirmations)[0]
    const { signatures, skipped } = serviceSignatures(
      decode({
        ...RECORD,
        confirmations: [
          eoa,
          { ...eoa, signatureType: 'ETH_SIGN', signature: `${eoa.signature.slice(0, -2)}1f` },
          { ...eoa, signatureType: 'CONTRACT_SIGNATURE', signature: '0x1234' },
          { ...eoa, signatureType: 'EOA', signature: null },
        ],
      }).confirmations,
    )
    expect(signatures).toHaveLength(1)
    expect(skipped).toBe(3)
  })
})

describe('serviceNote', () => {
  it("reads Safe{Wallet}'s note from origin", () => {
    expect(serviceNote('{"url":"https://app.safe.global","note":" Pay March invoice "}')).toBe(
      'Pay March invoice',
    )
    expect(serviceNote(RECORD.origin)).toBeUndefined()
    expect(serviceNote('not json')).toBeUndefined()
    expect(serviceNote(null)).toBeUndefined()
  })
})

describe('parseSafeWalletLink', () => {
  const safe = '0x91c32893216dE3eA0a55ABb9851f581d4503d39b'
  const hash = RECORD.safeTxHash
  it('reads chain, Safe and safeTxHash from a transaction link', () => {
    expect(
      parseSafeWalletLink(
        `https://app.safe.global/transactions/tx?safe=eth:${safe}&id=multisig_${safe}_${hash}`,
      ),
    ).toEqual({ chainId: 1, safe, safeTxHash: hash })
    expect(
      parseSafeWalletLink(
        `https://app.safe.global/transactions/tx?id=multisig_${safe.toLowerCase()}_${hash}&safe=matic:${safe}`,
      )?.chainId,
    ).toBe(137)
  })
  it('refuses links it cannot read unambiguously', () => {
    const other = '0x0000000000000000000000000000000000000001'
    expect(parseSafeWalletLink(`https://app.safe.global/home?safe=eth:${safe}`)).toBeUndefined()
    expect(
      parseSafeWalletLink(
        `https://app.safe.global/transactions/tx?safe=eth:${safe}&id=multisig_${other}_${hash}`,
      ),
    ).toBeUndefined()
    expect(
      parseSafeWalletLink(
        `https://app.safe.global/transactions/tx?safe=nope:${safe}&id=multisig_${safe}_${hash}`,
      ),
    ).toBeUndefined()
    expect(parseSafeWalletLink('plainsafe:1:abc')).toBeUndefined()
  })
})

describe('planPost', () => {
  const accounts = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()))
  const owners = accounts.slice(0, 2).map((a) => a.address)
  const sig = (a: (typeof accounts)[0]) => ({
    signer: a.address,
    kind: 'eip712' as const,
    data: '0x' as `0x${string}`,
  })
  const sigs = accounts.map(sig)

  it('proposes with the preferred owner and confirms the other owner signatures', () => {
    const plan = planPost(sigs, owners, { exists: false }, owners[1])
    expect(plan.propose?.signer).toBe(owners[1])
    expect(plan.confirm.map((s) => s.signer)).toEqual([owners[0]])
  })
  it('only confirms what the service is missing, and never posts non-owners', () => {
    const plan = planPost(sigs, owners, {
      exists: true,
      signers: [(owners[0] as Address).toLowerCase() as Address],
    })
    expect(plan.propose).toBeUndefined()
    expect(plan.confirm.map((s) => s.signer)).toEqual([owners[1]])
  })
  it('has nothing to propose without an owner signature', () => {
    expect(planPost([sig(accounts[2] as (typeof accounts)[0])], owners, { exists: false })).toEqual(
      { confirm: [] },
    )
  })
})

describe('proposeBody', () => {
  it("sends the SafeTx fields, our safeTxHash and the proposer's signature", async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const record = decode({ ...RECORD, confirmations: [] })
    const { pkg } = packageFromService(1, '1.3.0', record)
    const data = await owner.signTypedData(
      safeTxTypedData(1, getAddress(RECORD.safe), serviceSafeTx(record)),
    )
    const body = proposeBody(pkg, { signer: owner.address, kind: 'eip712', data })
    expect(body).toMatchObject({
      safe: RECORD.safe,
      to: RECORD.to,
      value: '0',
      data: RECORD.data,
      nonce: '245',
      contractTransactionHash: RECORD.safeTxHash,
      sender: owner.address,
      signature: data,
    })
  })
})

describe('urls', () => {
  it('builds api.safe.global URLs that end in a slash (netguard refuses redirects)', () => {
    const safe = '0x91c32893216dE3eA0a55ABb9851f581d4503d39b'
    expect(txServiceUrls.safe(137, safe)).toBe(
      `https://api.safe.global/tx-service/pol/api/v1/safes/${safe}/`,
    )
    expect(txServiceUrls.confirm(1, RECORD.safeTxHash as `0x${string}`)).toMatch(
      /\/eth\/api\/v1\/multisig-transactions\/0x43c9.*\/confirmations\/$/,
    )
    expect(txServiceUrls.pending(1, safe, 7n)).toContain('nonce__gte=7')
    expect(() => txServiceUrls.safe(31337, safe)).toThrow()
  })
  it('has a unique link prefix per chain', () => {
    const prefixes = Object.values(TX_SERVICE_CHAINS).map((c) => c.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
  it('strips the L2 suffix from service versions', () => {
    expect(serviceVersion('1.3.0+L2')).toBe('1.3.0')
    expect(serviceVersion('1.5.0')).toBe('1.5.0')
  })
  it('falls back to 1.3.0 when the service reports no version or an unsupported one', () => {
    expect(serviceVersion(null)).toBe('1.3.0')
    expect(serviceVersion(undefined)).toBe('1.3.0')
    expect(serviceVersion('9.9.9')).toBe('1.3.0')
  })
})

describe('decodeServiceRecords', () => {
  it('skips a record it cannot read without dropping the rest of the page', () => {
    const { records, malformed } = decodeServiceRecords([
      RECORD,
      { ...RECORD, to: 'not an address' },
    ])
    expect(records.map((r) => r.safeTxHash)).toEqual([RECORD.safeTxHash])
    expect(malformed).toBe(1)
  })
  it('reads records with a long contract signature and a long origin', () => {
    const contract = {
      owner: '0x7Bd3AB8fA37d63c04a8d0BeE3298088C0f366709',
      signature: `0x${'ab'.repeat(4000)}`,
      signatureType: 'CONTRACT_SIGNATURE',
    }
    const long = {
      ...RECORD,
      origin: JSON.stringify({ note: 'x'.repeat(5000) }),
      confirmations: [...RECORD.confirmations, contract],
    }
    const { records, malformed } = decodeServiceRecords([long])
    expect(malformed).toBe(0)
    expect(serviceSignatures((records[0] as (typeof records)[0]).confirmations)).toMatchObject({
      skipped: 1,
    })
  })
})

describe('ServiceTx integers', () => {
  const ok = (x: object) =>
    Either.isRight(Schema.decodeUnknownEither(ServiceTx)({ ...RECORD, ...x }))
  const max = 2n ** 256n - 1n

  it('accepts uint256 strings up to 2^256 - 1 and rejects 2^256', () => {
    expect(ok({ value: max.toString() })).toBe(true)
    expect(ok({ gasPrice: max.toString(), nonce: max.toString() })).toBe(true)
    expect(ok({ value: (max + 1n).toString() })).toBe(false)
    expect(ok({ gasPrice: (max + 1n).toString() })).toBe(false)
    expect(ok({ safeTxGas: (max + 1n).toString() })).toBe(false)
  })

  it('accepts nonnegative safe integers for nonce and gas', () => {
    expect(ok({ nonce: 245, safeTxGas: 0, baseGas: Number.MAX_SAFE_INTEGER })).toBe(true)
  })

  it('rejects negative and unsafe JSON integers', () => {
    expect(ok({ nonce: -1 })).toBe(false)
    expect(ok({ safeTxGas: -1 })).toBe(false)
    expect(ok({ baseGas: -5 })).toBe(false)
    expect(ok({ nonce: '-1' })).toBe(false)
    expect(ok({ nonce: 1.5 })).toBe(false)
    // 2**53 has already lost precision in JSON.parse
    const unsafe = JSON.parse(`{"nonce": ${2 ** 53}, "safeTxGas": 1e300}`)
    expect(ok({ nonce: unsafe.nonce })).toBe(false)
    expect(ok({ safeTxGas: unsafe.safeTxGas })).toBe(false)
  })

  it('counts an out-of-range record as malformed and keeps the valid one after it', () => {
    const { records, malformed } = decodeServiceRecords([
      { ...RECORD, value: (2n ** 256n).toString() },
      RECORD,
    ])
    expect(malformed).toBe(1)
    expect(records.map((r) => r.safeTxHash)).toEqual([RECORD.safeTxHash])
  })
})
