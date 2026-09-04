/**
 * The fixed simulation step, and nothing else.
 *
 * It lives in a file of its own rather than in `loop.ts` because `loop.ts`
 * touches `requestAnimationFrame` and is therefore DOM-typed, and the tools
 * tsconfig has no DOM lib. `src/content` needs the step to turn a world-tick
 * stamp into seconds (`thrustPhase`), and `tools/draw-world.ts` imports the
 * same content — so importing the loop to get one number broke the headless
 * typecheck. One number, one owner, no lib.
 *
 * CLAUDE.md, non-negotiable: the simulation always advances in whole 1/60s
 * steps and is never tied to frame time.
 */
export const STEP = 1 / 60
