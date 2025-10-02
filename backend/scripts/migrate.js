#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'migrations');

function parseArgs(argv) {
  const args = { db: process.env.SQLITE_DB_PATH || '' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--db' || value === '-d') {
      args.db = argv[i + 1] ?? '';
      i += 1;
    }
  }
  return args;
}

async function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );
  `);
}

async function main() {
  const { db: dbPath } = parseArgs(process.argv.slice(2));
  if (!dbPath) {
    console.error('Specify the SQLite database with --db <path> or set SQLITE_DB_PATH.');
    process.exit(1);
  }

  let migrations;
  try {
    migrations = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  } catch (err) {
    console.error('Failed reading migrations directory:', err?.message || err);
    process.exit(1);
  }

  if (migrations.length === 0) {
    console.log('No migrations found.');
    return;
  }

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);
  try {
    await ensureMigrationsTable(db);

    const appliedStmt = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const insertStmt = db.prepare('INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)');

    for (const migrationFile of migrations) {
      const version = migrationFile.replace(/\.sql$/, '');
      const alreadyApplied = appliedStmt.get(version);
      if (alreadyApplied) {
        console.log(`Skipping ${version} (already applied)`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, migrationFile), 'utf8');
      console.log(`Applying ${version}...`);
      try {
        db.exec(sql);
        insertStmt.run(version, Date.now());
        console.log(`Applied ${version}`);
      } catch (err) {
        console.error(`Migration ${version} failed:`, err?.message || err);
        process.exit(1);
      }
    }
  } finally {
    try {
      db.close();
    } catch (err) {
      void err;
    }
  }

  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration runner crashed:', err?.message || err);
  process.exit(1);
});
