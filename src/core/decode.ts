// ABI decoding for the renderer (SPEC §7.1 levels 3 to 5). Clear signing (levels 1–2) layers on
// top; this never looks at descriptor text.
import {
  type Abi,
  type AbiFunction,
  decodeFunctionData,
  type Hex,
  parseAbiItem,
  slice,
  toFunctionSelector,
} from 'viem'

export interface DecodedArg {
  readonly name: string
  readonly type: string
  readonly value: unknown
}

export type Decoded =
  | { readonly kind: 'empty' } // data = 0x: a plain value transfer
  | {
      readonly kind: 'abi'
      readonly level: 3
      readonly source: string
      readonly functionName: string
      readonly signature: string
      readonly args: readonly DecodedArg[]
    }
  | { readonly kind: 'raw'; readonly level: 5; readonly selector?: Hex }

export interface AbiSource {
  readonly source: string
  readonly abi: Abi | readonly unknown[]
}

/**
 * Decode `data` with the first source that has a matching function. When `selectorsInBytecode`
 * is given, functions whose selector isn't in the target's current bytecode are not used
 * (SPEC §7.3).
 */
export function decodeCalldata(
  data: Hex,
  sources: readonly AbiSource[],
  selectorsInBytecode?: ReadonlySet<string>,
): Decoded {
  if (data === '0x') return { kind: 'empty' }
  if (data.length < 10) return { kind: 'raw', level: 5 }
  const selector = slice(data, 0, 4).toLowerCase() as Hex
  if (selectorsInBytecode && !selectorsInBytecode.has(selector))
    return { kind: 'raw', level: 5, selector }
  for (const { source, abi } of sources) {
    const fn = (abi as readonly AbiFunction[]).find(
      (item) => item.type === 'function' && toFunctionSelector(item) === selector,
    )
    if (!fn) continue
    try {
      const { args } = decodeFunctionData({ abi: [fn], data })
      return {
        kind: 'abi',
        level: 3,
        source,
        functionName: fn.name,
        signature: `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`,
        args: fn.inputs.map((p, i) => ({
          name: p.name || `arg${i}`,
          type: p.type,
          value: (args ?? [])[i],
        })),
      }
    } catch {
      // The selector matched but the arguments don't decode: treat as undecodable.
      return { kind: 'raw', level: 5, selector }
    }
  }
  return { kind: 'raw', level: 5, selector }
}

/**
 * Level 4 (SPEC §7.1): a signature-database entry that decodes the calldata. Display only:
 * anyone can register a signature with a colliding selector, so safety rules never use it.
 */
export interface Guess {
  readonly signature: string
  readonly args: readonly DecodedArg[]
  /** Other registered signatures that also decode this calldata. */
  readonly alternatives: readonly string[]
}

export function guessCall(data: Hex, signatures: readonly string[]): Guess | undefined {
  if (data.length < 10) return undefined
  const selector = slice(data, 0, 4).toLowerCase()
  const decodable = signatures.flatMap((signature) => {
    try {
      const fn = parseAbiItem(`function ${signature}`) as AbiFunction
      if (toFunctionSelector(fn) !== selector) return []
      const { args } = decodeFunctionData({ abi: [fn], data })
      return [{ signature, fn, args: args ?? [] }]
    } catch {
      return []
    }
  })
  const [first, ...rest] = decodable
  if (!first) return undefined
  return {
    signature: first.signature,
    args: first.fn.inputs.map((p, i) => ({
      name: p.name || `arg${i}`,
      type: p.type,
      value: first.args[i],
    })),
    alternatives: rest.map((r) => r.signature),
  }
}
