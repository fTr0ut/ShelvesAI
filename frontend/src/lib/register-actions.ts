import type { PlasmicComponentLoader } from '@plasmicapp/loader-react'

export function registerActions(_loader: PlasmicComponentLoader) {
  // No-op for web runtime; mobile actions are registered in the mobile host.
}
