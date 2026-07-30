import * as fs from 'fs';
import * as path from 'path';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  size: number;
  modified: string;
}

interface SkillState {
  enabled: Record<string, boolean>;
}

export class SkillManager {
  readonly skillsDir: string;
  private readonly stateFile: string;

  constructor(workspaceDir: string) {
    this.skillsDir = path.join(workspaceDir, '.minis-skills');
    this.stateFile = path.join(workspaceDir, '.minis-skills.json');
    fs.mkdirSync(this.skillsDir, { recursive: true });
  }

  list(): SkillInfo[] {
    const state = this.loadState();
    if (!fs.existsSync(this.skillsDir)) return [];
    return fs.readdirSync(this.skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && this.isSafeId(entry.name))
      .map(entry => {
        const file = path.join(this.skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(file)) return null;
        const content = fs.readFileSync(file, 'utf-8');
        const stat = fs.statSync(file);
        const meta = this.parseMetadata(content, entry.name);
        return {
          id: entry.name,
          name: meta.name,
          description: meta.description,
          enabled: state.enabled[entry.name] !== false,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        } as SkillInfo;
      })
      .filter((item): item is SkillInfo => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): SkillInfo & { content: string } {
    const safeId = this.requireSafeId(id);
    const file = path.join(this.skillsDir, safeId, 'SKILL.md');
    if (!fs.existsSync(file)) throw new Error('Skill not found');
    const content = fs.readFileSync(file, 'utf-8');
    const info = this.list().find(s => s.id === safeId);
    if (!info) throw new Error('Skill not found');
    return { ...info, content };
  }

  save(input: { id?: string; name?: string; description?: string; content: string; enabled?: boolean }): SkillInfo {
    const id = this.requireSafeId(input.id || this.slugify(input.name || 'skill'));
    const dir = path.join(this.skillsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), input.content || '', 'utf-8');
    if (typeof input.enabled === 'boolean') this.setEnabled(id, input.enabled);
    return this.get(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const safeId = this.requireSafeId(id);
    const state = this.loadState();
    state.enabled[safeId] = enabled;
    this.saveState(state);
  }

  remove(id: string): void {
    const safeId = this.requireSafeId(id);
    const dir = path.join(this.skillsDir, safeId);
    if (!fs.existsSync(dir)) throw new Error('Skill not found');
    fs.rmSync(dir, { recursive: true, force: true });
    const state = this.loadState();
    delete state.enabled[safeId];
    this.saveState(state);
  }

  buildPrompt(): string {
    const enabled = this.list().filter(s => s.enabled);
    if (enabled.length === 0) return '';
    const blocks = enabled.map(info => {
      const content = this.get(info.id).content.trim();
      return `<skill id="${info.id}" name="${this.escapeAttr(info.name)}">\n${content}\n</skill>`;
    });
    return `## Enabled Skills\n\nUse these workspace skills when relevant. Follow their instructions unless they conflict with higher-priority instructions.\n\n${blocks.join('\n\n')}`;
  }

  private loadState(): SkillState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      return { enabled: raw.enabled || {} };
    } catch {
      return { enabled: {} };
    }
  }

  private saveState(state: SkillState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  private parseMetadata(content: string, fallback: string): { name: string; description: string } {
    let name = fallback;
    let description = '';
    const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatter) {
      for (const line of frontmatter[1].split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z][\w-]*):\s*["']?(.*?)["']?\s*$/);
        if (!match) continue;
        if (match[1] === 'name' && match[2]) name = match[2];
        if (match[1] === 'description' && match[2]) description = match[2];
      }
    }
    if (!description) {
      const paragraph = content.replace(/^---[\s\S]*?---\s*/, '').split(/\n\s*\n/)
        .map(p => p.replace(/^#+\s*/gm, '').trim()).find(Boolean);
      description = (paragraph || '').slice(0, 180);
    }
    return { name, description };
  }

  private slugify(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `skill-${Date.now()}`;
  }

  private isSafeId(id: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
  }

  private requireSafeId(id: string): string {
    if (!this.isSafeId(id)) throw new Error('Invalid skill id');
    return id;
  }

  private escapeAttr(value: string): string {
    return value.replace(/[&"<>]/g, ch => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
  }
}
