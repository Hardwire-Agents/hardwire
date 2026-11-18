# HARDWIRE (`$HWIRE`) — AI Execution Copilot & Direct Router on Robinhood Chain

- **`$HWIRE` Contract (Robinhood Chain, 4663):** [`0x0E7112755970b3E99dF6A5D516C6F694fA393310`](https://ponsfamily.com/launchpad/0x0E7112755970b3E99dF6A5D516C6F694fA393310)

Skip the 1.00% bot-router tax. Wire your wallet and AI agent straight to Pons v2 bonding curves and Uniswap v4 pools on Robinhood Chain (`4663`).

- **Website:** [hardwireagent.com](https://hardwireagent.com)
- **GitHub:** [github.com/Hardwire-Agents/hardwire](https://github.com/Hardwire-Agents/hardwire)
- **X:** [@hardwireagent](https://x.com/hardwireagent)
- **`HardwireRouter` (Chain 4663, Sourcify `exact_match`):** [`0x88f251df2012e58a6fcdaec69dc3fa2f6310d808`](https://repo.sourcify.dev/4663/0x88f251df2012e58a6fcdaec69dc3fa2f6310d808)
- **Remote MCP Endpoint:** `https://hardwireagent.com/mcp` (`POST` JSON-RPC 2.0)
- **Machine Docs:** [`/llms.txt`](https://hardwireagent.com/llms.txt) · [`/openapi.json`](https://hardwireagent.com/openapi.json)

## Architecture

1. **`contracts/HardwireRouter.sol`** (`solc 0.8.24`, `cancun`, Sourcify exact-match ready):
   - Executes `directBuy`, `directSell`, `swarmBuy` (2–8 recipient wallets in one block), and `basketBuy` directly against `PonsV2BondingCurve` pre-graduation and auto-switches to Uniswap v4 (`UniversalRouter` + `Permit2` + `PONS_HOOK`) the block a token graduates.
   - Enforces `maxCreatorTaxBps` on-chain so agents never get trapped by predatory creator taxes.
   - Charges **0.00% router fee** for protocol token holders (`>= 500,000`) and **0.30%** for non-holders (`3.3x` cheaper than 1.00% bot routers), routing 100% of collected ETH into an immutable `burnBucket` with zero admin withdrawal. Anyone can call `ignite()` (earning a 1.00% ETH gas tip) to buy and burn protocol tokens straight to `0x000000000000000000000000000000000000dEaD`.
2. **`worker/src/index.js`** (Cloudflare Worker + Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`):
   - Tool-grounded AI Execution Copilot (`/v1/copilot`) emitting SHA-256 execution receipts.
   - Curve & Block-8 Sniper Floor X-Ray (`/v1/audit`), Live Radar (`/v1/radar`), Non-Custodial Calldata Builder (`/v1/build-tx`), and 203 24/7 Tokenized Equities Directory (`/v1/stocks`).
   - Streamable HTTP JSON-RPC 2.0 Model Context Protocol server (`/mcp`) with 5 live tools.
3. **`site/`** (5-page zero-dependency static terminal built by `build.mjs`).

## Verify Locally

```bash
node hardwire/contracts/compile.mjs
node hardwire/contracts/test.mjs     # 18/18 live Robinhood Chain 4663 fork checks
node hardwire/worker/test-api.mjs    # 9/9 live RPC + Sherwood + MCP + Copilot checks
node hardwire/build.mjs
```

## License

MIT
