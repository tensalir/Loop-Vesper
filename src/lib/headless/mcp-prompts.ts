/**
 * MCP `prompts/list` + `prompts/get` definitions for Vesper.
 * Maps to slash-command style names: /vesper:generate, etc.
 *
 * Every prompt, and the vesper://skill/genai-prompting resource, carries the
 * prompting skill from `getPromptingSkillForClaude` (src/lib/prompts/prompting-source.ts):
 * the Loop edition from the creative kit, the text get_creative_kit section
 * 'prompting' returns, with its version. When the kit cannot be read they say
 * so and name what was served instead. They never read a skill file
 * themselves: until 2026-10-01 they read `src/lib/skills/genai-prompting/SKILL.md`,
 * a generic copy, and vesper:generate did not point at the kit at all.
 */

import {
  describePromptingSource,
  getPromptingSkillForClaude,
  type PromptingSource,
} from '@/lib/prompts/prompting-source'

export interface McpPromptDefinition {
  name: string
  title: string
  description: string
  arguments?: Array<{
    name: string
    description: string
    required?: boolean
  }>
}

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'vesper:generate',
    title: 'Generate a Loop image with Vesper',
    description:
      'Write the prompt with the Loop edition of the prompting skill (carried in this prompt) or enhance_prompt, pick an allowed Vesper image model, and call generate_asset. Use list_product_renders when the brief needs real Loop product imagery.',
    arguments: [
      {
        name: 'prompt',
        description: 'What to generate — subject, scene, lighting, aspect ratio intent.',
        required: true,
      },
      {
        name: 'modelId',
        description:
          'Optional Vesper model id (default gemini-nano-banana-pro). Call list_models first.',
      },
    ],
  },
  {
    name: 'vesper:enhance',
    title: 'Enhance a prompt with Vesper',
    description:
      'Run enhance_prompt, which rewrites the prompt with the Loop edition of the prompting skill, before sending it to any image or video model.',
    arguments: [
      {
        name: 'prompt',
        description: 'Raw prompt to sharpen.',
        required: true,
      },
      {
        name: 'modelId',
        description: 'Target model id so the skill picks the right enhancement strategy.',
        required: true,
      },
    ],
  },
  {
    name: 'vesper:iterate',
    title: 'Build an Andromeda-aware variant slate',
    description:
      'Run iterate_prompt to produce a structured slate of ad variants with locked anchors and diversified axes, written with the Loop edition of the prompting skill.',
    arguments: [
      {
        name: 'prompt',
        description: 'Baseline concept or prompt.',
        required: true,
      },
      {
        name: 'modelId',
        description: 'Target Vesper model id.',
        required: true,
      },
    ],
  },
]

/** What the prompts and the resource serve: the skill text, capped as get_creative_kit caps it, and one line naming its source. */
export interface PromptingSkillForClaude {
  sourceLine: string
  text: string
  source: PromptingSource
}

export type PromptingSkillLoader = () => Promise<PromptingSource>

export async function promptingSkillForClaude(
  load: PromptingSkillLoader = () => getPromptingSkillForClaude()
): Promise<PromptingSkillForClaude> {
  const source = await load()
  const { cap } = await import('@/lib/creative/tool-views')
  return { sourceLine: describePromptingSource(source), text: cap(source.text), source }
}

function skillSection(skill: PromptingSkillForClaude): string {
  return ['---', '', skill.sourceLine, '', skill.text].join('\n')
}

type PromptMessages = {
  description: string
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>
}

function userText(description: string, text: string): PromptMessages {
  return { description, messages: [{ role: 'user', content: { type: 'text', text } }] }
}

export async function getMcpPromptMessages(
  name: string,
  args: Record<string, string | undefined>,
  load?: PromptingSkillLoader
): Promise<PromptMessages | null> {
  if (!findMcpPrompt(name)) return null
  const prompt = args.prompt?.trim()
  const modelId = args.modelId?.trim() || 'gemini-nano-banana-pro'
  const skill = await promptingSkillForClaude(load)

  switch (name) {
    case 'vesper:generate':
      return userText(
        'Generate a Vesper image end-to-end',
        [
          'You are connected to the Vesper MCP server. Draw this with Vesper.',
          '1. Write the prompt with the prompting skill below, or call enhance_prompt with the brief and the modelId. Use no other prompting skill.',
          "2. A prompt filled by code goes out unchanged, never rewritten: a Loop product skeleton, cmf_prompt's template, packaging_finish's. For a Loop product, generate_product_image fills the skeleton itself.",
          '3. Call list_models if you need to confirm allowed models, then generate_asset with the prompt (generate_video for a video).',
          '4. Put the markdown image lines the result gives into your reply, and keep the links for iteration.',
          '',
          `Prompt: ${prompt || '(describe what the user asked for)'}`,
          `Suggested modelId: ${modelId}`,
          '',
          'If generation may exceed 60s, pass async: true and poll get_generation_status.',
          '',
          skillSection(skill),
        ].join('\n')
      )
    case 'vesper:enhance':
      return userText(
        'Enhance a prompt via Vesper',
        [
          'Call the Vesper enhance_prompt tool with:',
          `prompt: ${prompt || '(user brief)'}`,
          `modelId: ${modelId}`,
          '',
          'Return the enhanced prompt only — do not generate yet unless asked.',
          'enhance_prompt rewrites with the prompting skill below; its skill field names the source that ran. A prompt filled by code from a Loop product skeleton comes back unchanged: send it as it is.',
          '',
          skillSection(skill),
        ].join('\n')
      )
    case 'vesper:iterate':
      return userText(
        'Build a Vesper iteration slate',
        [
          'Call the Vesper iterate_prompt tool with:',
          `prompt: ${prompt || '(user brief)'}`,
          `modelId: ${modelId}`,
          '',
          'Return the JSON slate and offer to generate the strongest variants.',
          'iterate_prompt writes each variant with the prompting skill below; its skill field names the source that ran.',
          '',
          skillSection(skill),
        ].join('\n')
      )
    default:
      return null
  }
}

export function findMcpPrompt(name: string): McpPromptDefinition | undefined {
  return MCP_PROMPTS.find((p) => p.name === name)
}

/** The vesper://skill/genai-prompting resource: the source line, then the skill. */
export async function getGenAiSkillResourceText(load?: PromptingSkillLoader): Promise<string> {
  const skill = await promptingSkillForClaude(load)
  return `> ${skill.sourceLine}\n\n${skill.text}`
}
