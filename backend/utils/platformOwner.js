/**
 * Developer / platform owner access — NOT a Users-page role.
 * Marked only via DB flag `users.is_developer` (script or SQL).
 * Never creatable from Admin UI. Never shown as a role name.
 */

const isDeveloperFlag = (userOrFlag) => {
  if (userOrFlag == null) return false;
  if (typeof userOrFlag === "boolean") return userOrFlag;
  if (typeof userOrFlag === "number") return userOrFlag === 1;
  if (typeof userOrFlag === "object") {
    return Boolean(
      userOrFlag.is_developer === true ||
        userOrFlag.is_developer === 1 ||
        userOrFlag.isDeveloper === true
    );
  }
  return false;
};

/** Capabilities attached only when true (no "super admin" naming in API/UI). */
const getOwnerCapabilities = (userOrFlag) => {
  if (!isDeveloperFlag(userOrFlag)) return null;
  return {
    manageSystemPromptLifecycle: true,
  };
};

const withOwnerCapabilities = (user) => {
  if (!user || typeof user !== "object") return user;
  const capabilities = getOwnerCapabilities(user);
  // Strip internal flag from client-facing payload
  const {
    password: _password,
    is_developer: _isDeveloperCol,
    isDeveloper: _isDeveloperCamel,
    created_at,
    updated_at,
    ...safe
  } = user;

  const base = {
    ...safe,
    ...(created_at != null ? { createdAt: created_at } : {}),
    ...(updated_at != null ? { updatedAt: updated_at } : {}),
  };

  if (!capabilities) return base;
  return { ...base, capabilities };
};

module.exports = {
  isDeveloperFlag,
  getOwnerCapabilities,
  withOwnerCapabilities,
  // Back-compat aliases used by middleware
  isPlatformOwnerEmail: (email, user) => isDeveloperFlag(user),
  isPlatformOwner: isDeveloperFlag,
};
