// viem's full chain list, imported only by add-chain.tsx's dynamic import. Importing 'viem/chains'
// dynamically there directly doesn't split it: the app imports mainnet and sepolia from the same
// module statically, so the bundler kept every chain in the main chunk.
export * from 'viem/chains'
