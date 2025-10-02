const http = require('http');
const https = require('https');
const { URL } = require('url');

function normalizePath(path) {
  if (!path) return '/';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const parsed = new URL(path);
    return parsed.pathname + (parsed.search || '');
  }
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function applyPathRewrite(pathRewrite, reqPath, req) {
  if (!pathRewrite) return reqPath;

  if (typeof pathRewrite === 'function') {
    return pathRewrite(reqPath, req);
  }

  if (typeof pathRewrite === 'object') {
    return Object.keys(pathRewrite).reduce((result, pattern) => {
      const replacement = pathRewrite[pattern];
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      return result.replace(regex, replacement);
    }, reqPath);
  }

  return reqPath;
}

function createProxyMiddleware(options = {}) {
  const { target, changeOrigin = false, pathRewrite, onError } = options;
  if (!target) {
    throw new Error('createProxyMiddleware requires a "target" option');
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (err) {
    throw new Error(`Invalid proxy target: ${target}`);
  }

  const agent = targetUrl.protocol === 'https:' ? https : http;

  return function proxyMiddleware(req, res, next) {
    const originalPath = req.originalUrl || req.url || '/';
    const rewritten = applyPathRewrite(pathRewrite, originalPath, req) || originalPath;
    const proxyPath = normalizePath(rewritten);

    const requestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: proxyPath,
      headers: { ...req.headers },
    };

    if (changeOrigin) {
      requestOptions.headers.host = targetUrl.host;
      requestOptions.headers.origin = `${targetUrl.protocol}//${targetUrl.host}`;
      if (requestOptions.headers.referer) {
        try {
          const refererUrl = new URL(requestOptions.headers.referer);
          refererUrl.host = targetUrl.host;
          refererUrl.protocol = targetUrl.protocol;
          requestOptions.headers.referer = refererUrl.toString();
        } catch (_) {
          requestOptions.headers.referer = `${targetUrl.protocol}//${targetUrl.host}`;
        }
      }
    }

    const proxyReq = agent.request(requestOptions, (proxyRes) => {
      if (!res.headersSent) {
        res.status(proxyRes.statusCode || 502);
        Object.entries(proxyRes.headers || {}).forEach(([key, value]) => {
          if (value !== undefined && !res.hasHeader(key)) {
            res.setHeader(key, value);
          }
        });
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (typeof onError === 'function') {
        return onError(err, req, res, next);
      }
      if (!res.headersSent) {
        res.status(502).send('Proxy Error');
      } else {
        res.end();
      }
    });

    if (req.readable && typeof req.pipe === 'function') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  };
}

module.exports = { createProxyMiddleware };
