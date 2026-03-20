/**
 * Persona transition tests — models activate, deactivate, and switch scenarios.
 *
 * These test against an in-memory plugin registry mock, validating the
 * behavioral contract that the Omegon plugin loader must satisfy.
 */
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// --- In-memory plugin registry mock ---

interface MindFact {
  section: string;
  content: string;
  confidence: number;
  source?: string;
  tags?: string[];
}

interface LoadedPersona {
  id: string;
  directive: string;       // content of PERSONA.md
  mindFacts: MindFact[];   // loaded seed facts
  activatedSkills: string[];
  disabledTools: string[];
  badge?: string;
}

interface LoadedTone {
  id: string;
  directive: string;       // content of TONE.md
  exemplars: string[];     // content of exemplar files
  intensity: { design: string; coding: string };
}

interface MemoryLayer {
  persona: MindFact[];     // persona mind layer
  project: MindFact[];     // project memory (persists across persona switches)
  working: MindFact[];     // pinned working memory
}

class PluginRegistry {
  activePersona: LoadedPersona | null = null;
  activeTone: LoadedTone | null = null;
  memory: MemoryLayer = { persona: [], project: [], working: [] };
  systemPromptLayers: string[] = []; // ordered: lex → tone → persona
  private lexImperialis: string;

  constructor(lexContent: string) {
    this.lexImperialis = lexContent;
    this.rebuildSystemPrompt();
  }

  activatePersona(persona: LoadedPersona): { previousId: string | null } {
    const previousId = this.activePersona?.id ?? null;

    // Unload previous persona's mind facts
    if (this.activePersona) {
      this.memory.persona = [];
    }

    // Load new persona
    this.activePersona = persona;
    this.memory.persona = [...persona.mindFacts];

    this.rebuildSystemPrompt();
    return { previousId };
  }

  deactivatePersona(): { removedId: string | null; factsRemoved: number } {
    if (!this.activePersona) return { removedId: null, factsRemoved: 0 };

    const removedId = this.activePersona.id;
    const factsRemoved = this.memory.persona.length;

    this.activePersona = null;
    this.memory.persona = [];
    this.rebuildSystemPrompt();

    return { removedId, factsRemoved };
  }

  activateTone(tone: LoadedTone): { previousId: string | null } {
    const previousId = this.activeTone?.id ?? null;
    this.activeTone = tone;
    this.rebuildSystemPrompt();
    return { previousId };
  }

  deactivateTone(): { removedId: string | null } {
    if (!this.activeTone) return { removedId: null };
    const removedId = this.activeTone.id;
    this.activeTone = null;
    this.rebuildSystemPrompt();
    return { removedId };
  }

  /** Store a fact into the persona layer (domain learning during session) */
  storePersonaFact(fact: MindFact): void {
    if (!this.activePersona) throw new Error('No active persona — cannot store persona fact');
    this.memory.persona.push(fact);
  }

  /** Store a fact into the project layer */
  storeProjectFact(fact: MindFact): void {
    this.memory.project.push(fact);
  }

  /** Query all memory layers — merged view */
  queryAllFacts(): MindFact[] {
    return [...this.memory.working, ...this.memory.persona, ...this.memory.project];
  }

  /** Get the assembled system prompt */
  getSystemPrompt(): string {
    return this.systemPromptLayers.join('\n\n---\n\n');
  }

  private rebuildSystemPrompt(): void {
    this.systemPromptLayers = [this.lexImperialis];
    if (this.activeTone) {
      this.systemPromptLayers.push(this.activeTone.directive);
    }
    if (this.activePersona) {
      this.systemPromptLayers.push(this.activePersona.directive);
    }
  }
}

// --- Test fixtures ---

const ARMORY_ROOT = path.resolve(__dirname, '..');
const LEX_CONTENT = fs.readFileSync(path.join(ARMORY_ROOT, 'core', 'lex-imperialis.md'), 'utf-8');

function loadPersonaFixture(name: string): LoadedPersona {
  const dir = path.join(ARMORY_ROOT, 'personas', name);
  const directive = fs.readFileSync(path.join(dir, 'PERSONA.md'), 'utf-8');
  const factsPath = path.join(dir, 'mind', 'facts.jsonl');
  const mindFacts: MindFact[] = fs.existsSync(factsPath)
    ? fs.readFileSync(factsPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
    : [];

  // Read plugin.toml for tools config (simple extraction)
  const toml = fs.readFileSync(path.join(dir, 'plugin.toml'), 'utf-8');
  const disableMatch = toml.match(/disable\s*=\s*\[([^\]]*)\]/);
  const disabledTools = disableMatch
    ? disableMatch[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean)
    : [];

  const badgeMatch = toml.match(/badge\s*=\s*"([^"]+)"/);

  return {
    id: `dev.styrene.omegon.${name.replace(/-/g, '.')}`,
    directive,
    mindFacts,
    activatedSkills: [],
    disabledTools,
    badge: badgeMatch?.[1],
  };
}

