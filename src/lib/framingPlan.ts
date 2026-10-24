// Auto framing's decisions, from what was seen in a clip (see framing.ts for the looking). Plain logic,
// no browser APIs. Framed the way an editor would: one person at a time, a still camera that only
// reframes when someone really moves away, and clean cuts on camera cuts and when the speaker changes.
// The whole clip is known before deciding, so cuts land when things happen, never after.
import type { FramingTrack, Layout } from './clips';

export interface Framing {
  layout: Layout;
  cropX: number;
  track?: FramingTrack;
}

export interface Face {
  // Horizontal position and width, as shares (0..1) of the picture's width.
  left: number;
  right: number;
  // How open the mouth is (0..1), when the face was close enough to read; null otherwise.
  mouth: number | null;
}

export interface Look {
  t: number;
  faces: Face[];
  // A tiny grayscale copy of the frame, to spot camera cuts. Absent: no cut detection.
  sig?: Uint8Array;
  // When this look starts a new shot: the exact time of the camera cut before it, when known.
  cutAt?: number;
}

// A camera cut: the picture changes this much on average (0..255) from one look to the next.
export const CUT = 32;
// A face in two looks is the same person if its center moved less than this share of the width.
const SAME_PERSON = 0.09;
// Someone on screen for at least this share of a shot counts as a person in it (not a passer-by).
const PRESENT = 0.3;
// Speaker changes: the new speaker must lead for this long, and a speaker is held at least this long.
const LEAD_SECONDS = 0.7;
const HOLD_SECONDS = 1.6;
// Moments of mouth movement are compared over this window, so a single word doesn't cause a cut.
const ACTIVITY_SECONDS = 1.2;
// Less mouth movement than this (jaw opening change per look, averaged) is nobody talking: small
// readings wobble even on a still face.
const TALKING = 0.03;
// The camera stays still until the subject has been this far off center (share of the crop) this long.
const DRIFT = 0.28;
const DRIFT_SECONDS = 0.6;
// Faces within this share of the crop's width can be framed together.
const GROUP_FITS = 0.85;

/** The crop position (0..100) that centers `center` (0..1 of the width) in a crop `crop` wide. */
export const cropFor = (center: number, crop: number) =>
  crop >= 1 ? 50 : (Math.max(0, Math.min(1 - crop, center - crop / 2)) / (1 - crop)) * 100;

const centerOf = (f: Face) => (f.left + f.right) / 2;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function difference(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/** Splits the looks into shots at camera cuts. */
export function shots(looks: Look[]): Look[][] {
  const out: Look[][] = [];
  let current: Look[] = [];
  for (let i = 0; i < looks.length; i++) {
    const prev = looks[i - 1];
    const look = looks[i]!;
    if (prev?.sig && look.sig && difference(prev.sig, look.sig) > CUT && current.length) {
      out.push(current);
      current = [];
    }
    current.push(look);
  }
  if (current.length) out.push(current);
  return out;
}

interface Person {
  // One entry per look of the shot: the face, or null when not seen.
  faces: (Face | null)[];
  seen: number;
}

/** Follows each face from look to look within a shot (nearest face of a similar size). */
export function people(shot: Look[]): Person[] {
  const all: Person[] = [];
  shot.forEach((look, i) => {
    const free = new Set(all);
    for (const face of [...look.faces].sort((a, b) => b.right - b.left - (a.right - a.left))) {
      let best: Person | null = null;
      let bestDistance = SAME_PERSON;
      for (const p of free) {
        // The last place this person was seen.
        let last: Face | null = null;
        for (let k = i - 1; k >= 0 && !last; k--) last = p.faces[k] ?? null;
        if (!last) continue;
        const size = (face.right - face.left) / (last.right - last.left);
        const distance = Math.abs(centerOf(face) - centerOf(last));
        if (size > 0.55 && size < 1.8 && distance < bestDistance) {
          best = p;
          bestDistance = distance;
        }
      }
      if (!best) {
        best = { faces: Array(shot.length).fill(null), seen: 0 };
        all.push(best);
      }
      free.delete(best);
      best.faces[i] = face;
      best.seen++;
    }
  });
  return all.filter((p) => p.seen >= Math.max(2, shot.length * PRESENT)).sort((a, b) => b.seen - a.seen);
}

/** How much each person's mouth moves around each look (talking), averaged over a short window. */
function activity(shot: Look[], crowd: Person[]): number[][] {
  const raw = crowd.map((p) =>
    p.faces.map((f, i) => {
      const prev = p.faces[i - 1];
      // Talking moves the jaw: change in opening counts, a mouth held open (a smile) doesn't.
      return f?.mouth != null && prev?.mouth != null ? Math.abs(f.mouth - prev.mouth) : 0;
    }),
  );
  return raw.map((values) =>
    values.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < values.length; k++) {
        if (Math.abs(shot[k]!.t - shot[i]!.t) <= ACTIVITY_SECONDS / 2) {
          sum += values[k]!;
          n++;
        }
      }
      return n ? sum / n : 0;
    }),
  );
}

