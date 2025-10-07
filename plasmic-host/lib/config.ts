export type PlasmicProjectConfig = {
  id: string;
  token: string;
};

const DEFAULT_BACKEND_PORT = 5001;
const DEFAULT_BACKEND_PROTOCOL = 'http';
const DEFAULT_BACKEND_HOST = `localhost:${DEFAULT_BACKEND_PORT}`;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const readEnv = (name: string): string | undefined => {
  const meta = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, unknown> }).env : undefined;
  if (meta && typeof meta[name] === 'string') {
    return meta[name] as string;
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
    return process.env[name] as string;
  }
  return undefined;
};

const parseProjectList = (raw: string | undefined): PlasmicProjectConfig[] => {
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is PlasmicProjectConfig =>
          Boolean(entry && typeof entry.id === 'string' && typeof entry.token === 'string')
        )
        .map((entry) => ({ id: entry.id, token: entry.token }));
    }
  } catch (err) {
    console.warn('Failed to parse JSON env value', err);
  }

  return [];
};

export const getBackendBaseUrl = (): string => {
  const configured =
    readEnv('PLASMIC_BACKEND_ORIGIN') ||
    readEnv('NEXT_PUBLIC_EXPRESS_BASE_URL') ||
    readEnv('EXPRESS_BASE_URL') ||
    '';

  if (configured) {
    return trimTrailingSlash(configured);
  }

  return `${DEFAULT_BACKEND_PROTOCOL}://${DEFAULT_BACKEND_HOST}`;
};

export const getPlasmicHostUrl = (): string => {
  const explicit = readEnv('NEXT_PUBLIC_PLASMIC_HOST_URL') || readEnv('PLASMIC_HOST_URL');
  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/+$/, '');
    return `${origin}/plasmic-host`;
  }

  const site = readEnv('NEXT_PUBLIC_SITE_URL') || readEnv('SITE_URL');
  if (site) {
    return `${trimTrailingSlash(site)}/plasmic-host`;
  }

  return '/plasmic-host';
};

export const getPlasmicProjects = (): PlasmicProjectConfig[] => {
  const fromJson = parseProjectList(readEnv('NEXT_PUBLIC_PLASMIC_PROJECTS') || readEnv('PLASMIC_PROJECTS'));
  if (fromJson.length) {
    return fromJson;
  }

  const id =
    readEnv('NEXT_PUBLIC_PLASMIC_PROJECT_ID') ||
    readEnv('PLASMIC_PROJECT_ID') ||
    '';
  const token =
    readEnv('NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN') ||
    readEnv('PLASMIC_PROJECT_PUBLIC_TOKEN') ||
    '';

  if (id && token) {
    return [{ id, token }];
  }

  return [];
};
