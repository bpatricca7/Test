# Rocket Boy

A wordless animated short (about two minutes) made entirely in code: one HTML file with no image, model or audio assets.

Pip, a boy with a homemade soda-bottle jetpack, sees a star fall out of the sky. He finds it in his front yard, and his jetpack sputters until the star sprinkles it with stardust. He flies it home over the town, past the moon and up to its constellation. The star snaps back into place, and the constellation lights up as a rocket. Then the stars slide Pip home on a ribbon of starlight just before dawn.

## Watch it

Open `index.html` in a desktop or mobile browser and press **Play the film**. It loads three.js from jsDelivr and fonts from Google Fonts, so it needs a network connection.

Controls: space to play or pause, the left and right arrows to skip 5 seconds, `m` to mute. The bar at the bottom scrubs through the film by chapter.

## How it's built

- **Models:** Pip, Twinkle, the town, trees, clouds and the moon are all three.js primitives. There are no imported meshes.
- **Animation:** every pose, facial expression and camera move is a function of time, laid out as a shot list in `story()`. Scrubbing jumps to any moment.
- **Simulation:** the scarf runs on verlet cloth, and the sparks and smoke are CPU-simulated particles.
- **Look:** filmic tone mapping, bloom, a vignette and film grain.
- **Score:** music and sound effects are synthesized live with the Web Audio API, scheduled against the film clock.
