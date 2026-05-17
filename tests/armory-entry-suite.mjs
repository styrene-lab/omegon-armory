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
  'monitoring',
  'remote',
]);
const VALID_AGENT_DOMAINS = new Set(['chat', 'coding', 'infra', 'ops']);
const VALID_PROFILE_CATEGORIES = new Set(['engineering', 'knowledge', 'operations', 'review']);
const VALID_PROFILE_POSTURES = new Set(['architect', 'implementer', 'reviewer', 'operator', 'analyst']);
const VALID_PROFILE_THINKING = new Set(['low', 'medium', 'high', 'max']);
const VALID_PROFILE_EXPORT_FORMATS = new Set(['generic-markdown', 'agents-md', 'claude-md', 'cursor-rules']);
const VALID_PROFILE_DEPENDENCY_KINDS = new Set(['skill', 'persona', 'tone', 'extension', 'agent', 'profile']);
const VALID_PROFILE_ACTIVATION = new Set(['always', 'auto', 'manual']);

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_REF_RE = /^([A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})$/;

function assertNamesOnlySecrets(secrets, label) {
  if (!secrets) return;
  for (const name of [...(secrets.required || []), ...(secrets.optional || [])]) {
    assert.match(name, ENV_NAME_RE, `${label}: secret name '${name}' should be an env-style name`);
  }
  for (const [envName, secretRef] of Object.entries(secrets.env || {})) {
    assert.match(envName, ENV_NAME_RE, `${label}: secret env alias '${envName}' should be an env-style name`);
    assert.match(
      secretRef,
      SECRET_REF_RE,
      `${label}: secret env value for '${envName}' must be SECRET_NAME or {SECRET_NAME}, not a literal value`,
    );
  }
}

function assertToolEnvAliases(tools, label) {
  for (const tool of tools || []) {
    for (const [envName, secretRef] of Object.entries(tool.env || {})) {
      assert.match(envName, ENV_NAME_RE, `${label}:${tool.name || '<unnamed>'}: tool env alias '${envName}' should be an env-style name`);
      assert.match(
        secretRef,
        SECRET_REF_RE,
        `${label}:${tool.name || '<unnamed>'}: tool env value for '${envName}' must be SECRET_NAME or {SECRET_NAME}, not a literal value`,
      );
    }
  }
}

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