/** Who to show at each look of a shot: the person talking, held steady, changing with hysteresis. */
function speakers(shot: Look[], crowd: Person[]): number[] {
  const hasMouths = crowd.some((p) => p.faces.some((f) => f?.mouth != null));
  // No way to tell who talks: the person seen most (usually the closest, the main guest).
  if (!hasMouths) return shot.map(() => 0);
  const act = activity(shot, crowd);
  // Whoever talks most at look i, or -1 when nobody clearly talks.
  const leader = (i: number) => {
    const best = act.reduce((b, a, p) => (a[i]! > act[b]![i]! ? p : b), 0);
    return act[best]![i]! >= TALKING ? best : -1;
  };
  const who: number[] = [];
  // Until someone talks, the person seen most (crowd is sorted by that).
  let current = Math.max(0, leader(0));
  let since = shot[0]!.t;
  let challenger = -1;
  let challengerSince = 0;
  for (let i = 0; i < shot.length; i++) {
    const t = shot[i]!.t;
    const lead = leader(i);
    // Leading clearly, not by a hair; and only someone who is on screen right now.
    const clearly = lead >= 0 && lead !== current && act[lead]![i]! > act[current]![i]! * 1.3 && crowd[lead]!.faces[i];
    if (clearly) {
      if (challenger !== lead) {
        challenger = lead;
        challengerSince = t;
      }
      if (t - challengerSince >= LEAD_SECONDS && t - since >= HOLD_SECONDS) {
        // Cut to them from when they started leading, so the cut lands as they start talking.
        const from = shot.findIndex((l) => l.t >= challengerSince);
        for (let k = from; k < i; k++) who[k] = lead;
        current = lead;
        since = challengerSince;
        challenger = -1;
      }
    } else challenger = -1;
    who[i] = current;
  }
  return who;
}

interface Segment {
  t: number;
  center: number;
}

/**
 * A still camera on `subject` (the framed face or group's center at each look, null when unseen) from
 * look `from` to `to`: it aims at where the subject usually is, and reframes only when they have been
 * well off center for a while, cutting at the moment they started moving.
 */
function holdSteady(shot: Look[], subject: (number | null)[], from: number, to: number, crop: number): Segment[] {
  const out: Segment[] = [];
  let begin = from;
  while (begin < to) {
    const seen: number[] = [];
    let awaySince = -1;
    let next = to;
    for (let i = begin; i < to; i++) {
      const c = subject[i];
      if (c == null) continue;
      if (seen.length >= 3 && Math.abs(c - median(seen)) > DRIFT * crop) {
        if (awaySince < 0) awaySince = i;
        if (shot[i]!.t - shot[awaySince]!.t >= DRIFT_SECONDS) {
          next = awaySince;
          break;
        }
      } else {
        awaySince = -1;
        seen.push(c);
      }
    }
    out.push({ t: shot[begin]!.t, center: seen.length ? median(seen) : (out[out.length - 1]?.center ?? 0.5) });
    begin = next;
  }
  return out;
}

/**
 * Frames one clip from its looks. `crop` is the 9:16 crop's width as a share of the picture's width;
 * `start` and `end` are the clip's times. Keys are hard cuts (see cropAt in clips.ts).
 */
export function plan(looks: Look[], crop: number, start: number, end: number): Framing {
  const withFaces = looks.filter((l) => l.faces.length).length;
  // Mostly no faces (slides, screens, B-roll): a crop would likely cut off what matters.
  if (!looks.length || withFaces < looks.length * 0.5) return { layout: 'fit', cropX: 50 };

  const keys: FramingTrack = [];
  let previous: Look | null = null;
  for (const shot of shots(looks)) {
    // A camera cut happened between the last look of the previous shot and the first of this one.
    if (previous) shot[0] = { ...shot[0]!, t: shot[0]!.cutAt ?? (previous.t + shot[0]!.t) / 2 };
    previous = shot[shot.length - 1]!;
    const crowd = people(shot);
    const subject: (number | null)[] = shot.map(() => null);
    if (crowd.length) {
      // Everyone fits in one crop: frame them together. Otherwise, the person talking.
      const lefts = crowd.map((p) => median(p.faces.filter((f): f is Face => !!f).map((f) => f.left)));
      const rights = crowd.map((p) => median(p.faces.filter((f): f is Face => !!f).map((f) => f.right)));
      const together = Math.max(...rights) - Math.min(...lefts) <= crop * GROUP_FITS;
      const who = together ? null : speakers(shot, crowd);
      shot.forEach((_, i) => {
        if (together) {
          const here = crowd.map((p) => p.faces[i]).filter((f): f is Face => !!f);
          subject[i] = here.length ? (Math.min(...here.map((f) => f.left)) + Math.max(...here.map((f) => f.right))) / 2 : null;
        } else {
          const f = crowd[who![i]!]!.faces[i];
          subject[i] = f ? centerOf(f) : null;
        }
      });
      // Each run of the same speaker is framed on its own.
      let from = 0;
      for (let i = 1; i <= shot.length; i++) {
        if (i < shot.length && (together || who![i] === who![from])) continue;
        for (const seg of holdSteady(shot, subject, from, i, crop)) keys.push({ t: seg.t, x: cropFor(seg.center, crop) });
        from = i;
      }
    } else {
      // Nobody in this shot: keep the last framing (or the middle).
      keys.push({ t: shot[0]!.t, x: keys[keys.length - 1]?.x ?? 50 });
    }
  }

  // Cuts land at the clip's start and when shots change; tiny moves aren't worth a cut.
  const track: FramingTrack = [];
  for (const k of keys) {
    const x = Math.round(k.x);
    const last = track[track.length - 1];
    if (last && Math.abs(last.x - x) < 4) continue;
    track.push({ t: track.length ? k.t : start, x });
  }
  // Without following (Free), the crop stays where it is most of the time.
  const time = new Map<number, number>();
  track.forEach((k, i) => {
    const x = Math.round(k.x / 5) * 5;
    time.set(x, (time.get(x) ?? 0) + ((track[i + 1]?.t ?? end) - k.t));
  });
  const main = [...time.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const steady = track.reduce((best, k) => (Math.abs(k.x - main) < Math.abs(best.x - main) ? k : best), track[0]!).x;
  return { layout: 'fill', cropX: steady, track: track.length > 1 ? track : undefined };
}
