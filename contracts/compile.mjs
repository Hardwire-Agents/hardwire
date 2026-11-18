// Compiles HardwireRouter.sol with solc 0.8.24 (optimizer 200, viaIR, cancun)
// into build/HardwireRouter.json and build/HardwireRouter.standard-input.json (exact_match Sourcify v2).
import solc from "solc";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("./HardwireRouter.sol", import.meta.url), "utf8");
const stdInput = {
  language: "Solidity",
  sources: { "HardwireRouter.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(stdInput)));
if ((out.errors || []).some((e) => e.severity === "error")) {
  throw new Error(out.errors.map((e) => e.formattedMessage).join("\n"));
}

const c = out.contracts["HardwireRouter.sol"].HardwireRouter;
const bytecode = "0x" + c.evm.bytecode.object;
const deployedBytes = c.evm.deployedBytecode.object.length / 2;

mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("./build/HardwireRouter.json", import.meta.url),
  JSON.stringify({ abi: c.abi, bytecode }, null, 2)
);
writeFileSync(
  new URL("./build/HardwireRouter.standard-input.json", import.meta.url),
  JSON.stringify(stdInput, null, 2)
);

console.log(`[OK] Compiled HardwireRouter (${deployedBytes} runtime bytes) -> build/HardwireRouter.json`);
