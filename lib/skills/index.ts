/**
 * Skills Registry - Central module for managing AI assistant skills
 * 
 * Skills are markdown files with optional frontmatter that define
 * system prompts and capabilities for AI assistants.
 */

export {
  // Types
  type Skill,
  type SkillMetadata,
  type SkillValidation,
  
  // Core functions
  loadSkill,
  loadSkills,
  listSkills,
  getSkillSystemPrompt,
  combineSkills,
  validateSkill,
  
  // Query functions
  findSkillsByTag,
  findSkillsForModel,
  
  // Cache management
  clearSkillCache,
} from './registry'

