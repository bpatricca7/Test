// What friends say: short, kind lines that react to what is around (her outfit, pets, the
// time of day, the weather, food, the world type, furniture nearby) plus each friend's own
// lines. pickLine(game, friend, kind) never repeats one of the friend's last few lines.

import { HAIR_STYLES } from '../../player/wardrobe-data.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const LINES = {
  greet: ['Hi {name}!', 'Yay, you\'re here!', 'Hiya, {name}!', 'Hello, bestie!', 'Oh hi! I missed you!', 'Hey {name}! Let\'s play!', 'There you are, {name}!'],
  general: [
    'Want to build something together?', 'You\'re the best friend ever!', 'I love this world!', 'Let\'s have a dance party!',
    'Did you see the butterflies?', 'I\'m so happy today!', 'Let\'s be best friends forever!', 'You\'re really good at building!',
    'Can we have a sleepover?', 'I love sparkles! Do you?', 'Rainbows make me smile!', 'Let\'s go on an adventure!',
    'High five! Yay!', 'I just learned a new dance!', 'Do you like my outfit?', 'Pink or purple? I love both!',
    'Let\'s plant some flowers!', 'I wish I could fly like a bird!', 'Guess what? You\'re awesome!', 'Let\'s make cupcakes!',
    'Hee hee! This is so fun!', 'This is the best day ever!', 'I love your ideas!', 'Can I help you build?',
    'You make everything sparkly!', 'Let\'s have a picnic!', 'Tell me a joke! Hee hee!', 'Friends make everything better!',
    'Let\'s build a castle up to the clouds!', 'Your smile is so sunny!',
  ],
  follow: ['Yay! Let\'s go!', 'Right behind you!', 'Adventure time!', 'Where are we going? I love surprises!', 'Wait for me! Hee hee!'],
  stay: ['Okay! I\'ll wait right here!', 'See you soon!', 'I\'ll stay here. Come back!', 'I\'ll guard this spot!'],
  home: ['Bye bye! See you later!', 'I\'ll be at my spot!', 'That was fun! Bye!'],
  dance: ['Dance party!', 'Woo hoo! Dance with me!', 'Let\'s dance!', 'You\'re a great dancer!', 'Spin, spin, spin!', 'Shake it! Wiggle wiggle!'],
  wave: ['Hi hi hi!', 'Hello there!', 'Waving back at you!'],
  heart: ['I love you too, bestie!', 'Heart hands! Aww!', 'You\'re so sweet!'],
  twirl: ['Twirly twirl!', 'Round and round we go!'],
  cartwheel: ['Whoa! Cartwheel!', 'I can do that too! Wheee!'],
  jump: ['Jump for joy! Yay!', 'Boing boing!'],
  sit: ['Let\'s sit and rest a bit.', 'Ahh, so comfy!'],
  treat: ['Yummy! Thank you!', 'Mmm, my favorite!', 'This is so tasty!', 'You\'re so sweet! Thank you!', 'Nom nom nom! Yum!', 'Sharing is caring! Thank you!'],
  seat: ['This is so comfy!', 'Ahh, a cozy seat!', 'I could sit here all day!'],
  bed: ['Good night! Sweet dreams!', 'Nighty night!', 'Time for bed. Yawn!'],
  morning: ['Good morning, sunshine!', 'What should we do today?', 'I had the best dream!', 'Rise and shine!'],
  arrive: ['Hi! I\'m {friend}! Let\'s be friends!', 'Yay! Thanks for inviting me!', 'Wow, what a pretty world!', 'Hello! I love it here!'],
  style: ['I love it! Thank you!', 'I feel so fancy!', 'Do I look pretty?', 'This is my new favorite!', 'So stylish! Twirl!'],
  twins: ['We\'re twins! Matchy matchy!', 'Best friends in matching outfits!'],
  hair: ['New hair! I love it!', 'Ooh, so pretty!', 'My hair looks amazing!'],
  tickle: ['Hee hee! That tickles!', 'Stop, stop! Hee hee!', 'Ticklish! Ha ha!'],
  seatTaken: ['Oh! Your turn! Sit here!', 'Here, you can have my seat!'],
  night: ['Look at all the stars!', 'The moon is so bright tonight.', 'I\'m getting sleepy...', 'Let\'s have a sleepover!', 'The fireflies are glowing!'],
  rain: ['Let\'s jump in the puddles!', 'I love the sound of rain.', 'Pitter patter, raindrops!'],
  snow: ['Let\'s build a snowman!', 'Snowflakes are so pretty!', 'Brrr! Snowy!'],
  rainbow: ['A rainbow! Make a wish!', 'Look at the rainbow! So pretty!'],
  swim: ['Splash! The water is great!', 'I\'m swimming! Look!'],
  biome: {
    candy: ['Everything here looks yummy!', 'Can I lick the lollipop trees?'],
    snow: ['Brrr! Good thing I have you!', 'Let\'s go ice skating!'],
    beach: ['Let\'s go swimming!', 'I can hear the waves!'],
    fairy: ['I think I saw a fairy!', 'The mushrooms are glowing!'],
    meadow: ['So many flowers!', 'This meadow smells like flowers!'],
    flat: ['Let\'s build a whole town!'],
    mix: ['This world has everything!'],
  },
  pet: ['{pet} is so cute!', 'Can I pet {pet}?', 'Aww, look at {pet}!', 'Hi {pet}! You\'re so fluffy!', '{pet} is the best pet ever!'],
  petSpecies: {
    turtle: ['Your turtle is so slow and sweet!', 'Look at that pretty shell!'],
    horse: ['Can we ride your horse together?', 'Your horse is so beautiful!'],
    unicorn: ['A real unicorn! Wow!', 'Your unicorn is magical!'],
    pony: ['Your pony is so cute!', 'Can I brush your pony\'s mane?'],
    puppy: ['Who\'s a good puppy? You are!', 'Puppy kisses! Hee hee!'],
    kitty: ['Here, kitty kitty!', 'Your kitty is purring!'],
    bunny: ['Hop hop, little bunny!', 'Bunny ears! So cute!'],
    duckling: ['Quack quack! Hee hee!', 'Tiny duckling! So cute!'],
    panda: ['A panda! So fluffy!', 'Pandas love bamboo!'],
  },
  food: ['Something smells yummy!', 'Can we have a snack?', 'I love sweet treats!'],
  places: {
    piano: ['Can you play me a song?', 'I love the piano!'],
    trampoline: ['Let\'s bounce on the trampoline!', 'Boing boing boing!'],
    bed: ['Your room is so cozy!', 'I love your bed! So fluffy!'],
    tv: ['Let\'s watch a show!'],
    swing: ['Push me on the swing!', 'Let\'s swing up high!'],
    pool: ['Pool party!'],
    easel: ['Let\'s paint a picture!'],
    candy_shop: ['Candy shop! My favorite!', 'I want a rainbow lollipop!'],
    ice_cream_parlor: ['Ice cream! Can we get some?', 'Sprinkles on top, please!'],
    ice_cream_truck: ['I hear the ice cream truck!'],
    campfire: ['Let\'s roast marshmallows!', 'The campfire is so cozy!'],
    tent: ['Camping is so much fun!'],
    zipline_tower: ['The zip line looks so fun!', 'Wheee! Let\'s zip!'],
    hammock: ['A hammock! So relaxing!'],
  },
  events: {
    'shop:buy': ['Ooh, what did you get?', 'Yum! Can I have a taste?', 'Good choice!'],
    'zipline:ride': ['Wheee! You\'re so brave!', 'You zoomed so fast!'],
    'camp:marshmallow': ['Marshmallows are the best!', 'Gooey and yummy!'],
    'photo:taken': ['Say cheese!', 'Can I see the picture?'],
    'sticker:earned': ['You got a sticker! Yay!', 'A new sticker! You\'re amazing!'],
    'pet:adopt': ['A new pet! It\'s so cute!', 'What a sweet little friend!'],
    'cook:done': ['You\'re a great chef!', 'That looks delicious!'],
    'garden:harvest': ['Look what you grew!', 'Yummy veggies!'],
    'prefab:place': ['Wow! A whole house!', 'That\'s so magical!'],
  },
  outfit: {
    head: {
      tiara: 'I love your tiara!', crown: 'Your crown is so royal!', flower_crown: 'Your flower crown is so pretty!',
      cat_ears: 'Meow! Cute cat ears!', bunny_ears: 'Bunny ears! Hop hop!', unicorn_horn: 'A unicorn horn! So magical!',
      sun_hat: 'Cute sun hat!', beanie: 'Your beanie looks so cozy!', witch_hat: 'Your sparkly hat is so cool!',
      halo: 'Your halo is shining!', bow: 'I love your bow!', headband: 'Cute headband!',
    },
    face: {
      glasses: 'Your glasses look so smart!', sunglasses: 'Cool sunglasses!', heart_glasses: 'Heart glasses! I love them!',
      star_glasses: 'Star glasses! You\'re a star!',
    },
    back: {
      fairy_wings: 'Your wings are so sparkly!', butterfly_wings: 'Butterfly wings! So pretty!', angel_wings: 'You look like an angel!',
      cape: 'Cool cape, superhero!', backpack: 'Cute backpack!',
    },
    neck: { pearls: 'Your pearls are so fancy!', scarf: 'Cozy scarf!', necklace: 'Pretty necklace!', bowtie: 'A bow tie! So cute!' },
    hand: {
      wand: 'Can your wand do magic?', balloon: 'I love your balloon!', teddy: 'Your teddy is so cuddly!',
      ice_cream: 'Mmm, your ice cream looks yummy!', purse: 'Cute purse!',
    },
    dress: {
      ballgown: 'Your ball gown is beautiful!', mermaid: 'You look like a real mermaid!', princess: 'You look like a princess!',
      party: 'Party dress! Let\'s party!', sundress: 'Cute sundress!', overall_dress: 'I love your overall dress!',
    },
    shoes: { roller_skates: 'Roller skates! Let\'s skate together!', sparkle: 'Your sparkly shoes are so shiny!', rainboots: 'Cute rain boots!' },
  },
};

