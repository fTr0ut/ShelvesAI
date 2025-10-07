const readEnv = (name: string): string => {
  const meta = (typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, unknown> }).env : undefined)
  const metaValue = meta && typeof meta[name] === 'string' ? (meta[name] as string) : ''
  if (metaValue) {
    return metaValue
  }
  const processValue = typeof process !== 'undefined' && process.env ? process.env[name] : ''
  return processValue ? String(processValue) : ''
}

const getEnvValue = (...keys: string[]): string => {
  for (const key of keys) {
    const value = readEnv(key)
    if (value) {
      return value
    }
  }
  return ''
}

const TRUTHY_BOOL_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_BOOL_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBooleanEnv = (value: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUTHY_BOOL_VALUES.has(normalized)) {
    return true;
  }
  if (FALSY_BOOL_VALUES.has(normalized)) {
    return false;
  }
  return undefined;
};

export type PlasmicProjectConfig = {
  id: string;
  token: string;
};

const DEFAULT_BACKEND_PORT = 5001;
const DEFAULT_BACKEND_PROTOCOL = 'http';
const DEFAULT_BACKEND_HOST = `localhost:${DEFAULT_BACKEND_PORT}`;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const getBackendBaseUrl = (): string => {
  const configured = getEnvValue('PLASMIC_BACKEND_ORIGIN', 'NEXT_PUBLIC_EXPRESS_BASE_URL', 'EXPRESS_BASE_URL', 'VITE_API_BASE');

  if (configured) {
    return trimTrailingSlash(configured);
  }

  return `${DEFAULT_BACKEND_PROTOCOL}://${DEFAULT_BACKEND_HOST}`;
};

export const getPlasmicHostUrl = (): string => {
  const explicit = getEnvValue('NEXT_PUBLIC_PLASMIC_HOST_URL', 'PLASMIC_HOST_URL', 'VITE_PLASMIC_HOST_URL');
  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/+$/, '');
    return `${origin}/plasmic-host`;
  }

  const site = getEnvValue('NEXT_PUBLIC_SITE_URL', 'SITE_URL', 'VITE_SITE_URL');
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
    getEnvValue('NEXT_PUBLIC_PLASMIC_PROJECTS', 'PLASMIC_PROJECTS', 'VITE_PLASMIC_PROJECTS')
  );
  if (fromJson.length) {
    return fromJson;
  }

  const id =
    getEnvValue('NEXT_PUBLIC_PLASMIC_PROJECT_ID', 'PLASMIC_PROJECT_ID', 'VITE_PLASMIC_PROJECT_ID');
  const token =
    getEnvValue('NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN', 'PLASMIC_PROJECT_PUBLIC_TOKEN', 'VITE_PLASMIC_PROJECT_PUBLIC_TOKEN');

  if (id && token) {
    return [{ id, token }];
  }

  return [];
};

export const isPlasmicPreviewEnabled = (): boolean => {
  const configured = getEnvValue('NEXT_PUBLIC_PLASMIC_PREVIEW', 'PLASMIC_PREVIEW', 'VITE_PLASMIC_PREVIEW');
  const parsed = parseBooleanEnv(configured);
  if (typeof parsed === 'boolean') {
    return parsed;
  }

  const meta = (typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, unknown> }).env : undefined);
  const devFlag = meta && typeof meta.DEV === 'boolean' ? Boolean(meta.DEV) : undefined;
  if (typeof devFlag === 'boolean') {
    return devFlag;
  }

  const nodeEnv = readEnv('NODE_ENV');
  if (nodeEnv) {
    return nodeEnv.toLowerCase() !== 'production';
  }

  return false;
};


