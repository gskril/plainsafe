# Demo video: voiceover script

For `plain-safe-demo.mp4` (3:42, 1280×800, no audio). Each block is timed to its scene and sized for a
comfortable pace, about 150 words a minute. Times are positions in the video.

**How it was recorded:** the production build, driven by Playwright, against a local fork of Sepolia. The
Safe is a real SafeL2 v1.4.1 (2 of 3) created from the official factory on the fork, owned by throwaway
keys. "Alice's wallet" and "Bob's wallet" are test wallets that sign with those keys. Nothing was sent to
a public network, and testnet swap prices aren't real.

---

### 0:00 · Title (4 s)

> This is Plain Safe: a multisig app with no backend.

### 0:04 · 1. First run (17 s)

*On screen: the setup screen, a Sepolia RPC typed in and tested, then "Optional network access", all off.*

> On first run, you pick one RPC per chain. That's the only thing Plain Safe ever talks to. Here, Sepolia
> points at a local fork, so we can sign with test keys. Anything extra, like Sourcify or signature
> lookups, is off by default.

### 0:21 · 2. Add a Safe (28 s)

*On screen: the Safe address is checked, "Verified Safe v1.4.1 (L2)", owners Alice, Bob and Carol, then the
overview and the network log drawer.*

> Adding a Safe doesn't trust what the contract says about itself. Plain Safe hashes the proxy's code and
> the singleton's code, and matches them against Safe's official deployments. This one is a verified
> SafeL2, version 1.4.1. Owners, threshold and balances are all read at one pinned block. And the network
> log shows exactly who we talked to: our two RPCs, and nothing else.

### 0:50 · 3. Build, review and sign (43 s)

*On screen: New transaction, Send a token, 120 USDC to "Dana (design studio)", then the review: summary,
details, simulation, hashes. Alice connects and signs; the share panel appears.*

> Let's pay 120 USDC to a design studio. The recipient shows the label from my own address book, which
> lives only in this browser. Every transaction gets the same review screen. The summary comes from clear
> signing, ERC-7730, but safety warnings are always computed from the decoded calldata itself. The
> simulation runs the real execTransaction through the RPC, before anyone has signed: minus 120 USDC.
> The domain hash, message hash and safeTxHash are always on screen, to compare with your hardware
> wallet. Alice signs, and it's ready to share.

### 1:33 · 4. A co-signer signs and executes (31 s)

*On screen: Bob's browser opens the link: "Not yet checked against the chain", hashes and one signature.
He sets up an RPC, connects, signs (2 of 2) and executes. "Executed".*

> The share link carries the transaction and its signatures after the hash sign, a part of the URL that
> browsers never send to a server. Bob opens it in a fresh browser. Before any setup, the hashes are
> recomputed and Alice's signature is recovered, offline. Bob adds his RPC, connects his wallet and
> signs: two of two. He executes, and it lands on-chain. No transaction service, no API, no account.

### 2:03 · 5. Swap on Uniswap (31 s)

*On screen: the Swap form, 0.1 ETH for USDC, the quote with its route and TWAP check, then the review: the
router's commands in plain words, the swap panel with a fresh quote, the simulation.*

> Swaps go through Uniswap, quoted on-chain by Uniswap's own quoter contracts across v3 and v4. There's no
> Uniswap API. Each quote is checked against a 30-minute average price, to catch a manipulated pool. No
> clear-signing descriptor exists for the Universal Router, so Plain Safe decodes its commands itself:
> wrap 0.1 ETH, swap on v3, pay this Safe. The review re-quotes the route against the signed minimum.

### 2:34 · 6. Safety: a change of owners (18 s)

*On screen: adding Dana as a fourth owner with threshold 3, then the review's orange banner and the before →
after list.*

> Changing owners is how multisigs get taken over. Plain Safe flags it in orange and shows the owners and
> threshold before and after, computed from the calldata, never from a description someone else wrote.

### 2:52 · 7. Verify, with no RPC and no wallet (20 s)

*On screen: a fresh browser on the Verify page. The link is pasted, the hashes and the decoded call
appear, and the network log shows 0 requests.*

> The Verify page checks a transaction with no setup, no RPC and no wallet. Paste a link, and it
> recomputes the three hashes and decodes the call offline. The network log proves it: zero requests.

### 3:13 · 8. Settings (24 s)

*On screen: Network access (each capability with its host), Network log, Clear signing, Back up and
Restore, About.*

> Every extra network capability is opt-in, and each one names the host it contacts. The network log is
> kept in memory only. Clear-signing descriptors are pinned to one registry commit and checked by hash.
> Back up saves everything to one file, and About lists this build's exact commit and dependencies.

### 3:36 · End (6 s)

> Plain Safe. No backend, a reproducible build. Your keys, your RPC, nothing else.

---

**Tips:** record each block separately, and pause a beat at each scene change: the video fades there. If a
block runs long, cut its last sentence; each block's first sentences say what matters most.
