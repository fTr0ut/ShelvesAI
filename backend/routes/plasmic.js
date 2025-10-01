const express = require('express');

const router = express.Router();

function trimTrailingSlash(value = '') {
  return value.replace(/\/+$/, '');
}

function parseProjects() {
  const rawList = process.env.PLASMIC_PROJECTS;
  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry) => entry?.id && entry?.token);
      }
    } catch (err) {
      console.warn('Unable to parse PLASMIC_PROJECTS JSON:', err.message);
    }
  }

  const id = process.env.PLASMIC_PROJECT_ID;
  const token = process.env.PLASMIC_PROJECT_PUBLIC_TOKEN;
  if (id && token) {
    return [{ id, token }];
  }

  return [];
}

router.get('/plasmic-loader.json', (_req, res) => {
  const projects = parseProjects();
  if (!projects.length) {
    return res.status(500).json({
      error: 'PLASMIC_PROJECTS or PLASMIC_PROJECT_ID/PLASMIC_PROJECT_PUBLIC_TOKEN must be configured on the backend.',
    });
  }

  const hostUrl = trimTrailingSlash(
    process.env.PLASMIC_HOST_URL || process.env.SITE_URL || ''
  );
  const apiBase = trimTrailingSlash(process.env.PLASMIC_API_BASE || '');

  res.json({
    projects,
    hostUrl: hostUrl ? `${hostUrl}/plasmic-host` : undefined,
    apiBaseUrl: apiBase || undefined,
  });
});

module.exports = router;
