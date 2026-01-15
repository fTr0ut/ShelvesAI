import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateFromPath } from '@react-navigation/native';
import linkingConfig from '../src/navigation/linkingConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const casesPath = path.join(__dirname, 'deeplink-cases.json');
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));

function urlToPath(url) {
  const parsed = new URL(url);
  const host = parsed.host || '';
  const pathname = parsed.pathname.replace(/^\/+/, '');
  const base = [host, pathname].filter(Boolean).join('/');
  return `${base}${parsed.search || ''}`;
}

function getRouteChain(state) {
  const names = [];
  let current = state;
  let route = current?.routes?.[current.index ?? 0] || null;
  while (route) {
    names.push(route.name);
    if (!route.state) break;
    current = route.state;
    route = current?.routes?.[current.index ?? 0] || null;
  }
  return { names, lastRoute: route };
}

let failures = 0;

cases.forEach((testCase) => {
  const pathValue = urlToPath(testCase.url);
  const state = getStateFromPath(pathValue, linkingConfig.config);
  const { names, lastRoute } = getRouteChain(state);
  const nameMatch = JSON.stringify(names) === JSON.stringify(testCase.expectNames);
  const paramsMatch = testCase.expectParams
    ? JSON.stringify(lastRoute?.params || {}) === JSON.stringify(testCase.expectParams)
    : true;

  if (!nameMatch || !paramsMatch) {
    failures += 1;
    console.error(`[deeplink] FAIL ${testCase.name}`);
    console.error(`  url: ${testCase.url}`);
    console.error(`  expected names: ${JSON.stringify(testCase.expectNames)}`);
    console.error(`  actual names:   ${JSON.stringify(names)}`);
    if (testCase.expectParams) {
      console.error(`  expected params: ${JSON.stringify(testCase.expectParams)}`);
      console.error(`  actual params:   ${JSON.stringify(lastRoute?.params || {})}`);
    }
  } else {
    console.log(`[deeplink] PASS ${testCase.name}`);
  }
});

if (failures > 0) {
  process.exit(1);
}
