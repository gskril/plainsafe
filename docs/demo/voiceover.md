# Demo video: voiceover script

For `plain-safe-demo.mp4` (3:57, 1280×800, no audio). One block per scene, each sized to fit its scene at
about 150 words a minute (the pace of the first recording) with a second or two to spare. Times are
positions in the video.

**How it was recorded:** the production build, driven by Playwright. Scenes 1–4 and 6–9 run against a local
fork of Sepolia. That Safe is a real SafeL2 v1.4.1 (2 of 3), created from the official factory on the fork
and owned by throwaway keys. "Alice's wallet" and "Bob's wallet" are test wallets that sign with those
keys. Nothing was sent to a public network, and testnet swap prices aren't real. Scene 5 reads a public
Mainnet Safe (`0xeE9e…252E`) through the default Mainnet RPC. It only reads, and the scan's wait is sped up.

**Delivery:** talk it through as if you're showing a friend, not reading a spec. Contractions are
fine, and so are small pauses. Where a line and the screen drift apart by a second, let it go.

---

### 0:00 · Title (4 s) · `01-title.mp3`

> Meet Plain Safe: your Safe multisig, with no backend.

### 0:04 · 1. First run (17 s) · `02-first-run.mp3`

*On screen: the setup screen, a Sepolia RPC typed in and tested, then "Optional network access", all off.*

> The first time you open it, you pick an RPC for each chain. And that's it: that's the only server
> Plain Safe talks to. Anything extra stays off until you turn it on. For this demo, Sepolia is a local
> fork.

### 0:21 · 2. Add a Safe (28 s) · `03-add-safe.mp3`

*On screen: the Safe address is checked, "Verified Safe v1.4.1 (L2)", owners Alice, Bob and Carol, then the
overview and the network log drawer.*

> Now let's add a Safe. Plain Safe doesn't take the contract's word for what it is. It checks the actual
> bytecode against Safe's official deployments. This one checks out: a real Safe, version 1.4.1, two of
> three. The overview loads in a handful of requests, and the network log shows every one of them. Just
> our RPCs, nothing else.

### 0:50 · 3. Build, review and sign (43 s) · `04-build-review-sign.mp3`

*On screen: New transaction, Send a token, 120 USDC to "Dana (design studio)", then the review: summary,
details, simulation, hashes. Alice connects and signs; the share panel appears.*

> Let's pay a design studio 120 USDC. Dana's name comes from my own address book, which never leaves this
> browser. Then the review, and every transaction gets the same one. Up top there's a plain-English
> summary, but the warnings are always worked out from the actual calldata, never from someone's
> description of it. Before anyone signs, Plain Safe simulates the real transaction: the Safe loses
> exactly 120 USDC. All three hashes are right there to check against your hardware wallet. Alice signs,
> and we get a link to share.

### 1:33 · 4. A co-signer signs and executes (31 s) · `05-cosigner-execute.mp3`

*On screen: Bob's browser opens the link: "Not yet checked against the chain", hashes and one signature.
Bob sets up an RPC, connects, signs (2 of 2) and executes. "Executed".*

> Here's the neat part. The signatures travel inside the link, after the hash sign, which is the part of
> a URL your browser never sends to a server. Bob opens it in a brand-new browser. Before any setup, the
> hashes are already recomputed and Alice's signature checked. Bob adds an RPC, connects, signs, that's
> two of two, and executes. No transaction service, no API, no account.

### 2:03 · 5. Onchain history (25 s) · `06-on-chain-history.mp3`

*On screen: a real Mainnet Safe. Onchain history is turned on, the scan counts up to "78 of 78
transactions found" (sped up) and says "History complete". A row opens into a decoded batch of three USDC
transfers.*

> This is a real Mainnet Safe with 78 transactions. The official app gets this history from Safe's
> servers. Plain Safe rebuilds it from the chain, over your own RPC, in the background, and picks up where
> it left off if you close the tab. It even tells you when the history is complete. And every row is
> decoded, batches included.

### 2:29 · 6. Swap on Uniswap (31 s) · `07-uniswap-swap.mp3`

*On screen: the Swap form, 0.1 ETH for USDC, the quote with its route and TWAP check, then the review: the
router's commands in plain words, the swap panel with a fresh quote, the simulation.*

> Swaps don't need an API either. Quotes come straight from Uniswap's quoter contracts, across v3 and
> v4, and each one is checked against a thirty-minute average price, so a manipulated pool stands out.
> Nobody publishes a readable format for Uniswap's router, so Plain Safe decodes its commands itself:
> wrap 0.1 ETH, swap on v3, and send the USDC back to this Safe.

### 2:59 · 7. Safety: a change of owners (18 s) · `08-owner-change.mp3`

*On screen: adding Dana as a fourth owner with threshold 3, then the review's orange banner and the before →
after list.*

> Here we add a fourth owner. Owner changes are how multisigs get taken over, so Plain Safe makes them
> loud: an orange warning, and the owners and threshold before and after, read from the calldata itself.

### 3:17 · 8. Verify, with no RPC and no wallet (20 s) · `09-verify-offline.mp3`

*On screen: a fresh browser on the Verify page. The link is pasted, the hashes and the decoded call
appear, and the network log shows 0 requests.*

> Need to check a transaction on another machine? The Verify page needs no setup, no RPC and no wallet.
> Paste a link, and it recomputes all three hashes and decodes the call, completely offline. The network
> log says it all: zero requests.

### 3:38 · 9. Settings (11 s) · `10-settings.mp3`

*On screen: Network access, each capability with the host it contacts, then Clear signing.*

> Everything beyond your RPC is opt-in, and each switch names the exact host it would talk to. No
> analytics, no telemetry, anywhere.

### 3:49 · End (7 s) · `11-end.mp3`

> That's Plain Safe. No backend, no accounts. Just your keys and your RPC.

---

**Tips:** record each block as its own clip, named as above, and leave a beat of silence at each end: the
video fades between scenes. If a block runs long, drop its last sentence. The first sentences carry what
matters most.
