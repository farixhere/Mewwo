import type { WorldObject } from '../sim/types.ts';

export type Tag =
  | 'food' | 'water' | 'rest' | 'hide' | 'scratch' | 'toy' | 'litter'
  | 'window' | 'door' | 'curio' | 'bird';

export interface ObjectDef {
  type: string;
  label: string;
  /** Footprint on the floor (world units). */
  w: number;
  d: number;
  /** Blocks the cat's path. Rugs, toys and bowls don't. */
  blocks: boolean;
  movable: boolean;
  tags: Tag[];
  /** Height the cat sits at when using the top of this object (jumps up). */
  elevated?: number;
  /** Must stay reachable from the rest of the room after any move. */
  essential?: boolean;
  /** 0..1 how nice it is as a resting spot. */
  restQuality?: number;
  /** Where the door leads. */
  leadsTo?: string;
  /** Player-facing blurb shown in the object menu. */
  blurb: string;
}

export const OBJECT_DEFS: Record<string, ObjectDef> = {
  food_bowl: { type: 'food_bowl', label: 'Food bowl', w: 0.5, d: 0.5, blocks: false, movable: true, tags: ['food'], essential: true, blurb: 'Fresh kibble keeps her going.' },
  water_bowl: { type: 'water_bowl', label: 'Water bowl', w: 0.5, d: 0.5, blocks: false, movable: true, tags: ['water'], essential: true, blurb: 'Cool, fresh water.' },
  cat_bed: { type: 'cat_bed', label: 'Cat bed', w: 0.9, d: 0.9, blocks: false, movable: true, tags: ['rest'], restQuality: 0.95, essential: true, blurb: 'A soft, round place to curl up.' },
  cushion: { type: 'cushion', label: 'Sunny cushion', w: 0.7, d: 0.7, blocks: false, movable: true, tags: ['rest'], restQuality: 0.75, blurb: 'Warm if the sun finds it.' },
  litter_tray: { type: 'litter_tray', label: 'Litter tray', w: 0.8, d: 0.6, blocks: false, movable: true, tags: ['litter'], essential: true, blurb: 'Kept in a quiet corner, away from food.' },
  scratching_post: { type: 'scratching_post', label: 'Scratching post', w: 0.5, d: 0.5, blocks: true, movable: true, tags: ['scratch'], essential: true, blurb: 'For stretching claws, not sofas.' },
  cat_tree: { type: 'cat_tree', label: 'Cat tree', w: 0.9, d: 0.9, blocks: true, movable: true, tags: ['rest', 'scratch', 'curio'], elevated: 1.5, restQuality: 0.85, blurb: 'A tall perch with a view.' },
  window_perch: { type: 'window_perch', label: 'Window perch', w: 0.9, d: 0.5, blocks: true, movable: false, tags: ['rest', 'window', 'bird'], elevated: 0.75, restQuality: 0.8, blurb: 'Best seat for bird TV.' },
  sofa: { type: 'sofa', label: 'Sofa', w: 3.0, d: 1.2, blocks: true, movable: false, tags: ['rest', 'curio'], elevated: 0.5, restQuality: 0.7, blurb: 'Humans sit here. Cats do too.' },
  coffee_table: { type: 'coffee_table', label: 'Coffee table', w: 1.5, d: 0.9, blocks: true, movable: true, tags: ['curio'], blurb: 'A good place to knock things off.' },
  cardboard_box: { type: 'cardboard_box', label: 'Cardboard box', w: 0.8, d: 0.8, blocks: false, movable: true, tags: ['hide', 'rest'], restQuality: 0.6, blurb: 'If it fits, it sits.' },
  plant: { type: 'plant', label: 'Plant', w: 0.6, d: 0.6, blocks: true, movable: true, tags: ['curio'], blurb: 'Interesting. Possibly edible. (Cat-safe.)' },
  toy_mouse: { type: 'toy_mouse', label: 'Toy mouse', w: 0.25, d: 0.25, blocks: false, movable: true, tags: ['toy'], blurb: 'Small, squeaky, and doomed.' },
  toy_ball: { type: 'toy_ball', label: 'Jingle ball', w: 0.25, d: 0.25, blocks: false, movable: true, tags: ['toy'], blurb: 'Rolls everywhere.' },
  garden_door: { type: 'garden_door', label: 'Garden door', w: 0.4, d: 1.1, blocks: false, movable: false, tags: ['door'], leadsTo: 'garden', blurb: 'Leads to the garden.' },
  home_door: { type: 'home_door', label: 'Back door', w: 1.1, d: 0.4, blocks: false, movable: false, tags: ['door'], leadsTo: 'home', blurb: 'Back inside.' },
  bush: { type: 'bush', label: 'Bush', w: 1.4, d: 1.1, blocks: true, movable: false, tags: ['hide', 'curio'], blurb: 'Rustling. Suspicious.' },
  bird_feeder: { type: 'bird_feeder', label: 'Bird feeder', w: 0.5, d: 0.5, blocks: true, movable: false, tags: ['bird', 'curio'], blurb: 'Birds visit. The cat is aware.' },
  grass_patch: { type: 'grass_patch', label: 'Sunny grass', w: 1.6, d: 1.6, blocks: false, movable: false, tags: ['rest'], restQuality: 0.8, blurb: 'Warm, soft, and smells of outdoors.' },
};

