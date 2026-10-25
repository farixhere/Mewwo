export type GrowthStage = 'young_kitten' | 'growing_kitten' | 'adolescent' | 'adult';

export type Activity =
  | 'idle' | 'wander' | 'look_around' | 'sniff' | 'investigate' | 'eat' | 'drink'
  | 'groom' | 'scratch' | 'stretch' | 'rest' | 'sleep' | 'play' | 'watch_bird'
  | 'hide' | 'approach_person' | 'rub' | 'seek_attention' | 'retreat' | 'litter'
  | 'explore' | 'return_home';

/** All needs are 0..1. For every need except `stress`, 1 means fully satisfied. */
export interface Needs {
  satiety: number;
  hydration: number;
  energy: number;
  comfort: number;
  play: number;
  curiosity: number;
  social: number;
  stress: number;
  grooming: number;
  elimination: number;
}

export interface Personality {
  curiosity: number;
  playfulness: number;
  sociability: number;
  cautiousness: number;
  independence: number;
  activity: number;
}

export interface WorldObject {
  id: string;
  type: string;
  location: string;
  x: number;
  z: number;
  rotation: number;
  movable: boolean;
  state: Record<string, number | string | boolean>;
}

export interface CatSim {
  id: string;
  bornAt: number;
  personality: Personality;
  preferences: Record<string, number>;
  familiarity: Record<string, number>;
  needs: Needs;
  activity: Activity;
  targetId: string | null;
  location: string;
  /** Where the cat is standing (position it settled at after its last activity). */
  x: number;
  z: number;
  /** Where the cat is heading for its current activity when it has no object target (wandering, being called). */
  destX: number | null;
  destZ: number | null;
  activitySince: number;
  activityUntil: number;
  lastSimAt: number;
  rngCounter: number;
  stage: GrowthStage;
  /** Previous activity, used for natural sequencing (eat -> groom, wake -> stretch). Not persisted. */
  prevActivity?: Activity;
}

export type SimEventKind =
  | 'first_meal' | 'first_play' | 'favourite_toy' | 'new_sleep_spot'
  | 'growth_stage' | 'first_drink' | 'garden_unlocked'
  | 'first_greeting' | 'first_rub' | 'first_invite' | 'close_bond' | 'favourite_window' | 'favourite_scratcher' | 'play_habit' | 'first_garden_visit';

export interface SimEvent {
  kind: SimEventKind;
  /** Stable key: the same milestone never creates two memories. */
  dedupeKey: string;
  title: string;
  body?: string;
  objectId?: string;
  /** The owner this milestone is about, when it is about one of them. */
  userId?: string;
  at: number;
}

export interface Presence {
  /** True if at least one household member has been active in the last few minutes. */
  anyoneHere: boolean;
}
