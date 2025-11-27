require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");
const dotenv = require("dotenv");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");
const path = require("path");

dotenv.config();

// Allow excluding mock contracts from production builds by setting SKIP_MOCKS=true
if (process.env.SKIP_MOCKS === "true" || process.env.ONLY) {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(
    async (_, __, runSuper) => {
      const paths = await runSuper();
      const mocksPath = path.join("contracts", "mocks");
      let filtered = paths;
      if (process.env.SKIP_MOCKS === "true") {
        filtered = filtered.filter((p) => !p.includes(mocksPath));
      }
      if (process.env.ONLY) {
        const needle = process.env.ONLY;
        filtered = filtered.filter((p) => p.includes(needle));
      }
      return filtered;
    }
  );
}

const usingCoverage =
  process.argv.includes("coverage") ||
  process.env.SOLIDITY_COVERAGE === "true" ||
  process.env.SOLIDITY_COVERAGE === "1";

const viaIRDefault = process.env.SOLC_VIA_IR === "false" ? false : true;
// Use a production-friendly optimizer default; allow override via SOLC_RUNS.
const runsDefault = process.env.SOLC_RUNS ? (parseInt(process.env.SOLC_RUNS, 10) || 500) : 500;

/** @type import("hardhat/config").HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.23",
    settings: {
      viaIR: viaIRDefault,
      optimizer: {
        enabled: true,
        runs: usingCoverage ? 1 : runsDefault
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: process.env.SKIP_MOCKS === "true" ? false : true,
      blockGasLimit: 120_000_000,
      initialBaseFeePerGas: 0
    },
    base: {
      url: process.env.RPC_BASE_URL || process.env.RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453
    },
    mainnet: {
      url: process.env.RPC_MAINNET_URL || "https://rpc.ankr.com/eth",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 1
    },
    optimism: {
      url: process.env.RPC_OPTIMISM_URL || "https://mainnet.optimism.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 10
    },
    arbitrum: {
      url: process.env.RPC_ARBITRUM_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
      optimism: process.env.OPTIMISM_API_KEY || process.env.ETHERSCAN_API_KEY || "",
      arbitrum: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: usingCoverage ? 180_000 : 60_000,
    // Exclude heavy @load and randomized @fuzz suites from coverage runs
    grep: usingCoverage ? '@(load|fuzz)' : undefined,
    invert: usingCoverage ? true : undefined
  }
};

module.exports = config;
