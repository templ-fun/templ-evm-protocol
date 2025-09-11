#!/usr/bin/env node
/*
  Lightweight Solidity doc generator (no deps).
  Parses Natspec header comments (block-style or leading triple-slash)
  immediately preceding function/constructor/receive/fallback and emits Markdown.
*/
const fs = require('fs');
const path = require('path');

function read(file) { return fs.readFileSync(file, 'utf8'); }

function cleanDocLines(lines) {
  return lines
    .map(l => l.replace(/^\s*\*\s?/, '').replace(/^\s*\/\/\/\s?/, ''))
    .filter(l => !/^\s*$/.test(l));
}

function parseDocTags(doc) {
  const res = { notice: [], dev: [], params: [], returns: [] };
  for (const line of doc) {
    const mParam = line.match(/^@param\s+(\w+)\s+(.*)$/);
    const mReturn = line.match(/^@return\s+(\w+)?\s*(.*)$/);
    if (line.startsWith('@notice')) { res.notice.push(line.replace(/^@notice\s*/, '')); continue; }
    if (line.startsWith('@dev')) { res.dev.push(line.replace(/^@dev\s*/, '')); continue; }
    if (mParam) { res.params.push({ name: mParam[1], desc: mParam[2] }); continue; }
    if (mReturn) { res.returns.push({ name: mReturn[1] || '', desc: mReturn[2] }); continue; }
    // Free text: treat as notice if none yet, else dev
    if (res.notice.length === 0) res.notice.push(line); else res.dev.push(line);
  }
  return res;
}

function extractFunctions(src) {
  const lines = src.split(/\r?\n/);
  const fns = [];
  let i = 0;
  let pendingDoc = null;
  const startsBlock = /\/\*\*/;
  const endsBlock = /\*\//;
  const startsLineDoc = /^\s*\/\/\//;
  const funcStart = /(\bfunction\b|\bconstructor\b|\breceive\s*\(|\bfallback\s*\()/;

  while (i < lines.length) {
    const line = lines[i];
    // Block doc
    if (startsBlock.test(line)) {
      const buf = [line.replace(/^\s*\/\*\*\s?/, '')];
      i++;
      while (i < lines.length && !endsBlock.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) buf.push(lines[i].replace(/\*\//, ''));
      pendingDoc = cleanDocLines(buf);
      i++;
      continue;
    }
    // Line doc (one or more ///)
    if (startsLineDoc.test(line)) {
      const buf = [];
      while (i < lines.length && startsLineDoc.test(lines[i])) { buf.push(lines[i]); i++; }
      pendingDoc = cleanDocLines(buf);
      continue;
    }
    // Function-like start
    if (funcStart.test(line)) {
      // Accumulate raw text until we encounter a '{' or ';' in the accumulated buffer
      let buf = line.trim();
      i++;
      while (i < lines.length && !(/[{};]/.test(buf))) {
        buf += ' ' + lines[i].trim();
        i++;
      }
      // Cut off at first '{' or ';' if present
      const idxBrace = buf.indexOf('{');
      const idxSemi = buf.indexOf(';');
      let cut = -1;
      if (idxBrace !== -1 && idxSemi !== -1) cut = Math.min(idxBrace, idxSemi);
      else cut = (idxBrace !== -1 ? idxBrace : idxSemi);
      let sig = cut !== -1 ? buf.slice(0, cut) : buf;
      // Normalize whitespace
      sig = sig.replace(/\s+/g, ' ').trim();
      fns.push({ signature: sig, doc: pendingDoc ? parseDocTags(pendingDoc) : null });
      pendingDoc = null;
      continue;
    }
    i++;
  }
  return fns;
}

function extractContractName(src) {
  const m = src.match(/contract\s+(\w+)\s+/);
  return m ? m[1] : 'Contract';
}

function toMarkdown(contractName, items) {
  const lines = [];
  lines.push(`# ${contractName} – Public API`);
  lines.push('');
  for (const it of items) {
    lines.push(`## ${it.signature}`);
    if (it.doc) {
      if (it.doc.notice.length) {
        lines.push('');
        lines.push(it.doc.notice.join(' '));
      }
      if (it.doc.dev.length) {
        lines.push('');
        lines.push(`Dev: ${it.doc.dev.join(' ')}`);
      }
      if (it.doc.params.length) {
        lines.push('');
        lines.push('Params:');
        for (const p of it.doc.params) lines.push(`- ${p.name}: ${p.desc}`);
      }
      if (it.doc.returns.length) {
        lines.push('');
        lines.push('Returns:');
        for (const r of it.doc.returns) lines.push(`- ${r.name || '(value)'}: ${r.desc}`);
      }
    } else {
      lines.push('');
      lines.push('_No Natspec header found._');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const rel = process.argv[2] || 'contracts/TEMPL.sol';
  const srcPath = path.resolve(process.cwd(), rel);
  const src = read(srcPath);
  const name = extractContractName(src);
  const fns = extractFunctions(src);
  const md = toMarkdown(name, fns);
  const outDir = path.resolve(process.cwd(), 'contracts');
  const outPath = path.join(outDir, `${name}.API.md`);
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}
