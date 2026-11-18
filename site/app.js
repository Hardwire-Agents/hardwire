(function () {
  const EMBEDDED_TOKEN_CA = ""; // Patched atomically by launch.mjs at T=0
  const EMBEDDED_ROUTER_ADDR = "0x88f251df2012e58a6fcdaec69dc3fa2f6310d808"; // Sourcify exact_match on 4663
  const CHAIN_HEX = "0x1237"; // 4663 Robinhood Chain

  const state = {
    wallet: localStorage.getItem("hw_wallet") || "",
    status: null,
    radar: [],
    mode: "directBuy",
    activeToken: "0x01db7687276EAe013F287edcb904960116462357",
    lastBundle: null,
  };

  const $ = (id) => document.getElementById(id);
  const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—");
  const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function ensureRobinhoodChain() {
    if (!window.ethereum) throw new Error("Install MetaMask or Rabby wallet to sign on Robinhood Chain (4663).");
    const cur = await window.ethereum.request({ method: "eth_chainId" });
    if (cur.toLowerCase() !== CHAIN_HEX) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_HEX }],
        });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: "Robinhood Chain",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
                blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
              },
            ],
          });
        } else {
          throw e;
        }
      }
    }
  }

  async function connectWallet() {
    try {
      if (!window.ethereum) {
        alert("No injected EVM wallet detected. Open in a browser with MetaMask or Rabby.");
        return;
      }
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accs && accs[0]) {
        state.wallet = accs[0];
        localStorage.setItem("hw_wallet", state.wallet);
        updateWalletButtons();
        await loadStatus();
      }
    } catch (e) {
      console.error(e);
    }
  }

  function updateWalletButtons() {
    const btn = $("connectBtn");
    if (btn) {
      btn.textContent = state.wallet ? shortAddr(state.wallet) : "Connect Wallet";
    }
  }

  async function loadStatus() {
    try {
      const q = state.wallet ? `?wallet=${encodeURIComponent(state.wallet)}` : "";
      const r = await fetch(`/v1/status${q}`);
      const d = await r.json();
      if (!d.ok) return;
      state.status = d;

      if ($("barSession")) {
        $("barSession").textContent = `${d.market.etClock} (${d.market.session}) · RH 24/7 LIVE`;
      }
      if ($("barEth")) {
        $("barEth").textContent = `ETH $${fmtNum(d.ethUsd)}`;
      }
      if ($("barFee")) {
        const bps = d.tier?.activeRouterFeeBps ?? 0;
        $("barFee").textContent = `Router Fee: ${(bps / 100).toFixed(2)}% (vs 1.00% Bot Routers)`;
      }

      const caText = d.contracts?.hardwireToken || EMBEDDED_TOKEN_CA;
      if ($("caPill") && caText) {
        $("caPill").textContent = `CA: ${shortAddr(caText)}`;
        $("caPill").dataset.copy = caText;
      }

      // Populate KPI cards if on home or furnace
      if ($("kpiFee")) $("kpiFee").textContent = `${((d.tier?.activeRouterFeeBps ?? 0) / 100).toFixed(2)}%`;
      if ($("kpiSaved")) $("kpiSaved").textContent = "2.00% RT";
      if ($("kpiStocks")) $("kpiStocks").textContent = "203 Equities";
      if ($("kpiSession")) $("kpiSession").textContent = d.market.session;

      if ($("furnaceRouterAddr")) {
        const rAddr = d.contracts?.hardwireRouter || EMBEDDED_ROUTER_ADDR || "Deploying before launch";
        $("furnaceRouterAddr").textContent = rAddr;
        $("furnaceVol").textContent = `${d.router?.volumeEth ?? 0} ETH`;
        $("furnaceSaved").textContent = `${d.router?.savedVsBotsEth ?? 0} ETH`;
        $("furnaceBucket").textContent = `${d.router?.pendingBurnEth ?? 0} ETH`;
        $("furnaceBurned").textContent = `${fmtNum(d.router?.deadBalanceTokens || d.router?.burnedTokens || 0)}`;
        $("tierWalletStatus").textContent = state.wallet
          ? `${shortAddr(state.wallet)} · Active Fee: ${((d.tier?.activeRouterFeeBps ?? 0) / 100).toFixed(2)}% · Credits: ${d.tier?.priorityCredits ?? 0}`
          : "Connect wallet on Chain 4663 to verify zero-fee holder status.";
      }
    } catch (e) {
      console.error("status err", e);
    }
  }

  // ─── Page 1: Desk (Copilot + Direct Router + Live Radar) ────────────────────
  async function loadRadar(phase = "all") {
    const tbody = $("radarBody");
    if (!tbody) return;
    try {
      const r = await fetch(`/v1/radar?phase=${encodeURIComponent(phase)}&limit=14`);
      const d = await r.json();
      state.radar = d.items || [];
      if (!state.radar.length) {
        tbody.innerHTML = `<tr><td colspan="7">No tokens returned.</td></tr>`;
        return;
      }
      const defaultPick = state.radar.find((t) => !t.graduated && t.address) || state.radar[0];
      if (defaultPick?.address && $("tradeToken") && !$("tradeToken").dataset.touched) {
        state.activeToken = defaultPick.address;
        $("tradeToken").value = defaultPick.address;
        refreshQuote();
      }
      tbody.innerHTML = state.radar
        .map((t) => {
          const badgeCls = t.graduated ? "badge-cyan" : t.progressPct >= 75 ? "badge-green" : "badge-amber";
          return `<tr class="clickable" data-addr="${escapeHtml(t.address)}">
            <td><strong>$${escapeHtml(t.symbol)}</strong> <span style="color:var(--dim)">${escapeHtml(t.name.slice(0, 18))}</span></td>
            <td><span class="badge ${badgeCls}">${escapeHtml(t.venue)}</span></td>
            <td><span class="prog-track"><span class="prog-fill" style="width:${Math.min(100, t.progressPct)}%"></span></span>${t.progressPct}%</td>
            <td>$${fmtNum(t.mcapUsd)}</td>
            <td>${t.volumeEth} ETH</td>
            <td>${(t.creatorTaxBps / 100).toFixed(2)}%</td>
            <td><span class="badge badge-green">Save 2.0% RT</span></td>
          </tr>`;
        })
        .join("");

      tbody.querySelectorAll("tr.clickable").forEach((row) => {
        row.addEventListener("click", () => {
          const addr = row.dataset.addr;
          if ($("tradeToken")) {
            $("tradeToken").value = addr;
            $("tradeToken").dataset.touched = "1";
            state.activeToken = addr;
            refreshQuote();
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7">Live feed error: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function refreshQuote() {
    const tokenEl = $("tradeToken");
    const box = $("quoteBox");
    if (!tokenEl || !box) return;
    const token = tokenEl.value.trim();
    if (!token) return;

    const ethIn = Number($("tradeAmount")?.value || 0.05);
    const maxTaxPct = Number($("maxTaxInput")?.value || 3.5);
    const body = {
      mode: state.mode,
      token,
      ethIn,
      tokensIn: state.mode === "directSell" ? Number($("tradeAmount")?.value || 250000) : undefined,
      wallet: state.wallet,
      maxCreatorTaxBps: Math.round(maxTaxPct * 100),
      recipients:
        state.mode === "swarmBuy"
          ? ($("swarmWallets")?.value || "")
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    };

    box.innerHTML = `<div class="quote-line"><span>Simulating on Robinhood Chain (4663)…</span></div>`;
    try {
      const r = await fetch("/v1/build-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) {
        state.lastBundle = null;
        box.innerHTML = `<div style="color:var(--red)">${escapeHtml(d.error)}</div>`;
        return;
      }
      state.lastBundle = d;

      if (d.mode === "ladderPlan") {
        box.innerHTML = d.tranches
          .map(
            (t) =>
              `<div class="quote-line"><span>Tranche ${t.step} (${t.pct}%) · ${escapeHtml(t.trigger)}</span><strong>${escapeHtml(t.note)}</strong></div>`
          )
          .join("");
        return;
      }

      const q = d.quote;
      if ($("savedBannerVal")) {
        $("savedBannerVal").textContent = `${q.savedEth} ETH ($${q.savedUsd}) saved vs 1% bot routers`;
      }
      box.innerHTML = `
        <div class="quote-line"><span>Target Token</span><strong>$${escapeHtml(d.token.symbol)} · ${escapeHtml(d.token.venue)}</strong></div>
        <div class="quote-line"><span>${q.side === "buy" ? "Estimated Output" : "Estimated ETH Out"}</span><strong>${
        q.side === "buy" ? fmtNum(q.tokensOut) + " $" + escapeHtml(d.token.symbol) : q.ethOut + " ETH ($" + q.ethOutUsd + ")"
      }</strong></div>
        <div class="quote-line"><span>Curve + Creator Fee</span><strong>${q.curveAndCreatorFeePct}%</strong></div>
        <div class="quote-line"><span>HARDWIRE Router Fee</span><strong style="color:var(--green)">${(q.routerFeeBps / 100).toFixed(2)}% (Bots: 1.00%)</strong></div>
        <div class="quote-line"><span>Price Impact</span><strong>${q.priceImpactPct}%</strong></div>
        <div class="quote-line"><span>Calldata Target</span><strong>${escapeHtml(d.tx.targetLabel)}</strong></div>
      `;
    } catch (e) {
      box.innerHTML = `<div style="color:var(--red)">${escapeHtml(e.message)}</div>`;
    }
  }

  async function executeBundle(bundle, noteId = "tradeNote") {
    const note = $(noteId);
    if (!bundle || !bundle.tx) {
      if (note) note.textContent = "Select a valid token & simulate quote first.";
      return;
    }
    try {
      await ensureRobinhoodChain();
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      const from = accs[0];

      if (bundle.approveTx) {
        if (note) note.textContent = "Step 1/2: Approving token spend in wallet…";
        const appHash = await window.ethereum.request({
          method: "eth_sendTransaction",
          params: [{ from, to: bundle.approveTx.to, value: "0x0", data: bundle.approveTx.data }],
        });
        if (note) note.textContent = `Approval sent (${shortAddr(appHash)}). Confirming trade…`;
      }

      if (note) note.textContent = `Signing ${bundle.tx.targetLabel} in wallet…`;
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to: bundle.tx.to,
            value: bundle.tx.valueHex || "0x0",
            data: bundle.tx.data,
          },
        ],
      });
      if (note) {
        note.innerHTML = `Confirmed broadcast: <a href="https://robinhoodchain.blockscout.com/tx/${txHash}" target="_blank" rel="noopener" style="text-decoration:underline">${shortAddr(txHash)} ↗</a>`;
      }
    } catch (e) {
      if (note) note.textContent = `Wallet action: ${e.message || e}`;
    }
  }

  async function sendCopilotPrompt(text) {
    const log = $("chatLog");
    const input = $("copilotInput");
    const prompt = (text ?? input?.value ?? "").trim();
    if (!prompt || !log) return;
    if (input && !text) input.value = "";

    const uDiv = document.createElement("div");
    uDiv.className = "msg user";
    uDiv.innerHTML = `<div class="msg-meta"><span>OPERATOR</span><span>CHAIN 4663</span></div>${escapeHtml(prompt)}`;
    log.appendChild(uDiv);

    const aDiv = document.createElement("div");
    aDiv.className = "msg";
    aDiv.innerHTML = `<div class="msg-meta"><span>HARDWIRE COPILOT</span><span>QUERYING LIVE RPC + SHERWOOD…</span></div>Running live tools…`;
    log.appendChild(aDiv);
    log.scrollTop = log.scrollHeight;

    try {
      const r = await fetch("/v1/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, wallet: state.wallet }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Copilot error");

      const formatted = escapeHtml(d.reply).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      const traces = (d.toolTrace || [])
        .map((t) => `<div>⚡ ${escapeHtml(t.tool)} → ${escapeHtml(t.summary || (t.matched || []).join(", ") || t.error || "ok")}</div>`)
        .join("");

      let actionHtml = "";
      if (d.txBundle?.tx) {
        const btnId = "exec_" + Math.random().toString(36).slice(2, 9);
        actionHtml = `<div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--bg-card);padding:9px 12px;border-radius:8px;border:1px solid var(--border-hi)">
          <span style="font-family:var(--mono);font-size:11.5px;color:var(--green)">Ready: ${escapeHtml(d.txBundle.tx.targetLabel)} · Save $${d.txBundle.quote.savedUsd}</span>
          <button class="btn btn-primary btn-sm" id="${btnId}">Sign &amp; Execute</button>
        </div>`;
        setTimeout(() => {
          const b = $(btnId);
          if (b) b.addEventListener("click", () => executeBundle(d.txBundle));
        }, 0);

        if ($("tradeToken") && d.auditCard?.address) {
          $("tradeToken").value = d.auditCard.address;
          $("tradeToken").dataset.touched = "1";
          state.lastBundle = d.txBundle;
          refreshQuote();
        }
      }

      aDiv.innerHTML = `
        <div class="msg-meta"><span>HARDWIRE COPILOT · ${escapeHtml(d.model)}</span><span>RECEIPT ${escapeHtml(d.receiptHash.slice(0, 12))}…</span></div>
        <div>${formatted}</div>
        ${traces ? `<div class="trace-list">${traces}</div>` : ""}
        ${actionHtml}
      `;
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      aDiv.innerHTML = `<div style="color:var(--red)">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  // ─── Page 2: X-Ray ──────────────────────────────────────────────────────────
  async function runXray(q) {
    const out = $("xrayResult");
    if (!out) return;
    const query = (q || $("xrayInput")?.value || "").trim();
    if (!query) return;
    out.innerHTML = `<div class="panel"><div class="panel-body">Scanning Robinhood Chain RPC, Pons v2 Factory &amp; Sherwood AI…</div></div>`;
    try {
      const r = await fetch(`/v1/audit?q=${encodeURIComponent(query)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      const a = d.audit;
      const flagsHtml = a.flags
        .map((f) => {
          const cls = f.level === "PASS" ? "badge-green" : f.level === "WARN" ? "badge-amber" : "badge-red";
          return `<span class="badge ${cls}" style="margin-right:6px;margin-bottom:6px">${escapeHtml(f.label)}</span>`;
        })
        .join("");

      out.innerHTML = `
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-label">Hygiene Score</div><div class="kpi-val">${a.score}/100</div><div class="kpi-sub">${escapeHtml(a.verdict)}</div></div>
          <div class="kpi"><div class="kpi-label">Venue &amp; Reserve</div><div class="kpi-val">${a.progressPct}%</div><div class="kpi-sub">${a.realQuoteEth} / 4.20 ETH (${escapeHtml(a.venue)})</div></div>
          <div class="kpi"><div class="kpi-label">Implied MCAP</div><div class="kpi-val">$${fmtNum(a.impliedMcapUsd)}</div><div class="kpi-sub">Vol: ${a.curveVolumeEth} ETH (${a.buyCount}B / ${a.sellCount}S)</div></div>
          <div class="kpi"><div class="kpi-label">Creator Tax &amp; Clones</div><div class="kpi-val">${(a.creatorTaxBps / 100).toFixed(2)}%</div><div class="kpi-sub">${a.cloneCount} prior ticker clones</div></div>
        </div>
        <div class="panel" style="margin-bottom:16px">
          <div class="panel-head"><span class="panel-title">$${escapeHtml(a.symbol)} — ${escapeHtml(a.name)} (${escapeHtml(a.address)})</span><a class="btn btn-primary btn-sm" href="/?token=${encodeURIComponent(a.address)}">Route Direct 0% Trade →</a></div>
          <div class="panel-body">
            <div style="margin-bottom:14px">${flagsHtml}</div>
            <div class="quote-box">
              <div class="quote-line"><span>Estimated Deployer Floor Buy</span><strong>${a.sniperForensics.estDevFloorBuyEth} ETH (${a.sniperForensics.floorLiftStrong ? "Strong anti-sniper lift" : "Low floor — watch block-8 snipers"})</strong></div>
              <div class="quote-line"><span>Block +8..+11 Sniper Pack (~0.22 ETH)</span><strong>~${a.sniperForensics.estBlock8SniperSharePct}% supply (${a.sniperForensics.sniperRoiAt9kMcapPct}% ROI at $9K MCAP)</strong></div>
              <div class="quote-line"><span>Round-Trip Friction via HARDWIRE (Holder)</span><strong style="color:var(--green)">${a.roundTripCurveFrictionPct}% (saves 2.00% vs ${a.roundTripVia1PctBotRouterPct}% on 1% bot routers)</strong></div>
              <div class="quote-line"><span>ETH Remaining to Uniswap v4 Graduation</span><strong>${a.ethToGraduate} ETH</strong></div>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      out.innerHTML = `<div class="panel"><div class="panel-body" style="color:var(--red)">${escapeHtml(e.message)}</div></div>`;
    }
  }

  // ─── Page 3: 24/7 Stock Tokens ──────────────────────────────────────────────
  async function loadStocksPage(q = "") {
    const tbody = $("stocksBody");
    if (!tbody) return;
    try {
      const r = await fetch(`/v1/stocks?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if ($("stocksCount")) $("stocksCount").textContent = `${d.count} / ${d.totalCatalog} equities`;
      tbody.innerHTML = (d.stocks || [])
        .map(
          (s) => `<tr>
            <td><strong>$${escapeHtml(s.symbol)}</strong></td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.cusip || "—")}</td>
            <td><code>${shortAddr(s.address)}</code></td>
            <td><span class="badge badge-green">24/7 Chain 4663</span></td>
            <td>
              <button class="btn btn-sm copy-addr" data-addr="${escapeHtml(s.address)}">Copy ERC-20</button>
              <a class="btn btn-sm" href="https://robinhoodchain.blockscout.com/token/${encodeURIComponent(s.address)}" target="_blank" rel="noopener">Explorer ↗</a>
            </td>
          </tr>`
        )
        .join("");

      tbody.querySelectorAll(".copy-addr").forEach((b) => {
        b.addEventListener("click", () => {
          navigator.clipboard.writeText(b.dataset.addr);
          b.textContent = "Copied!";
          setTimeout(() => (b.textContent = "Copy ERC-20"), 1200);
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // ─── Page 4: MCP Playground ─────────────────────────────────────────────────
  async function testMcpLive(toolName, argsObj) {
    const out = $("mcpOutput");
    if (!out) return;
    out.textContent = "Sending JSON-RPC 2.0 POST /mcp …";
    try {
      const r = await fetch("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: argsObj },
        }),
      });
      const j = await r.json();
      const inner = j.result?.content?.[0]?.text;
      out.textContent = inner || JSON.stringify(j, null, 2);
    } catch (e) {
      out.textContent = "Error: " + e.message;
    }
  }

  // ─── Page 5: Burn Furnace (`ignite()`) ──────────────────────────────────────
  async function callIgnite() {
    const note = $("furnaceNote");
    const rAddr = state.status?.contracts?.hardwireRouter || EMBEDDED_ROUTER_ADDR;
    if (!rAddr) {
      if (note) note.textContent = "HardwireRouter contract will be bound at launch.";
      return;
    }
    try {
      await ensureRobinhoodChain();
      const [from] = await window.ethereum.request({ method: "eth_requestAccounts" });
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, to: rAddr, value: "0x0", data: "0xf768923a" }],
      });
      if (note) note.innerHTML = `Ignite broadcast: <a href="https://robinhoodchain.blockscout.com/tx/${txHash}" target="_blank" rel="noopener">${shortAddr(txHash)} ↗</a>`;
    } catch (e) {
      if (note) note.textContent = e.message || String(e);
    }
  }

  // ─── Boot Wiring ────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    updateWalletButtons();
    loadStatus();

    const connectBtn = $("connectBtn");
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);

    const caPill = $("caPill");
    if (caPill) {
      caPill.addEventListener("click", () => {
        const val = caPill.dataset.copy;
        if (val) {
          navigator.clipboard.writeText(val);
          const prev = caPill.textContent;
          caPill.textContent = "CA Copied!";
          setTimeout(() => (caPill.textContent = prev), 1200);
        }
      });
    }

    // Desk bindings
    if ($("radarBody")) {
      const urlTok = new URLSearchParams(location.search).get("token");
      if (urlTok && $("tradeToken")) {
        $("tradeToken").value = urlTok;
        $("tradeToken").dataset.touched = "1";
      }
      loadRadar("all");
      document.querySelectorAll("[data-radar-phase]").forEach((b) => {
        b.addEventListener("click", () => {
          document.querySelectorAll("[data-radar-phase]").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          loadRadar(b.dataset.radarPhase);
        });
      });

      document.querySelectorAll("[data-mode]").forEach((b) => {
        b.addEventListener("click", () => {
          document.querySelectorAll("[data-mode]").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          state.mode = b.dataset.mode;
          if ($("swarmField")) $("swarmField").style.display = state.mode === "swarmBuy" ? "block" : "none";
          if ($("amtLabel")) {
            $("amtLabel").textContent =
              state.mode === "directSell" ? "Token Amount to Sell" : state.mode === "swarmBuy" ? "Total Swarm ETH (Split Across Wallets)" : "ETH Amount";
          }
          if ($("tradeAmount")) {
            $("tradeAmount").value = state.mode === "directSell" ? "250000" : state.mode === "swarmBuy" ? "0.12" : "0.05";
          }
          refreshQuote();
        });
      });

      ["tradeToken", "tradeAmount", "maxTaxInput", "swarmWallets"].forEach((id) => {
        const el = $(id);
        if (el) {
          el.addEventListener("change", () => {
            if (id === "tradeToken") el.dataset.touched = "1";
            refreshQuote();
          });
        }
      });

      if ($("execTradeBtn")) {
        $("execTradeBtn").addEventListener("click", () => executeBundle(state.lastBundle, "tradeNote"));
      }

      if ($("copilotSend")) {
        $("copilotSend").addEventListener("click", () => sendCopilotPrompt());
      }
      if ($("copilotInput")) {
        $("copilotInput").addEventListener("keydown", (e) => {
          if (e.key === "Enter") sendCopilotPrompt();
        });
      }
      document.querySelectorAll("[data-prompt]").forEach((chip) => {
        chip.addEventListener("click", () => sendCopilotPrompt(chip.dataset.prompt));
      });

      // Run an automatic live scan greeting in Copilot on load
      sendCopilotPrompt("Scan live active Pons curves and highlight router savings");
    }

    // X-Ray bindings
    if ($("xrayBtn")) {
      $("xrayBtn").addEventListener("click", () => runXray());
      $("xrayInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runXray();
      });
      document.querySelectorAll("[data-xray-q]").forEach((c) => {
        c.addEventListener("click", () => {
          $("xrayInput").value = c.dataset.xrayQ;
          runXray(c.dataset.xrayQ);
        });
      });
      runXray($("xrayInput")?.value || "0x01db7687276EAe013F287edcb904960116462357");
    }

    // Stocks bindings
    if ($("stocksBody")) {
      loadStocksPage("");
      $("stocksSearch")?.addEventListener("input", (e) => loadStocksPage(e.target.value));
    }

    // MCP Playground bindings
    if ($("mcpOutput")) {
      document.querySelectorAll("[data-mcp-tool]").forEach((b) => {
        b.addEventListener("click", () => {
          const tool = b.dataset.mcpTool;
          const arg = JSON.parse(b.dataset.mcpArgs || "{}");
          testMcpLive(tool, arg);
        });
      });
      testMcpLive("hardwire_scan_curves", { phase: "all", limit: 4 });
    }

    // Furnace bindings
    if ($("igniteBtn")) {
      $("igniteBtn").addEventListener("click", callIgnite);
    }
  });
})();
