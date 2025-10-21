const { ethers, artifacts } = require("hardhat");

let cachedTemplAbi;

function abiKey(item) {
  if (!item) return "";
  const { type } = item;
  if (type === "function" || type === "event" || type === "error") {
    const args = (item.inputs || []).map((input) => input.type).join(",");
    return `${type}:${item.name || ""}(${args})`;
  }
  return `${type}:${item.stateMutability || ""}`;
}

async function getMergedTemplAbi() {
  if (cachedTemplAbi) {
    return cachedTemplAbi;
  }
  const templ = await artifacts.readArtifact("TEMPL");
  const membership = await artifacts.readArtifact("TemplMembershipModule");
  const treasury = await artifacts.readArtifact("TemplTreasuryModule");
  const governance = await artifacts.readArtifact("TemplGovernanceModule");

  const merged = [];
  const seen = new Set();
  for (const source of [templ.abi, membership.abi, treasury.abi, governance.abi]) {
    for (const item of source) {
      const key = abiKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }
  cachedTemplAbi = merged;
  return merged;
}

async function attachTemplInterface(instance) {
  const templAbi = await getMergedTemplAbi();
  let originalAbi = [];
  const iface = instance && instance.interface;
  if (iface && Array.isArray(iface.fragments)) {
    for (const fragment of iface.fragments) {
      if (!fragment || typeof fragment.format !== "function") continue;
      try {
        const formatted = fragment.format("json");
        originalAbi.push(JSON.parse(formatted));
      } catch {
        // ignore malformed fragments
      }
    }
  }
  const merged = [];
  const seen = new Set();
  for (const source of [originalAbi, templAbi]) {
    for (const item of source) {
      const key = abiKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }
  const address = instance.target || instance.address;
  const runner = instance.runner || instance.signer || (instance.provider && instance.provider.getSigner
    ? instance.provider.getSigner()
    : undefined);
  const attached = new ethers.Contract(address, merged, runner);
  attached.deploymentTransaction = instance.deploymentTransaction;
  return attached;
}

async function getTemplAt(address, runner) {
  const abi = await getMergedTemplAbi();
  return new ethers.Contract(address, abi, runner);
}

module.exports = {
  attachTemplInterface,
  getTemplAt,
  getMergedTemplAbi,
};
