// Test fixtures for the Safe Transaction Service code (src/core/tx-service.test.ts and
// src/features/tx-service/program.test.ts).

// A real record from api.safe.global (ENS DAO's v1.3.0 Safe on Mainnet, nonce 245, executed
// 2026-09-01), trimmed to the fields Plain Safe reads plus a few it ignores.
export const RECORD = {
  safe: '0x91c32893216dE3eA0a55ABb9851f581d4503d39b',
  to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  value: '0',
  data: '0xa9059cbb000000000000000000000000703ae03fb120ec91e9ed6d08ce8044e498cc789b000000000000000000000000000000000000000000000000000000007ac91b00',
  operation: 0,
  gasToken: '0x0000000000000000000000000000000000000000',
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  refundReceiver: '0x0000000000000000000000000000000000000000',
  nonce: '245',
  safeTxHash: '0x43c917e81eae486714cdf7481215ced2012d14b0eac1dc4be30a2f9d1d25a0cd',
  isExecuted: true,
  origin: '{"url": "https://app.safe.global", "name": "", "note": null}',
  dataDecoded: { method: 'transfer', parameters: [] },
  trusted: true,
  confirmations: [
    {
      owner: '0x75d91395CD36f24f990bbdE69993cB20B96EcFa6',
      submissionDate: '2026-09-01T03:43:34.812410Z',
      transactionHash: null,
      signature:
        '0x9878e9b53d0bee08fa842fcafd530844c313e63165df5f9b39cde99af22e7a9d1d9eef98604fd1f5804027d9403ea5c2b1026214185ff48edb78c62058b5f68d1b',
      signatureType: 'EOA',
    },
    {
      owner: '0x7Bd3AB8fA37d63c04a8d0BeE3298088C0f366709',
      submissionDate: '2026-09-01T15:56:47Z',
      transactionHash: null,
      signature:
        '0x0000000000000000000000007bd3ab8fa37d63c04a8d0bee3298088c0f366709000000000000000000000000000000000000000000000000000000000000000001',
      signatureType: 'APPROVED_HASH',
    },
  ],
}
