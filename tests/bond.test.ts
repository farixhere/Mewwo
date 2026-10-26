import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../lib/sim/engine.ts';
import { chooseActivity } from '../lib/sim/brain.ts';
import { defaultNeeds } from '../lib/sim/needs.ts';
import { rollPersonality } from '../lib/sim/personality.ts';
import { ageDays, stageForAge } from '../lib/sim/growth.ts';
import { decisionRng, mulberry32 } from '../lib/sim/rng.ts';
import { FLAG, bondGain, describeTraits, greetPull, initiativeFactor, ownerKey, ownerProfile, pickFocusOwner, traitsOf, type OwnerBond } from '../lib/sim/bond.ts';
import { HOME_SEED } from '../lib/world/catalog.ts';
import type { CatSim, WorldObject } from '../lib/sim/types.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0); // 17:30 in Kolkata: an evening when she is lively
const BORN = T0 - 90 * 86_400_000;

const world = (): WorldObject[] => HOME_SEED.map((s, i) => ({ ...s, id: `obj-${i}-${s.type}`, state: { ...s.state } }));

function cat(id = 'cat-1', at = T0): CatSim {
  return {
    id, bornAt: BORN, personality: rollPersonality(id), preferences: {}, familiarity: {},
    needs: defaultNeeds(), activity: 'idle', targetId: null, location: 'home', x: 0, z: 0, destX: null, destZ: null,
    activitySince: at, activityUntil: at, lastSimAt: at, rngCounter: 0, stage: stageForAge(ageDays(BORN, at)),
  };
}

const owner = (id: string, over: Partial<OwnerBond> = {}): OwnerBond => ({ id, key: ownerKey(id), here: true, bond: 0.5, play: 0.5, quiet: 0.5, ...over });
const ctx = (owners: OwnerBond[]) => ({ timeZone: 'Asia/Kolkata', anyoneHere: owners.some((o) => o.here), owners });

test('six traits are stable, bounded and differ between cats', () => {
  const t = traitsOf(rollPersonality('a'), 'a');
  assert.deepEqual(Object.keys(t).sort(), ['affection', 'curiosity', 'independence', 'playfulness', 'sociability', 'vocal']);
  for (const v of Object.values(t)) assert.ok(v >= 0 && v <= 1);
  assert.deepEqual(traitsOf(rollPersonality('a'), 'a'), t);
  const affections = new Set(Array.from({ length: 20 }, (_, i) => traitsOf(rollPersonality(`c${i}`), `c${i}`).affection.toFixed(2)));
  assert.ok(affections.size > 10, 'cats should not all be equally affectionate');
  assert.ok(Array.isArray(describeTraits(t, 0.5)));
});

test('mashing a button earns no bond, and gains shrink as the bond grows', () => {
  assert.equal(bondGain(0.2, 1000), 0);
  assert.equal(bondGain(0.2, 7000), 0);
  const early = bondGain(0.1, 60_000), late = bondGain(0.9, 60_000);
  assert.ok(early > late && late > 0);
  assert.ok(bondGain(0.3, 60_000) > bondGain(0.3, 10_000), 'patience pays more than repetition');
});

test('owner styles come from how someone spends time, and both owners can bond fully', () => {
  assert.equal(ownerProfile({ play: 20, pet: 2, feed: 3 }, 0.5, 0.5).style, 'playmate');
  assert.equal(ownerProfile({ pet: 20, play: 2, feed: 3 }, 0.5, 0.5).style, 'cuddler');
  assert.equal(ownerProfile({ feed: 20, water: 10, pet: 2 }, 0.5, 0.5).style, 'caretaker');
  assert.equal(ownerProfile({ pet: 1 }, 0.5, 0.5).style, 'new');
  // The bond depends on the relationship itself, not on which owner it is: no ranking is built in.
  assert.equal(ownerProfile({ play: 20 }, 0.8, 0.5).bond, ownerProfile({ pet: 20 }, 0.8, 0.5).bond);
});

