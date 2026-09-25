# Releasing Plain Safe

Plain Safe is published to IPFS. A release is identified by its CID, which anyone can recompute from
the source at the release tag.

## What a release is

- **The build** is reproducible: `base: './'`, no timestamps in the output, and
  `bun install --frozen-lockfile`. Building the same commit twice gives byte-identical `dist/`.
- **The CID** is computed locally by `scripts/compute-cid.ts` (`bun run cid dist`), with no
  dependencies, using the same UnixFS settings as [omnipin](https://github.com/omnipin/omnipin)
  3.1.3:

  | Setting | Value |
  |---|---|
  | CID version, hash | CIDv1, sha2-256, printed in base32 |
  | Leaves | raw (`raw` codec, not UnixFS) |
  | Chunker | fixed-size, 262,144 bytes |
  | Layout | balanced, 174 links per node |
  | Single-chunk files | the raw leaf itself |
  | Root | all files wrapped in one directory |
  | Directories | plain UnixFS directories (no HAMT sharding; the script refuses a directory that would need it) |
  | Metadata | no mode, no mtime |
  | Included files | every regular file under `dist/`, except dotfiles; empty directories are left out |

  `test/unit/compute-cid.test.ts` pins CIDs that omnipin produced for the same inputs.

## How a release is made

Push a tag `v*`. `.github/workflows/release.yml` then:

1. installs with the frozen lockfile, runs lint and the unit tests, and builds;
2. computes the CID with `scripts/compute-cid.ts`;
3. runs `omnipin pack dist --only-hash` and **fails if omnipin's CID differs from ours**;
4. checks that at least two pinning providers are configured, then pins with `omnipin deploy dist --strict`;
5. creates the GitHub release with the CID, `dist.zip` (run it locally with `bunx serve dist`) and
   the runtime dependency list.

Provider tokens are GitHub secrets: `OMNIPIN_PINATA_TOKEN`, `OMNIPIN_LIGHTHOUSE_TOKEN`,
`OMNIPIN_FILEBASE_TOKEN`, `OMNIPIN_4EVERLAND_TOKEN`, `OMNIPIN_FILECOIN_TOKEN` (set at least two).

## Checking a release yourself

```sh
git checkout vX.Y.Z
bun install --frozen-lockfile
bun run build
bun run cid dist   # must equal the release's CID
```

## Where to open it

Use a **subdomain gateway** (`https://<cid>.ipfs.dweb.link/`) or `plainsafe.eth.limo`. Plain Safe refuses
to run on path gateways (`/ipfs/<cid>`), where every IPFS site shares one origin and could read or
change its stored data (SPEC §12). Each gateway origin has its own storage: use Back up and Restore
to move your data between releases or origins.

## ENS

`plainsafe.eth`'s contenthash is updated by hand until the name is owned by a Safe; after that,
releases are published with a Safe transaction built in Plain Safe itself:

```sh
bun run contenthash plainsafe.eth <release CID>
```

prints the name's node, the EIP-1577 contenthash and the `setContenthash(node, hash)` calldata. In
Plain Safe, open the Safe that owns the name → New transaction → Contract call → the name's resolver
→ Raw calldata, paste it, and check the decoded `setContenthash` against the printed values before
signing. `test/unit/contenthash.test.ts` checks the encoding against the EIP-1577 example.
