// Verifies HardwireRouter artifact, EIP-170 runtime bytecode cap, ABI selectors, and calldata encoding.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData, keccak256, toBytes, toFunctionSelector, parseEther } from "viem";

const { abi, bytecode } = JSON.parse(readFileSync(new URL("./build/HardwireRouter.json", import.meta.url), "utf8"));

assert.ok(bytecode.startsWith("0x60"), "Valid EVM creation bytecode");
const sizeBytes = (bytecode.length - 2) / 2;
assert.ok(sizeBytes < 24576, `Under EIP-170 24KB cap (${sizeBytes} bytes)`);

const requiredFns = [
  "bindHardwire",
  "directBuy",
  "directSell",
  "swarmBuy",
  "basketBuy",
  "burnForPriority",
  "ignite",
  "donateAndIgnite",
  "routerStats",
  "inspectPonsToken",
];

const fnNames = new Set(abi.filter((x) => x.type === "function").map((x) => x.name));
for (const fn of requiredFns) {
  assert.ok(fnNames.has(fn), `Missing ABI function: ${fn}`);
}

const buyItem = abi.find((x) => x.type === "function" && x.name === "directBuy");
assert.equal(toFunctionSelector(buyItem), "0xbfcc5905");

const calldata = encodeFunctionData({
  abi,
  functionName: "directBuy",
  args: [
    "0x89eb4e6d4d0d6012fbf7724315a579093054eb0a",
    parseEther("1"),
    300,
    "0x0000000000000000000000000000000000000001",
    keccak256(toBytes("hardwire:directBuy")),
  ],
});
assert.ok(calldata.startsWith("0xbfcc5905"));

console.log("[OK] HardwireRouter bytecode, ABI selectors & calldata verified.");
