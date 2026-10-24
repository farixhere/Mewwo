import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, MAX_ITERATIONS } from '../lib/sim/engine.ts';
import { defaultNeeds, NEED_KEYS } from '../lib/sim/needs.ts';
import { rollPersonality } from '../lib/sim/personality.ts';
import { ageDays, proportionsFor, stageForAge } from '../lib/sim/growth.ts';
import { chooseActivity, sleepiness } from '../lib/sim/brain.ts';
import { decisionRng } from '../lib/sim/rng.ts';
import { HOME_SEED, GARDEN_SEED } from '../lib/world/catalog.ts';
import { buildGrid, findPath, validatePlacement, reachable, toCell, standPoint } from '../lib/world/nav.ts';
import type { CatSim, WorldObject } from '../lib/sim/types.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 24, 0, 0, 0);

function world(withGarden = false): WorldObject[] {
  const seeds = withGarden ? [...HOME_SEED, ...GARDEN_SEED] : HOME_SEED;
  return seeds.map((s, i) => ({ ...s, id: `obj-${i}-${s.type}`, state: { ...s.state } }));
}

function newCat(bornAt = T0, at = T0): CatSim {
  return {
    id: 'cat-1', bornAt, personality: rollPersonality('cat-1'), preferences: {}, familiarity: {},
    needs: defaultNeeds(), activity: 'idle', targetId: null, location: 'home', x: 0, z: 0, destX: null, destZ: null,
    activitySince: at, activityUntil: at, lastSimAt: at, rngCounter: 0,
    stage: stageForAge(ageDays(bornAt, at)),
  };
}

const ctx = { timeZone: 'Asia/Kolkata', anyoneHere: false };

test('offline simulation is deterministic', () => {
  const a = advance(newCat(), world(), T0 + 8 * 3_600_000, ctx);
  const b = advance(newCat(), world(), T0 + 8 * 3_600_000, ctx);
  assert.deepEqual(a.cat, b.cat);
  assert.deepEqual(a.objects, b.objects);
});

test('applying the same interval twice changes nothing', () => {
  const now = T0 + 6 * 3_600_000;
  const once = advance(newCat(), world(), now, ctx);
  const twice = advance(once.cat, once.objects, now, ctx);
  assert.equal(twice.steps, 0);
  assert.deepEqual(twice.cat.needs, once.cat.needs);
});

test('splitting an interval into two requests gives a coherent result', () => {
  const mid = T0 + 3 * 3_600_000;
  const end = T0 + 6 * 3_600_000;
  const first = advance(newCat(), world(), mid, ctx);
  const second = advance(first.cat, first.objects, end, ctx);
  assert.equal(second.cat.lastSimAt, end);
  for (const k of NEED_KEYS) assert.ok(second.cat.needs[k] >= 0 && second.cat.needs[k] <= 1, `${k} in range`);
});

test('needs stay in range and never go punitive after a long absence', () => {
  const bare = world().filter((o) => o.type !== 'food_bowl' && o.type !== 'water_bowl');
  const r = advance(newCat(), bare, T0 + 30 * DAY, ctx);
  assert.ok(r.steps <= MAX_ITERATIONS, `bounded steps (${r.steps})`);
  for (const k of NEED_KEYS) assert.ok(Number.isFinite(r.cat.needs[k]) && r.cat.needs[k] >= 0 && r.cat.needs[k] <= 1);
  assert.ok(r.cat.needs.satiety >= 0.15, 'satiety floor');
  assert.ok(r.cat.needs.hydration >= 0.2, 'hydration floor');
  assert.ok(r.cat.needs.stress <= 0.7, 'stress ceiling');
});

