require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");
const dotenv = require("dotenv");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");
const path = require("path");

dotenv.config();

// Allow excluding mock contracts from production builds by setting SKIP_MOCKS=true
if (process.env.SKIP_MOCKS === "true") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(
    async (_, __, runSuper) => {
      const paths = await runSuper();
      const mocksPath = path.join("contracts", "mocks");
      return paths.filter((p) => !p.includes(mocksPath));
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
      allowUnlimitedContractSize: process.env.SKIP_MOCKS === "true" ? false : true
    },
    base: {
      url: process.env.RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "",
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
  }
};

module.exports = config;
