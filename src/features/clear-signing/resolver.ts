// The DescriptorResolver (SPEC §7.2): bundled Safe descriptors, hash-verified downloads from the
// pinned registry commit (only with the capability on), and user-imported descriptors. The
// library's default GitHub resolver is never used.
import type {
  Descriptor,
  DescriptorDeployment,
  DescriptorResolver,
  RegistryIndex,
} from '@ethereum-sourcify/clear-signing'
import type { Address } from 'viem'

interface Pinned<T> {
  readonly repo: string
  readonly commit: string
  readonly files: Record<string, T>
}

let bundle: Promise<Pinned<unknown>> | undefined
let manifest: Promise<Pinned<string>> | undefined
/** Lazily loaded chunks from the app's own origin. */
export const loadBundle = () =>
  (bundle ??= import('@/generated/clear-signing/bundle.json').then(
    (m) => m.default as Pinned<unknown>,
  ))
export const loadManifest = () =>
  (manifest ??= import('@/generated/clear-signing/manifest.json').then(
    (m) => m.default as Pinned<string>,
  ))

const verified = new Map<string, Promise<unknown>>()

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Fetch a registry file at the pinned commit; dropped unless its SHA-256 matches the manifest. */
export function fetchVerified(path: string): Promise<unknown> {
  let p = verified.get(path)
  if (!p) {
    p = (async () => {
      const m = await loadManifest()
      const expected = m.files[path]
      if (!expected) throw new Error(`${path} is not in the pinned registry manifest`)
      // Imported here so this module stays usable outside the browser (tests).
      const { netguard } = await import('@/netguard')
      const res = await netguard.fetchFor('clear-signing')(
        `https://raw.githubusercontent.com/${m.repo}/${m.commit}/${path}`,
      )
      if (!res.ok)
        throw new Error(`raw.githubusercontent.com answered HTTP ${res.status} for ${path}`)
      const bytes = await res.arrayBuffer()
      if ((await sha256Hex(bytes)) !== expected)
        throw new Error(`${path} failed its SHA-256 check and was dropped`)
      return JSON.parse(new TextDecoder().decode(bytes))
    })()
    p.catch(() => verified.delete(path))
    verified.set(path, p)
  }
  return p
}

export interface SafeContext {
  readonly chainId: number
  readonly safe: Address
  /** From the singleton's code hash (SPEC §4.2), never from VERSION(). */
  readonly version: string
  readonly l2: boolean
}

export interface UserDescriptor {
  readonly id: string
  readonly descriptor: Descriptor
}

const SAFE_TX_TYPEHASH = '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8'

const withDeployment = (
  descriptor: Descriptor,
  kind: 'contract' | 'eip712',
  d: DescriptorDeployment,
): Descriptor => {
  const copy = structuredClone(descriptor)
  const section = copy.context?.[kind] ?? {}
  copy.context = {
    ...copy.context,
    [kind]: { ...section, deployments: [...(section.deployments ?? []), d] },
  }
  return copy
}

export async function makeResolver(
  ctx: SafeContext,
  options: { remote: boolean; userDescriptors: readonly UserDescriptor[] },
): Promise<DescriptorResolver> {
  const files = (await loadBundle()).files
  const base: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} }
  if (options.remote) {
    try {
      const [calldata, eip712] = await Promise.all([
        fetchVerified('index.calldata.json'),
        fetchVerified('index.eip712.json'),
      ])
      Object.assign(base.calldataIndex, calldata)
      Object.assign(base.typedDataIndex, eip712)
    } catch {
      // Without the index, only bundled and user descriptors resolve.
    }
  }
  // User descriptors, keyed by their own deployments
  for (const u of options.userDescriptors) {
    for (const d of u.descriptor.context?.contract?.deployments ?? [])
      if (d.chainId !== undefined && d.address)
        base.calldataIndex[`eip155:${d.chainId}:${d.address.toLowerCase()}`] = `user:${u.id}`
  }
  // SPEC §7.2: a call from the Safe to itself has `to` = the proxy, so the proxy maps to the Safe
  // descriptor for its code-hash-verified version, on any chain.
  const name = ctx.l2 ? 'SafeL2' : 'Safe'
  const proxyKey = `eip155:${ctx.chainId}:${ctx.safe.toLowerCase()}`
  const calldataPath = `registry/safe/calldata-${name}-${ctx.version}.json`
  const typedPath = `registry/safe/eip712-${name}-${ctx.version}.json`
  if (files[calldataPath]) base.calldataIndex[proxyKey] = calldataPath
  if (files[typedPath])
    base.typedDataIndex[proxyKey] = {
      SafeTx: [{ path: typedPath, encodeTypeHashes: [SAFE_TX_TYPEHASH] }],
    }

  const deployment = { chainId: ctx.chainId, address: ctx.safe }
  return {
    index: base,
    fetchDescriptor: async (path) => {
      if (path.startsWith('user:')) {
        const u = options.userDescriptors.find((x) => `user:${x.id}` === path)
        if (!u) throw new Error(`Missing user descriptor ${path}`)
        return u.descriptor
      }
      const bundled = files[path] as Descriptor | undefined
      if (bundled) {
        if (path === calldataPath) return withDeployment(bundled, 'contract', deployment)
        if (path === typedPath) return withDeployment(bundled, 'eip712', deployment)
        return bundled
      }
      if (!options.remote)
        throw new Error(`${path} isn't bundled; turn on "Clear-signing descriptors" to fetch it`)
      return (await fetchVerified(path)) as Descriptor
    },
  }
}
