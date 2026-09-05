export interface GoogleConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

/** An explicit false disables sync; otherwise complete configuration enables it. */
export const getGoogleConfig = (
  env: Record<string, unknown>,
  legacy?: Partial<GoogleConfig>,
): GoogleConfig | undefined => {
  if (env.VITE_ENABLE_GOOGLE_SYNC === "false") return undefined
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? legacy?.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? legacy?.authDomain,
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? legacy?.projectId,
    appId: env.VITE_FIREBASE_APP_ID ?? legacy?.appId,
  }
  if (
    !Object.values(config).every(
      (value) => typeof value === "string" && value.trim(),
    )
  )
    return undefined
  return config as GoogleConfig
}
