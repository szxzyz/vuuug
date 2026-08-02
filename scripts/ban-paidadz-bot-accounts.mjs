// One-time backfill: ban accounts that already used the "PaidAdz Automation"
// script BEFORE the known-bot-signature check existed in fraudDetection.ts.
//
// The check added to fraudDetection.ts / auth.ts only catches this signature
// going forward, on the NEXT login of an already-logged-in account. This
// script finds and bans matches that are already sitting in the DB right now.
//
// Signature: hardcoded device_id + fingerprint fields from the confirmed
// automation script (device_id c93ad4e2..., screenW 601, screenH 1007,
// hardwareConcurrency 8, deviceMemory 4, timezone Asia/Calcutta, UA containing
// SM-X110).
//
// Run with: node scripts/ban-paidadz-bot-accounts.mjs [--dry-run]

import pkg from 'pg';
const { Pool } = pkg;

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const KNOWN_DEVICE_ID = 'c93ad4e208577dc9be17b98aa37756c4';
const REASON = 'Known bot signature: PaidAdz Automation script (hardcoded fingerprint) — backfilled';

const MATCH_WHERE = `
  device_id = $1
  OR (
    device_fingerprint->>'screenW' = '601'
    AND device_fingerprint->>'screenH' = '1007'
    AND device_fingerprint->>'hardwareConcurrency' = '8'
    AND device_fingerprint->>'deviceMemory' = '4'
    AND device_fingerprint->>'timezone' = 'Asia/Calcutta'
    AND device_fingerprint->>'userAgent' LIKE '%SM-X110%'
  )
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be made' : '🚫 APPLY MODE — matching accounts will be banned');

    const { rows } = await client.query(
      `SELECT id, telegram_id, username, device_id, banned, created_at
       FROM users
       WHERE ${MATCH_WHERE}`,
      [KNOWN_DEVICE_ID],
    );

    if (rows.length === 0) {
      console.log('✅ No matching accounts found.');
      return;
    }

    console.log(`\nFound ${rows.length} matching account(s):\n`);
    for (const row of rows) {
      console.log(`  - id=${row.id} telegram_id=${row.telegram_id} username=${row.username || '(none)'} already_banned=${row.banned}`);
    }

    if (DRY_RUN) {
      console.log('\nDry run only — re-run without --dry-run to ban these accounts.');
      return;
    }

    const result = await client.query(
      `UPDATE users
       SET
         banned = true,
         banned_reason = $2,
         banned_at = NOW(),
         suspicion_score = 100,
         flagged = true,
         flag_reason = 'Known bot signature match (backfill)',
         updated_at = NOW()
       WHERE ${MATCH_WHERE}`,
      [KNOWN_DEVICE_ID, REASON],
    );

    console.log(`\n✅ Banned ${result.rowCount} account(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