function loadToneFixture(name: string): LoadedTone {
  const dir = path.join(ARMORY_ROOT, 'tones', name);
  const directive = fs.readFileSync(path.join(dir, 'TONE.md'), 'utf-8');
  const exemplarsDir = path.join(dir, 'exemplars');
  const exemplars = fs.existsSync(exemplarsDir)
    ? fs.readdirSync(exemplarsDir).filter(f => f.endsWith('.md'))
        .map(f => fs.readFileSync(path.join(exemplarsDir, f), 'utf-8'))
    : [];

  // Read intensity from plugin.toml
  const toml = fs.readFileSync(path.join(dir, 'plugin.toml'), 'utf-8');
  const designMatch = toml.match(/design\s*=\s*"([^"]+)"/);
  const codingMatch = toml.match(/coding\s*=\s*"([^"]+)"/);

  return {
    id: `dev.styrene.omegon.tone.${name}`,
    directive,
    exemplars,
    intensity: {
      design: designMatch?.[1] ?? 'full',
      coding: codingMatch?.[1] ?? 'muted',
    },
  };
}

// --- Tests ---

describe('Persona activation', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('loads persona directive into system prompt', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);

    const prompt = registry.getSystemPrompt();
    assert.ok(prompt.includes('Socratic Tutor'), 'System prompt should include tutor directive');
    assert.ok(prompt.includes('Lex Imperialis'), 'System prompt should still include Lex Imperialis');
  });

  it('loads mind facts into persona memory layer', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);

    assert.ok(registry.memory.persona.length > 0, 'Persona memory layer should have facts');
    assert.ok(
      registry.memory.persona.some(f => f.content.includes('Bloom')),
      'Tutor mind should contain Bloom\'s Taxonomy'
    );
  });

  it('Lex Imperialis is always first in system prompt', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);

    const prompt = registry.getSystemPrompt();
    const lexPos = prompt.indexOf('Lex Imperialis');
    const personaPos = prompt.indexOf('Socratic Tutor');
    assert.ok(lexPos < personaPos, 'Lex Imperialis must appear before persona directive');
  });

  it('returns null previousId on first activation', () => {
    const tutor = loadPersonaFixture('tutor');
    const result = registry.activatePersona(tutor);
    assert.equal(result.previousId, null);
  });
});

describe('Persona deactivation', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('removes persona directive from system prompt', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);
    registry.deactivatePersona();

    const prompt = registry.getSystemPrompt();
    assert.ok(!prompt.includes('Socratic Tutor'), 'Persona directive should be removed');
    assert.ok(prompt.includes('Lex Imperialis'), 'Lex Imperialis should remain');
  });

  it('clears persona memory layer', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);
    assert.ok(registry.memory.persona.length > 0);

    registry.deactivatePersona();
    assert.equal(registry.memory.persona.length, 0, 'Persona facts should be cleared');
  });

  it('preserves project memory across deactivation', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);
    registry.storeProjectFact({
      section: 'Architecture',
      content: 'Project uses React with TypeScript',
      confidence: 0.9,
    });

    registry.deactivatePersona();
    assert.equal(registry.memory.project.length, 1, 'Project fact should survive');
    assert.ok(registry.memory.project[0].content.includes('React'));
  });

  it('returns removed persona info', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);
    const result = registry.deactivatePersona();

    assert.ok(result.removedId?.includes('tutor'));
    assert.ok(result.factsRemoved > 0);
  });

  it('deactivating with no active persona is a no-op', () => {
    const result = registry.deactivatePersona();
    assert.equal(result.removedId, null);
    assert.equal(result.factsRemoved, 0);
  });
});

describe('Persona switching', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('replaces old persona directive with new one', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');

    registry.activatePersona(tutor);
    assert.ok(registry.getSystemPrompt().includes('Socratic Tutor'));

    registry.activatePersona(engineer);
    const prompt = registry.getSystemPrompt();
    assert.ok(!prompt.includes('Socratic Tutor'), 'Old persona should be removed');
    assert.ok(prompt.includes('Systems Engineer'), 'New persona should be present');
  });

  it('replaces old mind facts with new ones', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');

    registry.activatePersona(tutor);
    assert.ok(registry.memory.persona.some(f => f.content.includes('Bloom')));

    registry.activatePersona(engineer);
    assert.ok(!registry.memory.persona.some(f => f.content.includes('Bloom')),
      'Tutor facts should be gone');
    assert.ok(registry.memory.persona.some(f => f.content.includes('Conway')),
      'Engineer facts should be loaded');
  });

  it('returns previous persona ID on switch', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');

    registry.activatePersona(tutor);
    const result = registry.activatePersona(engineer);
    assert.ok(result.previousId?.includes('tutor'));
  });

  it('preserves project memory across persona switch', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');

    registry.activatePersona(tutor);
    registry.storeProjectFact({
      section: 'Decisions',
      content: 'Chose Postgres over SQLite for multi-user',
      confidence: 0.9,
    });

    registry.activatePersona(engineer);
    assert.equal(registry.memory.project.length, 1);
    assert.ok(registry.memory.project[0].content.includes('Postgres'));
  });

  it('session-accumulated persona facts are lost on switch', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');

    registry.activatePersona(tutor);
    registry.storePersonaFact({
      section: 'Domain',
      content: 'Student struggles with recursion — use tree metaphors',
      confidence: 0.8,
    });
    const tutorFactCount = registry.memory.persona.length;

    registry.activatePersona(engineer);
    // Engineer's seed facts only — tutor's accumulated fact is gone
    assert.ok(!registry.memory.persona.some(f => f.content.includes('recursion')),
      'Accumulated persona facts should not carry over to new persona');
    assert.ok(!registry.memory.persona.some(f => f.content.includes('Bloom')),
      'Previous persona seed facts should not carry over');
    assert.ok(registry.memory.persona.some(f => f.content.includes('Conway')),
      'New persona seed facts should be loaded');
  });
});

