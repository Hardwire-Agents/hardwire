#!/usr/bin/env node
// Generates all 5 static terminal pages for HARDWIRE into hardwire/site/.
// Zero pre-launch ticker leak: TOKEN_CA_TEXT & TOKEN_LABEL are patched atomically by launch.mjs at T=0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, "site");
fs.mkdirSync(SITE, { recursive: true });

const SITE_DOMAIN = "hardwireagent.com";
const X_HANDLE = "hardwireagent";
const TOKEN_CA_TEXT = "ANNOUNCING ON @HARDWIREAGENT";
const TOKEN_LABEL = "HARDWIRE Token";

function shell({ active, title, desc, body }) {
  const navItems = [
    ["index.html", "desk", "Copilot & Router"],
    ["xray.html", "xray", "Curve X-Ray"],
    ["stocks.html", "stocks", "24/7 Equities"],
    ["agents.html", "mcp", "MCP & Agents"],
    ["furnace.html", "furnace", "Zero-Fee & Furnace"],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="https://${SITE_DOMAIN}/" />
  <meta property="og:image" content="https://${SITE_DOMAIN}/og-card.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@${X_HANDLE}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="https://${SITE_DOMAIN}/og-card.png" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/" class="brand">
        <img src="/mark.svg" alt="HARDWIRE" />
        <span>HARDWIRE</span>
        <span class="brand-tag">CHAIN 4663</span>
      </a>
      <nav class="nav">
        ${navItems
          .map(
            ([href, key, label]) =>
              `<a href="/${href === "index.html" ? "" : href}" class="${active === key ? "active" : ""}">${label}</a>`
          )
          .join("\n        ")}
      </nav>
      <div class="nav-actions">
        <span class="ca-pill" id="caPill" data-copy="${TOKEN_CA_TEXT.startsWith("0x") ? TOKEN_CA_TEXT : ""}">${
    TOKEN_CA_TEXT.startsWith("0x") ? `CA: ${TOKEN_CA_TEXT.slice(0, 6)}…${TOKEN_CA_TEXT.slice(-4)}` : TOKEN_CA_TEXT
  }</span>
        <button class="btn btn-primary" id="connectBtn">Connect Wallet</button>
      </div>
    </div>
  </header>

  <div class="ticker-bar">
    <div class="ticker-bar-inner">
      <div><span class="dot-live"></span><span id="barSession">Robinhood Chain (4663) · ~100ms Blocks · Direct Curve + V4 Execution</span></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <span id="barEth">ETH —</span>
        <span id="barFee" style="color:var(--green)">Router Fee: 0.00% (vs 1.00% Bot Routers)</span>
        <a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener" style="color:var(--accent)">@${X_HANDLE} ↗</a>
      </div>
    </div>
  </div>

  <main class="wrap">
${body}
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <div>HARDWIRE · Non-custodial AI Copilot, MCP Gateway &amp; Direct Curve/V4 Router on Robinhood Chain (4663). Keys never leave your wallet.</div>
      <div style="display:flex;gap:16px;font-family:var(--mono)">
        <a href="https://github.com/Hardwire-Agents/hardwire" target="_blank" rel="noopener">GitHub</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/openapi.json">openapi.json</a>
        <a href="/mcp">MCP</a>
        <a href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener">@${X_HANDLE}</a>
      </div>
    </div>
  </footer>
  <script src="/app.js"></script>
</body>
</html>
`;
}

// 1. index.html
fs.writeFileSync(
  path.join(SITE, "index.html"),
  shell({
    active: "desk",
    title: "HARDWIRE — AI Execution Copilot & Zero-Middleman Router on Robinhood Chain",
    desc: "Skip the 1.00% bot-router tax. Autonomous AI Copilot, Curve X-Ray, and Remote MCP Gateway routing directly into Pons v2 curves and Uniswap v4 pools on Chain 4663.",
    body: `    <section class="hero">
      <div>
        <h1>Skip the 1% bot-router tax. <span>Wire straight to the curve.</span></h1>
        <p>Standard Robinhood Chain sniper routers bleed 1.00% on entry and 1.00% on exit. HARDWIRE pairs a tool-grounded AI Copilot &amp; MCP server with direct Pons v2 curve + Uniswap v4 calldata — saving 2.00% round-trip friction with on-chain creator-tax protection.</p>
      </div>
    </section>

    <section class="kpi-row">
      <div class="kpi">
        <div class="kpi-label">Holder Router Fee</div>
        <div class="kpi-val" id="kpiFee" style="color:var(--green)">0.00%</div>
        <div class="kpi-sub">0.30% non-holder → 100% burned</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Saved vs Bot Routers</div>
        <div class="kpi-val" id="kpiSaved">2.00% RT</div>
        <div class="kpi-sub">1.00% buy + 1.00% sell bypassed</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Stock Token Directory</div>
        <div class="kpi-val" id="kpiStocks">203 Equities</div>
        <div class="kpi-sub">24/7 ERC-20 spot on Chain 4663</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">US Market Clock</div>
        <div class="kpi-val" id="kpiSession">LIVE</div>
        <div class="kpi-sub">Sub-second 100ms EVM finality</div>
      </div>
    </section>

    <section class="grid-desk" style="margin-bottom:22px">
      <!-- Left: Grounded AI Copilot -->
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">AI Execution Copilot · Live RPC + Sherwood Grounded</span>
          <span class="badge badge-cyan">SHA-256 Receipt</span>
        </div>
        <div class="panel-body">
          <div class="chips">
            <button class="chip" data-prompt="Scan live active Pons curves and highlight router savings">Live Curve Scan</button>
            <button class="chip" data-prompt="Audit 0x01db7687276EAe013F287edcb904960116462357 and build a 0.05 ETH buy">X-Ray + 0.05E Buy</button>
            <button class="chip" data-prompt="Split 0.12 ETH swarm buy across 4 wallets on 0x7e270fbd339c5b6cbddb8db6821ec94184f902fb">4-Wallet Swarm</button>
            <button class="chip" data-prompt="Lookup $NVDA, $TSLA and $MSTR 24/7 stock tokens on Robinhood Chain">24/7 Stock Tokens</button>
          </div>
          <div class="chat-log" id="chatLog"></div>
          <div class="input-row">
            <input type="text" id="copilotInput" placeholder="Paste any 0x token, $TICKER, or ask Copilot to simulate a direct trade…" />
            <button class="btn btn-primary" id="copilotSend">Run</button>
          </div>
        </div>
      </div>

      <!-- Right: Non-Custodial Direct Router Ticket -->
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Direct Execution Ticket · Auto Curve / V4 Switch</span>
          <span class="badge badge-green">Non-Custodial</span>
        </div>
        <div class="panel-body">
          <div class="tabs">
            <button class="tab-btn active" data-mode="directBuy">Direct Buy</button>
            <button class="tab-btn" data-mode="directSell">Direct Sell</button>
            <button class="tab-btn" data-mode="swarmBuy">Swarm (2–8)</button>
            <button class="tab-btn" data-mode="ladderPlan">TP Ladder</button>
          </div>

          <div class="saved-banner">
            <span>⚡ Bypassing 1.00% bot router</span>
            <strong id="savedBannerVal">0.0005 ETH saved</strong>
          </div>

          <div class="field">
            <label><span>Pons Token (0x… or Symbol)</span><span>Chain 4663</span></label>
            <input type="text" id="tradeToken" value="0x01db7687276EAe013F287edcb904960116462357" />
          </div>

          <div class="field">
            <label><span id="amtLabel">ETH Amount</span><span>Constant-Product Sim</span></label>
            <input type="number" id="tradeAmount" value="0.05" step="0.01" min="0.001" />
          </div>

          <div class="field" id="swarmField" style="display:none">
            <label><span>Recipient Swarm Wallets (comma/line separated, 2–8)</span><span>Holder Unlocked</span></label>
            <textarea id="swarmWallets" rows="2" placeholder="0xWallet1, 0xWallet2, 0xWallet3, 0xWallet4"></textarea>
          </div>

          <div class="field">
            <label><span>Max Creator Tax Guard (%)</span><span>Reverts if higher</span></label>
            <input type="number" id="maxTaxInput" value="3.5" step="0.5" min="0" max="10" />
          </div>

          <div class="quote-box" id="quoteBox">
            <div class="quote-line"><span>Loading live curve reserves…</span></div>
          </div>

          <button class="btn btn-primary" style="width:100%;padding:11px" id="execTradeBtn">Sign &amp; Execute Direct in Wallet</button>
          <div class="status-note" id="tradeNote"></div>
        </div>
      </div>
    </section>

    <!-- Live Radar -->
    <section class="panel">
      <div class="panel-head">
        <span class="panel-title">Live Pons v2 Curve &amp; Uniswap v4 Radar (Click any row to load ticket)</span>
        <div class="chips" style="margin:0">
          <button class="chip active" data-radar-phase="all">All Active</button>
          <button class="chip" data-radar-phase="curve">Bonding Curves</button>
          <button class="chip" data-radar-phase="graduated">Graduated V4</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Venue</th>
              <th>Curve Progress</th>
              <th>Implied MCAP</th>
              <th>Volume</th>
              <th>Creator Tax</th>
              <th>HARDWIRE Edge</th>
            </tr>
          </thead>
          <tbody id="radarBody">
            <tr><td colspan="7">Connecting to Robinhood Chain live stream…</td></tr>
          </tbody>
        </table>
      </div>
    </section>`,
  })
);

// 2. xray.html
fs.writeFileSync(
  path.join(SITE, "xray.html"),
  shell({
    active: "xray",
    title: "Curve & Sniper X-Ray — HARDWIRE (Robinhood Chain)",
    desc: "Inspect any Pons v2 token on Robinhood Chain: Sherwood AI classification, ticker clone count, creator tax, and block +8..+11 sniper floor math.",
    body: `    <section class="hero">
      <div>
        <h1>Curve &amp; Block-8 Sniper <span>X-Ray</span></h1>
        <p>Before entering a Pons v2 bonding curve, inspect whether block +8..+11 snipers scooped cheap floor supply to dump at $9K MCAP, verify Sherwood AI taxonomy, and check exact ticker clone counts.</p>
      </div>
    </section>

    <div class="panel" style="margin-bottom:18px">
      <div class="panel-body">
        <div class="chips">
          <button class="chip" data-xray-q="0x01db7687276EAe013F287edcb904960116462357">Inspect Active Curve</button>
          <button class="chip" data-xray-q="0x89eb4e6d4d0d6012fbf7724315a579093054eb0a">Inspect Graduated V4 ($CYC)</button>
          <button class="chip" data-xray-q="0x7e270fbd339c5b6cbddb8db6821ec94184f902fb">Inspect $TALLY</button>
        </div>
        <div class="input-row">
          <input type="text" id="xrayInput" value="0x01db7687276EAe013F287edcb904960116462357" placeholder="Paste any 0x token address or symbol on Robinhood Chain…" />
          <button class="btn btn-primary" id="xrayBtn">Run X-Ray</button>
        </div>
      </div>
    </div>

    <div id="xrayResult"></div>`,
  })
);

// 3. stocks.html
fs.writeFileSync(
  path.join(SITE, "stocks.html"),
  shell({
    active: "stocks",
    title: "24/7 Tokenized Equities Directory — HARDWIRE (Chain 4663)",
    desc: "Search all 203 24/7 Robinhood Chain ERC-20 stock tokens resolved by 9-character CUSIP with live US session clock.",
    body: `    <section class="hero">
      <div>
        <h1>203 Tokenized Equities · <span>24/7 Onchain Wire</span></h1>
        <p>Traditional US equity brokers freeze at 16:00 ET and all weekend. Every ERC-20 equity token below settles 24/7 on Robinhood Chain (4663) and is indexed inside HARDWIRE Copilot &amp; MCP.</p>
      </div>
    </section>

    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">Robinhood Chain Equity Catalog</span>
        <span class="badge badge-cyan" id="stocksCount">203 equities</span>
      </div>
      <div class="panel-body" style="border-bottom:1px solid var(--border)">
        <input type="text" id="stocksSearch" placeholder="Filter by ticker (NVDA, TSLA, AAPL, MSTR, GME), company name, or 9-char CUSIP…" />
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Company</th>
              <th>9-Char CUSIP</th>
              <th>ERC-20 Contract</th>
              <th>Settlement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="stocksBody">
            <tr><td colspan="6">Loading 203 stock tokens…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
  })
);

