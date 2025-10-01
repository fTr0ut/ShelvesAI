import { initPlasmicLoader } from '@plasmicapp/loader-react';
import { getPlasmicHostUrl, getPlasmicProjects } from './lib/config';
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


export const PLASMIC = initPlasmicLoader({
  projects,
  preview: true,                  // set false in prod
  host: getPlasmicHostUrl(),      // fine to keep; Studio uses it
});

registerDataProviders(PLASMIC);
registerCollectorComponents(PLASMIC);
//registerCollectorActions(PLASMIC);
registerCollectorMobileComponents(PLASMIC);
registerActions(PLASMIC);