test('she can turn toward either owner; the bond only tilts the odds, and absent owners are never chosen', () => {
  const a = owner('a', { bond: 0.9 }), b = owner('b', { bond: 0.1 });
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 2000; i++) counts[pickFocusOwner([a, b], mulberry32(i))!.id as 'a' | 'b']++;
  assert.ok(counts.b > 400, `weaker bond still gets a fair chance (${counts.b})`);
  assert.ok(counts.a > counts.b, 'the stronger bond is favoured');
  assert.equal(pickFocusOwner([a, { ...b, here: false }], mulberry32(1))!.id, 'a');
  assert.equal(pickFocusOwner([{ ...a, here: false }], mulberry32(1)), null);
});

test('she waits before reaching out again, and the wait is gone after a while', () => {
  const t = T0;
  assert.equal(initiativeFactor(undefined, t), 1);
  assert.equal(initiativeFactor(t - 2 * MIN, t), 0);
  assert.ok(initiativeFactor(t - 12 * MIN, t) > 0 && initiativeFactor(t - 12 * MIN, t) < 1);
  assert.equal(initiativeFactor(t - 30 * MIN, t), 1);
});

test('a greeting pull is for one owner and fades', () => {
  const a = owner('a'), b = owner('b');
  const f = { [FLAG.greetFor]: a.key, [FLAG.greetAt]: T0 };
  assert.ok(greetPull(f, a.key, T0 + MIN) > 0.5);
  assert.equal(greetPull(f, b.key, T0 + MIN), 0);
  assert.equal(greetPull(f, a.key, T0 + 20 * MIN), 0);
  assert.equal(greetPull({}, a.key, T0), 0);
});

test('personality never overrides a basic need', () => {
  const c = cat();
  c.needs = { ...c.needs, satiety: 0.1 };
  const objs = world();
  for (const o of objs) if (o.type === 'food_bowl') o.state = { ...o.state, amount: 1 };
  const o = owner('a', { bond: 1, play: 0.9 });
  for (let i = 0; i < 40; i++) {
    const d = chooseActivity({ cat: { ...c, id: `x${i}`, personality: { ...c.personality, sociability: 1, playfulness: 1 } }, objects: objs, now: T0, hour: 18, anyoneHere: true, owners: [o], rng: decisionRng(`x${i}`, i), daylight: 1 });
    assert.equal(d.activity, 'eat');
  }
});

interface Started { activity: string; at: number; initiated: boolean }

/** Step the world the way polling does: short hops, owners present throughout. */
function run(c0: CatSim, owners: OwnerBond[], hours: number, stepMin = 2): { cat: CatSim; starts: Started[]; events: ReturnType<typeof advance>['events'] } {
  let c = c0; let objs = world(); const starts: Started[] = []; const events: ReturnType<typeof advance>['events'] = [];
  let seen = `${c.activity}|${c.activitySince}`;
  for (let t = T0 + stepMin * MIN; t <= T0 + hours * 60 * MIN; t += stepMin * MIN) {
    const r = advance(c, objs, t, ctx(owners));
    c = r.cat; objs = r.objects; events.push(...r.events);
    const k = `${c.activity}|${c.activitySince}`;
    if (k !== seen) { seen = k; starts.push({ activity: c.activity, at: c.activitySince, initiated: c.familiarity[FLAG.initAt] === c.activitySince }); }
  }
  return { cat: c, starts, events };
}

