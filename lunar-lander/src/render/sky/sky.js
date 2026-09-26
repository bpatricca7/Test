// Sky: stars, Milky Way, Sun, Earth and the reflection environment.
// Contract (ARCHITECTURE.md §6): createSky(ctx) -> { update(frame) }
//
// Everything in the sky is drawn FIRST (large negative renderOrder, opaque list, no depth test / no
// depth write) at proxy distances inside the far plane; terrain, spacecraft and cabins then simply
// overwrite it, so the Moon and the vessels occlude stars, Sun and Earth exactly, at no depth cost.
// Radiances are in the scene's linear units (SUN.intensity); post.js does exposure/tone mapping.
//
// Owned by the SKY-FX agent.

import { createStars } from './stars.js';
import { createMilkyWay } from './milkyWay.js';
import { createSun } from './sun.js';
import { createEarth } from './earth.js';
import { createEnvironment } from './environment.js';
import { createSkyTextures } from './skyTextures.js';

/**
 * Create the sky and add it to ctx.scene.
 * @param {object} ctx RenderContext (see renderer.js)
 * @returns {{update(frame): void, stars: object, earth: object, sun: object, environment: object, textures: object}}
 */
export function createSky(ctx) {
  const low = ctx.quality === 'low';
  const textures = createSkyTextures({ earthW: low ? 512 : 1024, earthH: low ? 256 : 512, mwW: low ? 512 : 1024, mwH: low ? 256 : 512 });
  const stars = createStars(ctx);
  const milky = createMilkyWay(ctx, textures.milkyWay);
  const sun = createSun(ctx);
  const earth = createEarth(ctx, textures);
  const environment = createEnvironment(ctx);
  ctx.scene.add(milky.object, stars.object, sun.object, earth.group);

  // a new scenario / vessel can teleport the camera: rebuild the environment immediately
  ctx.game.events.on('scenario', () => environment.force());
  ctx.game.events.on('vessel', () => environment.force());

  return {
    stars,
    earth,
    sun,
    environment,
    textures,
    update(frame) {
      textures.tick();
      stars.update(frame);
      sun.update(frame);
      earth.update(frame);
      environment.update(frame);
    },
  };
}