// 4. agents.html
fs.writeFileSync(
  path.join(SITE, "agents.html"),
  shell({
    active: "mcp",
    title: "Remote MCP Server & Agent SDK — HARDWIRE",
    desc: "Connect Cursor, Claude Desktop, or custom trading bots to HARDWIRE's Streamable HTTP JSON-RPC 2.0 MCP Server on Robinhood Chain (4663).",
    body: `    <section class="hero">
      <div>
        <h1>Remote MCP Gateway · <span>One URL, Your Keys</span></h1>
        <p>Connect any MCP-compatible AI agent to Robinhood Chain in 10 seconds. Agents audit live curves, resolve 203 stock tokens, and receive verified non-custodial calldata — private keys never touch our server.</p>
      </div>
    </section>

    <div class="grid-desk">
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Live MCP JSON-RPC 2.0 Playground (POST /mcp)</span>
          <span class="badge badge-green">5 Live Tools</span>
        </div>
        <div class="panel-body">
          <div class="chips">
            <button class="chip" data-mcp-tool="hardwire_scan_curves" data-mcp-args='{"phase":"all","limit":4}'>hardwire_scan_curves</button>
            <button class="chip" data-mcp-tool="hardwire_audit_token" data-mcp-args='{"query":"0x01db7687276EAe013F287edcb904960116462357"}'>hardwire_audit_token</button>
            <button class="chip" data-mcp-tool="hardwire_quote_and_build_tx" data-mcp-args='{"mode":"directBuy","token":"0x01db7687276EAe013F287edcb904960116462357","ethIn":0.05}'>hardwire_quote_and_build_tx</button>
            <button class="chip" data-mcp-tool="hardwire_lookup_stock_tokens" data-mcp-args='{"q":"NVDA"}'>hardwire_lookup_stock_tokens</button>
            <button class="chip" data-mcp-tool="hardwire_router_status" data-mcp-args='{}'>hardwire_router_status</button>
          </div>
          <pre class="codeblock" id="mcpOutput" style="max-height:420px">Click any MCP tool above to execute a live JSON-RPC 2.0 call…</pre>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Cursor / Claude MCP Configuration</span>
          <a href="/llms.txt" class="btn btn-sm">llms.txt ↗</a>
        </div>
        <div class="panel-body">
          <p style="color:var(--muted);font-size:13px;margin-bottom:10px">Add to <code>.cursor/mcp.json</code> or Claude Desktop config:</p>
          <pre class="codeblock">{
  "mcpServers": {
    "hardwire-robinhood": {
      "url": "https://${SITE_DOMAIN}/mcp"
    }
  }
}</pre>
          <p style="color:var(--muted);font-size:13px;margin:14px 0 10px">Direct JSON-RPC test via cURL:</p>
          <pre class="codeblock">curl -X POST https://${SITE_DOMAIN}/mcp \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
        </div>
      </div>
    </div>`,
  })
);

