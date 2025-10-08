const asArray = (value) => {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

const normaliseMethod = (method) => {
  if (!method) return 'GET'
  return String(method).toUpperCase()
}

const cleanPath = (path) => {
  if (!path) return ''
  return String(path)
}

const fromOpenApi = (spec) => {
  const endpoints = []
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {}
  Object.entries(paths).forEach(([path, definition]) => {
    if (!definition || typeof definition !== 'object') return
    Object.entries(definition).forEach(([method, config]) => {
      if (!config || typeof config !== 'object') return
      endpoints.push({
        method: normaliseMethod(method),
        path: cleanPath(path),
        summary: config.summary || config.operationId || '',
        description: config.description || '',
        operationId: config.operationId || null,
        tags: asArray(config.tags),
      })
    })
  })

  return {
    format: 'openapi',
    title: spec?.info?.title || '',
    version: spec?.info?.version || '',
    description: spec?.info?.description || '',
    endpoints,
  }
}

const fromCollectorLike = (spec) => {
  const endpoints = asArray(spec?.endpoints).map((endpoint) => ({
    method: normaliseMethod(endpoint?.method || endpoint?.httpMethod),
    path: cleanPath(endpoint?.path || endpoint?.url),
    summary: endpoint?.name || endpoint?.summary || '',
    description: endpoint?.description || '',
    operationId: endpoint?.operationId || null,
    tags: asArray(endpoint?.tags || endpoint?.collections),
  }))

  return {
    format: spec?.format || 'endpoints',
    title: spec?.title || '',
    version: spec?.version || '',
    description: spec?.description || '',
    endpoints,
  }
}

export const normaliseEndpointSpec = (spec) => {
  if (!spec || typeof spec !== 'object') {
    return {
      format: null,
      title: '',
      version: '',
      description: '',
      endpoints: [],
    }
  }

  if (spec.openapi || spec.swagger || (spec.paths && typeof spec.paths === 'object')) {
    return fromOpenApi(spec)
  }

  if (Array.isArray(spec.endpoints)) {
    return fromCollectorLike(spec)
  }

  return {
    format: 'custom',
    title: spec?.title || '',
    version: spec?.version || '',
    description: spec?.description || '',
    endpoints: [],
  }
}
