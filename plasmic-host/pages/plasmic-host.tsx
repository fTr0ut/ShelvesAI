import { PlasmicCanvasHost } from '@plasmicapp/host';
import { PlasmicRootProvider } from '@plasmicapp/loader-react';
import Head from 'next/head';
import { PLASMIC } from '../plasmic-init';

export default function PlasmicHost() {
  return (
    <>
      <Head>
        <title>Plasmic Host</title>
      </Head>
      <PlasmicRootProvider loader={PLASMIC}>
        <PlasmicCanvasHost />
      </PlasmicRootProvider>
    </>
  );
}
