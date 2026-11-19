/**
 * Configuration from environment variables, validated at startup.
 * The server refuses to start in production with insecure defaults.
 */
const env = process.env

export function loadConfig(overrides = {}) {
  const config = {
    env: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 4000),
    databaseUrl: process.argv.includes('--memory')
      ? 'memory'
      : (env.DATABASE_URL ?? 'postgres://flowdesk:flowdesk@localhost:5432/flowdesk'),
    jwtSecret: env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenDays: Number(env.REFRESH_TOKEN_DAYS ?? 7),
    // Not set in development → allow any localhost port (Vite may pick 5174 if 5173 is busy)
    corsOrigins: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',').map((s) => s.trim())
      : (env.NODE_ENV ?? 'development') === 'production'
        ? []
        : [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/],
    metricsToken: env.METRICS_TOKEN ?? '',
    llm: { apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.LLM_MODEL ?? 'claude-sonnet-4-5' },
    worker: { enabled: env.WORKER_ENABLED !== 'false', intervalMs: Number(env.WORKER_INTERVAL_MS ?? 2000) },
    webhooks: { timeoutMs: 5000, allowPrivateHosts: env.WEBHOOKS_ALLOW_PRIVATE === 'true' },
    ...overrides,
  }
  if (config.env === 'production' && (config.jwtSecret.startsWith('dev-only') || config.jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production')
  }
  return config
}
