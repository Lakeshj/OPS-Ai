/**
 * Mark a user as the platform developer (hidden flag).
 * Usage:
 *   node scripts/set-developer.js you@example.com
 *
 * Not available in Admin UI. Admins cannot grant this.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { pool } = require("../config/database");

const email = String(process.argv[2] || "")
  .trim()
  .toLowerCase();

if (!email) {
  console.error("Usage: node scripts/set-developer.js <email>");
  process.exit(1);
}

(async () => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, email, role, is_developer FROM users WHERE email = ?",
      [email]
    );
    if (rows.length === 0) {
      console.error(`No user found for ${email}`);
      process.exit(1);
    }

    await pool.execute(
      "UPDATE users SET is_developer = 1, updated_at = CURRENT_TIMESTAMP WHERE email = ?",
      [email]
    );

    console.log(`OK: ${email} is now the developer account (is_developer=1).`);
    console.log("Log out and log in again for capabilities to apply.");
    process.exit(0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
})();
