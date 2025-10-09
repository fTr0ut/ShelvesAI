export const stripTrailingSlash = (value) => value.replace(/\/+$/, '')

export const buildDebugUrl = (candidate, getApiOrigin) => {
  if (!candidate) {
    return `${getApiOrigin()}/__debug`
  }
  const base = stripTrailingSlash(candidate)
  return `${base}/__debug`
}

export const stringifyDocument = (document) => {
  if (!document) return ''
  try {
    return JSON.stringify(document, null, 2)
  } catch (error) {
    console.warn('Unable to stringify endpoint document', error)
    return ''
  }
}

export const validateTargetInput = (value) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) {
    return 'Targets cannot contain spaces. Use dashes or underscores instead.'
  }
  try {
    const parsed = new URL(trimmed)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return 'Only HTTP(S) URLs are supported for remote targets.'
    }
    return ''
  } catch (error) {
    const pathPattern = /^(\.{1,2}\/|\/)?[\w.-]+([\/\\][\w.@-]+)*$/
    const windowsDrivePattern = /^[a-zA-Z]:\\/
    if (pathPattern.test(trimmed) || windowsDrivePattern.test(trimmed)) {
      return ''
    }
    return 'Enter a full URL (https://…) or a relative directory path such as ./build.'
  }
}
