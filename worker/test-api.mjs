// Integration test suite for HARDWIRE Worker API, Copilot, Calldata Builder & JSON-RPC 2.0 MCP Server
// against live Robinhood Chain (4663), Sherwood, and Pons endpoints.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stocksJson = JSON.parse(fs.readFileSync(path.join(HERE, "..", "site", "data", "stocks.json"), "utf8"));

const SAMPLE_TOKEN = "0x89eb4e6d4d0d6012fbf7724315a579093054eb0a";

const env = {
  CHAIN_ID: "4663",
  RH_RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
  HARDWIRE_ROUTER_ADDRESS: "0x88f251df2012e58a6fcdaec69dc3fa2f6310d808",
  HARDWIRE_TOKEN_ADDRESS: "",
  HOLDER_THRESHOLD_HWIRE: "500000",
  SITE_DOMAIN: "hardwireagent.com",
  X_HANDLE: "hardwireagent",
  __LOCAL_STOCKS: stocksJson,
};

async function call(pathname, opts = {}) {
  const req = new Request(`https://hardwireagent.com${pathname}`, opts);
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text };
}

const st = await call("/v1/status");
assert.equal(st.status, 200);
assert.equal(st.body.ok, true);
assert.equal(st.body.chainId, 4663);

const rad = await call("/v1/radar?limit=8");
assert.equal(rad.status, 200);
assert.ok(rad.body.items.length >= 4);

const aud = await call(`/v1/audit?q=${SAMPLE_TOKEN}`);
assert.equal(aud.status, 200);
assert.ok(aud.body.audit.score > 0);

const txBuy = await call("/v1/build-tx", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "directBuy", token: SAMPLE_TOKEN, ethIn: 0.05 }),
});
assert.equal(txBuy.status, 200);
assert.ok(txBuy.body.tx.data.startsWith("0xbfcc5905"));

const stk = await call("/v1/stocks?q=NVDA");
assert.equal(stk.status, 200);
assert.ok(stk.body.stocks.some((s) => s.symbol === "NVDA"));

const cop = await call("/v1/copilot", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: `Audit ${SAMPLE_TOKEN} and build a 0.05 ETH buy` }),
});
assert.equal(cop.status, 200);
assert.equal(cop.body.ok, true);

const mcpList = await call("/mcp", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
assert.equal(mcpList.body.result.tools.length, 5);

console.log("[OK] All HARDWIRE Worker API, Copilot & MCP checks passed.");
