// HARDWIRE Cloudflare Worker — Autonomous AI Agent Copilot, Direct Pons Curve & Uniswap v4
// Execution Simulator, Non-Custodial Calldata Builder, and Remote JSON-RPC 2.0 MCP Server
// on Robinhood Chain (Chain ID 4663).

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-wallet-address, mcp-session-id",
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DEAD_ADDR = "0x000000000000000000000000000000000000dead";
const SHERWOOD_BASE = "https://api.sherwood.stream/v1/public";
const PONS_API = "https://api.ponsfamily.com/v1";

// Pons v2 constant-product economics
const PONS_PHANTOM_ETH = 1.68;
const PONS_GRAD_ETH = 4.20;
const PONS_SUPPLY = 1_000_000_000;
const PONS_CURVE_FEE_BPS = 100; // 1.00%
const BOT_ROUTER_FEE_BPS = 100; // 1.00% charged by standard third-party RH bot routers

// Verified 4-byte selectors matching HardwireRouter.sol & PonsBondingCurve
const SEL = {
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  routerStats: "0xeac85bc8",
  priorityCredits: "0xa255649e",
  userSavedWei: "0xc32939a7",
  userVolumeWei: "0x1bc4cb37",
  directBuy: "0xbfcc5905",
  directSell: "0xdcf43bbd",
  swarmBuy: "0xa16b62c4",
  basketBuy: "0x54d406c1",
  burnForPriority: "0xb61e3b12",
  ignite: "0xf768923a",
  donateAndIgnite: "0xfa76e5ea",
  curveBuy: "0x59a87bc1",
  curveSell: "0xd04c6983",
  realQuoteReserve: "0x4f1f58fd",
  graduationThreshold: "0x8b0bc501",
  graduated: "0xe7c2b772",
  creatorTaxBps: "0xc1bb8901",
  latestAnswer: "0x50d25bcd",
};

let cachedStocks = null;
let cachedStocksAt = 0;
let cachedRadar = null;
let cachedRadarAt = 0;
let cachedEthUsd = { price: 2280, ts: 0 };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extraHeaders,
    },
  });
}

function isAddr(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || "").trim());
}

