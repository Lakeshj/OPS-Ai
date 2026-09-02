const crypto = require("crypto");
const config = require("../config");

/**
 * AES-256-GCM envelope for secrets stored in the database. The key is derived
 * from config so rotating WORKFLOW_CREDENTIALS_KEY invalidates old ciphertext
 * rather than silently decrypting it wrong.
 */
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

const key = () =>
  crypto
    .createHash("sha256")
    .update(String(config.workflows.credentialsKey))
    .digest();

const encryptSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
};

const decryptSecret = (payload) => {
  const [version, ivB64, tagB64, dataB64] = String(payload || "").split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is malformed");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    throw new Error(
      "Could not decrypt credential — WORKFLOW_CREDENTIALS_KEY may have changed"
    );
  }
};

module.exports = { encryptSecret, decryptSecret };
