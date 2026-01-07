/**
 * Semantic analysis module for outputs
 * - Gemini captioning for images/videos
 * - Claude parsing for structured extraction
 */

export { captionImage, captionVideo, captionOutput, type CaptionResult } from './gemini'
export { parseCaption, type ParsedAnalysis, type ParseResult } from './claude'