function pad32(hexNo0x) {
  return String(hexNo0x).replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function u256Hex(val) {
  return BigInt(val).toString(16).padStart(64, "0");
}

function toWei(ethNum) {
  const clean = Math.max(0, Number(ethNum || 0));
  const [whole, frac = ""] = clean.toFixed(18).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(frac.slice(0, 18).padEnd(18, "0"));
}

function fromWei(weiBig) {
  return Number(BigInt(weiBig)) / 1e18;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return (
    "0x" +
    [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

async function rpcCall(env, method, params = []) {
  const rpc = env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

async function ethCallUint(env, to, data) {
  try {
    const res = await rpcCall(env, "eth_call", [{ to, data }, "latest"]);
    if (!res || res === "0x") return 0n;
    return BigInt(res);
  } catch {
    return 0n;
  }
}

async function getEthUsd(env) {
  if (Date.now() - cachedEthUsd.ts < 45_000) return cachedEthUsd.price;
  try {
    const r = await fetch(`${PONS_API}/tokens?limit=1`);
    if (r.ok) {
      const j = await r.json();
      const first = (j.items || [])[0];
      const p = Number(first?.quote_price_usd || 0);
      if (p > 200) {
        cachedEthUsd = { price: p, ts: Date.now() };
        return p;
      }
    }
  } catch {}
  return cachedEthUsd.price;
}

async function loadStocks(req, env) {
  if (cachedStocks && Date.now() - cachedStocksAt < 120_000) return cachedStocks;
  if (env.__LOCAL_STOCKS) {
    cachedStocks = env.__LOCAL_STOCKS;
    cachedStocksAt = Date.now();
    return cachedStocks;
  }
  const url = new URL("/data/stocks.json", req.url);
  const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
  if (!res.ok) return { count: 0, stocks: [] };
  cachedStocks = await res.json();
  cachedStocksAt = Date.now();
  return cachedStocks;
}

function getUsMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (k) => parts.find((p) => p.type === k)?.value || "";
  const wk = get("weekday");
  const hr = Number(get("hour"));
  const mn = Number(get("minute"));
  const mins = hr * 60 + mn;
  let session = "REGULAR";
  if (wk === "Sat" || wk === "Sun") session = "WEEKEND";
  else if (mins < 9 * 60 + 30) session = "PRE_MARKET";
  else if (mins >= 16 * 60) session = "AFTER_HOURS";
  return {
    etClock: `${wk} ${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")} ET`,
    session,
    wallStreetOpen: session === "REGULAR",
    robinhoodChain24x7: true,
  };
}

async function getWalletTier(wallet, env) {
  const threshold = Number(env.HOLDER_THRESHOLD_HWIRE || 500_000);
  const tokenAddr = String(env.HARDWIRE_TOKEN_ADDRESS || "").trim();
  const routerAddr = String(env.HARDWIRE_ROUTER_ADDRESS || "").trim();
  const validWallet = isAddr(wallet);
  const tokenLive = isAddr(tokenAddr);

  if (!tokenLive) {
    return {
      tokenLive: false,
      walletValid: validWallet,
      holderUnlocked: true, // 0% router fee open during pre-token launch window
      balanceTokens: 0,
      requiredTokens: threshold,
      activeRouterFeeBps: 0,
      nonHolderFeeBps: 30,
      botBenchmarkFeeBps: BOT_ROUTER_FEE_BPS,
      priorityCredits: 0,
      savedEth: 0,
      volumeEth: 0,
    };
  }

  if (!validWallet) {
    return {
      tokenLive: true,
      walletValid: false,
      holderUnlocked: false,
      balanceTokens: 0,
      requiredTokens: threshold,
      activeRouterFeeBps: 30,
      nonHolderFeeBps: 30,
      botBenchmarkFeeBps: BOT_ROUTER_FEE_BPS,
      priorityCredits: 0,
      savedEth: 0,
      volumeEth: 0,
    };
  }

  const wPad = pad32(wallet);
  const [balWei, credits, savedWei, volWei] = await Promise.all([
    ethCallUint(env, tokenAddr, SEL.balanceOf + wPad),
    isAddr(routerAddr) ? ethCallUint(env, routerAddr, SEL.priorityCredits + wPad) : Promise.resolve(0n),
    isAddr(routerAddr) ? ethCallUint(env, routerAddr, SEL.userSavedWei + wPad) : Promise.resolve(0n),
    isAddr(routerAddr) ? ethCallUint(env, routerAddr, SEL.userVolumeWei + wPad) : Promise.resolve(0n),
  ]);

  const balTokens = Math.floor(Number(balWei / 10n ** 15n)) / 1000;
  const unlocked = balWei >= BigInt(threshold) * 10n ** 18n;

  return {
    tokenLive: true,
    walletValid: true,
    holderUnlocked: unlocked,
    balanceTokens: balTokens,
    requiredTokens: threshold,
    activeRouterFeeBps: unlocked ? 0 : 30,
    nonHolderFeeBps: 30,
    botBenchmarkFeeBps: BOT_ROUTER_FEE_BPS,
    priorityCredits: Number(credits),
    savedEth: Number(fromWei(savedWei).toFixed(6)),
    volumeEth: Number(fromWei(volWei).toFixed(4)),
  };
}

async function readRouterTelemetry(env) {
  const routerAddr = String(env.HARDWIRE_ROUTER_ADDRESS || "").trim();
  const tokenAddr = String(env.HARDWIRE_TOKEN_ADDRESS || "").trim();
  if (!isAddr(routerAddr)) {
    return {
      deployed: false,
      routerAddress: null,
      bound: false,
      trades: 0,
      volumeEth: 0,
      savedVsBotsEth: 0,
      pendingBurnEth: 0,
      burnedEth: 0,
      burnedTokens: 0,
      ignitions: 0,
      deadBalanceTokens: 0,
    };
  }

  try {
    const rawHex = await rpcCall(env, "eth_call", [{ to: routerAddr, data: SEL.routerStats }, "latest"]);
    const clean = String(rawHex || "").replace(/^0x/, "");
    if (clean.length < 64 * 10) throw new Error("short routerStats");
    const word = (i) => clean.slice(i * 64, (i + 1) * 64);
    const u = (i) => BigInt("0x" + word(i));
    const addr = (i) => "0x" + word(i).slice(24);

    const hwTok = addr(1) !== ZERO_ADDR ? addr(1) : isAddr(tokenAddr) ? tokenAddr : null;
    const deadWei = hwTok ? await ethCallUint(env, hwTok, SEL.balanceOf + pad32(DEAD_ADDR)) : 0n;

    return {
      deployed: true,
      routerAddress: routerAddr,
      bound: u(0) === 1n,
      hardwireToken: hwTok,
      hardwireCurve: addr(2) !== ZERO_ADDR ? addr(2) : null,
      trades: Number(u(3)),
      volumeEth: Number(fromWei(u(4)).toFixed(4)),
      savedVsBotsEth: Number(fromWei(u(5)).toFixed(5)),
      pendingBurnEth: Number(fromWei(u(6)).toFixed(5)),
      burnedEth: Number(fromWei(u(7)).toFixed(5)),
      burnedTokens: Math.round(fromWei(u(8))),
      ignitions: Number(u(9)),
      deadBalanceTokens: Math.round(fromWei(deadWei)),
    };
  } catch {
    return {
      deployed: true,
      routerAddress: routerAddr,
      bound: false,
      trades: 0,
      volumeEth: 0,
      savedVsBotsEth: 0,
      pendingBurnEth: 0,
      burnedEth: 0,
      burnedTokens: 0,
      ignitions: 0,
      deadBalanceTokens: 0,
    };
  }
}

/**
 * Exact Pons v2 constant-product curve math (phantomQuote = 1.68 ETH, supply = 1B).
 */
function computeCurveQuote({ side, amountIn, realQuoteEth, creatorTaxBps, routerFeeBps, ethUsd }) {
  const totalCurveFeeRate = (PONS_CURVE_FEE_BPS + Number(creatorTaxBps || 0)) / 10_000;
  const routerFeeRate = Number(routerFeeBps || 0) / 10_000;
  const botFeeRate = BOT_ROUTER_FEE_BPS / 10_000;

  const qRes = PONS_PHANTOM_ETH + Math.max(0, Number(realQuoteEth || 0));
  const tRes = (PONS_PHANTOM_ETH * PONS_SUPPLY) / qRes;
  const spotEthPerToken = qRes / tRes;
  const impliedMcapUsd = spotEthPerToken * PONS_SUPPLY * ethUsd;

  if (side === "buy") {
    const grossEth = Math.max(0, Number(amountIn || 0));
    const routerFeeEth = grossEth * routerFeeRate;
    const swapEth = Math.min(grossEth - routerFeeEth, Math.max(0, PONS_GRAD_ETH - realQuoteEth) / Math.max(0.01, 1 - totalCurveFeeRate));
    const netCurveEth = swapEth * (1 - totalCurveFeeRate);
    const tokensOut = (netCurveEth * tRes) / (qRes + netCurveEth);

    // Compare against 1.00% bot router
    const botFeeEth = grossEth * botFeeRate;
    const botNetCurveEth = (grossEth - botFeeEth) * (1 - totalCurveFeeRate);
    const botTokensOut = (botNetCurveEth * tRes) / (qRes + botNetCurveEth);

    const newQRes = qRes + netCurveEth;
    const newTRes = tRes - tokensOut;
    const priceImpactPct = ((newQRes / newTRes - spotEthPerToken) / spotEthPerToken) * 100;
    const savedEth = Math.max(0, botFeeEth - routerFeeEth);

    return {
      side: "buy",
      ethIn: grossEth,
      swapEth: Number(swapEth.toFixed(6)),
      tokensOut: Math.floor(tokensOut),
      extraTokensVsBotRouter: Math.max(0, Math.floor(tokensOut - botTokensOut)),
      routerFeeBps,
      routerFeeEth: Number(routerFeeEth.toFixed(6)),
      botRouterFeeEth: Number(botFeeEth.toFixed(6)),
      savedEth: Number(savedEth.toFixed(6)),
      savedUsd: Number((savedEth * ethUsd).toFixed(2)),
      curveAndCreatorFeePct: Number((totalCurveFeeRate * 100).toFixed(2)),
      priceImpactPct: Number(priceImpactPct.toFixed(2)),
      impliedMcapUsd: Math.round(impliedMcapUsd),
    };
  }

  const tokensIn = Math.max(0, Number(amountIn || 0));
  const grossQuoteOut = (tokensIn * qRes) / (tRes + tokensIn);
  const afterCurveEth = grossQuoteOut * (1 - totalCurveFeeRate);
  const routerFeeEth = afterCurveEth * routerFeeRate;
  const netEthOut = afterCurveEth - routerFeeEth;

  const botFeeEth = afterCurveEth * botFeeRate;
  const savedEth = Math.max(0, botFeeEth - routerFeeEth);
  const newTRes = tRes + tokensIn;
  const newQRes = qRes - grossQuoteOut;
  const priceImpactPct = ((spotEthPerToken - newQRes / newTRes) / spotEthPerToken) * 100;

  return {
    side: "sell",
    tokensIn,
    grossEthAfterCurve: Number(afterCurveEth.toFixed(6)),
    ethOut: Number(netEthOut.toFixed(6)),
    ethOutUsd: Number((netEthOut * ethUsd).toFixed(2)),
    routerFeeBps,
    routerFeeEth: Number(routerFeeEth.toFixed(6)),
    botRouterFeeEth: Number(botFeeEth.toFixed(6)),
    savedEth: Number(savedEth.toFixed(6)),
    savedUsd: Number((savedEth * ethUsd).toFixed(2)),
    curveAndCreatorFeePct: Number((totalCurveFeeRate * 100).toFixed(2)),
    priceImpactPct: Number(priceImpactPct.toFixed(2)),
    impliedMcapUsd: Math.round(impliedMcapUsd),
  };
}

/**
 * Resolves and X-rays any Pons v2 token by address or ticker symbol.
 */
async function auditPonsToken(query, env) {
  const clean = String(query || "").trim();
  if (!clean) throw new Error("Provide a Robinhood Chain token address (0x...) or ticker symbol.");

  let targetAddr = isAddr(clean) ? clean.toLowerCase() : null;
  let searchMatches = [];

  if (!targetAddr) {
    const sym = clean.replace(/^\$/, "");
    const sr = await fetch(`${SHERWOOD_BASE}/tokens/search?q=${encodeURIComponent(sym)}`).then((r) => r.json()).catch(() => ({ data: [] }));
    searchMatches = sr.data || [];
    const exact = searchMatches.filter((t) => (t.symbol || "").toUpperCase() === sym.toUpperCase());
    const chosen = exact[0] || searchMatches[0];
    if (!chosen?.address) {
      throw new Error(`No Pons token found on Robinhood Chain matching '${clean}'.`);
    }
    targetAddr = chosen.address.toLowerCase();
  }

  const [ponsRes, sherwoodRes, headHex, ethUsd] = await Promise.all([
    fetch(`${PONS_API}/tokens/${targetAddr}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${SHERWOOD_BASE}/tokens/${targetAddr}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    rpcCall(env, "eth_blockNumber", []).catch(() => "0x0"),
    getEthUsd(env),
  ]);

  const sh = sherwoodRes?.data || null;
  if (!ponsRes && !sh) {
    throw new Error(`Token ${targetAddr} not indexed as a Pons v2 launch on Robinhood Chain.`);
  }

  const symbol = ponsRes?.symbol || sh?.symbol || "TOKEN";
  const name = ponsRes?.name || sh?.name || symbol;
  const curve = (ponsRes?.curve || sh?.curve || "").toLowerCase();

  // Check exact ticker clone count on Sherwood if we haven't already
  if (searchMatches.length === 0 && symbol) {
    const sr = await fetch(`${SHERWOOD_BASE}/tokens/search?q=${encodeURIComponent(symbol)}`).then((r) => r.json()).catch(() => ({ data: [] }));
    searchMatches = sr.data || [];
  }
  const cloneCount = searchMatches.filter(
    (t) => (t.symbol || "").toUpperCase() === symbol.toUpperCase() && (t.address || "").toLowerCase() !== targetAddr
  ).length;

  // Read live curve state directly from Robinhood Chain RPC for zero-lag reserve & tax accuracy
  const [resWei, gradFlag, onchainTax] = curve
    ? await Promise.all([
        ethCallUint(env, curve, SEL.realQuoteReserve),
        ethCallUint(env, curve, SEL.graduated),
        ethCallUint(env, curve, SEL.creatorTaxBps),
      ])
    : [0n, 0n, 0n];

  const graduated = gradFlag === 1n || Boolean(ponsRes?.graduated_at) || (ponsRes?.phase && ponsRes.phase !== "NotGraduated" && ponsRes.phase !== 0);
  const realQuoteEth = graduated ? PONS_GRAD_ETH : fromWei(resWei || BigInt(ponsRes?.quote_raised || 0));
  const creatorTaxBps = Number(onchainTax || ponsRes?.creator_tax_bps || sh?.creatorTaxBps || 0);
  const progressPct = graduated ? 100 : Math.min(100, Number(((realQuoteEth / PONS_GRAD_ETH) * 100).toFixed(2)));
  const ethToGraduate = graduated ? 0 : Math.max(0, Number((PONS_GRAD_ETH - realQuoteEth).toFixed(4)));

  const headBlock = parseInt(headHex || "0x0", 16);
  const restrictEnd = Number(ponsRes?.restrictions_end_block || 0);
  const snipeTaxActive = headBlock > 0 && restrictEnd > headBlock;

  // Block +8..+11 sniper floor forensics
  const initTokens = ponsRes?.initial_buy_amount ? Number(BigInt(ponsRes.initial_buy_amount) / 10n ** 18n) : 0;
  const estDevBuyEth = initTokens > 0 ? (initTokens * PONS_PHANTOM_ETH) / Math.max(1, PONS_SUPPLY - initTokens) : 0;
  const totalFeeRate = (PONS_CURVE_FEE_BPS + creatorTaxBps) / 10_000;
  const qAfterDev = PONS_PHANTOM_ETH + estDevBuyEth;
  const tAfterDev = (PONS_PHANTOM_ETH * PONS_SUPPLY) / qAfterDev;
  const sniperPackNet = 0.22 * (1 - totalFeeRate - 0.012);
  const sniperTokens = (sniperPackNet * tAfterDev) / (qAfterDev + sniperPackNet);
  const sniperSupplyPct = Number(((sniperTokens / PONS_SUPPLY) * 100).toFixed(2));
  const qAt9k = PONS_PHANTOM_ETH + 0.96;
  const tAt9k = (PONS_PHANTOM_ETH * PONS_SUPPLY) / qAt9k;
  const sniperNetAt9k = ((sniperTokens * qAt9k) / (tAt9k + sniperTokens)) * (1 - totalFeeRate);
  const sniperRoiAt9kPct = Number((((sniperNetAt9k - 0.22) / 0.22) * 100).toFixed(1));

  // Score & hygiene signals
  let score = 100;
  const flags = [];
  const website = ponsRes?.website || sh?.metadata?.socials?.website || "";
  const twitter = ponsRes?.twitter || sh?.metadata?.socials?.twitter || "";
  const classification = sh?.classification || null;

  if (snipeTaxActive) {
    score -= 35;
    flags.push({ level: "DANGER", label: `Snipe tax decaying (${restrictEnd - headBlock} blocks left)` });
  }
  if (creatorTaxBps > 500) {
    score -= 32;
    flags.push({ level: "DANGER", label: `High creator tax (${(creatorTaxBps / 100).toFixed(2)}%)` });
  } else if (creatorTaxBps > 300) {
    score -= 10;
    flags.push({ level: "WARN", label: `Elevated creator tax (${(creatorTaxBps / 100).toFixed(2)}%)` });
  } else {
    flags.push({ level: "PASS", label: `Clean creator tax (${(creatorTaxBps / 100).toFixed(2)}%)` });
  }

  if (cloneCount >= 3) {
    score -= 18;
    flags.push({ level: "WARN", label: `${cloneCount} ticker clones on Pons` });
  } else if (cloneCount === 0) {
    flags.push({ level: "PASS", label: "Zero ticker clones on Sherwood" });
  }

  if (ponsRes?.snipe_tax_exempt) {
    score -= 10;
    flags.push({ level: "WARN", label: "Deployer used snipe-tax whitelist" });
  } else {
    flags.push({ level: "PASS", label: "No snipe-tax whitelist" });
  }

  if (!website && !twitter) {
    score -= 16;
    flags.push({ level: "WARN", label: "No website or X linked" });
  } else {
    flags.push({ level: "PASS", label: `Verified socials (${[website ? "Web" : null, twitter ? "X" : null].filter(Boolean).join(" + ")})` });
  }

  if (classification?.status === "accepted") {
    flags.push({ level: "PASS", label: `Sherwood AI: ${classification.path} (${classification.confidence})` });
  } else if (classification?.status) {
    score -= 6;
    flags.push({ level: "WARN", label: `Sherwood AI: ${classification.status} (${classification.path || "unclassified"})` });
  }

  score = Math.max(5, Math.min(100, score));
  const verdict =
    snipeTaxActive
      ? "WAIT_SNIPE_DECAY"
      : creatorTaxBps > 500
      ? "HIGH_TAX_TRAP"
      : graduated
      ? "GRADUATED_V4_DIRECT"
      : score >= 78
      ? "CLEAN_DIRECT_ROUTE"
      : "CAUTION_THIN_HYGIENE";

  const sample01 = computeCurveQuote({
    side: "buy",
    amountIn: 0.1,
    realQuoteEth,
    creatorTaxBps,
    routerFeeBps: 0,
    ethUsd,
  });

  const curveVolEth =
    (Number(ponsRes?.curve_quote_in || 0) + Number(ponsRes?.curve_quote_out || 0)) / 1e18;

  return {
    address: targetAddr,
    name,
    symbol,
    curve: curve || null,
    deployer: ponsRes?.deployer || sh?.deployer || null,
    graduated,
    venue: graduated ? "Uniswap v4 (Pons Hook Pool)" : "Pons v2 Bonding Curve",
    realQuoteEth: Number(realQuoteEth.toFixed(4)),
    graduationThresholdEth: PONS_GRAD_ETH,
    progressPct,
    ethToGraduate,
    impliedMcapUsd: sample01.impliedMcapUsd,
    ethUsd,
    creatorTaxBps,
    roundTripCurveFrictionPct: Number((((PONS_CURVE_FEE_BPS + creatorTaxBps) * 2) / 100).toFixed(2)),
    roundTripVia1PctBotRouterPct: Number((((PONS_CURVE_FEE_BPS + creatorTaxBps + 100) * 2) / 100).toFixed(2)),
    curveVolumeEth: Number(curveVolEth.toFixed(2)),
    buyCount: Number(ponsRes?.buy_count || 0),
    sellCount: Number(ponsRes?.sell_count || 0),
    cloneCount,
    snipeTaxActive,
    whitelistUsed: Boolean(ponsRes?.snipe_tax_exempt),
    buybackEnabled: Boolean(ponsRes?.buyback_enabled),
    socials: { website, twitter },
    sherwood: classification,
    sniperForensics: {
      estDevFloorBuyEth: Number(estDevBuyEth.toFixed(3)),
      estBlock8SniperSharePct: sniperSupplyPct,
      sniperRoiAt9kMcapPct: sniperRoiAt9kPct,
      floorLiftStrong: estDevBuyEth >= 0.18,
    },
    savingsPreview: [0.05, 0.25, 1.0].map((sz) => ({
      tradeEth: sz,
      roundTripBotTaxEth: Number((sz * 0.02).toFixed(5)),
      roundTripBotTaxUsd: Number((sz * 0.02 * ethUsd).toFixed(2)),
      hardwireHolderFeeEth: 0,
    })),
    score,
    verdict,
    flags,
    ponsUrl: `https://ponsfamily.com/launchpad/${targetAddr}`,
    explorerUrl: `https://robinhoodchain.blockscout.com/token/${targetAddr}`,
  };
}

/**
 * Live Radar across active & graduated Pons launches on Robinhood Chain.
 */
async function getLiveRadar(env, { phase = "all", limit = 16 } = {}) {
  const cacheKey = `${phase}:${limit}`;
  if (cachedRadar && cachedRadar.key === cacheKey && Date.now() - cachedRadarAt < 20_000) {
    return cachedRadar.payload;
  }

  const [ethUsd, activeRes, gradRes, shStats] = await Promise.all([
    getEthUsd(env),
    fetch(`${PONS_API}/tokens?graduated=false&limit=24`).then((r) => r.json()).catch(() => ({ items: [] })),
    fetch(`${PONS_API}/tokens?graduated=true&limit=12`).then((r) => r.json()).catch(() => ({ items: [] })),
    fetch(`${SHERWOOD_BASE}/stats`).then((r) => r.json()).catch(() => ({ data: {} })),
  ]);

  let rawList = [];
  if (phase === "graduated") rawList = gradRes.items || [];
  else if (phase === "curve") rawList = activeRes.items || [];
  else rawList = [...(activeRes.items || []).slice(0, 14), ...(gradRes.items || []).slice(0, 8)];

  // Sort active curves by reserve / activity so traders see real live flow, not dead 0-buy deploys
  rawList.sort((a, b) => {
    const volA = Number(a.curve_quote_in || 0) + Number(a.pool_quote_in || 0);
    const volB = Number(b.curve_quote_in || 0) + Number(b.pool_quote_in || 0);
    return volB - volA;
  });

  const sliced = rawList.slice(0, Math.min(24, Math.max(4, Number(limit || 16))));
  const items = sliced.map((t) => {
    const grad = Boolean(t.graduated_at);
    const raisedEth = grad ? PONS_GRAD_ETH : Number(t.quote_raised || 0) / 1e18;
    const progressPct = grad ? 100 : Math.min(100, Number(((raisedEth / PONS_GRAD_ETH) * 100).toFixed(1)));
    const qRes = PONS_PHANTOM_ETH + raisedEth;
    const tRes = (PONS_PHANTOM_ETH * PONS_SUPPLY) / qRes;
    const mcapUsd = Math.round((qRes / tRes) * PONS_SUPPLY * ethUsd);
    const volEth = (Number(t.curve_quote_in || 0) + Number(t.curve_quote_out || 0)) / 1e18;
    const taxBps = Number(t.creator_tax_bps || 0);

    return {
      address: t.address?.toLowerCase(),
      symbol: t.symbol,
      name: t.name,
      curve: t.curve?.toLowerCase() || null,
      graduated: grad,
      venue: grad ? "Uniswap v4" : "Pons Curve",
      realQuoteEth: Number(raisedEth.toFixed(3)),
      progressPct,
      mcapUsd,
      volumeEth: Number(volEth.toFixed(2)),
      buys: Number(t.buy_count || 0),
      sells: Number(t.sell_count || 0),
      creatorTaxBps: taxBps,
      savedRoundTripBps: 200, // 1.00% buy + 1.00% sell saved for Hardwire holders
      website: t.website || "",
      twitter: t.twitter || "",
      description: (t.description || "").slice(0, 140),
    };
  });

  const payload = {
    updatedAt: new Date().toISOString(),
    ethUsd,
    sherwoodStream: {
      status: shStats.data?.status || "live",
      lagBlocks: shStats.data?.lagBlocks ?? 0,
    },
    count: items.length,
    items,
  };
  cachedRadar = { key: cacheKey, payload };
  cachedRadarAt = Date.now();
  return payload;
}

/**
 * Encodes non-custodial calldata for HardwireRouter (or direct PonsCurve when router isn't deployed yet).
 */
async function buildExecutionBundle(body, env) {
  const mode = String(body.mode || "directBuy");
  const tokenInput = body.token || body.address || body.q;
  const audit = await auditPonsToken(tokenInput, env);
  const wallet = isAddr(body.wallet) ? body.wallet : ZERO_ADDR;
  const recipient = isAddr(body.recipient) ? body.recipient : wallet !== ZERO_ADDR ? wallet : ZERO_ADDR;
  const tier = await getWalletTier(wallet, env);
  const slippageBps = Math.min(2500, Math.max(25, Number(body.slippageBps ?? 250)));
  const maxCreatorTaxBps = Number(body.maxCreatorTaxBps ?? Math.max(350, audit.creatorTaxBps));
  const routerAddr = String(env.HARDWIRE_ROUTER_ADDRESS || "").trim();
  const hasRouter = isAddr(routerAddr);

  const intentSeed = `${mode}:${audit.address}:${wallet}:${body.ethIn || body.tokensIn || ""}:${Date.now()}`;
  const intentHash = await sha256Hex(intentSeed);
  const intentWord = pad32(intentHash);

  if (audit.creatorTaxBps > maxCreatorTaxBps) {
    throw new Error(
      `CreatorTaxTooHigh guard blocked build: $${audit.symbol} charges ${(audit.creatorTaxBps / 100).toFixed(2)}% > your max ${(maxCreatorTaxBps / 100).toFixed(2)}%.`
    );
  }

  if (mode === "directBuy") {
    const ethIn = Math.max(0.0005, Number(body.ethIn ?? 0.05));
    const quote = computeCurveQuote({
      side: "buy",
      amountIn: ethIn,
      realQuoteEth: audit.realQuoteEth,
      creatorTaxBps: audit.creatorTaxBps,
      routerFeeBps: hasRouter ? tier.activeRouterFeeBps : 0,
      ethUsd: audit.ethUsd,
    });
    const estTokensWei = BigInt(Math.max(1, quote.tokensOut)) * 10n ** 18n;
    const minOutWei = audit.graduated ? 1n : (estTokensWei * BigInt(10_000 - slippageBps)) / 10_000n;
    const valWei = toWei(ethIn);

    let to, data, targetLabel;
    if (hasRouter) {
      to = routerAddr;
      targetLabel = "HardwireRouter.directBuy";
      data =
        SEL.directBuy +
        pad32(audit.address) +
        u256Hex(minOutWei) +
        u256Hex(maxCreatorTaxBps) +
        pad32(recipient) +
        intentWord;
    } else if (!audit.graduated && audit.curve) {
      to = audit.curve;
      targetLabel = "PonsBondingCurve.buy (Direct)";
      data = SEL.curveBuy + u256Hex(valWei) + u256Hex(minOutWei) + pad32(recipient);
    } else {
      // Graduated Uniswap v4 pool direct UniversalRouter fallback (0% router fee)
      to = env.UNIVERSAL_ROUTER || "0x8876789976dEcBfCbBbe364623C63652db8C0904";
      targetLabel = "UniversalRouter.execute (Uniswap v4 Direct)";
      // Read poolFee & tickSpacing from PonsV2LaunchFactory.getLaunchedToken(token)
      const facAddr = env.PONS_FACTORY || "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
      const facRes = await rpcCall(env, "eth_call", [{ to: facAddr, data: "0x49bf4b2f" + pad32(audit.address) }, "latest"]).catch(() => "0x");
      const cleanFac = String(facRes || "").replace(/^0x/, "");
      const poolFee = cleanFac.length >= 64 * 7 ? Number(BigInt("0x" + cleanFac.slice(5 * 64, 6 * 64))) : 10000;
      const tickRaw = cleanFac.length >= 64 * 7 ? BigInt("0x" + cleanFac.slice(6 * 64, 7 * 64)) : 200n;
      const tickHex = tickRaw.toString(16).padStart(64, "0").slice(-64);
      const hook = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      // Encode V4_SWAP (command 0x10) with actions 0x060c0f (SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL)
      const p0 =
        u256Hex(0x20n) +
        pad32(ZERO_ADDR) +
        pad32(audit.address) +
        u256Hex(poolFee) +
        tickHex +
        pad32(hook) +
        u256Hex(1n) +
        u256Hex(valWei) +
        u256Hex(1n) +
        u256Hex(0x120n) +
        u256Hex(0n);
      const p1 = pad32(ZERO_ADDR) + u256Hex(valWei);
      const p2 = pad32(audit.address) + u256Hex(1n);
      const actionsBytes = u256Hex(3n) + "060c0f".padEnd(64, "0");
      const p0Bytes = u256Hex(p0.length / 2) + p0;
      const p1Bytes = u256Hex(p1.length / 2) + p1;
      const p2Bytes = u256Hex(p2.length / 2) + p2;
      const paramsArray =
        u256Hex(3n) +
        u256Hex(0x60n) +
        u256Hex(0x60n + BigInt(p0Bytes.length / 2)) +
        u256Hex(0x60n + BigInt((p0Bytes.length + p1Bytes.length) / 2)) +
        p0Bytes +
        p1Bytes +
        p2Bytes;
      const v4Payload = u256Hex(0x40n) + u256Hex(0x80n) + actionsBytes + paramsArray;
      const v4Bytes = u256Hex(v4Payload.length / 2) + v4Payload;
      const cmdBytes = u256Hex(1n) + "10".padEnd(64, "0");
      const inputsArr = u256Hex(1n) + u256Hex(0x20n) + v4Bytes;
      data =
        "0x3593564c" +
        u256Hex(0x60n) +
        u256Hex(0x60n + BigInt(cmdBytes.length / 2)) +
        u256Hex(deadline) +
        cmdBytes +
        inputsArr;
    }

    return {
      ok: true,
      mode,
      token: { address: audit.address, symbol: audit.symbol, name: audit.name, venue: audit.venue, graduated: audit.graduated },
      tier,
      quote,
      intentHash,
      tx: {
        chainId: 4663,
        targetLabel,
        to,
        valueWei: valWei.toString(),
        valueHex: "0x" + valWei.toString(16),
        valueEth: ethIn,
        data,
        maxCreatorTaxBps,
        slippageBps,
      },
      approveTx: null,
    };
  }

  if (mode === "directSell") {
    let tokensIn = Number(body.tokensIn || 0);
    if ((!tokensIn || tokensIn <= 0) && isAddr(wallet)) {
      const balWei = await ethCallUint(env, audit.address, SEL.balanceOf + pad32(wallet));
      const pct = Math.min(100, Math.max(1, Number(body.sellPct ?? 100)));
      tokensIn = (fromWei(balWei) * pct) / 100;
    }
    if (!tokensIn || tokensIn <= 0) tokensIn = 100_000;

    const quote = computeCurveQuote({
      side: "sell",
      amountIn: tokensIn,
      realQuoteEth: audit.realQuoteEth,
      creatorTaxBps: audit.creatorTaxBps,
      routerFeeBps: hasRouter ? tier.activeRouterFeeBps : 0,
      ethUsd: audit.ethUsd,
    });
    const tokensWei = toWei(tokensIn);
    const estEthWei = toWei(quote.ethOut);
    const minEthWei = audit.graduated ? 1n : (estEthWei * BigInt(10_000 - slippageBps)) / 10_000n;
    const spender = hasRouter ? routerAddr : audit.curve;

    let needApprove = true;
    if (isAddr(wallet) && isAddr(spender)) {
      const allow = await ethCallUint(env, audit.address, SEL.allowance + pad32(wallet) + pad32(spender));
      needApprove = allow < tokensWei;
    }

    const approveTx = needApprove && isAddr(spender)
      ? {
          chainId: 4663,
          targetLabel: `Approve $${audit.symbol}`,
          to: audit.address,
          valueHex: "0x0",
          data: SEL.approve + pad32(spender) + "f".repeat(64),
        }
      : null;

    const to = hasRouter ? routerAddr : audit.curve;
    const data = hasRouter
      ? SEL.directSell +
        pad32(audit.address) +
        u256Hex(tokensWei) +
        u256Hex(minEthWei) +
        u256Hex(maxCreatorTaxBps) +
        pad32(recipient) +
        intentWord
      : SEL.curveSell + u256Hex(tokensWei) + u256Hex(minEthWei) + pad32(recipient);

    return {
      ok: true,
      mode,
      token: { address: audit.address, symbol: audit.symbol, name: audit.name, venue: audit.venue, graduated: audit.graduated },
      tier,
      quote,
      intentHash,
      approveTx,
      tx: {
        chainId: 4663,
        targetLabel: hasRouter ? "HardwireRouter.directSell" : "PonsBondingCurve.sell (Direct)",
        to,
        valueWei: "0",
        valueHex: "0x0",
        valueEth: 0,
        data,
        maxCreatorTaxBps,
        slippageBps,
      },
    };
  }

  if (mode === "swarmBuy") {
    const rawWallets = Array.isArray(body.recipients) && body.recipients.length >= 2
      ? body.recipients.filter(isAddr).slice(0, 8)
      : [recipient, recipient, recipient, recipient];
    const n = rawWallets.length;
    const totalEth = Math.max(0.004, Number(body.ethIn ?? 0.12));
    const perLegEth = Number((totalEth / n).toFixed(6));
    const quote = computeCurveQuote({
      side: "buy",
      amountIn: totalEth,
      realQuoteEth: audit.realQuoteEth,
      creatorTaxBps: audit.creatorTaxBps,
      routerFeeBps: 0,
      ethUsd: audit.ethUsd,
    });

    const legWei = toWei(perLegEth);
    const totalWei = legWei * BigInt(n);

    // Dynamic ABI encoding for swarmBuy(address token, address[] recipients, uint256[] ethShares, uint256[] minOuts, uint16 maxCreatorTaxBps, bytes32 agentIntentHash)
    const head0 = pad32(audit.address);
    const offRec = 6 * 32;
    const offShares = offRec + (1 + n) * 32;
    const offMin = offShares + (1 + n) * 32;
    const head =
      head0 +
      u256Hex(offRec) +
      u256Hex(offShares) +
      u256Hex(offMin) +
      u256Hex(maxCreatorTaxBps) +
      intentWord;
    const arrRec = u256Hex(n) + rawWallets.map((w) => pad32(w)).join("");
    const arrShares = u256Hex(n) + rawWallets.map(() => u256Hex(legWei)).join("");
    const arrMin = u256Hex(n) + rawWallets.map(() => u256Hex(1n)).join("");

    return {
      ok: true,
      mode: "swarmBuy",
      holderGateNote: "Requires >= 500,000 protocol tokens once bound (0% router fee across all legs).",
      token: { address: audit.address, symbol: audit.symbol, name: audit.name, venue: audit.venue, graduated: audit.graduated },
      tier,
      quote,
      swarmLegs: rawWallets.map((w, idx) => ({ leg: idx + 1, recipient: w, ethShare: perLegEth })),
      intentHash,
      approveTx: null,
      tx: {
        chainId: 4663,
        targetLabel: `HardwireRouter.swarmBuy (${n} wallets)`,
        to: hasRouter ? routerAddr : audit.curve,
        valueWei: totalWei.toString(),
        valueHex: "0x" + totalWei.toString(16),
        valueEth: Number(fromWei(totalWei).toFixed(6)),
        data: hasRouter
          ? SEL.swarmBuy + head + arrRec + arrShares + arrMin
          : SEL.curveBuy + u256Hex(totalWei) + u256Hex(1n) + pad32(recipient),
        maxCreatorTaxBps,
        slippageBps,
      },
    };
  }

  if (mode === "ladderPlan") {
    const tranches = [
      { step: 1, pct: 25, trigger: "55% curve (2.31 ETH reserve)", note: "Recover principal into wave-2 momentum" },
      { step: 2, pct: 25, trigger: "88% curve (3.70 ETH Final Stretch)", note: "De-risk ahead of block-8 sniper wall" },
      { step: 3, pct: 50, trigger: "100% Graduated (Uniswap v4 Pool)", note: "Auto-switches venue via HardwireRouter.directSell" },
    ];
    return {
      ok: true,
      mode: "ladderPlan",
      token: { address: audit.address, symbol: audit.symbol, name: audit.name, venue: audit.venue },
      currentProgressPct: audit.progressPct,
      ethToGraduate: audit.ethToGraduate,
      intentHash,
      tranches,
    };
  }

  throw new Error(`Unsupported execution mode: ${mode}`);
}

/**
 * Grounded AI Copilot: runs real onchain/Sherwood/stock tools first, then synthesizes via Cloudflare Workers AI (or deterministic analyst fallback).
 */
async function runCopilot(body, req, env) {
  const prompt = String(body.prompt || body.message || "").trim();
  const wallet = String(body.wallet || "").trim();
  if (!prompt) throw new Error("Ask HARDWIRE Copilot about any Robinhood Chain token, curve, stock token, or direct trade.");

  const toolTrace = [];
  let auditCard = null;
  let txBundle = null;
  let radarSample = null;
  let stockMatches = null;

  // 1. Detect explicit 0x address or $TICKER in prompt
  const addrMatch = prompt.match(/0x[a-fA-F0-9]{40}/);
  const tickerMatches = [...prompt.matchAll(/\$([A-Za-z0-9]{2,10})\b/g)].map((m) => m[1].toUpperCase());
  const ethAmtMatch = prompt.match(/(\d+(?:\.\d+)?)\s*eth\b/i);
  const requestedEth = ethAmtMatch ? Math.min(25, Math.max(0.001, Number(ethAmtMatch[1]))) : 0.05;
  const wantsSwarm = /\bswarm|split|wallets|пачк|кошельк/i.test(prompt);
  const wantsSell = /\bsell|exit|dump|прод|выход/i.test(prompt);
  const wantsBuy = /\bbuy|ape|enter|snipe|route|куп|вход/i.test(prompt) || Boolean(ethAmtMatch);
  const wantsStocks = /\bstock|equit|nasdaq|nyse|oracle|24\/7|акци|nvda|tsla|aapl|mstr|coin|pltr|gme\b/i.test(prompt);

  // Check stock catalog first if ticker matches a 24/7 stock token
  const stocksCatalog = await loadStocks(req, env);
  if (wantsStocks || tickerMatches.length > 0) {
    const hits = (stocksCatalog.stocks || []).filter((s) =>
      tickerMatches.includes(s.symbol.toUpperCase()) ||
      new RegExp(`\\b${s.symbol}\\b`, "i").test(prompt)
    );
    if (hits.length > 0) {
      stockMatches = hits.slice(0, 6);
      toolTrace.push({
        tool: "hardwire_lookup_stock_tokens",
        source: "Robinhood Chain 203 Equity Catalog (Chain 4663)",
        matched: stockMatches.map((s) => `${s.symbol} (${s.address.slice(0, 10)}…)`),
      });
    }
  }

  // Audit target Pons token if 0x address or non-stock $TICKER present
  const targetQuery = addrMatch ? addrMatch[0] : tickerMatches.find((t) => !(stockMatches || []).some((s) => s.symbol === t));
  if (targetQuery) {
    try {
      auditCard = await auditPonsToken(targetQuery, env);
      toolTrace.push({
        tool: "hardwire_audit_token",
        source: "Robinhood Chain RPC + Pons v2 + Sherwood AI",
        summary: `$${auditCard.symbol} | ${auditCard.venue} | ${auditCard.progressPct}% (${auditCard.realQuoteEth}/4.20 ETH) | tax ${(auditCard.creatorTaxBps / 100).toFixed(2)}% | score ${auditCard.score}/100`,
      });
    } catch (e) {
      toolTrace.push({ tool: "hardwire_audit_token", error: e.message });
    }
  }

  // If no specific token found yet, scan live Pons curves so Copilot always works on real live chain state
  if (!auditCard) {
    radarSample = await getLiveRadar(env, { phase: "all", limit: 8 });
    toolTrace.push({
      tool: "hardwire_scan_curves",
      source: "Pons v2 Live Feed + Sherwood Stream",
      summary: `Fetched ${radarSample.items.length} active/graduated launches (ETH $${radarSample.ethUsd})`,
    });
    if (wantsBuy && radarSample.items[0] && !stockMatches?.length) {
      try {
        auditCard = await auditPonsToken(radarSample.items[0].address, env);
      } catch {}
    }
  }

  // Build ready-to-sign non-custodial transaction bundle whenever an audited Pons token is in focus
  if (auditCard && (wantsBuy || wantsSell || wantsSwarm || addrMatch)) {
    try {
      const txMode = wantsSwarm ? "swarmBuy" : wantsSell ? "directSell" : "directBuy";
      txBundle = await buildExecutionBundle(
        { mode: txMode, token: auditCard.address, ethIn: requestedEth, wallet },
        env
      );
      toolTrace.push({
        tool: "hardwire_quote_and_build_tx",
        source: "Hardwire Constant-Product & V4 Calldata Engine",
        summary: `Prepared ${txMode} on $${auditCard.symbol} | Saved ${txBundle.quote.savedEth} ETH ($${txBundle.quote.savedUsd}) vs 1% bot routers`,
      });
    } catch (e) {
      toolTrace.push({ tool: "hardwire_quote_and_build_tx", error: e.message });
    }
  }

  const market = getUsMarketClock();
  const contextFacts = JSON.stringify({
    market,
    audit: auditCard
      ? {
          name: auditCard.name,
          symbol: auditCard.symbol,
          address: auditCard.address,
          venue: auditCard.venue,
          progressPct: auditCard.progressPct,
          realQuoteEth: auditCard.realQuoteEth,
          ethToGraduate: auditCard.ethToGraduate,
          impliedMcapUsd: auditCard.impliedMcapUsd,
          creatorTaxPct: auditCard.creatorTaxBps / 100,
          cloneCount: auditCard.cloneCount,
          snipeTaxActive: auditCard.snipeTaxActive,
          sherwood: auditCard.sherwood,
          sniperForensics: auditCard.sniperForensics,
          score: auditCard.score,
          verdict: auditCard.verdict,
        }
      : null,
    txPreview: txBundle
      ? {
          mode: txBundle.mode,
          ethIn: txBundle.quote.ethIn,
          tokensOut: txBundle.quote.tokensOut,
          ethOut: txBundle.quote.ethOut,
          routerFeeBps: txBundle.quote.routerFeeBps,
          savedEthVs1PctBots: txBundle.quote.savedEth,
          savedUsdVs1PctBots: txBundle.quote.savedUsd,
          priceImpactPct: txBundle.quote.priceImpactPct,
        }
      : null,
    stockTokens: stockMatches || undefined,
    liveTopCurves: radarSample ? radarSample.items.slice(0, 5) : undefined,
  });

  // Synthesize crisp technical response via Cloudflare Workers AI (`env.AI`) with deterministic zero-hallucination fallback
  let reply = "";
  let modelUsed = "hardwire-deterministic-v1";

  if (env.AI && typeof env.AI.run === "function") {
    try {
      const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      const aiRes = await env.AI.run(model, {
        messages: [
          {
            role: "system",
            content:
              "You are HARDWIRE Copilot, a concise onchain execution analyst on Robinhood Chain (chain ID 4663). " +
              "Answer in 4-7 crisp technical lines using ONLY the exact numbers in LIVE_TOOL_DATA. " +
              "Never invent prices, addresses, or tickers. Highlight: (1) venue & curve progress/MCAP, " +
              "(2) creator tax, clone count, and block-8 sniper floor risk, and (3) exact ETH/USD saved by routing directly instead of 1.00% bot routers. Never give financial advice.",
          },
          {
            role: "user",
            content: `USER_PROMPT: ${prompt}\n\nLIVE_TOOL_DATA: ${contextFacts}`,
          },
        ],
        max_tokens: 340,
        temperature: 0.15,
      });
      const text = String(aiRes?.response || "").trim();
      if (text.length > 25) {
        reply = text;
        modelUsed = model;
      }
    } catch {}
  }

  if (!reply) {
    if (auditCard) {
      const lines = [
        `X-Ray complete on **${auditCard.name} ($${auditCard.symbol})** (\`${auditCard.address}\`):`,
        `• **Venue & Liquidity:** ${auditCard.venue} — **${auditCard.progressPct}%** (${auditCard.realQuoteEth} / 4.20 ETH, implied MCAP ~$${auditCard.impliedMcapUsd.toLocaleString()}).`,
        `• **Hygiene (${auditCard.score}/100 · ${auditCard.verdict}):** Creator tax **${(auditCard.creatorTaxBps / 100).toFixed(2)}%**, ticker clones **${auditCard.cloneCount}**, Sherwood **${auditCard.sherwood?.path || "pending"}**.`,
        `• **Block-8 Sniper Check:** Est. floor lift **${auditCard.sniperForensics.estDevFloorBuyEth} ETH**; a 0.22 ETH block-8 pack holds ~${auditCard.sniperForensics.estBlock8SniperSharePct}% supply (${auditCard.sniperForensics.sniperRoiAt9kMcapPct >= 0 ? "+" : ""}${auditCard.sniperForensics.sniperRoiAt9kMcapPct}% at $9K MCAP).`,
      ];
      if (txBundle) {
        lines.push(
          `• **Direct Route Ready (${txBundle.mode}):** Router fee **${(txBundle.quote.routerFeeBps / 100).toFixed(2)}%** — saves **${txBundle.quote.savedEth} ETH ($${txBundle.quote.savedUsd})** vs 1.00% bot routers. Review and sign below.`
        );
      }
      reply = lines.join("\n");
    } else if (stockMatches?.length) {
      reply =
        `Matched **${stockMatches.length}** tokenized equities on Robinhood Chain (24/7 settlement, US market currently **${market.session}** · ${market.etClock}):\n` +
        stockMatches
          .map((s) => `• **$${s.symbol}** (${s.name}) — ERC-20 \`${s.address}\` · CUSIP \`${s.cusip}\``)
          .join("\n");
    } else if (radarSample) {
      reply =
        `Scanned **${radarSample.items.length}** live Pons v2 markets on Robinhood Chain (ETH $${radarSample.ethUsd.toLocaleString()}, Sherwood lag ${radarSample.sherwoodStream.lagBlocks} blocks):\n` +
        radarSample.items
          .slice(0, 4)
          .map(
            (i) =>
              `• **$${i.symbol}** (${i.venue}) — **${i.progressPct}%** (${i.realQuoteEth}E, ~$${i.mcapUsd.toLocaleString()} MCAP) · tax ${(i.creatorTaxBps / 100).toFixed(2)}% · vol ${i.volumeEth}E`
          )
          .join("\n") +
        `\nPaste any \`0x…\` token address to run a full sniper-cluster X-ray and build a 0%-holder-fee direct transaction.`;
    }
  }

  const receiptHash = await sha256Hex(`${prompt}|${contextFacts}|${reply}`);

  return {
    ok: true,
    model: modelUsed,
    market,
    reply,
    receiptHash,
    toolTrace,
    auditCard,
    txBundle,
    stockMatches,
    radarItems: radarSample?.items?.slice(0, 6) || null,
  };
}

/**
 * MCP Tools Catalog + JSON-RPC 2.0 Handler (`POST /mcp` & `GET /mcp`).
 */
const MCP_TOOLS = [
  {
    name: "hardwire_audit_token",
    description:
      "Runs a live Robinhood Chain (4663) X-ray on any Pons v2 token address or ticker: curve reserve, graduation progress, creatorTaxBps, ticker clone count, Sherwood AI taxonomy, and block-8 sniper floor math.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "0x token contract address or ticker symbol on Robinhood Chain" },
      },
      required: ["query"],
    },
  },
  {
    name: "hardwire_scan_curves",
    description:
      "Lists active Pons v2 bonding curves and recently graduated Uniswap v4 pools on Robinhood Chain sorted by live ETH flow.",
    inputSchema: {
      type: "object",
      properties: {
        phase: { type: "string", enum: ["all", "curve", "graduated"], default: "all" },
        limit: { type: "number", default: 12 },
      },
    },
  },
  {
    name: "hardwire_quote_and_build_tx",
    description:
      "Computes exact Pons constant-product math and builds non-custodial calldata for directBuy, directSell, swarmBuy (2..8 wallets), or ladderPlan on Chain 4663, comparing fees against 1.00% bot routers.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["directBuy", "directSell", "swarmBuy", "ladderPlan"], default: "directBuy" },
        token: { type: "string", description: "0x token address or symbol" },
        ethIn: { type: "number", description: "ETH input for directBuy / swarmBuy" },
        tokensIn: { type: "number", description: "Token amount for directSell" },
        wallet: { type: "string", description: "Optional user/agent wallet address (0x...) to check 0%-fee tier & allowances" },
        maxCreatorTaxBps: { type: "number", default: 350 },
        slippageBps: { type: "number", default: 250 },
      },
      required: ["token"],
    },
  },
  {
    name: "hardwire_lookup_stock_tokens",
    description:
      "Searches all 203 24/7 Robinhood Chain ERC-20 stock tokens by ticker, company name, or 9-character CUSIP and returns contract + oracle metadata.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Stock ticker (e.g. NVDA, TSLA), company name, or CUSIP" },
      },
      required: ["q"],
    },
  },
  {
    name: "hardwire_router_status",
    description:
      "Reads live HardwireRouter onchain telemetry (volume, ETH saved vs 1% bot routers, burnBucket, total burned to 0x...dEaD) and optional wallet tier.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Optional 0x wallet address" },
      },
    },
  },
];

