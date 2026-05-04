import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YAML_PATH = path.join(__dirname, '../clans.yml');
const TS_PATH = path.join(__dirname, '../../front/src/app/core/game/clans.data.ts');

function loadYamlData() {
  const fileContents = fs.readFileSync(YAML_PATH, 'utf8');
  const data = yaml.load(fileContents);
  if (!data || !data.clans) {
    throw new Error('Invalid clans.yml structure.');
  }
  return data.clans;
}

function loadTsData() {
  const fileContents = fs.readFileSync(TS_PATH, 'utf8');
  
  // Extract JSON payload from TS file
  // Expecting format: export const CLANS_DATA: Record<string, any> = [ ... ];
  const jsonMatch = fileContents.match(/export const CLANS_DATA[\s\S]*?=\s*(\[\s*[\s\S]*\])\s*;/);
  if (!jsonMatch || !jsonMatch[1]) {
    throw new Error('Could not extract JSON from clans.data.ts');
  }

  return JSON.parse(jsonMatch[1]);
}

function compareObjects(obj1, obj2, path = '') {
  if (obj1 === obj2) return true;

  if (typeof obj1 !== typeof obj2) {
    console.error(`Type mismatch at ${path}: ${typeof obj1} vs ${typeof obj2}`);
    return false;
  }

  if (obj1 === null || obj2 === null) {
    console.error(`Null mismatch at ${path}`);
    return false;
  }

  if (Array.isArray(obj1) !== Array.isArray(obj2)) {
    console.error(`Array mismatch at ${path}`);
    return false;
  }

  if (typeof obj1 === 'object') {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
      console.error(`Key length mismatch at ${path}: ${keys1.length} vs ${keys2.length}`);
      return false;
    }

    for (let key of keys1) {
      if (!keys2.includes(key)) {
        console.error(`Missing key at ${path}: ${key}`);
        return false;
      }
      if (!compareObjects(obj1[key], obj2[key], `${path}.${key}`)) {
        return false;
      }
    }
    return true;
  }

  console.error(`Value mismatch at ${path}: ${obj1} vs ${obj2}`);
  return false;
}

function main() {
  console.log('[SyncCheck] Verifying clans.yml and clans.data.ts synchronization...');

  try {
    const yamlData = loadYamlData();
    const tsData = loadTsData();

    // Remove string formatting differences like escaped characters if any
    const isSynced = compareObjects(yamlData, tsData, 'root');

    if (isSynced) {
      console.log('✅ SUCCESS: clans.yml and clans.data.ts are perfectly synchronized.');
      process.exit(0);
    } else {
      console.error('❌ ERROR: Desynchronization detected between clans.yml and clans.data.ts.');
      console.error('Please regenerate clans.data.ts or ensure both files contain the same data.');
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ERROR: Failed during verification: ${error.message}`);
    process.exit(1);
  }
}

main();
