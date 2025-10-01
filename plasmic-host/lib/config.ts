export type PlasmicProjectConfig = {
  id: string;
  token: string;
};

const DEFAULT_BACKEND_PORT = 5001;
const DEFAULT_BACKEND_PROTOCOL = 'http';
const DEFAULT_BACKEND_HOST = `localhost:${DEFAULT_BACKEND_PORT}`;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const getBackendBaseUrl = (): string => {
  const configured =
    process.env.PLASMIC_BACKEND_ORIGIN ||
    process.env.NEXT_PUBLIC_EXPRESS_BASE_URL ||
    process.env.EXPRESS_BASE_URL ||
    '';

  if (configured) {
    return trimTrailingSlash(configured);
  }

  return `${DEFAULT_BACKEND_PROTOCOL}://${DEFAULT_BACKEND_HOST}`;
};

export const getPlasmicHostUrl = (): string => {
  const explicit = process.env.NEXT_PUBLIC_PLASMIC_HOST_URL || process.env.PLASMIC_HOST_URL;
  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/+$/, '');
    return `${origin}/plasmic-host`;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (site) {
    return `${trimTrailingSlash(site)}/plasmic-host`;
  }

  return '/plasmic-host';
};

const parseJsonArray = <T>(raw: string | undefined): T[] => {
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch (err) {
    console.warn('Failed to parse JSON env value', err);
    return [];
  }
};

export const getPlasmicProjects = (): PlasmicProjectConfig[] => {
  const fromJson = parseJsonArray<PlasmicProjectConfig>(
    process.env.NEXT_PUBLIC_PLASMIC_PROJECTS || process.env.PLASMIC_PROJECTS
  );
  if (fromJson.length) {
    return fromJson;
  }

  const id =
    process.env.NEXT_PUBLIC_PLASMIC_PROJECT_ID ||
    process.env.PLASMIC_PROJECT_ID ||
    '';
  const token =
    process.env.NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN ||
    process.env.PLASMIC_PROJECT_PUBLIC_TOKEN ||
    '';

  if (id && token) {
    return [{ id, token }];
  }

  return [];
};
