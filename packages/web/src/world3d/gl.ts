import * as THREE from "three";

/** What the 3D views say when the browser will not draw in 3D, instead of taking the page down. */
export const NO_3D =
  "This browser can't draw the 3D town (WebGL is off or unavailable here). The rest of the game still runs. Open this page in Chrome, Safari or Firefox to see the world.";

/**
 * A WebGL renderer, or undefined when the browser refuses one (WebGL disabled, no GPU, too many
 * contexts). three throws in that case, and an uncaught throw in an effect blanks the whole app.
 */
export function makeRenderer(opts: THREE.WebGLRendererParameters): THREE.WebGLRenderer | undefined {
  try {
    return new THREE.WebGLRenderer(opts);
  } catch (e) {
    console.warn("Psyche: no WebGL context, the 3D view is off.", e);
    return undefined;
  }
}