async function handleMcpPost(req, env) {
  const rpcReq = await req.json().catch(() => null);
  if (!rpcReq || typeof rpcReq !== "object") {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const { id = null, method, params = {} } = rpcReq;
  const okRpc = (result) => json({ jsonrpc: "2.0", id, result });
  const errRpc = (code, message) => json({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    return okRpc({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "hardwire-robinhood-mcp", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (method === "ping") {
    return okRpc({});
  }
  if (method === "tools/list") {
    return okRpc({ tools: MCP_TOOLS });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      let data;
      if (name === "hardwire_audit_token") {
        data = await auditPonsToken(args.query, env);
      } else if (name === "hardwire_scan_curves") {
        data = await getLiveRadar(env, { phase: args.phase || "all", limit: args.limit || 12 });
      } else if (name === "hardwire_quote_and_build_tx") {
        data = await buildExecutionBundle(args, env);
      } else if (name === "hardwire_lookup_stock_tokens") {
        const cat = await loadStocks(req, env);
        const q = String(args.q || "").trim().toUpperCase();
        const matches = (cat.stocks || []).filter(
          (s) =>
            s.symbol.toUpperCase().includes(q) ||
            s.name.toUpperCase().includes(q) ||
            String(s.cusip || "").toUpperCase().includes(q)
        );
        data = { market: getUsMarketClock(), count: matches.length, stocks: matches.slice(0, 25) };
      } else if (name === "hardwire_router_status") {
        const [router, tier] = await Promise.all([
          readRouterTelemetry(env),
          getWalletTier(args.wallet || "", env),
        ]);
        data = { chainId: 4663, router, tier };
      } else {
        return errRpc(-32601, `Unknown MCP tool: ${name}`);
      }

      return okRpc({
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (e) {
      return okRpc({
        content: [{ type: "text", text: `Error: ${e.message || e}` }],
        isError: true,
      });
    }
  }

  return errRpc(-32601, `Unsupported JSON-RPC method: ${method}`);
}

function buildLlmsTxt(env) {
  const domain = env.SITE_DOMAIN || "hardwireagent.com";
  const handle = env.X_HANDLE || "hardwireagent";
  const router = env.HARDWIRE_ROUTER_ADDRESS || "deploying-on-chain-4663";
  const tokLine = env.HARDWIRE_TOKEN_ADDRESS
    ? `- Protocol Token (Chain 4663): ${env.HARDWIRE_TOKEN_ADDRESS}`
    : `- Protocol Token: Not yet deployed. Official address will be published on @${handle} and https://${domain}.`;

  return `# HARDWIRE — Autonomous AI Copilot & Direct Execution Router on Robinhood Chain (4663)

> Skip the 1.00% bot-router tax. Wire your agent straight to Pons v2 bonding curves and Uniswap v4 pools.

- Website: https://${domain}
- X: https://x.com/${handle}
- Chain: Robinhood Chain (EVM Chain ID 4663, ~100ms blocks)
- HardwireRouter Contract: ${router}
${tokLine}

## MCP Endpoint (Streamable HTTP JSON-RPC 2.0)
POST https://${domain}/mcp

Tools:
1. hardwire_audit_token({ query }) — Live curve reserve, creatorTaxBps, clone count, Sherwood AI path & block-8 sniper forensics.
2. hardwire_scan_curves({ phase, limit }) — Active Pons v2 bonding curves & graduated Uniswap v4 pools.
3. hardwire_quote_and_build_tx({ mode, token, ethIn, tokensIn, wallet, maxCreatorTaxBps, slippageBps }) — Non-custodial calldata for directBuy, directSell, swarmBuy (2..8 wallets), and ladderPlan.
4. hardwire_lookup_stock_tokens({ q }) — All 203 24/7 tokenized equities on Robinhood Chain.
5. hardwire_router_status({ wallet }) — Live router telemetry, ETH saved vs 1% bot routers, and burnBucket status.

## REST Endpoints
- GET  /v1/status?wallet=0x...
- GET  /v1/radar?phase=all&limit=16
- GET  /v1/audit?q=0x...
- GET  /v1/stocks?q=NVDA
- POST /v1/build-tx
- POST /v1/copilot
- GET  /openapi.json
`;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // Safe read-only JSON-RPC proxy for browser wallet & curve reads
      if (p === "/rpc" && req.method === "POST") {
        const payload = await req.json().catch(() => null);
        const allowed = new Set([
          "eth_chainId",
          "eth_blockNumber",
          "eth_call",
          "eth_getBalance",
          "eth_estimateGas",
          "eth_gasPrice",
          "eth_maxPriorityFeePerGas",
          "eth_getTransactionReceipt",
        ]);
        const list = Array.isArray(payload) ? payload : [payload];
        if (!list.length || list.some((item) => !item || !allowed.has(item.method))) {
          return json({ error: "Method not permitted on read-only RPC proxy" }, 403);
        }
        const upstream = await fetch(env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "content-type": "application/json", ...CORS },
        });
      }

      if (p === "/llms.txt") {
        return new Response(buildLlmsTxt(env), {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
        });
      }

      if (p === "/openapi.json") {
        const domain = env.SITE_DOMAIN || "hardwireagent.com";
        return json({
          openapi: "3.1.0",
          info: {
            title: "HARDWIRE Direct Execution & AI Copilot API",
            version: "1.0.0",
            description:
              "Non-custodial AI agent copilot, Pons v2 curve / Uniswap v4 calldata builder, and 24/7 stock-token directory on Robinhood Chain (4663).",
          },
          servers: [{ url: `https://${domain}` }],
          paths: {
            "/v1/status": { get: { summary: "Protocol & router telemetry + wallet fee tier" } },
            "/v1/radar": { get: { summary: "Live Pons v2 curves & graduated Uniswap v4 pools" } },
            "/v1/audit": { get: { summary: "Deep curve, clone, Sherwood AI, and sniper-floor X-ray" } },
            "/v1/stocks": { get: { summary: "203 24/7 Robinhood Chain stock tokens" } },
            "/v1/build-tx": { post: { summary: "Simulate & encode non-custodial directBuy / directSell / swarmBuy calldata" } },
            "/v1/copilot": { post: { summary: "Tool-grounded AI Copilot prompt execution" } },
            "/mcp": { post: { summary: "Streamable HTTP JSON-RPC 2.0 Model Context Protocol endpoint" } },
          },
        });
      }

      if (p === "/mcp") {
        if (req.method === "POST") return await handleMcpPost(req, env);
        return json({
          protocol: "mcp-streamable-http",
          name: "hardwire-robinhood-mcp",
          chainId: 4663,
          endpoint: "/mcp",
          tools: MCP_TOOLS,
        });
      }

      if (p === "/v1/status") {
        const wallet = url.searchParams.get("wallet") || req.headers.get("x-wallet-address") || "";
        const [router, tier, ethUsd] = await Promise.all([
          readRouterTelemetry(env),
          getWalletTier(wallet, env),
          getEthUsd(env),
        ]);
        return json({
          ok: true,
          protocol: "HARDWIRE",
          chainId: 4663,
          ethUsd,
          market: getUsMarketClock(),
          contracts: {
            hardwireRouter: env.HARDWIRE_ROUTER_ADDRESS || null,
            hardwireToken: env.HARDWIRE_TOKEN_ADDRESS || null,
            ponsFactory: env.PONS_FACTORY || "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
            universalRouter: env.UNIVERSAL_ROUTER || "0x8876789976dEcBfCbBbe364623C63652db8C0904",
          },
          router,
          tier,
        });
      }

      if (p === "/v1/radar") {
        const phase = url.searchParams.get("phase") || "all";
        const limit = Number(url.searchParams.get("limit") || 16);
        return json(await getLiveRadar(env, { phase, limit }));
      }

      if (p === "/v1/audit") {
        const q = url.searchParams.get("q") || url.searchParams.get("token") || "";
        return json({ ok: true, audit: await auditPonsToken(q, env) });
      }

      if (p === "/v1/stocks") {
        const cat = await loadStocks(req, env);
        const q = (url.searchParams.get("q") || "").trim().toUpperCase();
        let list = cat.stocks || [];
        if (q) {
          list = list.filter(
            (s) =>
              s.symbol.toUpperCase().includes(q) ||
              s.name.toUpperCase().includes(q) ||
              String(s.cusip || "").toUpperCase().includes(q) ||
              s.address.toUpperCase() === q
          );
        }
        return json({
          ok: true,
          market: getUsMarketClock(),
          totalCatalog: (cat.stocks || []).length,
          count: list.length,
          stocks: list.slice(0, 60),
        });
      }

      if ((p === "/v1/quote" || p === "/v1/build-tx") && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        return json(await buildExecutionBundle(body, env));
      }

      if (p === "/v1/copilot" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        return json(await runCopilot(body, req, env));
      }

      if (p.startsWith("/v1/")) {
        return json({ ok: false, error: `Unknown endpoint: ${p}` }, 404);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(req);
      }
      return new Response("HARDWIRE Worker Online", { status: 200, headers: CORS });
    } catch (err) {
      return json({ ok: false, error: String(err?.message || err) }, 400);
    }
  },
};
