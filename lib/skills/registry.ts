import fs from 'fs'
import path from 'path'

/**
 * Skill metadata extracted from frontmatter
 */
export interface SkillMetadata {
  name: string
  description?: string
  /** Optional tags for categorization */
  tags?: string[]
  /** Optional model IDs this skill is specialized for */
  models?: string[]
}

/**
 * Loaded skill with metadata and content
 */
export interface Skill {
  id: string
  metadata: SkillMetadata
  content: string
  /** Full path to the skill file */
  path: string
  /** Last modified timestamp */
  lastModified: Date
}

/**
 * Validation result for a skill
 */
export interface SkillValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// In-memory cache for loaded skills
const skillCache = new Map<string, { skill: Skill; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes in development

/**
 * Get the skills directory path
 */
function getSkillsDir(): string {
  return path.join(process.cwd(), 'lib', 'skills')
}

/**
 * Parse YAML-like frontmatter from skill content
 */
function parseFrontmatter(content: string): { metadata: Partial<SkillMetadata>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  
  if (!frontmatterMatch) {
    return { metadata: {}, body: content.trim() }
  }
  
  const [, frontmatter, body] = frontmatterMatch
  const metadata: Partial<SkillMetadata> = {}
  
  // Parse key-value pairs (simple YAML subset)
  const lines = frontmatter.split('\n')
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/)
    if (match) {
      const [, key, value] = match
      
      // Handle array values (comma-separated)
      if (key === 'tags' || key === 'models') {
        metadata[key] = value.split(',').map(v => v.trim())
      } else {
        (metadata as Record<string, string>)[key] = value.trim()
      }
    }
  }
  
  return { metadata, body: body.trim() }
}

/**
 * Validate a skill's structure and content
 */
export function validateSkill(skill: Skill): SkillValidation {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Required: name in metadata
  if (!skill.metadata.name) {
    errors.push('Missing required "name" field in frontmatter')
  }
  
  // Required: content body
  if (!skill.content || skill.content.length === 0) {
    errors.push('Skill content is empty')
  }
  
  // Warning: no description
  if (!skill.metadata.description) {
    warnings.push('Missing "description" field in frontmatter')
  }
  
  // Warning: very short content
  if (skill.content && skill.content.length < 100) {
    warnings.push('Skill content is very short (<100 characters)')
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Load a single skill by ID
 * Results are cached in memory with TTL
 */
export function loadSkill(skillId: string): Skill | null {
  const now = Date.now()
  
  // Check cache first
  const cached = skillCache.get(skillId)
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.skill
  }
  
  try {
    const skillPath = path.join(getSkillsDir(), `${skillId}.skill.md`)
    
    if (!fs.existsSync(skillPath)) {
      return null
    }
    
    const content = fs.readFileSync(skillPath, 'utf-8')
    const stats = fs.statSync(skillPath)
    const { metadata, body } = parseFrontmatter(content)
    
    const skill: Skill = {
      id: skillId,
      metadata: {
        name: metadata.name || skillId,
        description: metadata.description,
        tags: metadata.tags,
        models: metadata.models,
      },
      content: body,
      path: skillPath,
      lastModified: stats.mtime,
    }
    
    // Update cache
    skillCache.set(skillId, { skill, timestamp: now })
    
    return skill
  } catch (error) {
    console.error(`Failed to load skill "${skillId}":`, error)
    return null
  }
}

/**
 * Get the system prompt content from a skill
 */
export function getSkillSystemPrompt(skillId: string): string | null {
  const skill = loadSkill(skillId)
  return skill?.content ?? null
}

/**
 * List all available skills in the skills directory
 */
export function listSkills(): Skill[] {
  const skillsDir = getSkillsDir()
  
  if (!fs.existsSync(skillsDir)) {
    return []
  }
  
  const files = fs.readdirSync(skillsDir)
  const skills: Skill[] = []
  
  for (const file of files) {
    if (file.endsWith('.skill.md')) {
      const skillId = file.replace('.skill.md', '')
      const skill = loadSkill(skillId)
      if (skill) {
        skills.push(skill)
      }
    }
  }
  
  return skills
}

/**
 * Load multiple skills by IDs
 * Returns skills in the order requested, skipping any not found
 */
export function loadSkills(skillIds: string[]): Skill[] {
  const skills: Skill[] = []
  
  for (const id of skillIds) {
    const skill = loadSkill(id)
    if (skill) {
      skills.push(skill)
    }
  }
  
  return skills
}

/**
 * Combine multiple skills into a single system prompt
 * Skills are separated by section headers
 */
export function combineSkills(skills: Skill[]): string {
  if (skills.length === 0) return ''
  if (skills.length === 1) return skills[0].content
  
  return skills
    .map(skill => `## ${skill.metadata.name}\n\n${skill.content}`)
    .join('\n\n---\n\n')
}

/**
 * Clear the skill cache (useful for development/hot-reloading)
 */
export function clearSkillCache(): void {
  skillCache.clear()
}

/**
 * Find skills by tag
 */
export function findSkillsByTag(tag: string): Skill[] {
  return listSkills().filter(skill => 
    skill.metadata.tags?.includes(tag)
  )
}

/**
 * Find skills by model ID
 */
export function findSkillsForModel(modelId: string): Skill[] {
  return listSkills().filter(skill => 
    !skill.metadata.models || skill.metadata.models.includes(modelId)
  )
}