// 5. furnace.html
fs.writeFileSync(
  path.join(SITE, "furnace.html"),
  shell({
    active: "furnace",
    title: "Zero-Fee Tier & Burn Furnace — HARDWIRE",
    desc: "On-chain fee tier rules and autonomous buyback-and-burn furnace in HardwireRouter.sol on Robinhood Chain (4663).",
    body: `    <section class="hero">
      <div>
        <h1>Zero-Fee Tier &amp; <span>Autonomous Burn Furnace</span></h1>
        <p>HardwireRouter.sol has zero admin withdrawal over router fees. Wallets holding &ge; 500,000 ${TOKEN_LABEL} trade at 0.00% router fee and unlock 2–8 wallet swarm execution; non-holders pay 0.30% (3.3&times; cheaper than 1.00% bot routers), 100% accumulated inside <code>burnBucket</code> for permissionless buyback-and-burn to <code>0x000…dEaD</code>.</p>
      </div>
    </section>

    <section class="kpi-row">
      <div class="kpi">
        <div class="kpi-label">Routed Volume</div>
        <div class="kpi-val" id="furnaceVol">0 ETH</div>
        <div class="kpi-sub">Chain 4663 Verified</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Saved vs 1% Bot Routers</div>
        <div class="kpi-val" id="furnaceSaved" style="color:var(--green)">0 ETH</div>
        <div class="kpi-sub">Kept by traders</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Pending Burn Bucket</div>
        <div class="kpi-val" id="furnaceBucket" style="color:var(--accent)">0 ETH</div>
        <div class="kpi-sub">1% gas tip on ignite()</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Total Burned (0x…dEaD)</div>
        <div class="kpi-val" id="furnaceBurned">0</div>
        <div class="kpi-sub">Permanent supply reduction</div>
      </div>
    </section>

    <div class="grid-desk">
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">On-Chain Alignment &amp; Tier Rules</span>
          <span class="badge badge-green">Sourcify Exact Match</span>
        </div>
        <div class="panel-body">
          <div class="quote-box">
            <div class="quote-line"><span>Protocol Token</span><strong>${TOKEN_CA_TEXT}</strong></div>
            <div class="quote-line"><span>HardwireRouter Contract</span><strong id="furnaceRouterAddr">—</strong></div>
            <div class="quote-line"><span>Standard Tier (0 ${TOKEN_LABEL})</span><strong>0.30% router fee · Single Buy/Sell + Copilot + MCP</strong></div>
            <div class="quote-line"><span>Direct Holder Tier (&ge; 500,000 ${TOKEN_LABEL})</span><strong style="color:var(--green)">0.00% router fee · 2–8 Wallet Swarm + Basket Buy</strong></div>
            <div class="quote-line"><span>Priority Deep Audit Burn</span><strong>25,000 ${TOKEN_LABEL} → 0x000…dEaD</strong></div>
          </div>
          <div class="status-note" id="tierWalletStatus">Connect wallet on Chain 4663 to check holder tier.</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Permissionless Buyback &amp; Burn (ignite)</span>
          <span class="badge badge-amber">1.00% Caller Tip</span>
        </div>
        <div class="panel-body">
          <p style="color:var(--muted);font-size:13.5px;margin-bottom:14px">Whenever <code>burnBucket &ge; 0.0002 ETH</code>, any wallet or keeper bot can trigger <code>HardwireRouter.ignite()</code>. The contract buys ${TOKEN_LABEL} directly on the Pons v2 curve (or Uniswap v4 pool post-graduation) straight to <code>0x000000000000000000000000000000000000dEaD</code> and pays the caller 1% in ETH for gas.</p>
          <button class="btn btn-primary" style="width:100%;padding:11px" id="igniteBtn">Trigger Public ignite() → 0x…dEaD</button>
          <div class="status-note" id="furnaceNote"></div>
        </div>
      </div>
    </div>`,
  })
);

console.log("[OK] Built 5 HARDWIRE pages into hardwire/site/ (zero pre-launch ticker leak).");
