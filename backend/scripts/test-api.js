/**
 * Quick API smoke test (no auth).
 * Usage: node scripts/test-api.js
 * Optional: API_BASE=http://localhost:5013/api node scripts/test-api.js
 */
const base = (process.env.API_BASE || "http://localhost:5013/api").replace(
  /\/$/,
  ""
);

const check = async (path) => {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    console.log(`${res.status} ${url}`);
    console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
    console.log("---");
    return res.ok;
  } catch (error) {
    console.error(`FAIL ${url}`);
    console.error(error.message);
    console.log("---");
    return false;
  }
};

(async () => {
  const a = await check("/");
  const b = await check("/health");
  if (!a || !b) process.exit(1);
  console.log("API smoke test passed.");
})();
