import { PlasmicCanvasHost } from '@plasmicapp/host';
import { PlasmicRootProvider } from '@plasmicapp/loader-react';
import { PLASMIC } from '../plasmic-init';

export default function PlasmicHost() {
  return (
    <PlasmicRootProvider loader={PLASMIC}>
      <PlasmicCanvasHost />
    </PlasmicRootProvider>
  );
}

