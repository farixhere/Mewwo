import type { CatSim, Needs, Personality, WorldObject } from '../sim/types';
import type { GrowthStage, Activity } from '../sim/types';
import type { schema } from './db';

type CatRow = typeof schema.cats.$inferSelect;
type StateRow = typeof schema.catState.$inferSelect;
type PersRow = typeof schema.catPersonality.$inferSelect;
type ObjRow = typeof schema.placedObjects.$inferSelect;

export function toCatSim(cat: CatRow, s: StateRow, p: PersRow): CatSim {
  const needs: Needs = {
    satiety: s.satiety, hydration: s.hydration, energy: s.energy, comfort: s.comfort, play: s.play,
    curiosity: s.curiosityDrive, social: s.social, stress: s.stress, grooming: s.grooming, elimination: s.elimination,
  };
  const personality: Personality = {
    curiosity: p.curiosity, playfulness: p.playfulness, sociability: p.sociability,
    cautiousness: p.cautiousness, independence: p.independence, activity: p.activity,
  };
  return {
    id: cat.id,
    bornAt: cat.bornAt.getTime(),
    personality,
    preferences: { ...p.preferences },
    familiarity: { ...s.familiarity },
    needs,
    activity: s.activity as Activity,
    targetId: s.activityTarget,
    location: s.locationId,
    x: s.posX, z: s.posZ, destX: s.destX, destZ: s.destZ,
    activitySince: s.activitySince.getTime(),
    activityUntil: s.activityUntil.getTime(),
    lastSimAt: s.lastSimAt.getTime(),
    rngCounter: s.rngCounter,
    stage: s.growthStage as GrowthStage,
  };
}

export function toWorldObject(o: ObjRow): WorldObject {
  return {
    id: o.id, type: o.objectType, location: o.locationId, x: o.x, z: o.z,
    rotation: o.rotation, movable: o.movable, state: { ...o.state },
  };
}

export function stateColumns(c: CatSim) {
  return {
    satiety: c.needs.satiety, hydration: c.needs.hydration, energy: c.needs.energy, comfort: c.needs.comfort,
    play: c.needs.play, curiosityDrive: c.needs.curiosity, social: c.needs.social, stress: c.needs.stress,
    grooming: c.needs.grooming, elimination: c.needs.elimination,
    activity: c.activity, activityTarget: c.targetId,
    activitySince: new Date(c.activitySince), activityUntil: new Date(c.activityUntil),
    rngCounter: c.rngCounter, locationId: c.location, posX: c.x, posZ: c.z, destX: c.destX, destZ: c.destZ,
    growthStage: c.stage, familiarity: c.familiarity, lastSimAt: new Date(c.lastSimAt),
    updatedAt: new Date(),
  };
}