const HAIR_NAMES = Object.fromEntries(HAIR_STYLES.map((h) => [h.key, h.name.toLowerCase()]));

function fill(line, game, friend, extra = {}) {
  const look = game.profile && game.profile.look;
  const name = (look && look.name) || game.profile.playerName || 'friend';
  return line.replace(/\{name\}/g, name).replace(/\{friend\}/g, friend ? friend.name : '').replace(/\{pet\}/g, extra.pet || 'your pet');
}

/** Compliments about her outfit (a list, maybe empty). */
function outfitLines(game) {
  const look = game.profile && game.profile.look;
  if (!look) return [];
  const O = LINES.outfit, a = look.acc || {};
  const out = [];
  if (O.head[a.head]) out.push(O.head[a.head]);
  if (O.face[a.face]) out.push(O.face[a.face]);
  if (O.back[a.back]) out.push(O.back[a.back]);
  if (O.neck[a.neck]) out.push(O.neck[a.neck]);
  if (O.hand[a.hand]) out.push(O.hand[a.hand]);
  if (look.dress && O.dress[look.dress.type]) out.push(O.dress[look.dress.type]);
  if (look.shoes && O.shoes[look.shoes.type]) out.push(O.shoes[look.shoes.type]);
  if (look.hair) {
    if (look.hair.color2 === 'rainbow') out.push('Rainbow hair! Wow!');
    const hn = HAIR_NAMES[look.hair.style];
    if (hn) out.push(`Your ${hn} hair is so pretty!`);
  }
  if (look.top && look.top.pattern === 'hearts' && !look.dress) out.push('I love the hearts on your top!');
  return out;
}

