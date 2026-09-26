import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { RpcUrl, rpcUrlProblem } from './common'

const decode = Schema.decodeUnknownEither(RpcUrl)

describe('RpcUrl', () => {
  it('accepts https and http for any host', () => {
    expect(Either.isRight(decode('https://rpc.mevblocker.io'))).toBe(true)
    expect(Either.isRight(decode('http://localhost:8545'))).toBe(true)
    expect(Either.isRight(decode('http://node.tail1234.ts.net:8545'))).toBe(true)
    expect(Either.isRight(decode('http://100.101.102.103:8545'))).toBe(true)
  })

  it('rejects other schemes and non-URLs', () => {
    expect(Either.isLeft(decode('javascript:alert(1)'))).toBe(true)
    expect(Either.isLeft(decode('ws://localhost:8546'))).toBe(true)
    expect(Either.isLeft(decode('rpc.mevblocker.io'))).toBe(true)
  })
})

describe('rpcUrlProblem', () => {
  it('allows https from any page', () => {
    expect(rpcUrlProblem('https://rpc.mevblocker.io', 'https:')).toBeUndefined()
    expect(rpcUrlProblem('https://rpc.mevblocker.io', 'http:')).toBeUndefined()
  })

  it('allows http to this machine from an https page', () => {
    for (const url of ['http://localhost:8545', 'http://127.0.0.1:8545', 'http://[::1]:8545']) {
      expect(rpcUrlProblem(url, 'https:')).toBeUndefined()
    }
  })

  it('refuses http to another host from an https page, which the browser would block', () => {
    expect(rpcUrlProblem('http://node.tail1234.ts.net:8545', 'https:')).toMatch(/tailscale serve/)
  })

  it('allows http to another host from an http page', () => {
    expect(rpcUrlProblem('http://node.tail1234.ts.net:8545', 'http:')).toBeUndefined()
  })

  it('names the accepted schemes for anything else', () => {
    expect(rpcUrlProblem('ftp://node.example', 'http:')).toBe('Use an https:// or http:// URL')
    expect(rpcUrlProblem('', 'https:')).toBe('Use an https:// or http:// URL')
  })
})
