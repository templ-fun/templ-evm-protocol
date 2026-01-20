#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const outDir = path.join(__dirname, "out");

const DEFAULT_DUMMY_TOKEN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const DEFAULT_DUMMY_ENTRY_FEE = "10";
const DEFAULT_TARGETS = ["mainnet", "base"];
const CHAIN_CONFIGS = [
  { name: "mainnet" },
  { name: "base" },
  { name: "optimism" },
  { name: "arbitrum" }
];

function parseBoolean(value) {
  if (value === undefined || value === null) return false;
  const trimmed = String(value).trim();
  if (trimmed === "") return false;
  return /^(?:1|true|yes)$/i.test(trimmed);
}

function parseTargets(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return DEFAULT_TARGETS;
  return trimmed
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function loadFactoryAddresses() {
  const fallbackPath = path.join(outDir, "factory-addresses.json");
  const factoryPath = (process.env.FACTORY_ADDRESSES_PATH || fallbackPath).trim();
  if (!fs.existsSync(factoryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(factoryPath, "utf8"));
  } catch (err) {
    throw new Error(`Unable to read factory addresses at ${factoryPath}: ${err?.message || err}`);
  }
}

function readEnvForNetwork(prefix, chainName) {
  const key = `${prefix}_${chainName.toUpperCase()}`;
  const value = process.env[key];
  return value ? value.trim() : "";
}

function pickFactoryAddress(chainName, factoryMap) {
  const perNetwork = readEnvForNetwork("FACTORY_ADDRESS", chainName);
  if (perNetwork) return perNetwork;
  const direct = (process.env.FACTORY_ADDRESS || "").trim();
  if (direct) return direct;
  const fromFile = factoryMap?.chains?.[chainName]?.factory;
  return fromFile ? String(fromFile).trim() : "";
}

function pickTokenAddress(chainName, allowDummyToken) {
  const perNetwork = readEnvForNetwork("TOKEN_ADDRESS", chainName);
  if (perNetwork) return perNetwork;
  const direct = (process.env.TOKEN_ADDRESS || "").trim();
  if (direct) return direct;
  if (!allowDummyToken) return "";
  return (process.env.DUMMY_TOKEN_ADDRESS || DEFAULT_DUMMY_TOKEN_ADDRESS).trim();
}

function pickEntryFee(chainName, allowDummyToken) {
  const perNetwork = readEnvForNetwork("ENTRY_FEE", chainName);
  if (perNetwork) return perNetwork;
  const direct = (process.env.ENTRY_FEE || "").trim();
  if (direct) return direct;
  if (!allowDummyToken) return "";
  return (process.env.DUMMY_ENTRY_FEE || DEFAULT_DUMMY_ENTRY_FEE).trim();
}

function applyOptionalOverrides(env, chainName) {
  const suffix = chainName.toUpperCase();
  const keys = ["PRIEST_ADDRESS", "TEMPL_NAME", "TEMPL_DESCRIPTION", "TEMPL_LOGO_LINK"];
  for (const key of keys) {
    const override = process.env[`${key}_${suffix}`];
    if (override && override.trim() !== "") {
      env[key] = override.trim();
    }
  }
}

function runDeploy(chainName, env) {
  execFileSync(
    "npx",
    ["hardhat", "run", "scripts/deploy-templ.cjs", "--network", chainName],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env
    }
  );
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Set PRIVATE_KEY in your environment to deploy.");
  }
  const allowDummyToken = parseBoolean(
    process.env.ALLOW_DUMMY_TOKEN || process.env.USE_DUMMY_TOKEN || process.env.GENESIS_TEMPL
  );
  const targets = parseTargets(process.env.TEMPL_TARGET_CHAINS);
  const available = new Map(CHAIN_CONFIGS.map((chain) => [chain.name, chain]));
  const factoryMap = loadFactoryAddresses();

  for (const name of targets) {
    const chain = available.get(name);
    if (!chain) {
      throw new Error(`Unsupported chain "${name}". Supported: ${CHAIN_CONFIGS.map((c) => c.name).join(", ")}`);
    }
    const factoryAddress = pickFactoryAddress(chain.name, factoryMap);
    if (!factoryAddress) {
      throw new Error(
        `Missing FACTORY_ADDRESS for ${chain.name}. Set FACTORY_ADDRESS (or FACTORY_ADDRESS_${chain.name.toUpperCase()}) or ensure scripts/out/factory-addresses.json exists.`
      );
    }
    const tokenAddress = pickTokenAddress(chain.name, allowDummyToken);
    if (!tokenAddress) {
      throw new Error(
        `Missing TOKEN_ADDRESS for ${chain.name}. Set TOKEN_ADDRESS (or TOKEN_ADDRESS_${chain.name.toUpperCase()}) or enable ALLOW_DUMMY_TOKEN.`
      );
    }
    const entryFee = pickEntryFee(chain.name, allowDummyToken);
    if (!entryFee) {
      throw new Error(
        `Missing ENTRY_FEE for ${chain.name}. Set ENTRY_FEE (or ENTRY_FEE_${chain.name.toUpperCase()}) or enable ALLOW_DUMMY_TOKEN.`
      );
    }

    const env = {
      ...process.env,
      FACTORY_ADDRESS: factoryAddress,
      TOKEN_ADDRESS: tokenAddress,
      ENTRY_FEE: entryFee
    };
    applyOptionalOverrides(env, chain.name);

    console.log(`\n=== Deploying TEMPL on ${chain.name} ===`);
    runDeploy(chain.name, env);
  }
}

main().catch((err) => {
  console.error("\n❌ Multichain TEMPL deployment failed:", err?.message || err);
  process.exit(1);
});
