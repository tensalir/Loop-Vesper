/**
 * Compute a stable content hash for a skill so callers can pin to a
 * specific revision of the Gen-AI prompting substrate. Returned with
 * every headless response so Damien (or any downstream tool) can tell
 * which version of the prompting craft produced an output.
 */

import crypto from 'crypto'
import { loadSkill } from '@/lib/skills/registry'

export interface SkillVersion {
  skillId: string
  /** Short content-hash used for cache-busting and audit. */
  hash: string
  /** Last filesystem mtime of the skill file. */
  lastModified: string
}

export function getSkillVersion(skillId: string): SkillVersion | null {
  const skill = loadSkill(skillId)
  if (!skill) return null
  const hash = crypto
    .createHash('sha256')
    .update(skill.content)
    .digest('hex')
    .slice(0, 12)
  return {
    skillId,
    hash,
    lastModified: skill.lastModified.toISOString(),
  }
}
