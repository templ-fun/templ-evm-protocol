const fs = require('fs');
const path = require('path');

function stripMetadata(bytecode) {
  if (!bytecode || bytecode === '0x') return bytecode;
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  if (hex.length <= 4) return bytecode;
  const metadataLengthHex = hex.slice(-4);
  const metadataLength = parseInt(metadataLengthHex, 16) * 2;
  const stripped = hex.slice(0, hex.length - metadataLength - 4);
  return '0x' + stripped;
}

function shrinkArtifacts() {
  const artifactsDir = path.join(__dirname, '../artifacts/contracts');
  if (!fs.existsSync(artifactsDir)) {
    console.error('Artifacts directory not found. Did you run compile?');
    process.exit(1);
  }

  const targetFolder = path.join(artifactsDir, 'TEMPL.sol');
  if (!fs.existsSync(targetFolder)) {
    console.error('TEMPL artifact not found. Did you compile?');
    process.exit(1);
  }

  for (const file of fs.readdirSync(targetFolder)) {
    if (!file.endsWith('.json')) continue;
    const artifactPath = path.join(targetFolder, file);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    ['bytecode', 'deployedBytecode'].forEach((key) => {
      if (artifact[key]) {
        artifact[key] = stripMetadata(artifact[key]);
      }
    });
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    console.log(`Shrunk ${artifactPath}`);
  }
}

shrinkArtifacts();
