// Importing a user's ERC-7730 file (SPEC §7.2, §9.2: untrusted input is decoded with Schema).
import { Either, ParseResult, Schema } from 'effect'
import { Erc7730Descriptor, type UserDescriptorRecord } from '@/schemas/descriptor'

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** An imported ERC-7730 file, checked with Schema; its SHA-256 is its id (SPEC §9.5). */
export async function parseUserDescriptor(
  text: string,
  fileName?: string,
): Promise<Either.Either<UserDescriptorRecord, string>> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return Either.left("This file isn't JSON.")
  }
  const includes = (json as { includes?: unknown } | null)?.includes
  if (includes !== undefined)
    return Either.left(
      `This descriptor includes another file (${String(includes).slice(0, 100)}), which can't be resolved here. Import a self-contained descriptor, with the included file merged in.`,
    )
  const d = Schema.decodeUnknownEither(Erc7730Descriptor)(json)
  if (Either.isLeft(d))
    return Either.left(
      `This isn't an ERC-7730 descriptor: ${ParseResult.TreeFormatter.formatErrorSync(d.left)}`,
    )
  const meta = (d.right as { metadata?: { owner?: unknown; contractName?: unknown } }).metadata
  const name =
    [meta?.contractName, meta?.owner, fileName].find(
      (x): x is string => typeof x === 'string' && x.trim().length > 0,
    ) ?? 'Imported descriptor'
  return Either.right({
    id: await sha256Hex(text),
    name: name.slice(0, 200),
    importedAt: new Date().toISOString(),
    descriptor: d.right,
  })
}
