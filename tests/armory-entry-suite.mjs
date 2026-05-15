#!/usr/bin/env node
/**
 * Armory entry validation suite.
 *
 * Local checks validate every entry in this repository. Set OMEGON_BIN to run
 * sandboxed install checks against a real Omegon binary. Set
 * ARMORY_TEST_NETWORK=1 with OMEGON_BIN to run live registry/release smokes.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARMORY_ROOT = path.resolve(__dirname, '..');
const OMEGON_BIN = process.env.OMEGON_BIN || '';
const RUN_NETWORK = process.env.ARMORY_TEST_NETWORK === '1';
const SKIP_INSTALLS = process.env.ARMORY_SKIP_INSTALLS === '1';

const PLUGIN_ROOTS = ['skills', 'personas', 'tones'];
const REQUIRED_PLUGIN_FILE = {
  skill: 'SKILL.md',
  persona: 'PERSONA.md',
  tone: 'TONE.md',
};
const VALID_PLUGIN_TYPES = new Set(['skill', 'persona', 'tone', 'extension']);
const VALID_EXTENSION_CATEGORIES = new Set([
  'automation',
  'comms',
  'forge',
  'knowledge',
  'media',
  'remote',
]);
const VALID_AGENT_DOMAINS = new Set(['chat', 'coding', 'infra', 'ops']);

function readText(relativePath) {
  return fs.readFileSync(path.join(ARMORY_ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ARMORY_ROOT, relativePath));
}

function parseValue(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return body
      .split(',')
      .map((part) => parseValue(part.trim()))
      .filter((part) => part !== '');
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    return value;
  }
  return value;
}

function stripInlineComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i - 1] !== '\\') inString = !inString;
    if (char === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

function parseSectionName(name) {
  const parts = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < name.length; i += 1) {
    const char = name[i];
    if (char === '"' && name[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }
    if (char === '.' && !inString) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function setDeep(target, pathParts, key, value) {
  let node = target;
  for (const part of pathParts) {
    node[part] ||= {};
    node = node[part];
  }
  node[key] = value;
}

function parseToml(content) {
  const root = {};
  let section = [];
  for (const originalLine of content.split('\n')) {
    const line = stripInlineComment(originalLine).trim();
    if (!line) continue;

    const arraySection = line.match(/^\[\[(.+)\]\]$/);
    if (arraySection) {
      section = parseSectionName(arraySection[1]);
      let node = root;
      for (let i = 0; i < section.length - 1; i += 1) {
        node[section[i]] ||= {};
        node = node[section[i]];
      }
      const key = section.at(-1);
      node[key] ||= [];
      node[key].push({});
      continue;
    }

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = parseSectionName(sectionMatch[1]);
      let node = root;
      for (const part of section) {
        node[part] ||= {};
        node = node[part];
      }
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, raw] = kvMatch;
    let targetSection = section;
    let node = root;
    for (const part of targetSection) {
      node = Array.isArray(node[part]) ? node[part].at(-1) : node[part];
    }
    if (node) {
      node[key] = parseValue(raw);
    } else {
      setDeep(root, targetSection, key, parseValue(raw));
    }
  }
  return root;
}

function parseRegistry(relativePath) {
  const parsed = parseToml(readText(relativePath));
  return Object.entries(parsed).map(([id, entry]) => ({ id, ...entry }));
}

function discoverPlugins() {
  const plugins = [];
  for (const root of PLUGIN_ROOTS) {
    const absRoot = path.join(ARMORY_ROOT, root);
    for (const dirent of fs.readdirSync(absRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const relativeDir = `${root}/${dirent.name}`;
      const manifest = `${relativeDir}/plugin.toml`;
      if (!exists(manifest)) continue;
      plugins.push({
        root,
        slug: dirent.name,
        relativeDir,
        manifestPath: manifest,
        manifest: parseToml(readText(manifest)),
      });
    }
  }
  return plugins.sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
}

function discoverCatalogEntries() {
  return parseRegistry('catalog-registry.toml').sort((a, b) => a.id.localeCompare(b.id));
}

function discoverExtensions() {
  return parseRegistry('registry.toml').sort((a, b) => a.id.localeCompare(b.id));
}

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd || ARMORY_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeout || 120_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(
    result.status,
    0,
    `${bin} ${args.join(' ')} failed with ${result.status}\n${output}`,
  );
  return output;
}

function assertFactJsonl(relativePath, content) {
  for (const [index, line] of content.trim().split('\n').entries()) {
    const fact = JSON.parse(line);
    assert.ok(fact.section, `${relativePath}:${index + 1}: missing section`);
    assert.ok(fact.content, `${relativePath}:${index + 1}: missing content`);
    assert.equal(typeof fact.confidence, 'number', `${relativePath}:${index + 1}: confidence`);
    assert.ok(
      fact.confidence >= 0 && fact.confidence <= 1,
      `${relativePath}:${index + 1}: confidence out of range`,
    );
  }
}

function maybeDescribe(name, fn) {
  if (OMEGON_BIN && !SKIP_INSTALLS) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (set OMEGON_BIN to enable)`, fn);
  }
}

function networkDescribe(name, fn) {
  if (OMEGON_BIN && RUN_NETWORK) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (set OMEGON_BIN and ARMORY_TEST_NETWORK=1 to enable)`, fn);
  }
}

const plugins = discoverPlugins();
const catalogEntries = discoverCatalogEntries();
const extensions = discoverExtensions();

describe('armory registry inventory', () => {
  it('has the expected public entry counts before publish', () => {
    assert.equal(plugins.length, 5, 'unexpected plugin/persona/tone/skill count');
    assert.equal(catalogEntries.length, 6, 'unexpected agent catalog count');
    assert.equal(extensions.length, 5, 'unexpected extension registry count');
  });

  it('does not retain retired Scribe references in publishable entry surfaces', () => {
    const scanned = [
      'registry.toml',
      'catalog-registry.toml',
      ...plugins.flatMap((plugin) => {
        const required = REQUIRED_PLUGIN_FILE[plugin.manifest.plugin.type];
        return [plugin.manifestPath, required ? `${plugin.relativeDir}/${required}` : null];
      }),
      ...catalogEntries.flatMap((entry) =>
        entry.files.map((file) => `catalog/${entry.id}/${file}`),
      ),
    ].filter(Boolean);
    const stale = [];
    for (const relativePath of scanned) {
      if (!exists(relativePath)) continue;
      const content = readText(relativePath);
      if (/\b[Ss]cribe\b|SCRIBE|\.scribe/.test(content)) stale.push(relativePath);
    }
    assert.deepEqual(stale, []);
  });
});

describe('plugin entries', () => {
  for (const plugin of plugins) {
    const { slug, relativeDir, manifest } = plugin;
    const metadata = manifest.plugin || {};
    const type = metadata.type;

    it(`${relativeDir} has a valid manifest and guidance file`, () => {
      assert.ok(VALID_PLUGIN_TYPES.has(type), `${relativeDir}: invalid plugin type ${type}`);
      assert.equal(type, plugin.root.replace(/s$/, ''));
      assert.match(metadata.id, /^dev\.styrene\.omegon\./);
      assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
      assert.ok(metadata.name?.length > 0);
      assert.ok(metadata.description?.length > 0);
      assert.ok(metadata.description.length <= 180);
      assert.ok(metadata.license, `${relativeDir}: missing license`);
      assert.ok(Array.isArray(metadata.authors), `${relativeDir}: authors must be an array`);

      const required = REQUIRED_PLUGIN_FILE[type];
      assert.ok(required, `${relativeDir}: no required file mapping for ${type}`);
      assert.ok(exists(`${relativeDir}/${required}`), `${relativeDir}: missing ${required}`);
    });

    it(`${relativeDir} has type-specific functional content`, () => {
      if (type === 'skill') {
        const guidance = readText(`${relativeDir}/${manifest.skill.guidance}`);
        assert.match(guidance, /^# .+/m);
        assert.match(guidance, /^## .+/m);
        assert.ok(guidance.length > 400, `${relativeDir}: skill guidance is too thin`);
      }

      if (type === 'persona') {
        const directive = readText(`${relativeDir}/${manifest.persona.identity.directive}`);
        assert.match(directive, /^# .+/m);
        assert.ok(
          /Avoid|NOT|Anti-pattern/i.test(directive),
          `${relativeDir}: persona should include anti-pattern guidance`,
        );
        const factsPath = manifest.persona.mind?.seed_facts;
        if (factsPath) {
          const facts = readText(`${relativeDir}/${factsPath}`).trim().split('\n');
          assert.ok(facts.length > 0, `${relativeDir}: seed facts are empty`);
          for (const [index, line] of facts.entries()) {
            const fact = JSON.parse(line);
            assert.ok(fact.section, `${relativeDir}:${index + 1}: missing section`);
            assert.ok(fact.content, `${relativeDir}:${index + 1}: missing content`);
            assert.equal(typeof fact.confidence, 'number');
            assert.ok(fact.confidence >= 0 && fact.confidence <= 1);
          }
        }
      }

      if (type === 'tone') {
        const tone = readText(`${relativeDir}/${manifest.tone.directive}`);
        assert.match(tone, /^# .+/m);
        assert.ok(tone.length <= 2000, `${relativeDir}: tone directive should stay compact`);
        if (manifest.tone.exemplars) {
          const exemplarDir = path.join(ARMORY_ROOT, relativeDir, manifest.tone.exemplars);
          const exemplars = fs.readdirSync(exemplarDir).filter((file) => file.endsWith('.md'));
          assert.ok(exemplars.length > 0, `${relativeDir}: no exemplar markdown files`);
        }
      }

      assert.equal(path.basename(relativeDir), slug);
    });
  }

  it('has no duplicate plugin IDs', () => {
    const ids = plugins.map((plugin) => plugin.manifest.plugin.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('catalog agent entries', () => {
  for (const entry of catalogEntries) {
    it(`${entry.id} references existing, valid files`, () => {
      assert.match(entry.id, /^styrene\.[a-z0-9.-]+$/);
      assert.match(entry.version, /^\d+\.\d+\.\d+$/);
      assert.ok(VALID_AGENT_DOMAINS.has(entry.domain), `${entry.id}: invalid domain`);
      assert.ok(Array.isArray(entry.files), `${entry.id}: files must be an array`);
      assert.ok(entry.files.includes('agent.toml'), `${entry.id}: missing agent.toml in registry`);
      assert.ok(entry.files.includes('PERSONA.md'), `${entry.id}: missing PERSONA.md in registry`);

      for (const file of entry.files) {
        const relativePath = `catalog/${entry.id}/${file}`;
        assert.ok(exists(relativePath), `${entry.id}: missing ${file}`);
        if (file.endsWith('.jsonl')) {
          assertFactJsonl(relativePath, readText(relativePath));
        }
      }

      const agent = parseToml(readText(`catalog/${entry.id}/agent.toml`));
      assert.equal(agent.agent?.id, entry.id);
      assert.equal(agent.agent?.name, entry.name);
    });
  }
});

describe('extension registry entries', () => {
  for (const extension of extensions) {
    it(`${extension.id} has publish metadata and staged enablement`, () => {
      assert.match(extension.id, /^[a-z0-9-]+$/);
      assert.equal(typeof extension.enabled, 'boolean', `${extension.id}: enabled must be explicit`);
      assert.match(extension.repo, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
      assert.ok(VALID_EXTENSION_CATEGORIES.has(extension.category));
      assert.ok(extension.maintainer);
      assert.ok(extension.license);
      assert.match(extension.min_sdk, /^\d+\.\d+$/);
      if (extension.enabled) {
        assert.ok(extension.asset_prefix, `${extension.id}: enabled extensions need asset_prefix`);
        assert.ok(extension.manifest_path, `${extension.id}: enabled extensions need manifest_path`);
      }
    });
  }

  it('only flynt and shuttle are enabled for the initial publish gate', () => {
    const enabled = extensions.filter((entry) => entry.enabled).map((entry) => entry.id);
    assert.deepEqual(enabled, ['flynt', 'shuttle']);
  });
});

describe('OCI example tool contract', () => {
  it('returns JSON errors without importing optional analytics dependencies', () => {
    const result = spawnSync('python3', ['examples/oci-tool/tool.py'], {
      cwd: ARMORY_ROOT,
      input: '{"path":"missing.csv","query":"describe"}',
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, null);
    assert.match(payload.error, /file not found/);
  });
});

maybeDescribe('sandboxed Omegon installs', () => {
  let sandbox;
  let env;

  before(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'omegon-armory-entry-suite.'));
    env = { OMEGON_HOME: path.join(sandbox, 'home') };
  });

  after(() => {
    if (sandbox && process.env.ARMORY_KEEP_SANDBOX !== '1') {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('installs every text-only plugin entry by local path', () => {
    for (const plugin of plugins) {
      command(OMEGON_BIN, ['plugin', 'install', path.join(ARMORY_ROOT, plugin.relativeDir)], {
        env,
      });
    }
    const listing = command(OMEGON_BIN, ['plugin', 'list'], { env });
    for (const plugin of plugins) {
      assert.ok(
        listing.includes(plugin.manifest.plugin.name) || listing.includes(plugin.slug),
        `plugin list did not include ${plugin.relativeDir}\n${listing}`,
      );
    }
  });

  it('installs bundled catalog agents and matches the armory catalog IDs', () => {
    command(OMEGON_BIN, ['catalog', 'install', '--offline'], { env });
    for (const entry of catalogEntries) {
      assert.ok(
        fs.existsSync(path.join(env.OMEGON_HOME, 'catalog', entry.id, 'agent.toml')),
        `catalog install did not create ${entry.id}`,
      );
      for (const file of entry.files.filter((candidate) => candidate.endsWith('.jsonl'))) {
        const installedPath = path.join(env.OMEGON_HOME, 'catalog', entry.id, file);
        assertFactJsonl(installedPath, fs.readFileSync(installedPath, 'utf8'));
      }
    }
  });
});

networkDescribe('live Omegon registry installs', () => {
  let sandbox;
  let env;

  before(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'omegon-armory-network-suite.'));
    env = { OMEGON_HOME: path.join(sandbox, 'home') };
  });

  after(() => {
    if (sandbox && process.env.ARMORY_KEEP_SANDBOX !== '1') {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exposes only enabled extensions through browse', () => {
    const output = command(OMEGON_BIN, ['armory', 'browse', '--kind', 'extensions', '--json'], {
      env,
      timeout: 180_000,
    });
    const items = JSON.parse(output);
    assert.deepEqual(items.map((item) => item.id), ['flynt']);
  });

  it('installs every enabled extension by name', () => {
    for (const extension of extensions.filter((entry) => entry.enabled)) {
      command(OMEGON_BIN, ['extension', 'install', extension.id], {
        env,
        timeout: 300_000,
      });
      assert.ok(
        fs.existsSync(path.join(env.OMEGON_HOME, 'extensions', extension.id, 'manifest.toml')),
        `extension install did not create ${extension.id}/manifest.toml`,
      );
    }
  });
});
