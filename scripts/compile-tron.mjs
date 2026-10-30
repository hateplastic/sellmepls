import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import wrapper from "solc/wrapper.js";
const compilerFile = "artifacts/tron-soljson-0.8.25.cjs";
const checksum =
  "70a068c5b090ef1b1b2410f92713eabc459501edfebb127034a46f9448d9d244";
fs.mkdirSync("artifacts", { recursive: true });
if (!fs.existsSync(compilerFile)) {
  const response = await fetch(
    "https://raw.githubusercontent.com/tronprotocol/solc-bin/main/wasm/soljson-v0.8.25+commit.77bd169f.js",
  );
  if (!response.ok) throw new Error("Official TRON compiler download failed");
  const body = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(body).digest("hex") !== checksum)
    throw new Error("TRON compiler checksum mismatch");
  fs.writeFileSync(compilerFile, body);
}
if (
  createHash("sha256").update(fs.readFileSync(compilerFile)).digest("hex") !==
  checksum
)
  throw new Error("TRON compiler checksum mismatch");
const solc = wrapper(createRequire(import.meta.url)(`../${compilerFile}`));
const input = {
  language: "Solidity",
  sources: {
    "TronPaymentRouter.sol": {
      content: fs.readFileSync("contracts/TronPaymentRouter.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "istanbul",
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
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors || []) console.error(error.formattedMessage);
if (output.errors?.some((e) => e.severity === "error")) process.exit(1);
fs.writeFileSync(
  "artifacts/TronPaymentRouter.json",
  JSON.stringify(
    {
      compiler: solc.version(),
      ...output.contracts["TronPaymentRouter.sol"].TronPaymentRouter,
    },
    null,
    2,
  ),
);
console.log(`TronPaymentRouter compiled with TRON solc ${solc.version()}`);
