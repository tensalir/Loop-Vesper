/**
 * The version of the prompting skill a headless result ran on, returned with
 * every enhance and iterate response so Damien (or any downstream tool) can
 * tell which version of the prompting craft produced an output.
 *
 * It is built from the source that actually ran (`skillVersionFromSource` in
 * `./prompting-source.ts`). The old `getSkillVersion` hashed the bundled file
 * directly; iterate ran on that file and reported it while enhance ran on the
 * kit. Both run on the kit now, and the helper is gone.
 */

export interface SkillVersion {
  skillId: string
  /** Short content-hash used for cache-busting and audit. */
  hash: string
  /** The kit's version, the override's update time, or the bundled file's mtime. */
  lastModified: string
  /** Which source the text came from: kit, db (admin override), bundled or fallback. */
  source?: string
}