test('with company she reaches out now and then, never constantly, and never twice inside the quiet period', () => {
  let total = 0, social = 0;
  for (let i = 0; i < 8; i++) {
    const { starts } = run(cat(`friendly-${i}`), [owner('a', { bond: 0.7 }), owner('b', { bond: 0.4, here: false })], 5);
    const reach = starts.filter((s) => s.initiated && (s.activity === 'approach_person' || s.activity === 'seek_attention'));
    for (let k = 1; k < reach.length; k++) assert.ok(reach[k]!.at - reach[k - 1]!.at >= 5.9 * MIN, 'cooldown held');
    total += starts.length; social += reach.length;
  }
  assert.ok(social > 0, 'she does reach out');
  assert.ok(social / total < 0.3, `reaches out ${social} of ${total} activities, which is occasional`);
});

test('someone returning is greeted more readily, and only the person who returned', () => {
  const a = owner('a'), b = owner('b');
  let withGreet = 0, other = 0, without = 0;
  for (let i = 0; i < 120; i++) {
    const base = cat(`g-${i}`);
    base.needs = { ...base.needs, social: 0.3 };
    const objs = world();
    const pick = (c: CatSim, who: OwnerBond) => chooseActivity({ cat: c, objects: objs, now: T0, hour: 18, anyoneHere: true, owners: [who], rng: decisionRng(c.id, 3), daylight: 1 }).activity === 'approach_person';
    const greeted = { ...base, familiarity: { [FLAG.greetFor]: a.key, [FLAG.greetAt]: T0 - MIN } };
    if (pick(greeted, a)) withGreet++;
    if (pick(greeted, b)) other++;
    if (pick(base, a)) without++;
  }
  assert.ok(withGreet > without, `greeting boosts approach (${withGreet} vs ${without})`);
  assert.ok(withGreet > other, `and only for the owner who returned (${withGreet} vs ${other})`);
});

test('a milestone with an owner is attributed to them, unique per owner, and identical on replay', () => {
  const a = owner('00000000-0000-4000-8000-00000000000a', { bond: 0.8 }), b = owner('00000000-0000-4000-8000-00000000000b', { bond: 0.8 });
  const all: ReturnType<typeof run>['events'] = [];
  for (let i = 0; i < 12; i++) all.push(...run(cat(`m-${i}`), [a, b], 6).events);
  const personal = all.filter((e) => e.userId);
  assert.ok(personal.length > 0, 'some company milestones occur');
  for (const e of personal) assert.ok(e.dedupeKey.endsWith(`:${e.userId}`), 'keyed per owner so each only happens once for each of them');
  const one = run(cat('replay'), [a, b], 6), two = run(cat('replay'), [a, b], 6);
  assert.deepEqual(one.events, two.events);
  assert.deepEqual(one.cat, two.cat);
});

test('favourites and habits come from what she actually does', () => {
  const { cat: c, events } = run(cat('habits'), [owner('a', { play: 0.8 })], 48, 5);
  const habit = Object.keys(c.preferences).filter((k) => k.startsWith('habit:play:'));
  const played = Object.keys(c.preferences).some((k) => k.startsWith('toy:'));
  assert.ok(played, 'she has played');
  assert.ok(habit.length > 0, 'play times are tracked');
  const keys = events.filter((e) => e.kind === 'play_habit').map((e) => e.dedupeKey);
  assert.ok(new Set(keys).size <= 1, 'one play-habit memory, not one per occurrence');
  const none = run(cat('quiet-cat'), [owner('a')], 0.2);
  assert.equal(Object.keys(none.cat.preferences).filter((k) => k.startsWith('habit:')).length, 0, 'nothing is invented before it happens');
});

test('owner presence only shapes the present, not hours she spent alone', () => {
  const alone = advance(cat('away'), world(), T0 + 5 * 60 * MIN, { timeZone: 'Asia/Kolkata', anyoneHere: false, owners: [owner('a', { here: false })] });
  const there = advance(cat('away'), world(), T0 + 5 * 60 * MIN, ctx([owner('a')]));
  const earlyReach = (r: typeof alone) => r.events.filter((e) => e.userId).length;
  assert.equal(earlyReach(alone), 0);
  assert.ok(earlyReach(there) <= 2, 'a long replay does not invent hours of company');
});
