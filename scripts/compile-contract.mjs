import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const source = fs.readFileSync("contracts/PaymentRouter.sol", "utf8");
const input = {
  language: "Solidity",
  sources: {
    "PaymentRouter.sol": { content: source },
    "TronPaymentRouter.sol": {
      content: fs
        .readFileSync("contracts/TronPaymentRouter.sol", "utf8")
        .replace("pragma solidity 0.8.25;", "pragma solidity >=0.8.25;"),
    },
    "PaymentToken.sol": {
      content: fs.readFileSync("tests/fixtures/PaymentToken.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
        ],
      },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (name) => {
      const p = path.resolve("node_modules", name);
      if (!p.startsWith(path.resolve("node_modules") + path.sep))
        return { error: "Invalid import" };
      try {
        return { contents: fs.readFileSync(p, "utf8") };
      } catch {
        return { error: `Cannot import ${name}` };
      }
    },
  }),
);
for (const error of output.errors || []) console.error(error.formattedMessage);
if (output.errors?.some((e) => e.severity === "error")) process.exit(1);
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(
  "artifacts/PaymentRouter.json",
  JSON.stringify(
    {
      compiler: solc.version(),
      ...output.contracts["PaymentRouter.sol"].PaymentRouter,
    },
    null,
    2,
  ),
);
console.log(`PaymentRouter compiled with ${solc.version()}`);
// EVM-only model for local invariant tests. Deployment always uses the separate official TRON compiler artifact.
fs.writeFileSync(
  "artifacts/TronPaymentRouterEvmModel.json",
  JSON.stringify(
    output.contracts["TronPaymentRouter.sol"].TronPaymentRouter,
    null,
    2,
  ),
);
fs.writeFileSync(
  "artifacts/PaymentToken.json",
  JSON.stringify(output.contracts["PaymentToken.sol"].PaymentToken, null, 2),
);
