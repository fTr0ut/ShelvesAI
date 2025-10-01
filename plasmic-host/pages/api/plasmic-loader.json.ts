import type { NextApiRequest, NextApiResponse } from 'next';
import { getBackendBaseUrl } from '../../lib/config';

const buildBackendUrl = (search = '') => {
  const base = getBackendBaseUrl();
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/plasmic-loader.json`;
  url.search = search;
  return url.toString();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = buildBackendUrl(search);

  try {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
    };

    if (req.headers.cookie) {
      headers.cookie = req.headers.cookie;
    }

    if (req.headers['content-type']) {
      headers['content-type'] = Array.isArray(req.headers['content-type'])
        ? req.headers['content-type'][0]
        : req.headers['content-type'];
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      credentials: 'include',
      body:
        req.method && ['GET', 'HEAD'].includes(req.method)
          ? undefined
          : typeof req.body === 'string'
            ? req.body
            : req.body
              ? JSON.stringify(req.body)
              : undefined,
    });

    const body = await upstream.text();

    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });

    res.status(upstream.status).send(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: 'Failed to reach backend loader endpoint', details: message });
  }
}
