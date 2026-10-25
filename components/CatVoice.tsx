'use client';
import { useEffect, useRef } from 'react';
import { useGame } from '@/lib/client/store';
import { audio } from '@/lib/client/audio';
import { planMotion, type MotionInput } from '@/lib/client/motion';
import { CAPTIONS, decideReaction, type Reaction } from '@/lib/sim/voice';
import type { Personality, Needs, Activity } from '@/lib/sim/types';

/**
 * The cat's communication controller (client side). It owns no state of its own: it watches the authoritative
 * cat state and turns it into a sound, a short caption and a posture, exactly once per event.
 *
 *  - Reactions to something an owner did (call, pet, treat, play) arrive in the state itself, decided on the
 *    server, so both owners get the identical reaction. They are de-duplicated by timestamp.
 *  - Reactions to what the cat is doing (a new activity, arriving after a call) are derived from the saved state
 *    with a seeded generator, so both clients derive the same thing, and each client plays it once.
 *
 * Renders nothing.
 */
const FRESH_MS = 6000;

const pitchFor = (ageDays: number) => (ageDays < 14 ? 1.35 : ageDays < 60 ? 1.2 : ageDays < 180 ? 1.08 : 1);

export function CatVoice() {
  const seenReaction = useRef<number | null>(null);
  const seenActivity = useRef<string | null>(null);
  const lastDirectAt = useRef(0);
  const arrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fire = (rx: Reaction & { x?: number; z?: number }, at: number) => {
      const st = useGame.getState();
      const v = st.view;
      if (!v) return;
      const delay = rx.gaze !== 'none' ? 220 : 60; // glance first, then speak
      if (rx.sound !== 'none') {
        setTimeout(() => {
          audio.vocalize(rx.sound, { intensity: rx.intensity, priority: rx.priority, pitch: pitchFor(v.cat.ageDays), seed: at % 100003 });
        }, delay);
      }
      if (rx.caption > 0 && st.sound.captions && st.sound.master) setTimeout(() => useGame.getState().showCaption(CAPTIONS[rx.caption]!), delay);
      if (rx.body !== 'none' || rx.gaze !== 'none') {
        st.setVoiceFx({ id: at, body: rx.body, gaze: rx.gaze, x: rx.x ?? 0, z: rx.z ?? 0, startedAt: st.now(), dur: rx.body === 'recoil' ? 2.4 : 2, intensity: rx.intensity || 0.5 });
      }
    };

    const check = () => {
      const st = useGame.getState();
      const v = st.view;
      if (!v) return;
      const now = st.now();
      const c = v.cat;

      // 1. Reactions to what an owner just did (decided on the server).
      const rx = c.reaction;
      if (rx && rx.at !== seenReaction.current) {
        const first = seenReaction.current === null;
        seenReaction.current = rx.at;
        if (now - rx.at < FRESH_MS || (first && now - rx.at < FRESH_MS)) {
          lastDirectAt.current = now;
          fire(rx, rx.at);
        }
      }

      // 2. Reactions to what the cat itself has just started doing.
      const key = `${c.activity}|${c.activitySince}`;
      if (key !== seenActivity.current) {
        const first = seenActivity.current === null;
        seenActivity.current = key;
        if (arrivalTimer.current) { clearTimeout(arrivalTimer.current); arrivalTimer.current = null; }
        const age = now - c.activitySince;
        const base = {
          catId: c.id, personality: c.personality as unknown as Personality, needs: toNeeds(c.needs), activity: c.activity as Activity, familiarity: v.relationships.find((r) => r.userId === v.me.id)?.familiarity ?? 0.3,
        };
        if (age < FRESH_MS && !(first && age > 3000)) {
          // The server already voiced a call that brought her over; do not greet twice.
          const covered = c.activity === 'approach_person' && now - lastDirectAt.current < 3000;
          if (!covered) {
            const r = decideReaction({ ...base, kind: 'activity', salt: c.activitySince });
            if (r.sound !== 'none' || r.body !== 'none' || r.gaze !== 'none') fire(r, c.activitySince);
          }
        }
        // Arrival greeting: when a called cat reaches the person, once.
        if (c.activity === 'approach_person' && c.targetId === null && c.destX !== null) {
          const input: MotionInput = {
            location: c.location, activity: 'approach_person', targetId: null, x: c.x, z: c.z, destX: c.destX, destZ: c.destZ,
            activitySince: c.activitySince, activityUntil: c.activityUntil,
          };
          const plan = planMotion(input, v.objects, 0.85 * c.proportions.speed);
          const wait = c.activitySince + plan.arriveAfter * 1000 - now;
          if (wait > -500 && wait < 65_000 && plan.arriveAfter > 0.8) {
            const since = c.activitySince;
            arrivalTimer.current = setTimeout(() => {
              const cur = useGame.getState().view;
              if (!cur || cur.cat.activitySince !== since) return;
              const r = decideReaction({ ...base, kind: 'call_arrived', salt: since, distance: 0.5 });
              fire({ ...r, x: input.destX ?? 0, z: input.destZ ?? 0 }, since + 1);
            }, Math.max(0, wait));
          }
        }
      }
    };

    check();
    const unsub = useGame.subscribe(check);
    return () => { unsub(); if (arrivalTimer.current) clearTimeout(arrivalTimer.current); };
  }, []);

  return null;
}

/** The view rounds and renames needs for display; the voice rules want the simulation's names. */
function toNeeds(n: { food: number; water: number; energy: number; comfort: number; play: number; social: number; calm: number; clean: number; litter: number }): Needs {
  return {
    satiety: n.food, hydration: n.water, energy: n.energy, comfort: n.comfort, play: n.play, social: n.social,
    stress: 1 - n.calm, grooming: n.clean, elimination: n.litter, curiosity: 0.5,
  } as Needs;
}
