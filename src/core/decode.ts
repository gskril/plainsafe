// ABI decoding for the renderer (SPEC §7.1 levels 3 and 5). Clear signing (levels 1–2) and the
// signature database (level 4) layer on top later; this never looks at descriptor text.
import {
  type Abi,
  type AbiFunction,
  decodeFunctionData,
  type Hex,
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