describe('Tone activation', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('inserts tone between Lex Imperialis and persona in system prompt', () => {
    const tutor = loadPersonaFixture('tutor');
    const watts = loadToneFixture('alan-watts');

    registry.activatePersona(tutor);
    registry.activateTone(watts);

    const prompt = registry.getSystemPrompt();
    const lexPos = prompt.indexOf('Lex Imperialis');
    const tonePos = prompt.indexOf('Alan Watts');
    const personaPos = prompt.indexOf('Socratic Tutor');

    assert.ok(lexPos < tonePos, 'Lex before tone');
    assert.ok(tonePos < personaPos, 'Tone before persona');
  });

  it('tone works without an active persona', () => {
    const watts = loadToneFixture('alan-watts');
    registry.activateTone(watts);

    const prompt = registry.getSystemPrompt();
    assert.ok(prompt.includes('Alan Watts'));
    assert.ok(prompt.includes('Lex Imperialis'));
  });

  it('switching tones replaces the old one', () => {
    const watts = loadToneFixture('alan-watts');
    const concise = loadToneFixture('concise');

    registry.activateTone(watts);
    assert.ok(registry.getSystemPrompt().includes('Alan Watts'));

    registry.activateTone(concise);
    const prompt = registry.getSystemPrompt();
    assert.ok(!prompt.includes('Alan Watts'), 'Old tone removed');
    assert.ok(prompt.includes('Concise'), 'New tone present');
  });

  it('deactivating tone removes it from prompt', () => {
    const watts = loadToneFixture('alan-watts');
    registry.activateTone(watts);
    registry.deactivateTone();

    assert.ok(!registry.getSystemPrompt().includes('Alan Watts'));
  });
});

describe('Memory layer isolation', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('queryAllFacts merges all layers in priority order', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);
    registry.storeProjectFact({
      section: 'Architecture',
      content: 'Uses monorepo layout',
      confidence: 0.9,
    });
    registry.memory.working.push({
      section: 'Pinned',
      content: 'Current focus: authentication module',
      confidence: 1.0,
    });

    const all = registry.queryAllFacts();
    // Working memory first, then persona, then project
    assert.ok(all[0].section === 'Pinned', 'Working memory should be first');
    assert.ok(all.some(f => f.content.includes('Bloom')), 'Persona facts present');
    assert.ok(all.some(f => f.content.includes('monorepo')), 'Project facts present');
  });

  it('persona facts do not leak into project memory', () => {
    const tutor = loadPersonaFixture('tutor');
    registry.activatePersona(tutor);

    assert.ok(registry.memory.persona.length > 0);
    assert.equal(registry.memory.project.length, 0,
      'Project memory should be empty — persona facts are in their own layer');
  });

  it('cannot store persona facts without an active persona', () => {
    assert.throws(() => {
      registry.storePersonaFact({
        section: 'Domain',
        content: 'Test fact',
        confidence: 0.8,
      });
    }, /No active persona/);
  });
});

describe('Lex Imperialis invariants', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry(LEX_CONTENT);
  });

  it('Lex Imperialis is present with no persona and no tone', () => {
    const prompt = registry.getSystemPrompt();
    assert.ok(prompt.includes('Lex Imperialis'));
    assert.ok(prompt.includes('Anti-Sycophancy'));
  });

  it('Lex Imperialis survives any combination of persona/tone changes', () => {
    const tutor = loadPersonaFixture('tutor');
    const engineer = loadPersonaFixture('systems-engineer');
    const watts = loadToneFixture('alan-watts');
    const concise = loadToneFixture('concise');

    // Activate everything
    registry.activatePersona(tutor);
    registry.activateTone(watts);
    assert.ok(registry.getSystemPrompt().includes('Lex Imperialis'));

    // Switch persona
    registry.activatePersona(engineer);
    assert.ok(registry.getSystemPrompt().includes('Lex Imperialis'));

    // Switch tone
    registry.activateTone(concise);
    assert.ok(registry.getSystemPrompt().includes('Lex Imperialis'));

    // Deactivate everything
    registry.deactivatePersona();
    registry.deactivateTone();
    assert.ok(registry.getSystemPrompt().includes('Lex Imperialis'));
  });

  it('Lex Imperialis cannot be removed by any registry operation', () => {
    // The only way to construct a registry is with lex content
    // There's no removelex() method — it's structural
    const prompt = registry.getSystemPrompt();
    const lines = prompt.split('\n');
    assert.ok(lines.length > 10, 'Lex should have substantial content');
  });
});
