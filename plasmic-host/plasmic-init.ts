import { initPlasmicLoader } from '@plasmicapp/loader-react';
import { getPlasmicHostUrl, getPlasmicProjects } from './lib/config';
import { registerDataProviders } from './lib/register-data-providers';
import { registerCollectorComponents, registerCollectorMobileComponents } from './lib/register-components';
import { registerActions } from './lib/register-actions';


const projects = getPlasmicProjects();

if (!projects.length) {
  console.warn(
    'No Plasmic projects configured. Set NEXT_PUBLIC_PLASMIC_PROJECTS or NEXT_PUBLIC_PLASMIC_PROJECT_ID/NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN.'
  );
}

export const PLASMIC = initPlasmicLoader({
  projects,
  preview: true,
  host: getPlasmicHostUrl(),
  fetcher: async (url, options) => {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
    });

    if (!response.ok) {
      console.warn(`Plasmic fetch failed: ${response.status} ${response.statusText}`);
    }

    return response;
  },
});

registerDataProviders(PLASMIC);
registerCollectorComponents(PLASMIC);

registerCollectorMobileComponents(PLASMIC);
registerActions(PLASMIC);
