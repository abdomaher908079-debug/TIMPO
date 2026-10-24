-- Invite rewards only once the first episode really got its clips. The reward used to fire when the episode
-- row was made (reserve_pick), which is before the AI runs: an episode the AI then failed on was removed
-- again (release_pick) but both people had already been given their hours. The pick's own log row
-- (ai_calls, written only after the AI answered) is the signal instead. If that log line is ever missed,
-- the reward simply waits for the next successful pick.
drop trigger reward_invite on public.episodes;
create trigger reward_invite after insert on public.ai_calls
  for each row when (new.kind = 'pick' and new.user_id is not null)
  execute function public.reward_invite();
