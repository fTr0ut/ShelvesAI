import { PlasmicCanvasHost } from '@plasmicapp/host';
import { PlasmicRootProvider } from '@plasmicapp/loader-react';
import { useEffect } from 'react';
import { PLASMIC } from '../plasmic-init';

const normalizePath = (value: string) => value.replace(/\/+$/, '') || '/';

const hostBase = '/plasmic-host';

const isHostRequest = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const path = normalizePath(window.location.pathname);
  return path === hostBase || path.startsWith(`${hostBase}/`);
};

const scrollToTop = () => {
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
};

const HostShell = () => (
  <PlasmicRootProvider loader={PLASMIC}>
    <PlasmicCanvasHost />
  </PlasmicRootProvider>
);

const Landing = () => (
  <main style={{ padding: '2rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
    <h1 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>Plasmic Host</h1>
    <p style={{ lineHeight: 1.6, maxWidth: 540 }}>
      This app powers Plasmic Studio previews. Navigate to <code>/plasmic-host</code> to load the canvas host
      or configure Plasmic Studio with the full URL to this deployment.
    </p>
  </main>
);

const App = () => {
  useEffect(() => {
    scrollToTop();
  }, []);

  return isHostRequest() ? <HostShell /> : <Landing />;
};

export default App;
