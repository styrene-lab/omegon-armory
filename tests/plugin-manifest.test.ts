/**
 * Plugin manifest (plugin.toml) parsing and validation tests.
 *
 * These tests validate the contract between plugin repos and the Omegon
 * plugin loader. They run against the example plugins in this armory repo.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Types reflecting the plugin.toml schema ---

interface PluginManifest {
  plugin: {
    type: 'persona' | 'tone' | 'skill' | 'extension';
    id: string;
    name: string;
    version: string;
    description: string;
    authors?: string[];
    license?: string;
    min_omegon?: string;
  };
  persona?: {
    identity?: { directive: string };
    mind?: { seed_facts?: string; seed_episodes?: string };
    skills?: { activate?: string[]; deactivate?: string[] };
    tools?: { profile?: string; enable?: string[]; disable?: string[] };
    routing?: { default_thinking?: string };
    tone?: { default?: string };
    style?: { badge?: string; accent_color?: string };
  };
  tone?: {
    directive: string;
    exemplars?: string;
    intensity?: { design?: string; coding?: string };
  };
  skill?: {
    guidance: string;
  };
  detect?: {
    file_patterns?: string[];
    directories?: string[];
    default?: boolean;
  };
}

// Minimal TOML parser for testing — handles the subset we use
function parseToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].split('.');
      let obj = result;
      for (const key of currentSection) {
        if (!obj[key]) obj[key] = {};
        obj = obj[key];
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      let value: any = rawValue;

      // String
      if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        value = rawValue.slice(1, -1);
      }
      // Boolean
      else if (rawValue === 'true') value = true;
      else if (rawValue === 'false') value = false;
      // Array
      else if (rawValue.startsWith('[')) {
        value = rawValue
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }

      let obj = result;
      for (const section of currentSection) {
        obj = obj[section];
      }
      obj[key] = value;
    }
  }

  return result;
}

// --- Test helpers ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARMORY_ROOT = path.resolve(__dirname, '..');

function findPlugins(): { dir: string; toml: string; type: string }[] {
  const plugins: { dir: string; toml: string; type: string }[] = [];
  for (const category of ['personas', 'tones', 'skills']) {
    const categoryDir = path.join(ARMORY_ROOT, category);
    if (!fs.existsSync(categoryDir)) continue;
    for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const tomlPath = path.join(categoryDir, entry.name, 'plugin.toml');
      if (fs.existsSync(tomlPath)) {
        plugins.push({
          dir: path.join(categoryDir, entry.name),
          toml: tomlPath,
          type: category.replace(/s$/, ''), // personas → persona
        });
      }
    }
  }
  return plugins;
}

function loadManifest(tomlPath: string): PluginManifest {
  const content = fs.readFileSync(tomlPath, 'utf-8');
  return parseToml(content) as unknown as PluginManifest;
}

// --- Tests ---

describe('Plugin manifest discovery', () => {
  const plugins = findPlugins();

  it('finds at least 5 plugins in the armory', () => {
    assert.ok(plugins.length >= 5, `Expected >= 5 plugins, found ${plugins.length}`);
  });

  it('every plugin directory has a plugin.toml', () => {
    for (const p of plugins) {
      assert.ok(fs.existsSync(p.toml), `Missing plugin.toml in ${p.dir}`);
    }
  });
});

describe('Plugin manifest schema validation', () => {
  const plugins = findPlugins();

  for (const p of plugins) {
    const name = path.basename(p.dir);

    describe(`${p.type}/${name}`, () => {
      const manifest = loadManifest(p.toml);

      it('has required [plugin] fields', () => {
        assert.ok(manifest.plugin, 'Missing [plugin] section');
        assert.ok(manifest.plugin.type, 'Missing plugin.type');
        assert.ok(manifest.plugin.id, 'Missing plugin.id');
        assert.ok(manifest.plugin.name, 'Missing plugin.name');
        assert.ok(manifest.plugin.version, 'Missing plugin.version');
        assert.ok(manifest.plugin.description, 'Missing plugin.description');
      });

      it('type matches directory category', () => {
        assert.equal(manifest.plugin.type, p.type,
          `plugin.toml type '${manifest.plugin.type}' doesn't match directory '${p.type}'`);
      });

      it('id follows reverse-domain convention', () => {
        const parts = manifest.plugin.id.split('.');
        assert.ok(parts.length >= 3,
          `ID '${manifest.plugin.id}' should have at least 3 dot-separated segments`);
      });

      it('version is valid semver', () => {
        assert.match(manifest.plugin.version, /^\d+\.\d+\.\d+/,
          `Version '${manifest.plugin.version}' is not valid semver`);
      });

      it('description is non-empty and under 200 chars', () => {
        assert.ok(manifest.plugin.description.length > 0, 'Description is empty');
        assert.ok(manifest.plugin.description.length < 200,
          `Description is ${manifest.plugin.description.length} chars — keep under 200`);
      });
    });
  }
});

describe('Persona plugins', () => {
  const personas = findPlugins().filter(p => p.type === 'persona');

  for (const p of personas) {
    const name = path.basename(p.dir);
    const manifest = loadManifest(p.toml);

    describe(`persona/${name}`, () => {
      it('has a PERSONA.md directive file', () => {
        const directivePath = manifest.persona?.identity?.directive;
        assert.ok(directivePath, 'Missing persona.identity.directive');
        const fullPath = path.join(p.dir, directivePath);
        assert.ok(fs.existsSync(fullPath), `Directive file not found: ${fullPath}`);
      });

      it('PERSONA.md has required sections', () => {
        const directivePath = manifest.persona?.identity?.directive || 'PERSONA.md';
        const content = fs.readFileSync(path.join(p.dir, directivePath), 'utf-8');

        // Must have a title
        assert.match(content, /^# .+/m, 'PERSONA.md should start with a # title');
        // Should have a "What NOT To Do" or equivalent anti-pattern section
        assert.ok(
          content.includes('NOT') || content.includes('Anti-pattern') || content.includes('Avoid'),
          'PERSONA.md should include anti-patterns (What NOT To Do section)'
        );
      });

      it('mind seed facts are valid JSONL if declared', () => {
        const seedPath = manifest.persona?.mind?.seed_facts;
        if (!seedPath) return; // optional

        const fullPath = path.join(p.dir, seedPath);
        assert.ok(fs.existsSync(fullPath), `Seed facts file not found: ${fullPath}`);

        const lines = fs.readFileSync(fullPath, 'utf-8').trim().split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            assert.fail(`Line ${i + 1} is not valid JSON: ${line.slice(0, 80)}...`);
          }

          assert.ok(parsed.section, `Line ${i + 1}: missing 'section' field`);
          assert.ok(parsed.content, `Line ${i + 1}: missing 'content' field`);
          assert.ok(typeof parsed.confidence === 'number',
            `Line ${i + 1}: 'confidence' should be a number`);
          assert.ok(parsed.confidence >= 0 && parsed.confidence <= 1,
            `Line ${i + 1}: confidence ${parsed.confidence} should be between 0 and 1`);
        }
      });

      it('tool profile disables are valid tool names', () => {
        const disableList = manifest.persona?.tools?.disable;
        if (!disableList) return;

        const knownTools = [
          'bash', 'read', 'write', 'edit', 'view',
          'web_search', 'memory_store', 'memory_recall', 'memory_query',
          'design_tree', 'design_tree_update', 'openspec_manage',
          'cleave_assess', 'cleave_run', 'whoami', 'chronos',
          'ask_local_model', 'manage_ollama', 'set_model_tier',
          'set_thinking_level', 'manage_tools',
        ];
        for (const tool of disableList) {
          assert.ok(knownTools.includes(tool),
            `Unknown tool '${tool}' in disable list. Known: ${knownTools.join(', ')}`);
        }
      });
    });
  }
});

describe('Tone plugins', () => {
  const tones = findPlugins().filter(p => p.type === 'tone');

  for (const p of tones) {
    const name = path.basename(p.dir);
    const manifest = loadManifest(p.toml);

    describe(`tone/${name}`, () => {
      it('has a TONE.md directive file', () => {
        const directivePath = manifest.tone?.directive;
        assert.ok(directivePath, 'Missing tone.directive');
        const fullPath = path.join(p.dir, directivePath);
        assert.ok(fs.existsSync(fullPath), `Tone file not found: ${fullPath}`);
      });

      it('TONE.md is under 2000 chars (tones should be concise)', () => {
        const directivePath = manifest.tone?.directive || 'TONE.md';
        const content = fs.readFileSync(path.join(p.dir, directivePath), 'utf-8');
        assert.ok(content.length < 2000,
          `TONE.md is ${content.length} chars — tones should be concise, under 2000`);
      });

      it('exemplars directory exists if declared', () => {
        const exemplarsPath = manifest.tone?.exemplars;
        if (!exemplarsPath) return;

        const fullPath = path.join(p.dir, exemplarsPath);
        assert.ok(fs.existsSync(fullPath), `Exemplars dir not found: ${fullPath}`);

        const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.md'));
        assert.ok(files.length > 0, 'Exemplars directory has no .md files');
      });
    });
  }
});

describe('Skill plugins', () => {
  const skills = findPlugins().filter(p => p.type === 'skill');

  for (const p of skills) {
    const name = path.basename(p.dir);
    const manifest = loadManifest(p.toml);

    describe(`skill/${name}`, () => {
      it('has a SKILL.md guidance file', () => {
        const guidancePath = manifest.skill?.guidance;
        assert.ok(guidancePath, 'Missing skill.guidance');
        const fullPath = path.join(p.dir, guidancePath);
        assert.ok(fs.existsSync(fullPath), `Skill file not found: ${fullPath}`);
      });

      it('SKILL.md has a title and at least one section', () => {
        const guidancePath = manifest.skill?.guidance || 'SKILL.md';
        const content = fs.readFileSync(path.join(p.dir, guidancePath), 'utf-8');
        assert.match(content, /^# .+/m, 'SKILL.md should start with a # title');
        assert.match(content, /^## .+/m, 'SKILL.md should have at least one ## section');
      });
    });
  }
});

describe('Lex Imperialis', () => {
  const lexPath = path.join(ARMORY_ROOT, 'core', 'lex-imperialis.md');

  it('exists', () => {
    assert.ok(fs.existsSync(lexPath), 'core/lex-imperialis.md not found');
  });

  it('has all six directives', () => {
    const content = fs.readFileSync(lexPath, 'utf-8');
    const requiredDirectives = [
      'Anti-Sycophancy',
      'Evidence-Based Epistemology',
      'Perfection Is the Enemy of Good',
      'Systems Engineering Harness',
      'Cognitive Honesty',
      'Operator Agency',
    ];
    for (const directive of requiredDirectives) {
      assert.ok(content.includes(directive),
        `Missing directive: ${directive}`);
    }
  });

  it('uses numbered Roman numeral sections', () => {
    const content = fs.readFileSync(lexPath, 'utf-8');
    for (const numeral of ['## I.', '## II.', '## III.', '## IV.', '## V.', '## VI.']) {
      assert.ok(content.includes(numeral), `Missing section ${numeral}`);
    }
  });
});

describe('OCI tool example', () => {
  const exampleDir = path.join(ARMORY_ROOT, 'examples', 'oci-tool');

  it('has a valid plugin.toml', () => {
    const tomlPath = path.join(exampleDir, 'plugin.toml');
    assert.ok(fs.existsSync(tomlPath));
    const manifest = loadManifest(tomlPath);
    assert.equal(manifest.plugin.type, 'extension');
    assert.ok(manifest.plugin.id.includes('csv-analyzer'));
  });

  it('declares an OCI-backed tool', () => {
    const toml = fs.readFileSync(path.join(exampleDir, 'plugin.toml'), 'utf-8');
    assert.ok(toml.includes('runner = "oci"'), 'should use oci runner');
    assert.ok(toml.includes('mount_cwd = true'), 'should mount cwd');
    assert.ok(toml.includes('network = false'), 'should disable network');
  });

  it('has a Containerfile', () => {
    assert.ok(fs.existsSync(path.join(exampleDir, 'Containerfile')));
    const content = fs.readFileSync(path.join(exampleDir, 'Containerfile'), 'utf-8');
    assert.ok(content.includes('FROM'), 'Containerfile must have a FROM instruction');
    assert.ok(content.includes('ENTRYPOINT'), 'Containerfile must have an ENTRYPOINT');
  });

  it('has a tool script that follows the JSON contract', () => {
    const toolPath = path.join(exampleDir, 'tool.py');
    assert.ok(fs.existsSync(toolPath));
    const content = fs.readFileSync(toolPath, 'utf-8');
    // Must read from stdin
    assert.ok(content.includes('sys.stdin'), 'tool must read from stdin');
    // Must write JSON to stdout
    assert.ok(content.includes('json.dump'), 'tool must write JSON to stdout');
    // Must handle errors
    assert.ok(content.includes('emit_error'), 'tool must have error handling');
    // Must have the result/error contract
    assert.ok(content.includes('"result"'), 'output must include "result" key');
    assert.ok(content.includes('"error"'), 'output must include "error" key');
  });

  it('has a test CSV file', () => {
    assert.ok(fs.existsSync(path.join(exampleDir, 'test.csv')));
  });

  it('has a README', () => {
    const readme = fs.readFileSync(path.join(exampleDir, 'README.md'), 'utf-8');
    assert.ok(readme.includes('podman'), 'README should mention podman');
    assert.ok(readme.includes('Contract'), 'README should document the contract');
  });
});

describe('Cross-plugin consistency', () => {
  const plugins = findPlugins();

  it('no duplicate plugin IDs', () => {
    const ids = plugins.map(p => loadManifest(p.toml).plugin.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size,
      `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  it('all IDs share the dev.styrene.omegon prefix', () => {
    for (const p of plugins) {
      const manifest = loadManifest(p.toml);
      assert.ok(manifest.plugin.id.startsWith('dev.styrene.omegon'),
        `ID '${manifest.plugin.id}' should start with 'dev.styrene.omegon'`);
    }
  });

  it('all plugins have a license field', () => {
    for (const p of plugins) {
      const manifest = loadManifest(p.toml);
      assert.ok(manifest.plugin.license,
        `Plugin ${manifest.plugin.id} is missing a license field`);
    }
  });
});
