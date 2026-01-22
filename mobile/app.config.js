function pickEnvValue(primary, fallback) {
  if (primary !== undefined && primary !== null && primary !== '') return primary
  if (fallback !== undefined && fallback !== null && fallback !== '') return fallback
  return undefined
}

module.exports = ({ config }) => {
  const baseConfig = config || {}
  const envOverrides = {}

  const useNgrok = pickEnvValue(
    process.env.EXPO_PUBLIC_USE_NGROK,
    process.env.USE_NGROK
  )
  if (useNgrok !== undefined) {
    envOverrides.USE_NGROK = useNgrok
  }

  const ngrokUrl = pickEnvValue(
    process.env.EXPO_PUBLIC_NGROK_URL,
    process.env.NGROK_URL
  )
  if (ngrokUrl !== undefined) {
    envOverrides.NGROK_URL = ngrokUrl
  }

  const apiBase = pickEnvValue(
    process.env.EXPO_PUBLIC_API_BASE,
    process.env.API_BASE
  )
  if (apiBase !== undefined) {
    envOverrides.API_BASE = apiBase
  }

  return {
    ...baseConfig,
    extra: {
      ...(baseConfig.extra || {}),
      ...envOverrides,
    },
  }
}
