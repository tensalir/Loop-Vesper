/**
 * MCP tool definitions for the Vesper headless surface.
 */

import type { HeadlessTool } from './tool-registry'
import { PHASE_1_MODEL_IDS, VIDEO_MODEL_IDS } from './model-allowlists'

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolDefinition {
  name: HeadlessTool
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
}

const generateAssetOutputSchema = {
  type: 'object',
  properties: {
    modelId: { type: 'string' },
    requestedModelId: { type: 'string' },
    effectiveModelId: { type: 'string' },
    provider: { type: 'string' },
    isFallback: { type: 'boolean' },
    routeReason: { type: ['string', 'null'] },
    jobId: { type: 'string' },
    status: { type: 'string' },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          mimeType: { type: 'string' },
          outputId: { type: ['string', 'null'] },
        },
      },
    },
    generationId: { type: 'string' },
    durationMs: { type: 'number' },
    estimatedCostUsd: { type: ['number', 'null'] },
  },
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'enhance_prompt',
    title: 'Enhance a generation prompt',
    description:
      'Enhance a single image or video prompt using the Vesper Gen-AI prompting skill. Returns the enhanced prompt text and the substrate version used. A prompt filled by code from a Loop product skeleton, or one naming a Loop product, comes back unchanged with the reason: send those as they are.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        modelId: { type: 'string' },
        referenceImage: {
          type: 'string',
          description: 'Optional data URL or https URL of a reference image.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        enhancedPrompt: { type: 'string' },
        modelId: { type: 'string' },
        skill: { type: 'object' },
      },
    },
  },
  {
    name: 'iterate_prompt',
    title: 'Build an Andromeda-aware prompt slate',
    description:
      'Produce a structured slate of variant prompts that preserve declared anchors while varying diversification axes.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        modelId: { type: 'string' },
        referenceImage: { type: 'string' },
        baselineOutputId: { type: 'string' },
        anchors: { type: 'object' },
        variantCount: { type: 'integer', minimum: 2, maximum: 8, default: 4 },
        lockedAxes: { type: 'array', items: { type: 'string' }, maxItems: 7 },
        preferredAxes: { type: 'array', items: { type: 'string' }, maxItems: 7 },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        slate: { type: 'object' },
        variantCount: { type: 'number' },
        modelId: { type: 'string' },
      },
    },
  },
  {
    name: 'list_models',
    title: 'List available Vesper models',
    description:
      'Return the catalog of models the credential may use, including capabilities, parameters, aspect ratios, and per-image cost hints.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        models: { type: 'array' },
        total: { type: 'number' },
        wildcardAccess: { type: 'boolean' },
      },
    },
  },
  {
    name: 'estimate_generation_cost',
    title: 'Estimate generation cost',
    description:
      'Preflight credit/cost estimate in USD for a model call before spending quota. Uses published per-image or per-second pricing from the model registry.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['modelId'],
      properties: {
        modelId: { type: 'string' },
        numOutputs: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 60 },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        estimatedCostUsd: { type: ['number', 'null'] },
      },
    },
  },
  {
    name: 'generate_asset',
    title: 'Generate an image',
    description:
      'Generate an image with a Vesper model. Answers inline when the draw finishes within about 50 seconds: a JPEG preview you can read for each image plus a link to the full-resolution file. A slower draw, or async: true, returns a jobId to collect with get_generation_status. Every draw is saved in your Vesper project "Claude". Pass allowFallback: false to forbid silent Replicate routing.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        modelId: { type: 'string', enum: [...PHASE_1_MODEL_IDS] },
        aspectRatio: { type: 'string', maxLength: 16 },
        referenceImage: {
          type: 'string',
          description:
            'Optional style/composition anchor as data URL or https URL (e.g. a prior Vesper output).',
        },
        productRenderIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          maxItems: 4,
        },
        numOutputs: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        seed: { type: 'integer' },
        inlineBase64: { type: 'boolean', default: true },
        allowFallback: { type: 'boolean', default: true },
        async: { type: 'boolean', default: false },
      },
    },
    outputSchema: generateAssetOutputSchema,
  },
  {
    name: 'generate_video',
    title: 'Generate a video',
    description:
      'Generate a short video with Veo, Kling, or Seedance 2.5. Defaults to async job queue — poll get_generation_status until completed.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        modelId: { type: 'string', enum: [...VIDEO_MODEL_IDS] },
        aspectRatio: { type: 'string', maxLength: 16 },
        duration: { type: 'integer', minimum: 4, maximum: 30 },
        resolution: { type: 'integer' },
        referenceImage: { type: 'string' },
        referenceImageUrls: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 30,
          description: 'Seedance 2.5 only: reference image URLs for character/style consistency. Cannot be combined with referenceImage.',
        },
        referenceVideoUrls: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
          description: 'Seedance 2.5 only: reference video URLs for motion/style transfer. Billed on a higher tier.',
        },
        referenceAudioUrls: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
          description: 'Seedance 2.5 only: reference audio URLs for lip-sync. Requires at least one reference image or video.',
        },
        allowFallback: { type: 'boolean', default: true },
        async: { type: 'boolean', default: true },
      },
    },
    outputSchema: generateAssetOutputSchema,
  },
  {
    name: 'get_generation_status',
    title: 'Collect a long-running job',
    description:
      'Collect the result of any long Vesper call that returned a jobId (image or video generation). While the job runs it says so; when it is done it returns the result, with image previews.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['jobId'],
      properties: {
        jobId: { type: 'string', format: 'uuid' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string' },
        outputs: { type: 'array' },
      },
    },
  },
  {
    name: 'list_product_renders',
    title: 'List Loop product renders',
    description:
      'Discover Loop product render library entries. Pass ids to generate_asset.productRenderIds.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', maxLength: 128 },
        colorway: { type: 'string', maxLength: 128 },
        renderType: { type: 'string', enum: ['single', 'pair', 'case'] },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        renders: { type: 'array' },
        total: { type: 'number' },
      },
    },
  },
  {
    name: 'get_creative_kit',
    title: 'Read the Loop creative kit',
    description:
      "What Vesper is running on: the Loop Creative plugin's kit at its release tag. section 'summary' (the default) names the version, commit and products; 'products' lists them in full; 'prompting' returns the Loop edition of the prompting skill; 'feedback' the feedback targets and labels; 'rubric:<product>' a product's checks with their plain-language captions. Says when the kit is stale.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        section: {
          type: 'string',
          description: "summary | products | prompting | feedback | rubric:<product>, e.g. rubric:eclipse",
          default: 'summary',
        },
      },
    },
  },
  {
    name: 'list_creative_products',
    title: 'List Loop products Vesper serves',
    description:
      'The Loop products in the creative kit that Vesper serves (pilot or live): name, kind, rubric version, colourways or looks, who decides, where answers go, and the Vesper tools that work with each.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_product_references',
    title: "See a product's pinned references",
    description:
      "The real pictures a grade or a draw of a Loop product attaches, in the order it attaches them, with JPEG previews of exactly those pictures and why any is not attached. purpose 'grade' (the grader's references for a colourway and view) or 'generate' (the product render first, then a photograph of it worn). Packaging takes a look and a scene; CMF takes a clown key.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['product'],
      properties: {
        product: { type: 'string', description: 'slug or name, e.g. eclipse, packaging, cmf' },
        purpose: { type: 'string', enum: ['grade', 'generate'], default: 'grade' },
        colourway: { type: 'string', maxLength: 40, description: 'e.g. Teal; the kit default when omitted' },
        view: { type: 'string', maxLength: 40, description: 'frontal, profile, three_quarter, flat_lay, product_only, other' },
        look: { type: 'string', maxLength: 40, description: 'packaging: e.g. coachella' },
        scene: { type: 'string', maxLength: 40, description: 'packaging: both, closed or open' },
        clown: { type: 'string', maxLength: 80, description: 'CMF: a clown key, e.g. case-experience2--front' },
        previews: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'generate_product_image',
    title: 'Draw a Loop product',
    description:
      "Draws a Loop product the way the Loop studio's graded rounds taught: the product render of that colourway and view attached first (then one photograph of it worn), the product's prompt skeleton filled by code from your scene, light and format, never rewritten; the model from the product's dated router (lane final, second or draft); one call per image; every draw saved in your Vesper project Claude with the full prompt and references. There is no reference parameter: a draw is never the next draw's reference. Returns JPEG previews, output ids and a manifest line; grade each draw with grade_image next. Packaging and CMF have their own tools.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['product', 'scene', 'light'],
      properties: {
        product: { type: 'string', description: 'slug or name, e.g. eclipse' },
        colourway: { type: 'string', maxLength: 40, description: 'e.g. Teal; the kit default when omitted' },
        view: { type: 'string', maxLength: 40, description: 'frontal, profile, three_quarter, flat_lay, product_only, other' },
        scene: { type: 'string', minLength: 3, maxLength: 600, description: 'scene, subject and camera, one sentence each; one line, no product description' },
        light: { type: 'string', minLength: 3, maxLength: 300, description: 'source, direction, temperature, one sentence' },
        format: { type: 'string', maxLength: 60, description: 'e.g. "4:5 portrait"; the aspect when omitted' },
        lane: { type: 'string', enum: ['final', 'second', 'draft'], default: 'final' },
        n: { type: 'integer', minimum: 1, maximum: 4, default: 1, description: "capped at the product's draws per call" },
        aspect: { type: 'string', description: 'e.g. 4:5', default: '4:5' },
        image_size: { type: 'string', enum: ['1K', '2K', '4K'], default: '2K' },
        async: { type: 'boolean', default: false, description: 'return a job id at once; collect with get_generation_status' },
      },
    },
  },
  {
    name: 'grade_image',
    title: 'Grade a picture of a Loop product',
    description:
      "Vesper's scripted read of one picture against its product's rubric: three reads with the product's grader words and pinned references from the creative kit, majority per check, the verdict ladder. Labelled judge <model> vesper x3; advisory, the product's decider decides; never pooled with your own read (record that with record_grade). Give exactly one picture: output_id (a draw of yours), frontify_asset_id or an https image_url. A draw of yours brings its colourway and view; otherwise name them, or the kit default is assumed and the answer says so. When most reads error the result is ERROR, not a verdict. For a CMF render (product cmf) name the tab, column and clown key: it is read against its sheet row and its clown, the clown attached second, reporting only while the CMF rubric is; Vesper measures nothing on the pixels. Packaging is not graded here yet.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['product'],
      properties: {
        product: { type: 'string', description: 'slug or name, e.g. eclipse' },
        output_id: { type: 'string', description: 'an output of yours in Vesper' },
        frontify_asset_id: { type: 'string', description: 'a Frontify asset id' },
        image_url: { type: 'string', description: 'an https URL on Vesper\'s fetch allowlist' },
        colourway: { type: 'string', maxLength: 40, description: 'a colourway you name is a trusted claim' },
        view: { type: 'string', maxLength: 40 },
        runs: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
        tab: { type: 'string', description: 'CMF: the sheet tab, e.g. "Experience 2 CC" (needed for product cmf)' },
        column: { type: 'string', description: 'CMF: the SKU column letter, e.g. E (needed for product cmf)' },
        clown: { type: 'string', description: 'CMF: the clown key the render was drawn through, e.g. case-experience2--front (needed for product cmf)' },
        look: { type: 'string', description: 'packaging: the look' },
        box: { type: 'string', description: 'packaging: the box' },
        async: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'record_grade',
    title: "Keep Claude's own read beside Vesper's",
    description:
      "Records your own look at a picture as a separate judge (judge <model> chat x1, or cowork/code), stored beside Vesper's grade of the same picture and never added to it, so the two judges can be compared against the decider's answers later.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['product', 'verdict', 'judge_model'],
      properties: {
        product: { type: 'string' },
        output_id: { type: 'string' },
        frontify_asset_id: { type: 'string' },
        image_url: { type: 'string' },
        verdict: { type: 'string', enum: ['PASS', 'PASS_WITH_NOTES', 'RETRY', 'FAIL'] },
        failed: { type: 'array', items: { type: 'string', pattern: '^[A-E]\\d+$' }, default: [] },
        judge_model: { type: 'string', description: 'your model id, e.g. claude-opus-5-5' },
        reads: { type: 'integer', minimum: 1, maximum: 5, default: 1 },
        surface: { type: 'string', enum: ['chat', 'cowork', 'code'], default: 'chat' },
        colourway: { type: 'string' },
        view: { type: 'string' },
      },
    },
  },
  {
    name: 'record_verdict',
    title: "Record the decider's answer",
    description:
      "Records a decider's yes or no on one picture, with their remark verbatim and the checks it names (decoded, or decoded_unconfirmed when they have not confirmed your reading), in the signed-in person's name, against the picture's latest grade (or grade_id). For a Frontify asset of a product whose answers go to Frontify, returns the exact comment line to post with the person's own Frontify connector; otherwise it is recorded in Vesper. Never approves, moves or tags anything.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['product', 'answer'],
      properties: {
        product: { type: 'string' },
        grade_id: { type: 'string' },
        output_id: { type: 'string' },
        frontify_asset_id: { type: 'string' },
        image_url: { type: 'string' },
        answer: { type: 'string', enum: ['yes', 'no'] },
        remark: { type: 'string', maxLength: 2000, description: "the decider's words, verbatim" },
        decoded: { type: 'array', items: { type: 'string', pattern: '^[A-E]\\d+$' }, default: [] },
        decoded_unconfirmed: { type: 'array', items: { type: 'string', pattern: '^[A-E]\\d+$' }, default: [] },
        judge_model: { type: 'string', description: 'for a picture nobody graded: the model that read it for the person' },
      },
    },
  },
  {
    name: 'export_creative_records',
    title: 'Export the creative record',
    description:
      "For the plugin repository's nightly job only: grades, decider answers or draw manifests, oldest first from since, with next_since to page forward. Carried only by a static credential an admin issues for it.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['grades', 'verdicts', 'manifests'] },
        product: { type: 'string' },
        since: { type: 'string', description: 'ISO 8601' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
      },
    },
  },
  {
    name: 'list_feedback_targets',
    title: 'What feedback can be about',
    description:
      "The skills and products of the Loop Creative plugin a colleague's remark can be about, each with its command and, for a product, its checks and their plain-language captions; the kinds of feedback (remark, bug, idea, question).",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'list_feedback',
    title: 'See feedback already filed',
    description:
      "Feedback issues in the Loop Creative plugin's repository, newest first, at most 15: number, title, state, triage labels and the first lines of the triage's answer. target narrows to one skill; query searches the words; mine keeps the ones the caller filed. Use it to find the same remark before filing, and to answer 'what happened to my feedback'.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', description: 'an id from list_feedback_targets' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        query: { type: 'string', maxLength: 200, description: 'words to look for' },
        mine: { type: 'boolean', default: false, description: 'only the ones the caller filed' },
      },
    },
  },
  {
    name: 'preview_feedback',
    title: 'Preview a feedback issue',
    description:
      "The exact issue a colleague's remark becomes, before anything is filed: title, labels and body, with their name and Loop email (the signed-in person, never an argument), possible earlier issues with the same remark, and a preview_id valid 15 minutes. Refuses anything shaped like a key or token. Show it to them; file only on a yes, with submit_feedback.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'kind', 'words'],
      properties: {
        target: { type: 'string', description: 'what the remark is about: an id from list_feedback_targets, e.g. eclipse' },
        kind: { type: 'string', enum: ['remark', 'bug', 'idea', 'question'] },
        words: { type: 'string', maxLength: 4000, description: "the colleague's remark, verbatim, never paraphrased" },
        summary: { type: 'string', maxLength: 160, description: "for the title; their first words when omitted" },
        what_should_have_happened: { type: 'string', maxLength: 4000, description: 'in their words, when they said it' },
        example: { type: 'string', maxLength: 4000, description: 'where it happened, in words; never an image' },
        links: { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'https links: a Frontify asset, a round, a page' },
        claudes_reading: { type: 'string', maxLength: 4000, description: "Claude's own reading, labelled as Claude's" },
        check: { type: 'string', description: 'the check the remark names, e.g. B3' },
        check_confirmed: { type: 'boolean', description: 'true when they confirmed that check' },
        output_id: { type: 'string', description: 'the Vesper output it is about' },
        grade_id: { type: 'string', description: 'the Vesper grade it is about' },
        surface: { type: 'string', enum: ['chat', 'cowork', 'code'], default: 'chat' },
        plugin_version: { type: 'string', description: 'the plugin version they have, e.g. 0.2.0; the kit version when omitted' },
        mode: { type: 'string', enum: ['issue', 'comment'], default: 'issue', description: "'comment' joins an earlier issue with the same remark" },
        issue_number: { type: 'integer', description: "the earlier issue, for mode 'comment'" },
      },
    },
  },
  {
    name: 'submit_feedback',
    title: 'File the previewed feedback issue',
    description:
      "Files exactly what preview_feedback showed, as one issue in the plugin's repository (or, in mode 'comment', on the earlier issue it joins), in the signed-in person's name. Pass the preview_id and the same fields; if anything changed it files nothing and asks for a new preview. Filing the same preview twice files it once. Only after they said yes.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['preview_id', 'target', 'kind', 'words'],
      properties: {
        preview_id: { type: 'string', description: 'from preview_feedback' },
        target: { type: 'string', description: 'what the remark is about: an id from list_feedback_targets, e.g. eclipse' },
        kind: { type: 'string', enum: ['remark', 'bug', 'idea', 'question'] },
        words: { type: 'string', maxLength: 4000, description: "the colleague's remark, verbatim, never paraphrased" },
        summary: { type: 'string', maxLength: 160, description: "for the title; their first words when omitted" },
        what_should_have_happened: { type: 'string', maxLength: 4000, description: 'in their words, when they said it' },
        example: { type: 'string', maxLength: 4000, description: 'where it happened, in words; never an image' },
        links: { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'https links: a Frontify asset, a round, a page' },
        claudes_reading: { type: 'string', maxLength: 4000, description: "Claude's own reading, labelled as Claude's" },
        check: { type: 'string', description: 'the check the remark names, e.g. B3' },
        check_confirmed: { type: 'boolean', description: 'true when they confirmed that check' },
        output_id: { type: 'string', description: 'the Vesper output it is about' },
        grade_id: { type: 'string', description: 'the Vesper grade it is about' },
        surface: { type: 'string', enum: ['chat', 'cowork', 'code'], default: 'chat' },
        plugin_version: { type: 'string', description: 'the plugin version they have, e.g. 0.2.0; the kit version when omitted' },
        mode: { type: 'string', enum: ['issue', 'comment'], default: 'issue', description: "'comment' joins an earlier issue with the same remark" },
        issue_number: { type: 'integer', description: "the earlier issue, for mode 'comment'" },
      },
    },
  },
  {
    name: 'cmf_list',
    title: 'What CMF renders can be made',
    description:
      "The CMF sheet's tabs as the creative kit carries them: per tab, the SKU columns in scope (Product Name filled), the clown keys of its product (draft, named, or confirmed by Damien), and which tab, column and key have a prompt ready or refused, with the reasons. Name a tab to list every SKU column, in scope or not, with why. Needs CMF access.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { tab: { type: 'string', description: 'a tab name or its slug, e.g. "Experience 2 CC" or experience-2-cc' } },
    },
  },
  {
    name: 'cmf_prompt',
    title: "Damien's template, filled from a sheet row",
    description:
      "The prompt the plugin repository's prompt_build.py wrote for one tab, SKU column and clown key: Damien's template filled by code from the row and the key, verbatim, with the zone lines, what was left out and why, warnings (a key named but not confirmed), and the sha256s. Or prompt_build's refusal, word for word. Never rewrite it; cmf_render sends it as it is. Needs CMF access.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab', 'column', 'clown'],
      properties: {
        tab: { type: 'string', description: 'the sheet tab, e.g. "Experience 2 CC"' },
        column: { type: 'string', description: 'the SKU column letter, e.g. E' },
        clown: { type: 'string', description: 'the clown key, e.g. case-experience2--front' },
      },
    },
  },
  {
    name: 'cmf_render',
    title: 'Render a colourway on its clown',
    description:
      "Sends the payload for one tab, SKU column and clown key the way the repository's render.py sends it: the clown the only image, the prompt byte for byte (no rewrite, no lighting clause), the clown's aspect, 2K unless asked, one model call per image. Refuses before paying when the key is a draft, the template or the prompt is not the payload's, or the clown's bytes are not the ones the key was sampled from. Saved under Claude / CMF. Grade each render with grade_image next; Damien decides. Needs CMF access.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab', 'column', 'clown'],
      properties: {
        tab: { type: 'string' },
        column: { type: 'string' },
        clown: { type: 'string' },
        lane: { type: 'string', enum: ['final', 'draft'], default: 'final', description: "final: Nano Banana Pro; draft: Nano Banana 2 (the kit's CMF models)" },
        n: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        image_size: { type: 'string', enum: ['1K', '2K', '4K'], default: '2K' },
        async: { type: 'boolean', default: false, description: 'return a job id at once; collect with get_generation_status' },
      },
    },
  },
  {
    name: 'cmf_check_pdf',
    title: 'Check a CMF PDF against the sheet',
    description:
      "Every value printed on a CMF PDF against its sheet cell, per SKU, component and field, with the states and causes of the repository's spec_diff.py (match, mismatch, missing_in_pdf, empty_in_sheet, extra_in_pdf; truncated code, export date, words added, blank colour and the rest). clean is true only when every value matches: one mismatch or one empty required cell and the PDF does not go out. Name the PDF by pdf_url (on Vesper's storage) or cmf_packet_id. Runs in Vesper; engine worker runs the repository's own script on the creative worker. Needs CMF access.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab'],
      properties: {
        pdf_url: { type: 'string', description: 'the PDF, on a host Vesper may fetch' },
        cmf_packet_id: { type: 'string', description: "a Vesper CMF packet whose exported PDF to check" },
        tab: { type: 'string', description: 'the sheet tab the PDF is for' },
        columns: { type: 'array', items: { type: 'string' }, description: 'column letters (or names one column has); every SKU page found when omitted' },
        layout: { type: 'string', enum: ['vesper', 'ours'], default: 'vesper', description: "vesper: Vesper's export today; ours: a PDF made to spec-fields.md" },
        clown: { type: 'string', description: "a clown key: the legend is checked in the key's order" },
        engine: { type: 'string', enum: ['vesper', 'worker'], default: 'vesper' },
      },
    },
  },
]

export function findMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}
