import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'
import { PlasmicCanvasHost } from '@plasmicapp/host'
import { PlasmicRootProvider } from '@plasmicapp/loader-react'
import { PLASMIC } from '../plasmic-init'

function HostOnly() {
  return (
    <PlasmicRootProvider loader={PLASMIC}>
      <PlasmicCanvasHost />
    </PlasmicRootProvider>
  )
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()

  if (router.pathname === '/plasmic-host') {
    return <HostOnly />
  }

  return <Component {...pageProps} />
}
