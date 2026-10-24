// What people keep, for learning which picks work (clip_feedback in the database; the owner page shows it): each
// exported clip and each 👍/👎, with the clip's AI score and place in the list. Never blocks or fails anything.
import { clipSeconds, type Clip } from './clips';
import { supabase } from './supabase';

export type FeedbackKind = 'exported' | 'liked' | 'disliked';

/** Notes `kind` for `clip`, the `rank`-th clip of its episode (0 = first). Fire and forget. */
export function recordFeedback(kind: FeedbackKind, clip: Clip, rank: number) {
  if (!supabase) return;
  void supabase
    .from('clip_feedback')
    .insert({
      kind,
      score: clip.score,
      rank: Math.min(100, rank),
      seconds: Math.min(600, Math.round(clipSeconds(clip) * 10) / 10),
      layout: clip.layout,
      joined: !!clip.skips?.length,
    })
    .then(({ error }) => error && console.warn('Feedback not saved', error.message));
}