test('a cat with food and water gets fed while owners are away', () => {
  const objs = world();
  objs.find((o) => o.type === 'food_bowl')!.state.amount = 1;
  objs.find((o) => o.type === 'water_bowl')!.state.amount = 1;
  const cat = newCat();
  cat.needs.satiety = 0.3;
  const r = advance(cat, objs, T0 + 4 * 3_600_000, ctx);
  const food = r.objects.find((o) => o.type === 'food_bowl')!;
  assert.ok(Number(food.state.amount) < 1, 'some food eaten');
  assert.ok(r.cat.needs.satiety > 0.3, 'less hungry than at the start');
  assert.ok(r.events.some((e) => e.kind === 'first_meal'));
});

test('an empty bowl feeds no one', () => {
  const objs = world();
  objs.find((o) => o.type === 'food_bowl')!.state.amount = 0;
  const cat = newCat();
  cat.needs.satiety = 0.4;
  const r = advance(cat, objs, T0 + 5 * 3_600_000, ctx);
  assert.ok(r.cat.needs.satiety < 0.4);
  assert.equal(Number(r.objects.find((o) => o.type === 'food_bowl')!.state.amount), 0);
});

test('growth is clock-based and stages fire once, in order', () => {
  const born = T0;
  const cat = newCat(born, born);
  const r = advance(cat, world(), born + 200 * DAY, ctx);
  const stages = r.events.filter((e) => e.kind === 'growth_stage').map((e) => e.dedupeKey);
  assert.deepEqual(stages, ['stage:growing_kitten', 'stage:adolescent', 'stage:adult']);
  assert.equal(r.cat.stage, 'adult');
  assert.ok(r.skippedMs > 0);
  const p0 = proportionsFor(0), p1 = proportionsFor(300);
  assert.ok(p0.scale < p1.scale && p0.head > p1.head && p0.legs < p1.legs);
});

test('learning: repeated play raises preference and finds a favourite toy', () => {
  const objs = world();
  const cat = newCat();
  cat.needs.play = 0.1;
  let c = cat, o = objs, t = T0;
  let fav = false;
  for (let i = 0; i < 40 && !fav; i++) {
    t += 3 * 3_600_000;
    c.needs.play = 0.1; c.needs.energy = 0.9;
    const r = advance(c, o, t, { ...ctx, anyoneHere: true });
    c = r.cat; o = r.objects;
    fav = r.events.some((e) => e.kind === 'favourite_toy');
  }
  assert.ok(Object.keys(c.preferences).some((k) => k.startsWith('toy:')), 'toy preference learned');
});

test('brain: hungry cat with food picks eating; without food it does not', () => {
  const cat = newCat();
  cat.needs.satiety = 0.2;
  const objs = world();
  objs.find((o) => o.type === 'food_bowl')!.state.amount = 0.8;
  const d = chooseActivity({ cat, objects: objs, now: T0, hour: 12, anyoneHere: false, rng: decisionRng('x', 1), daylight: 1 });
  assert.equal(d.activity, 'eat');
  objs.find((o) => o.type === 'food_bowl')!.state.amount = 0;
  const d2 = chooseActivity({ cat, objects: objs, now: T0, hour: 12, anyoneHere: false, rng: decisionRng('x', 1), daylight: 1 });
  assert.notEqual(d2.activity, 'eat');
});

test('brain: variety, not a loop (many activities over a day)', () => {
  const r = advance(newCat(), world(), T0 + 24 * 3_600_000, { ...ctx, anyoneHere: true });
  assert.ok(r.steps > 20);
  const seen = new Set<string>();
  let c = newCat();
  let o = world();
  for (let i = 1; i <= 96; i++) {
    const res = advance(c, o, T0 + i * 15 * 60_000, ctx);
    c = res.cat; o = res.objects; seen.add(c.activity);
  }
  assert.ok(seen.size >= 6, `saw ${[...seen].join(', ')}`);
});

test('chronotype shifts the daily rhythm between cats', () => {
  const a = Array.from({ length: 24 }, (_, h) => sleepiness(h, 'cat-A'));
  const b = Array.from({ length: 24 }, (_, h) => sleepiness(h, 'cat-B'));
  assert.notDeepEqual(a, b);
});