function discoverProfiles() {
  const root = path.join(ARMORY_ROOT, 'profiles');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => {
      const relativeDir = `profiles/${dirent.name}`;
      const manifestPath = `${relativeDir}/profile.toml`;
      return {
        slug: dirent.name,
        relativeDir,
        manifestPath,
        manifest: parseToml(readText(manifestPath)),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
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
const profiles = discoverProfiles();
const catalogEntries = discoverCatalogEntries();
const extensions = discoverExtensions();

describe('secret env contract helpers', () => {
  it('rejects malformed template refs and literal-looking values', () => {
    assert.throws(() => assertNamesOnlySecrets({ env: { VAULT_TOKEN: '{VAULT_ROOT_TOKEN' } }, 'fixture'));
    assert.throws(() => assertNamesOnlySecrets({ env: { VAULT_TOKEN: 'VAULT_ROOT_TOKEN}' } }, 'fixture'));
    assert.throws(() => assertNamesOnlySecrets({ env: { VAULT_TOKEN: 'https://token@example.com' } }, 'fixture'));
    assert.throws(() => assertNamesOnlySecrets({ env: { VAULT_TOKEN: 'abc123-secret-value' } }, 'fixture'));
  });
});

describe('armory registry inventory', () => {
  it('has the expected public entry counts before publish', () => {
    assert.equal(plugins.length, 14, 'unexpected plugin/persona/tone/skill count');
    assert.equal(catalogEntries.length, 6, 'unexpected agent catalog count');
    assert.equal(profiles.length, 6, 'unexpected profile count');
    assert.equal(extensions.length, 6, 'unexpected extension registry count');
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


describe('profile manifests', () => {
  const available = new Set([
    ...plugins.map((plugin) => `${plugin.manifest.plugin.type}:${plugin.slug}`),
    ...catalogEntries.map((entry) => `agent:${entry.id}`),
    ...extensions.map((entry) => `extension:${entry.id}`),
    ...profiles.map((profile) => `profile:${profile.slug}`),
  ]);

  for (const profileEntry of profiles) {
    const manifest = profileEntry.manifest;
    const profile = manifest.profile || {};
    const defaults = manifest.defaults || {};
    const exportConfig = manifest.export || {};
    const dependencies = manifest.dependencies || [];

    it(`${profileEntry.relativeDir} follows profile schema v1`, () => {
      assert.equal(profile.schema, 'dev.styrene.omegon.profile.v1');
      assert.equal(profile.slug, profileEntry.slug);
      assert.equal(profile.id, `dev.styrene.omegon.profile.${profileEntry.slug}`);
      assert.match(profile.version, /^\d+\.\d+\.\d+$/);
      assert.ok(profile.name?.length > 0);
      assert.ok(profile.description?.length > 0);
      assert.ok(profile.description.length <= 220);
      assert.ok(VALID_PROFILE_CATEGORIES.has(profile.category), `${profileEntry.slug}: invalid category`);
      assert.ok(profile.license, `${profileEntry.slug}: missing license`);
      assert.match(profile.min_omegon, /^\d+\.\d+\.\d+$/);
      assert.ok(exists(`${profileEntry.relativeDir}/README.md`), `${profileEntry.slug}: missing README.md`);

      assert.ok(VALID_PROFILE_POSTURES.has(defaults.posture), `${profileEntry.slug}: invalid posture`);
      assert.ok(VALID_PROFILE_THINKING.has(defaults.thinking_level), `${profileEntry.slug}: invalid thinking_level`);
      assert.equal(Number.isInteger(defaults.max_turns), true, `${profileEntry.slug}: max_turns must be integer`);
      assert.ok(defaults.max_turns >= 1 && defaults.max_turns <= 200, `${profileEntry.slug}: max_turns out of range`);
      assert.ok(defaults.persona, `${profileEntry.slug}: missing default persona`);
      assert.ok(defaults.tone, `${profileEntry.slug}: missing default tone`);

      assert.ok(VALID_PROFILE_EXPORT_FORMATS.has(exportConfig.default_format), `${profileEntry.slug}: invalid export format`);
      assert.equal(typeof exportConfig.include_optional, 'boolean', `${profileEntry.slug}: include_optional must be boolean`);
      assert.equal(typeof exportConfig.include_native_notes, 'boolean', `${profileEntry.slug}: include_native_notes must be boolean`);

      assert.ok(Array.isArray(dependencies), `${profileEntry.slug}: dependencies must be an array`);
      assert.ok(dependencies.length >= 2, `${profileEntry.slug}: expected persona/tone dependencies`);
      const seen = new Set();
      for (const [index, dependency] of dependencies.entries()) {
        assert.ok(VALID_PROFILE_DEPENDENCY_KINDS.has(dependency.kind), `${profileEntry.slug}:${index}: invalid dependency kind`);
        assert.match(dependency.id, /^[a-z0-9][a-z0-9.-]*$/, `${profileEntry.slug}:${index}: invalid dependency id`);
        assert.ok(dependency.version, `${profileEntry.slug}:${dependency.id}: missing version`);
        assert.equal(typeof dependency.required, 'boolean', `${profileEntry.slug}:${dependency.id}: required must be boolean`);
        assert.ok(VALID_PROFILE_ACTIVATION.has(dependency.activate), `${profileEntry.slug}:${dependency.id}: invalid activation`);
        const key = `${dependency.kind}:${dependency.id}`;
        assert.equal(seen.has(key), false, `${profileEntry.slug}: duplicate dependency ${key}`);
        seen.add(key);
        assert.ok(available.has(key), `${profileEntry.slug}: unresolved dependency ${key}`);
      }
      assert.ok(
        dependencies.some((dependency) => dependency.kind === 'persona' && dependency.id === defaults.persona && dependency.required),
        `${profileEntry.slug}: default persona must be a required persona dependency`,
      );
      assert.ok(
        dependencies.some((dependency) => dependency.kind === 'tone' && dependency.id === defaults.tone && dependency.required),
        `${profileEntry.slug}: default tone must be a required tone dependency`,
      );
    });
  }
});

describe('catalog agent entries', () => {
  for (const entry of catalogEntries) {
    it(`${entry.id} references existing, valid files`, () => {
      assert.match(entry.id, /^styrene\.[a-z0-9.-]+$/);
      assert.match(entry.version, /^\d+\.\d+\.\d+$/);
      assert.ok(VALID_AGENT_DOMAINS.has(entry.domain), `${entry.id}: invalid domain`);
      assert.ok(Array.isArray(entry.files), `${entry.id}: files must be an array`);
      assert.ok(entry.files.includes('agent.pkl'), `${entry.id}: missing agent.pkl in registry`);
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
      assertNamesOnlySecrets(agent.secrets, entry.id);
      assertToolEnvAliases(agent.tools, entry.id);

      const pkl = readText(`catalog/${entry.id}/agent.pkl`);
      assert.match(pkl, /amends "omegon:\/\/schema\/AgentManifest\.pkl"/);
      assert.match(pkl, new RegExp(`id = "${entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      assert.match(pkl, new RegExp(`name = "${entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      for (const extension of agent.extensions || []) {
        assert.match(pkl, new RegExp(`name = "${extension.name}"`), `${entry.id}: agent.pkl missing extension ${extension.name}`);
      }
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
      const detailPath = `extensions/${extension.id}.toml`;
      assert.ok(exists(detailPath), `${extension.id}: missing extension detail file`);
      const detail = parseToml(readText(detailPath));
      if (extension.distribution === 'external') {
        assert.equal(detail.interfaces?.omegon?.status, 'none', `${extension.id}: external integrations must not claim native Omegon support`);
      } else {
        assert.equal(
          detail.interfaces?.omegon?.status,
          'supported',
          `${extension.id}: interfaces.omegon.status must be supported`,
        );
        assert.equal(
          detail.interfaces?.omegon?.install,
          `omegon extension install ${extension.id}`,
          `${extension.id}: interfaces.omegon.install must match registry install command`,
        );
      }
      for (const interfaceName of ['mcp', 'cli', 'http', 'oci']) {
        const status = detail.interfaces?.[interfaceName]?.status;
        assert.ok(
          ['supported', 'planned', 'none'].includes(status),
          `${extension.id}: interfaces.${interfaceName}.status must be supported, planned, or none`,
        );
      }
      if (extension.enabled && extension.distribution !== 'external') {
        assert.ok(extension.asset_prefix, `${extension.id}: enabled extensions need asset_prefix`);
        assert.ok(extension.manifest_path, `${extension.id}: enabled extensions need manifest_path`);
      }
      if (extension.distribution === 'external') {
        assert.equal(extension.installable, false, `${extension.id}: external integrations must not be native-installable`);
      }
    });
  }

  it('only flynt and shuttle are enabled for the initial publish gate', () => {
    const enabledNative = extensions
      .filter((entry) => entry.enabled && entry.distribution !== 'external')
      .map((entry) => entry.id);
    assert.deepEqual(enabledNative, ['flynt', 'shuttle']);
  });
});


describe('profile exports', () => {
  const formats = ['generic-markdown', 'agents-md', 'claude-md', 'cursor-rules'];

  it('exports every public profile in every degraded format', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegon-armory-profile-export.'));
    try {
      for (const profileEntry of profiles) {
        for (const format of formats) {
          const out = path.join(outDir, `${profileEntry.slug}.${format}.md`);
          command('python3', ['scripts/export-profile.py', profileEntry.slug, '--format', format, '--out', out], {
            timeout: 180_000,
          });
          const content = fs.readFileSync(out, 'utf8');
          assert.match(content, new RegExp(`Profile: ${profileEntry.slug}|${profileEntry.slug}`));
          assert.match(content, /Generated by Omegon Armory profile export/);
          assert.match(content, /Provenance/);
          assert.match(content, /systems-engineer/);
          assert.match(content, /concise/);
        }
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('skips optional portable dependencies by default and includes them on request', () => {
    const basic = command('python3', ['scripts/export-profile.py', 'python-shop', '--format', 'generic-markdown'], {
      timeout: 180_000,
    });
    assert.match(basic, /Skill: python/);
    assert.match(basic, /Skill: security/);
    assert.doesNotMatch(basic, /Skill: openspec/);
    assert.doesNotMatch(basic, /Skill: oci/);

    const withOptional = command(
      'python3',
      ['scripts/export-profile.py', 'python-shop', '--format', 'generic-markdown', '--include-optional'],
      { timeout: 180_000 },
    );
    assert.match(withOptional, /Skill: openspec/);
    assert.match(withOptional, /Skill: oci/);
  });

  it('renders native extensions as setup notes rather than prompt content', () => {
    const content = command(
      'python3',
      ['scripts/export-profile.py', 'infra-operator', '--format', 'generic-markdown', '--include-optional'],
      { timeout: 180_000 },
    );
    assert.match(content, /Native-only dependencies/);
    assert.match(content, /omegon extension install shuttle/);
    assert.match(content, /omegon extension install flynt/);
    assert.equal(content.includes('ssh_tunnel_open'), false);
    assert.equal(content.includes('canvas_set_cells'), false);
  });
});

describe('public payload lint', () => {
  it('rejects obvious secrets and private topology in publishable payloads', () => {
    const result = spawnSync('python3', ['scripts/lint-public-payloads.py'], {
      cwd: ARMORY_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Public payload lint passed/);
  });
});

describe('generated catalog compatibility metadata', () => {
  it('emits conservative compatibility contracts for every public site/API item', () => {
    const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegon-armory-generated.'));
    try {
      const ociDir = path.join(generatedDir, 'oci');
      const siteJson = path.join(generatedDir, 'armory.json');
      const apiJson = path.join(generatedDir, 'api.json');
      command('python3', ['scripts/build-oci-artifacts.py', '--out', ociDir], { timeout: 180_000 });
      command(
        'python3',
        ['scripts/generate-site-data.py', '--oci', ociDir, '--out', siteJson, '--api', apiJson],
        { timeout: 180_000 },
      );

      const sitePayload = JSON.parse(fs.readFileSync(siteJson, 'utf8'));
      const apiPayload = JSON.parse(fs.readFileSync(apiJson, 'utf8'));
      assert.equal(sitePayload.items.length, 29);
      assert.deepEqual(apiPayload.items, sitePayload.items);

      for (const item of sitePayload.items) {
        assert.ok(item.compatibility, `${item.kind}/${item.id}: missing compatibility`);
        assert.equal(Number.isInteger(item.compatibility.tier), true, `${item.kind}/${item.id}: tier must be an integer`);
        assert.ok(item.compatibility.tier >= 0 && item.compatibility.tier <= 4, `${item.kind}/${item.id}: invalid tier`);
        assert.ok(Array.isArray(item.compatibility.native), `${item.kind}/${item.id}: native must be an array`);
        assert.ok(Array.isArray(item.compatibility.degraded), `${item.kind}/${item.id}: degraded must be an array`);
        assert.ok(Array.isArray(item.compatibility.notes), `${item.kind}/${item.id}: notes must be an array`);
        assert.ok(
          item.compatibility.native.some((mode) => mode.runtime === 'omegon'),
          `${item.kind}/${item.id}: native compatibility must include omegon`,
        );
        assert.ok(item.compatibility.degraded.length > 0, `${item.kind}/${item.id}: missing degraded mode`);

        for (const mode of [...item.compatibility.native, ...item.compatibility.degraded]) {
          assert.ok(mode.runtime, `${item.kind}/${item.id}: compatibility mode missing runtime`);
          assert.ok(mode.mode, `${item.kind}/${item.id}: compatibility mode missing mode`);
          if (mode.entrypoints) {
            assert.ok(Array.isArray(mode.entrypoints), `${item.kind}/${item.id}: entrypoints must be an array`);
            for (const entrypoint of mode.entrypoints) {
              if (entrypoint.endsWith('Url') || entrypoint === 'interfaces') continue;
              assert.ok(
                item.files.includes(entrypoint),
                `${item.kind}/${item.id}: compatibility entrypoint ${entrypoint} not in files`,
              );
            }
          }
        }

        for (const dependency of item.dependencies || []) {
          assert.ok(dependency.compatibility, `${item.kind}/${item.id}: dependency ${dependency.id} missing compatibility`);
          assert.equal(Number.isInteger(dependency.compatibility.tier), true, `${item.kind}/${item.id}: dependency tier must be integer`);
          assert.ok(dependency.compatibility.mode, `${item.kind}/${item.id}: dependency mode missing`);
          if (dependency.kind === 'extension') {
            assert.equal(dependency.compatibility.nativeOnly, true, `${item.kind}/${item.id}: extension dependencies must be marked nativeOnly`);
          }
        }

        if (item.kind === 'extension') {
          assert.ok(item.interfaces, `${item.id}: extension missing interface metadata`);
          if (item.distribution === 'external') {
            assert.equal(item.interfaces.omegon?.status, 'none', `${item.id}: external integration must not claim native Omegon support`);
          } else {
            assert.equal(item.interfaces.omegon?.status, 'supported', `${item.id}: omegon interface must be supported`);
          }
          const portableInterfaces = ['mcp', 'cli', 'http', 'oci'].filter(
            (name) => item.interfaces[name]?.status === 'supported',
          );
          assert.equal(
            item.compatibility.tier,
            portableInterfaces.length > 0 ? 3 : 0,
            `${item.id}: extension tier should reflect portable callable interfaces`,
          );
        } else if (item.kind === 'profile' || item.kind === 'agent') {
          assert.equal(item.compatibility.tier, 2, `${item.kind}/${item.id}: expected manifest-compatible tier`);
        } else {
          assert.equal(item.compatibility.tier, 1, `${item.kind}/${item.id}: expected prompt-compatible tier`);
        }
      }
    } finally {
      fs.rmSync(generatedDir, { recursive: true, force: true });
    }
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
    const expectedEnabled = extensions.filter((entry) => entry.enabled).map((entry) => entry.id);
    assert.deepEqual(items.map((item) => item.id), expectedEnabled);
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
