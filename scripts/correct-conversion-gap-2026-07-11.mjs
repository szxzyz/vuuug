// One-off forensic correction: accounts whose total POW->USD/TON conversions
// exceed their (earned - already-corrected) ledger total. See MEMORY.md /
// cashwatch-balance-audits.md for background on the prior two correction passes
// this one follows.
//
// For each affected account:
//   gap_pow = total_converted - (total_earned - total_already_corrected)
//   available_pow_equiv = balance + usd_balance*usd_rate + ton_balance*ton_rate
//   correction_pow = min(gap_pow, available_pow_equiv)   // never claws back
//                                                          // funds already paid
//                                                          // out via approved
//                                                          // withdrawals — those
//                                                          // are no longer in
//                                                          // balance/usd/ton.
// Deduct correction_pow from balance first, then usd_balance, then ton_balance
// (in POW-equivalent terms), floor at 0 for each. Logs an audit row + mirrored
// transaction row per corrected account, same pattern as the prior two passes.
//
// Run with: node scripts/correct-conversion-gap-2026-07-11.mjs [--dry-run]

import pkg from 'pg';
const { Pool } = pkg;

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const GAP_THRESHOLD = 1000; // ignore noise/rounding gaps below this

async function main() {
  const client = await pool.connect();
  try {
    const ratesRes = await client.query(
      `SELECT setting_key, setting_value FROM admin_settings WHERE setting_key IN ('pad_to_usd_rate','pad_to_ton_rate')`
    );
    const rates = Object.fromEntries(ratesRes.rows.map(r => [r.setting_key, parseFloat(r.setting_value)]));
    const usdRate = rates.pad_to_usd_rate || 10000000;
    const tonRate = rates.pad_to_ton_rate || 10000000;

    const gapsRes = await client.query(`
      WITH earned AS (
        SELECT user_id, SUM(amount::numeric) AS total_earned_ledger
        FROM transactions WHERE type='addition' GROUP BY user_id
      ), converted AS (
        SELECT user_id, SUM(-amount::numeric) AS total_converted
        FROM transactions WHERE source='convert' GROUP BY user_id
      ), corrected AS (
        SELECT user_id, SUM(-amount::numeric) AS total_corrected
        FROM transactions WHERE source='balance_correction' GROUP BY user_id
      )
      SELECT c.user_id,
        COALESCE(e.total_earned_ledger,0) AS total_earned,
        COALESCE(co.total_corrected,0) AS total_corrected,
        c.total_converted,
        c.total_converted - (COALESCE(e.total_earned_ledger,0) - COALESCE(co.total_corrected,0)) AS gap_pow
      FROM converted c
      LEFT JOIN earned e ON e.user_id = c.user_id
      LEFT JOIN corrected co ON co.user_id = c.user_id
      WHERE c.total_converted - (COALESCE(e.total_earned_ledger,0) - COALESCE(co.total_corrected,0)) > ${GAP_THRESHOLD}
      ORDER BY gap_pow DESC
    `);

    console.log(`Found ${gapsRes.rows.length} accounts with unexplained conversion gap > ${GAP_THRESHOLD} POW`);
    if (DRY_RUN) console.log('--- DRY RUN: no writes will be made ---');

    let totalCorrected = 0;
    let totalUncorrectable = 0;
    let correctedCount = 0;

    for (const row of gapsRes.rows) {
      const userId = row.user_id;
      const gapPow = parseFloat(row.gap_pow);

      await client.query('BEGIN');
      try {
        const userRes = await client.query(
          `SELECT username, telegram_id, balance, usd_balance, ton_balance,
                  (SELECT status FROM withdrawals w WHERE w.user_id = u.id AND LOWER(w.status) = 'approved' LIMIT 1) AS approved_withdrawal
           FROM users u WHERE u.id = $1 FOR UPDATE`,
          [userId]
        );
        const user = userRes.rows[0];
        if (!user) { await client.query('ROLLBACK'); continue; }

        const balance = parseFloat(user.balance || '0');
        const usdBalance = parseFloat(user.usd_balance || '0');
        const tonBalance = parseFloat(user.ton_balance || '0');

        const balancePowEquiv = balance;
        const usdPowEquiv = usdBalance * usdRate;
        const tonPowEquiv = tonBalance * tonRate;
        const availablePowEquiv = balancePowEquiv + usdPowEquiv + tonPowEquiv;

        const correctionPow = Math.min(gapPow, availablePowEquiv);
        if (correctionPow <= 0) { await client.query('ROLLBACK'); continue; }

        // Deduct from balance first, then usd_balance, then ton_balance (POW-equivalent order)
        let remaining = correctionPow;
        const deductBalance = Math.min(remaining, balancePowEquiv);
        remaining -= deductBalance;
        const deductUsdPow = Math.min(remaining, usdPowEquiv);
        remaining -= deductUsdPow;
        const deductTonPow = Math.min(remaining, tonPowEquiv);
        remaining -= deductTonPow;

        const newBalance = Math.max(0, balance - deductBalance);
        const newUsdBalance = Math.max(0, usdBalance - deductUsdPow / usdRate);
        const newTonBalance = Math.max(0, tonBalance - deductTonPow / tonRate);

        if (!DRY_RUN) {
          await client.query(
            `UPDATE users SET balance = $1, usd_balance = $2, ton_balance = $3, updated_at = NOW() WHERE id = $4`,
            [String(Math.round(newBalance)), newUsdBalance.toFixed(10), newTonBalance.toFixed(10), userId]
          );
          await client.query(
            `UPDATE user_balances SET balance = GREATEST(0, COALESCE(balance,0) - $1), updated_at = NOW() WHERE user_id = $2`,
            [String(deductBalance), userId]
          );
          await client.query(
            `INSERT INTO transactions (user_id, amount, type, source, description)
             VALUES ($1, $2, 'deduction', 'balance_correction', $3)`,
            [userId, String(-correctionPow),
             `Conversion-gap correction: removed ${correctionPow.toFixed(2)} POW-equivalent (converted more POW than the earnings ledger + prior corrections support)`]
          );
          await client.query(
            `INSERT INTO balance_correction_audit
               (user_id, username, telegram_id, balance_before, balance_after, correction_amount,
                correction_reason, has_withdrawal, corrected_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [userId, user.username, user.telegram_id,
             String(availablePowEquiv), String(availablePowEquiv - correctionPow), String(correctionPow),
             `Unexplained POW-to-USD/TON conversion gap (converted ${row.total_converted} POW vs net legitimate earnings ${(parseFloat(row.total_earned) - parseFloat(row.total_corrected)).toFixed(2)} POW). Corrected against currently-held balance only; funds already paid out via approved withdrawals were not clawed back.`,
             !!user.approved_withdrawal, 'forensic_audit_2026_07_11']
          );
        }

        await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');

        totalCorrected += correctionPow;
        if (correctionPow < gapPow) totalUncorrectable += (gapPow - correctionPow);
        correctedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error correcting user ${userId}:`, err.message);
      }
    }

    console.log(`\nCorrected ${correctedCount} accounts`);
    console.log(`Total POW clawed back from current balances: ${totalCorrected.toFixed(2)} (~$${(totalCorrected / usdRate).toFixed(4)})`);
    console.log(`Total POW gap that could NOT be corrected (already paid out / spent): ${totalUncorrectable.toFixed(2)} (~$${(totalUncorrectable / usdRate).toFixed(4)})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