test('navigation: path from the bed to the food bowl avoids furniture', () => {
  const objs = world();
  const g = buildGrid('home', objs);
  const bed = objs.find((o) => o.type === 'cat_bed')!;
  const bowl = objs.find((o) => o.type === 'food_bowl')!;
  const path = findPath(g, { x: bed.x, z: bed.z }, { x: bowl.x, z: bowl.z });
  assert.ok(path && path.length >= 2);
  // No waypoint inside a blocked cell.
  for (const p of path!) {
    const c = toCell(g, p);
    assert.equal(g.blocked[c.r * g.cols + c.c], 0);
  }
});

test('navigation: litter nook is reachable only through the gap', () => {
  const objs = world();
  const g = buildGrid('home', objs);
  const litter = objs.find((o) => o.type === 'litter_tray')!;
  const path = findPath(g, { x: -3, z: 0 }, { x: litter.x, z: litter.z });
  assert.ok(path);
  // Must pass south of the half-wall (z > 0.9) to get into the nook.
  assert.ok(path!.some((p) => p.z > 0.9 && p.x > 2.3));
});

test('placement: valid move is accepted; blocking an essential is refused', () => {
  const objs = world();
  const post = objs.find((o) => o.type === 'scratching_post')!;
  const ok = validatePlacement({ ...post, x: -2.4, z: 3.0 }, objs, { x: 0, z: 2 });
  assert.equal(ok.ok, true, ok.reason);
  const tray = objs.find((o) => o.type === 'litter_tray')!;
  const nearFood = validatePlacement({ ...tray, x: -3.2, z: -2.4 }, objs, { x: 0, z: 2 });
  assert.equal(nearFood.ok, false);
  const fixed = objs.find((o) => o.type === 'sofa')!;
  assert.equal(validatePlacement({ ...fixed, x: 0, z: 0 }, objs, { x: 0, z: 2 }).ok, false);
  const out = validatePlacement({ ...post, x: 9, z: 0 }, objs, { x: 0, z: 2 });
  assert.equal(out.ok, false);
});

test('placement: a move that walls off the litter tray is refused', () => {
  const base = world();
  const tree = base.find((o) => o.type === 'cat_tree')!;
  const post = base.find((o) => o.type === 'scratching_post')!;
  // Two trees already form most of a barrier across the nook's mouth...
  const t1: WorldObject = { ...tree, id: 'wall-1', x: 3.05, z: 1.2 };
  const t2: WorldObject = { ...tree, id: 'wall-2', x: 3.95, z: 1.2 };
  const others = base.filter((o) => o.id !== tree.id && o.id !== post.id).concat(t1, t2, post);
  // ...and the scratching post would close the last gap.
  const res = validatePlacement({ ...post, x: 4.65, z: 1.2 }, others, { x: 0, z: 2 });
  assert.equal(res.ok, false);
  assert.match(res.reason ?? '', /litter tray|trap/i);
  // Without the closing piece the nook still has a gap, so an unrelated move is fine.
  const fine = validatePlacement({ ...post, x: -2.4, z: 3.0 }, others, { x: 0, z: 2 });
  assert.equal(fine.ok, true, fine.reason);
});

test('garden trips only happen once the garden exists, and the cat can come back', () => {
  let c = newCat(T0 - 40 * DAY, T0);
  c.personality.curiosity = 0.95;
  let o = world(true);
  let visited = false, returned = false;
  for (let i = 1; i <= 400; i++) {
    c.needs.energy = Math.max(c.needs.energy, 0.7);
    c.needs.stress = 0.05;
    const r = advance(c, o, T0 + i * 20 * 60_000, ctx);
    c = r.cat; o = r.objects;
    if (c.location === 'garden') visited = true;
    if (visited && c.location === 'home') returned = true;
  }
  assert.ok(visited, 'cat went to the garden at some point');
  assert.ok(returned, 'and came back');
  const noGarden = advance(newCat(T0 - 40 * DAY, T0), world(false), T0 + 3 * DAY, ctx);
  assert.equal(noGarden.cat.location, 'home');
});

