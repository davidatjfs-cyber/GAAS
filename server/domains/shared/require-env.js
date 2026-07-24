/**
 * Startup / health: list missing critical env keys.
 */

export function createRequireEnvHelpers({ databaseUrl, jwtSecret }) {
  function requireEnv() {
    const missing = [];
    if (!databaseUrl) missing.push('DATABASE_URL');
    if (!jwtSecret) missing.push('JWT_SECRET');
    return missing;
  }
  return { requireEnv };
}
