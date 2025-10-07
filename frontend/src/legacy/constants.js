export const LEGACY_BASE_PATH = '/legacy'

export const legacyPath = (suffix = '') => {
  if (!suffix) {
    return LEGACY_BASE_PATH
  }
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${LEGACY_BASE_PATH}${normalized}`
}
