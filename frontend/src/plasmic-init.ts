import { initPlasmicLoader } from '@plasmicapp/loader-react';
import { getPlasmicHostUrl, getPlasmicProjects, isPlasmicPreviewEnabled } from './lib/config';
import { registerDataProviders } from './lib/register-data-providers';
//import { registerCollectorActions } from './lib/register-actions';
import { registerCollectorComponents, registerCollectorMobileComponents } from './lib/register-components';
import { registerActions } from './lib/register-actions';


const projects = getPlasmicProjects();

if (!projects.length) {
  console.warn(
    'No Plasmic projects configured. Set NEXT_PUBLIC_PLASMIC_PROJECTS or NEXT_PUBLIC_PLASMIC_PROJECT_ID/NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN.'
  );
}

const previewEnabled = isPlasmicPreviewEnabled();

if (previewEnabled) {
  console.info('Plasmic preview mode enabled; fetching draft content.');
} else {
  console.info('Plasmic preview mode disabled; using published Plasmic content.');
}

export const PLASMIC = initPlasmicLoader({
  projects,
  preview: previewEnabled,
  host: previewEnabled ? getPlasmicHostUrl() : undefined,
});

registerDataProviders(PLASMIC);
registerCollectorComponents(PLASMIC);
//registerCollectorActions(PLASMIC);
registerCollectorMobileComponents(PLASMIC);
registerActions(PLASMIC);



