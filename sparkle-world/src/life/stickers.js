// Stickers (achievements): the sticker registry (game.registry.stickers), progress counters in
// profile.stats and game.stickers.award(id). Awarding shows a big toast and emits
// 'sticker:earned'. The Environment & Stickers team adds sticker art and the Sticker Book.

const STICKERS = [
  ['first_block', 'First Block', 'Place your very first block', 'star'],
  ['builder', 'Super Builder', 'Place 100 blocks', 'build'],
  ['home_sweet_home', 'Home Sweet Home', 'Put a bed and a door in the same world', 'home'],
  ['sweet_dreams', 'Sweet Dreams', 'Sleep in a bed', 'moon'],
  ['best_friends', 'Best Friends', 'Adopt a pet', 'heart'],
  ['pet_lover', 'Pet Lover', 'Pet your pets 10 times', 'heart'],
  ['little_chef', 'Little Chef', 'Cook something yummy', 'star'],
  ['master_chef', 'Master Chef', 'Cook every recipe', 'star'],
  ['green_thumb', 'Green Thumb', 'Harvest a plant', 'star'],
  ['fashionista', 'Fashionista', 'Change your outfit 5 times', 'dress'],
  ['gem_hunter', 'Gem Hunter', 'Find 10 gems', 'gem'],
  ['gem_master', 'Gem Master', 'Find all the gems in a world', 'gem'],
  ['rainbow_maker', 'Rainbow Maker', 'Place all 7 rainbow colors', 'star'],
  ['night_owl', 'Night Owl', 'See the stars at night', 'moon'],
  ['musician', 'Musician', 'Play 20 piano notes', 'music'],
  ['photographer', 'Photographer', 'Take a photo', 'photo'],
  ['unicorn_rider', 'Unicorn Rider', 'Ride a unicorn', 'star'],
  ['magic_builder', 'Magic Builder', 'Place a Magic House', 'home'],
  ['world_maker', 'World Maker', 'Create 3 worlds', 'star'],
  ['splash', 'Splash!', 'Go swimming', 'star'],
  ['sky_high', 'Sky High', 'Fly above the clouds', 'fly'],
];

export function install(game) {
  const reg = game.registry.stickers;
  for (const [id, name, hint, icon] of STICKERS) {
    if (!reg.has(id)) reg.set(id, { id, name, hint, icon });
  }

  const stats = () => game.profile.stats;
  const bump = (key, by = 1) => {
    const s = stats();
    s[key] = (s[key] || 0) + by;
    return s[key];
  };

  game.stickers = {
    has: (id) => !!game.profile.stickers[id],
    /** Give a sticker once. Returns true when it is new. */
    award(id) {
      const def = reg.get(id);
      if (!def || game.profile.stickers[id]) return false;
      game.profile.stickers[id] = new Date().toISOString();
      game.saveProfile();
      const bang = /[!?.]$/.test(def.name) ? '' : '!'; // 'Splash!' should not become 'Splash!!'
      game.toast(`New sticker: ${def.name}${bang}`, { icon: def.icon || 'sticker', big: true, color: 'sun' });
      game.audio.play('success');
      if (game.player) {
        const p = game.player.position;
        game.celebrate([p.x, p.y + 2, p.z], 'confetti', { quiet: true });
      }
      game.events.emit('sticker:earned', { sticker: def });
      return true;
    },
    count: () => Object.keys(game.profile.stickers).length,
  };

  const ev = game.events;
  ev.on('block:place', ({ key }) => {
    const n = bump('blocksPlaced');
    if (n >= 1) game.award('first_block');
    if (n >= 100) game.award('builder');
    const rainbow = ['wool_red', 'wool_orange', 'wool_yellow', 'wool_lime', 'wool_sky', 'wool_blue', 'wool_purple'];
    if (rainbow.includes(key)) {
      const s = stats();
      s.rainbow = s.rainbow || {};
      s.rainbow[key] = 1;
      if (rainbow.every((k) => s.rainbow[k])) game.award('rainbow_maker');
    }
  });
  ev.on('world:created', () => {
    if ((stats().worldsCreated || 0) >= 3) game.award('world_maker');
  });
  ev.on('player:sleep', () => bump('sleeps'));
  ev.on('player:swim', () => game.award('splash'));
  ev.on('time:night', () => { if (game.mode === 'play') game.award('night_owl'); });
  ev.on('pet:adopt', () => game.award('best_friends'));
  ev.on('pet:pet', () => { if (bump('petsPetted') >= 10) game.award('pet_lover'); });
  ev.on('pet:ride', ({ pet }) => { if (pet && (pet.species === 'unicorn' || pet.kind === 'unicorn')) game.award('unicorn_rider'); });
  ev.on('cook:done', ({ recipe }) => {
    const s = stats();
    s.recipesCooked = s.recipesCooked || {};
    const key = recipe && (recipe.key || recipe);
    if (key) s.recipesCooked[key] = (s.recipesCooked[key] || 0) + 1;
    game.award('little_chef');
    const all = [...game.registry.recipes.keys()];
    if (all.length && all.every((k) => s.recipesCooked[k])) game.award('master_chef');
  });
  ev.on('garden:harvest', () => game.award('green_thumb'));
  ev.on('outfit:changed', () => { if (bump('outfitChanges') >= 5) game.award('fashionista'); });
  ev.on('gem:collect', ({ total }) => {
    const n = bump('gems');
    if (n >= 10) game.award('gem_hunter');
    if (total && game.world && game.world.gemTotal && total >= game.world.gemTotal) game.award('gem_master');
  });
  ev.on('piano:note', () => { if (bump('notesPlayed') >= 20) game.award('musician'); });
  ev.on('photo:taken', () => game.award('photographer'));
  ev.on('prefab:place', () => game.award('magic_builder'));
  ev.on('entity:place', ({ entity }) => {
    if (!game.entities) return;
    const keys = new Set(game.entities.all().map((e) => e.key));
    const hasBed = [...keys].some((k) => k.startsWith('bed_'));
    const hasDoor = [...keys].some((k) => k.startsWith('door'));
    if (entity && hasBed && hasDoor) game.award('home_sweet_home');
  });

  // flying above the cloud layer
  let check = 0;
  game.addSystem({
    name: 'stickers',
    update(dt) {
      check -= dt;
      if (check > 0 || !game.player || !game.world) return;
      check = 1;
      if (game.player.flying && game.player.position.y > game.world.sy + 9) game.award('sky_high');
    },
  });
}