export function defOf(type: string): ObjectDef {
  const d = OBJECT_DEFS[type];
  if (!d) throw new Error(`Unknown object type: ${type}`);
  return d;
}

export function hasTag(o: Pick<WorldObject, 'type'>, tag: Tag): boolean {
  return OBJECT_DEFS[o.type]?.tags.includes(tag) ?? false;
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface LocationDef {
  id: string;
  label: string;
  bounds: Rect;
  /** Fixed walls the cat can't cross. */
  walls: Rect[];
  /** Placement is only allowed inside this area (defaults to bounds). */
  unlock: { stage?: 'growing_kitten' | 'adolescent' | 'adult' } | null;
}

export const LOCATIONS: Record<string, LocationDef> = {
  home: {
    id: 'home',
    label: 'Home',
    bounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
    // A half-wall makes a quiet nook on the right for the litter tray.
    walls: [{ minX: 2.42, maxX: 2.58, minZ: -4, maxZ: 0.9 }],
    unlock: null,
  },
  garden: {
    id: 'garden',
    label: 'Garden',
    bounds: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
    walls: [],
    unlock: { stage: 'growing_kitten' },
  },
};

/** The litter tray lives in the nook; keep it away from food and water. */
export const NOOK: Rect = { minX: 2.58, maxX: 5, minZ: -4, maxZ: 0.9 };

export const WALL_PROXIMITY_PADDING = 0.1;

/** Objects every household starts with. Positions are in the home's coordinate system. */
export const HOME_SEED: Omit<WorldObject, 'id'>[] = [
  { type: 'food_bowl', location: 'home', x: -3.8, z: -2.9, rotation: 0, movable: true, state: { amount: 0.6 } },
  { type: 'water_bowl', location: 'home', x: -3.0, z: -3.3, rotation: 0, movable: true, state: { amount: 0.8 } },
  { type: 'cat_bed', location: 'home', x: -3.4, z: 2.4, rotation: 0.3, movable: true, state: {} },
  { type: 'cushion', location: 'home', x: -0.8, z: -2.2, rotation: 0.1, movable: true, state: {} },
  { type: 'sofa', location: 'home', x: 0.9, z: -3.3, rotation: 0, movable: false, state: {} },
  { type: 'window_perch', location: 'home', x: -1.7, z: -3.6, rotation: 0, movable: false, state: {} },
  { type: 'coffee_table', location: 'home', x: 0.2, z: 0.4, rotation: 0, movable: true, state: {} },
  { type: 'cat_tree', location: 'home', x: 1.7, z: 3.1, rotation: 0, movable: true, state: {} },
  { type: 'scratching_post', location: 'home', x: -0.6, z: 3.3, rotation: 0, movable: true, state: {} },
  { type: 'cardboard_box', location: 'home', x: 3.5, z: 2.9, rotation: 0.4, movable: true, state: {} },
  { type: 'litter_tray', location: 'home', x: 4.0, z: -2.8, rotation: 0, movable: true, state: {} },
  { type: 'plant', location: 'home', x: -4.4, z: 0.1, rotation: 0, movable: true, state: {} },
  { type: 'toy_mouse', location: 'home', x: -1.2, z: 1.6, rotation: 0.8, movable: true, state: {} },
  { type: 'toy_ball', location: 'home', x: 1.6, z: 1.7, rotation: 0, movable: true, state: {} },
  { type: 'garden_door', location: 'home', x: -4.8, z: 1.3, rotation: 0, movable: false, state: {} },
];

export const GARDEN_SEED: Omit<WorldObject, 'id'>[] = [
  { type: 'home_door', location: 'garden', x: 0, z: 2.8, rotation: 0, movable: false, state: {} },
  { type: 'bush', location: 'garden', x: -2.8, z: -1.6, rotation: 0, movable: false, state: {} },
  { type: 'bird_feeder', location: 'garden', x: 2.6, z: -1.8, rotation: 0, movable: false, state: {} },
  { type: 'grass_patch', location: 'garden', x: 1.2, z: 0.8, rotation: 0, movable: false, state: {} },
];

export const STARTING_INVENTORY: Record<string, number> = { kibble: 12, treat: 3 };
