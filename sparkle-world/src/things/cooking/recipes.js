// Recipes: what you put in the bowl (in order), how it cooks, and what comes out.
// Pantry basics (flour, milk, eggs, sugar...) are always there; garden crops come from
// profile.basket (the garden's harvest).

import { FOOD, INGREDIENTS } from '../food-models.js';

export const METHODS = {
  bake: { name: 'Bake', verb: 'Bake!', icon: 'oven', doing: 'Baking…', station: 'oven' },
  fry: { name: 'Cook', verb: 'Cook!', icon: 'pot', doing: 'Sizzle sizzle…', station: 'stove' },
  boil: { name: 'Cook', verb: 'Cook!', icon: 'pot', doing: 'Bubble bubble…', station: 'stove' },
  freeze: { name: 'Freeze', verb: 'Freeze!', icon: 'fridge', doing: 'Brrr… freezing!', station: 'fridge' },
  blend: { name: 'Blend', verb: 'Blend!', icon: 'blender', doing: 'Whirrr!', station: 'counter' },
  mix: { name: 'Mix', verb: 'Toss!', icon: 'bowl', doing: 'Toss toss!', station: 'counter' },
};

export const RECIPES = [
  { key: 'cupcake', food: 'cupcake', makes: 2, method: 'bake', steps: ['flour', 'sugar', 'egg', 'milk', 'sprinkles'] },
  { key: 'cookies', food: 'cookies', makes: 3, method: 'bake', steps: ['flour', 'butter', 'sugar', 'chocolate'] },
  { key: 'pizza', food: 'pizza', makes: 1, method: 'bake', steps: ['flour', 'water', 'tomato', 'cheese'] },
  { key: 'pancakes', food: 'pancakes', makes: 1, method: 'fry', steps: ['flour', 'milk', 'egg', 'honey'] },
  { key: 'ice_cream', food: 'ice_cream', makes: 1, method: 'freeze', steps: ['milk', 'cream', 'sugar', 'sprinkles'] },
  { key: 'fruit_salad', food: 'fruit_salad', makes: 1, method: 'mix', steps: ['strawberry', 'blueberry', 'banana', 'honey'] },
  { key: 'birthday_cake', food: 'birthday_cake', makes: 1, method: 'bake', steps: ['flour', 'sugar', 'egg', 'butter', 'sprinkles'] },
  { key: 'smoothie', food: 'smoothie', makes: 1, method: 'blend', steps: ['banana', 'blueberry', 'yogurt', 'ice'] },
  { key: 'carrot_soup', food: 'carrot_soup', makes: 1, method: 'boil', steps: ['carrot', 'carrot', 'water', 'cream'] },
  { key: 'strawberry_pie', food: 'strawberry_pie', makes: 1, method: 'bake', steps: ['flour', 'butter', 'sugar', 'strawberry', 'strawberry'] },
  { key: 'pumpkin_pie', food: 'pumpkin_pie', makes: 1, method: 'bake', steps: ['flour', 'butter', 'pumpkin', 'cinnamon'] },
  { key: 'watermelon_popsicle', food: 'watermelon_popsicle', makes: 2, method: 'freeze', steps: ['watermelon', 'honey', 'water'] },
];

for (const r of RECIPES) {
  r.name = FOOD[r.food].name;
  r.station = METHODS[r.method].station;
}

/** Garden crops a recipe needs: { cropKey: count }. */
export function gardenNeeds(recipe) {
  const out = {};
  for (const s of recipe.steps) {
    if (FOOD[s] && FOOD[s].kind === 'crop') out[s] = (out[s] || 0) + 1;
  }
  return out;
}

export function ingredientColor(key) {
  return (INGREDIENTS[key] || FOOD[key] || { color: '#FFFFFF' }).color;
}

export function ingredientName(key) {
  return (INGREDIENTS[key] || FOOD[key] || { name: key }).name;
}

export const PANTRY = Object.keys(INGREDIENTS);