/** Everything that fits right now (weighted by pushing some lists twice). */
function contextLines(game, friend) {
  const out = [];
  const g = game;
  const add = (list, n = 1) => { for (let i = 0; i < n; i++) out.push(...list); };
  // her outfit (the favourite thing to talk about)
  add(outfitLines(g), 2);
  // pets nearby
  if (g.pets && g.pets.pets.length && friend) {
    const p = friend.pos;
    const pet = g.pets.nearest(p.x, p.y, p.z, 7);
    if (pet) {
      add(LINES.pet.map((l) => fill(l, g, friend, { pet: pet.name })));
      const sp = LINES.petSpecies[pet.species];
      if (sp) add(sp);
    }
  }
  // time and weather
  const d = g.time ? g.time.dayTime : 0.5;
  if (d < 0.23 || d > 0.8) add(LINES.night, 2);
  else if (d < 0.36) add(LINES.morning);
  const w = g.weather && g.weather.current;
  if (w === 'rain') add(LINES.rain, 2);
  else if (w === 'snow') add(LINES.snow, 2);
  else if (w === 'rainbow') add(LINES.rainbow, 2);
  // the world type
  const biome = g.world && g.world.meta && g.world.meta.biome;
  if (biome && LINES.biome[biome]) add(LINES.biome[biome]);
  // food in the basket
  const basket = g.profile && g.profile.basket;
  if (basket && Object.keys(basket).length) add(LINES.food);
  // furniture nearby
  if (friend && g.entities) {
    const near = friend.nearbyKeys();
    for (const k of near) {
      const base = k.startsWith('bed_') ? 'bed' : k === 'pool_float' ? 'pool' : k;
      if (LINES.places[base]) add(LINES.places[base]);
    }
  }
  // her own lines
  if (friend && friend.def) add(friend.def.lines, 2);
  return out;
}

/**
 * A line for a friend to say. kind: 'chat' (anything that fits, the default), or a key of
 * LINES ('greet', 'follow', 'dance', 'treat'...), or 'event:<name>'.
 */
export function pickLine(game, friend, kind = 'chat', extra = {}) {
  let pool;
  if (kind === 'chat') {
    const ctx = contextLines(game, friend);
    pool = ctx.length && Math.random() < 0.75 ? ctx : [...ctx, ...LINES.general];
  } else if (kind.startsWith('event:')) {
    pool = LINES.events[kind.slice(6)] || LINES.general;
  } else {
    pool = LINES[kind] || LINES.general;
  }
  const recent = friend ? friend.recent : [];
  let line = pick(pool);
  for (let i = 0; i < 6 && recent.includes(line) && pool.length > 1; i++) line = pick(pool);
  if (friend) {
    recent.push(line);
    if (recent.length > 8) recent.shift();
  }
  return fill(line, game, friend, extra);
}

/** How many different lines friends can say (for the probe). */
export function lineCount() {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) n += v.length;
    else if (typeof v === 'string') n += 1;
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(LINES);
  return n;
}