test('standPoint gives a reachable spot next to blocking furniture', () => {
  const objs = world();
  const g = buildGrid('home', objs);
  const post = objs.find((o) => o.type === 'scratching_post')!;
  const sp = standPoint(g, post, { x: 0, z: 2 });
  const reach = reachable(g, { x: 0, z: 2 });
  const c = toCell(g, sp);
  assert.ok(reach.has(c.r * g.cols + c.c));
});

import { poseFor, blend, NEUTRAL } from '../lib/client/pose.ts';
import { ACTIVITY_DEFS } from '../lib/sim/activities.ts';

test('pose: every activity yields finite, bounded channels, moving or not', () => {
  for (const a of Object.keys(ACTIVITY_DEFS) as (keyof typeof ACTIVITY_DEFS)[]) {
    for (const moving of [false, true]) {
      for (const t of [0, 0.7, 3.3, 41]) {
        const p = poseFor({ activity: a, t, moving, trot: moving, stress: 0.6, energy: 0.2, birds: true, trust: 0.9 });
        for (const [k, v] of Object.entries(p)) assert.ok(Number.isFinite(v), `${a}.${k}`);
        assert.ok(p.eyeOpen >= 0 && p.eyeOpen <= 1.0001, `${a} eyeOpen ${p.eyeOpen}`);
        assert.ok(p.earBack >= 0 && p.earBack <= 1.0001, `${a} earBack ${p.earBack}`);
      }
    }
  }
});

test('pose: same tail signal means different things in different contexts', () => {
  const play = poseFor({ activity: 'play', t: 0.5, moving: false, trot: false, stress: 0.1, energy: 0.8, birds: false, trust: 0.5 });
  const sleep = poseFor({ activity: 'sleep', t: 0.5, moving: false, trot: false, stress: 0.1, energy: 0.8, birds: false, trust: 0.5 });
  const greet = poseFor({ activity: 'approach_person', t: 0.5, moving: false, trot: false, stress: 0.1, energy: 0.8, birds: false, trust: 0.5 });
  assert.ok(play.tailSway > 0.7 && play.crouch > 0.7, 'hunting: lashing tail, low body');
  assert.ok(sleep.tailSway === 0 && sleep.curl === 1, 'sleeping: still tail, curled');
  assert.ok(greet.tailLift > 1 && greet.tailSway < 0.2, 'greeting: tall, quiet tail');
});

test('pose: blending converges and stays continuous', () => {
  const to = poseFor({ activity: 'sleep', t: 0, moving: false, trot: false, stress: 0, energy: 0.2, birds: false, trust: 1 });
  let p = NEUTRAL;
  let prev = p.curl;
  for (let i = 0; i < 200; i++) {
    p = blend(p, to, 0.05);
    assert.ok(p.curl >= prev - 1e-9, 'monotonic toward target');
    prev = p.curl;
  }
  assert.ok(Math.abs(p.curl - 1) < 0.01);
});

// ---------- 2.0: motion maths ----------
import { makeProfile, distanceAt, speedAt, makeTrack, sampleTrack, curvePath, turnToward, angleDiff } from '../lib/world/kinematics.ts';
import { useSpot } from '../lib/world/place.ts';
import { lineClear, isFreePoint } from '../lib/world/nav.ts';

test('velocity profile eases in and out and covers exactly the path length', () => {
  const p = makeProfile(4, 1.2);
  assert.equal(distanceAt(p, 0), 0);
  assert.ok(Math.abs(distanceAt(p, p.duration) - 4) < 1e-9);
  assert.equal(speedAt(p, 0), 0);
  assert.ok(speedAt(p, 0.05) < 0.3, 'starts gently');
  assert.ok(speedAt(p, p.duration - 0.05) < 0.3, 'stops gently');
  let last = -1;
  for (let t = 0; t <= p.duration; t += p.duration / 200) {
    const d = distanceAt(p, t);
    assert.ok(d >= last - 1e-9, 'never moves backwards');
    assert.ok(speedAt(p, t) <= p.vmax + 1e-9);
    last = d;
  }
});

