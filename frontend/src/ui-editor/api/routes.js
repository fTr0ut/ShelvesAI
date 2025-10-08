import { fetchJson } from './client'

export const fetchRouteConfiguration = () => fetchJson('/api/ui-editor/routes')

export const fetchAvailableScreens = () => fetchJson('/api/ui-editor/screens')

export const saveRouteConfiguration = (routes = []) => {
  const payload = {
    routes: routes.map((route) => ({
      id: route.id,
      path: route.path,
      screenId: route.screenId,
    })),
  }

  return fetchJson('/api/ui-editor/routes', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