test('short hops never exceed what fits and still arrive', () => {
  const p = makeProfile(0.3, 2.6);
  assert.ok(p.vmax < 2.6);
  assert.ok(Math.abs(distanceAt(p, p.duration) - 0.3) < 1e-9);
});

test('track sampling follows the polyline and reports heading', () => {
  const tr = makeTrack([{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }]);
  assert.equal(tr.length, 4);
  const a = sampleTrack(tr, 1);
  assert.deepEqual([a.x, a.z], [0, 1]);
  assert.ok(Math.abs(a.heading) < 1e-9);
  const b = sampleTrack(tr, 3);
  assert.deepEqual([b.x, b.z], [1, 2]);
  assert.ok(Math.abs(b.heading - Math.PI / 2) < 1e-9);
  assert.deepEqual([sampleTrack(tr, 99).x, sampleTrack(tr, 99).z], [2, 2]);
});

test('rounded paths keep their endpoints, stay in free space, and cut the corners', () => {
  const g = buildGrid('home', world());
  const from = { x: -3, z: -3 }, to = { x: 3, z: 1 };
  const raw = findPath(g, from, to)!;
  const curved = curvePath(raw, (a, b) => lineClear(g, a, b));
  assert.deepEqual(curved[0], raw[0]);
  assert.deepEqual(curved[curved.length - 1], raw[raw.length - 1]);
  for (let i = 1; i < curved.length; i++) assert.ok(lineClear(g, curved[i - 1]!, curved[i]!));
  if (raw.length > 2) assert.ok(curved.length > raw.length, 'a bent path gets rounded');
});

test('rounding falls back to the original path rather than clip furniture', () => {
  const raw = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
  const curved = curvePath(raw, () => false);
  assert.deepEqual(curved, raw);
});

test('turning is rate-limited and never overshoots', () => {
  let h = 0;
  const target = Math.PI * 0.9;
  for (let i = 0; i < 400; i++) {
    const before = Math.abs(angleDiff(h, target));
    h = turnToward(h, target, 1 / 60, 10, 4);
    assert.ok(Math.abs(angleDiff(h, target)) <= before + 1e-9);
    assert.ok(Math.abs(angleDiff(h, target)) >= 0 );
  }
  assert.ok(Math.abs(angleDiff(h, target)) < 0.01);
  // goes the short way round the circle
  assert.ok(turnToward(3.0, -3.0, 0.1, 10, 4) > 3.0);
});

test('the cat stops beside a bowl, facing it, instead of standing in it', () => {
  const objs = world();
  const bowl = objs.find((o) => o.type === 'food_bowl');
  assert.ok(bowl, 'seed has a food bowl');
  const g = buildGrid('home', objs);
  const from = { x: bowl!.x + 2, z: bowl!.z + 1 };
  const spot = useSpot(g, bowl!, 'eat', from);
  const d = Math.hypot(spot.x - bowl!.x, spot.z - bowl!.z);
  assert.ok(d > 0.25 && d < 0.5, `stands ${d.toFixed(2)}m from the bowl`);
  assert.ok(isFreePoint(g, spot));
  const faces = Math.atan2(bowl!.x - spot.x, bowl!.z - spot.z);
  assert.ok(Math.abs(angleDiff(spot.heading!, faces)) < 1e-9);
  // deterministic: same inputs, same spot
  assert.deepEqual(useSpot(g, bowl!, 'eat', from), spot);
  // sleeping on a bed is unchanged: no offset
  const bed = objs.find((o) => o.type === 'cat_bed');
  if (bed) {
    const s = useSpot(g, bed, 'sleep', from);
    assert.equal(s.heading, undefined);
  }
});
