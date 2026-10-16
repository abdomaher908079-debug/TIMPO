import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { setExtraSeats } from '../lib/billing';
import { invite, joinTeam, listTeam, removeMember, MAX_EXTRA_SEATS, SEAT_PRICE, TEAM_SIZE, type TeamMember } from '../lib/team';

// Studio teams on the Account page: the owner invites up to 2 people, who share the plan's hours,
// brand kits and Best AI. Invited people join from here too.
export default function Team() {
  const { user, demo } = useAuth();
  const { plan, profile, workspace, refresh } = useAccount();
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(() => {
    listTeam().then(setRows, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
      // Joining or leaving changes your plan and hours.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (demo) {
    return (
      <section className="card account-card" aria-labelledby="team-title">
        <h2 id="team-title" className="account-section-title">Team</h2>
        <p className="muted">Studio teams need real accounts, so they aren't available in demo mode.</p>
      </section>
    );
  }
  if (!user || !rows) return null;

  const myEmail = user.email.toLowerCase();
  const membership = rows.find((r) => r.user_id === user.id);
  const invitesToMe = rows.filter((r) => r.status === 'invited' && r.email === myEmail && r.owner_id !== user.id);
  const myTeam = rows.filter((r) => r.owner_id === user.id);
  const isOwner = plan.id === 'studio' && !workspace?.is_team_member;
  const extraSeats = profile?.extra_seats ?? 0;
  const teamSize = TEAM_SIZE + extraSeats;
  const yearly = profile?.billing === 'yearly';
  const seatPrice = yearly ? `$${SEAT_PRICE.yearly} a year` : `$${SEAT_PRICE.monthly} a month`;

  function changeSeats(n: number) {
    const adding = n > extraSeats;
    const ok = window.confirm(
      adding
        ? `Add a seat for ${seatPrice}? You'll be charged now for the rest of this billing period, then with your plan.`
        : `Remove a seat? You'll get credit for the rest of this billing period.`,
    );
    if (ok) void act(() => setExtraSeats(n));
  }

  return (
    <section className="card account-card" id="team" aria-labelledby="team-title">
      <h2 id="team-title" className="account-section-title">Team</h2>
      {error && <p className="error">{error}</p>}

      {invitesToMe.map((r) => (
        <div key={r.id} className="notice team-invite">
          <p>
            <b>{r.owner_email ?? 'A Studio owner'}</b> invited you to their Studio team. You'll share their plan's hours, brand kits and
            Best AI{plan.id !== 'free' && !workspace?.is_team_member ? ', instead of your own plan while you’re in the team' : ''}.
          </p>
          <div className="team-buttons">
            <button type="button" className="btn btn-primary btn-inline" disabled={busy || !!membership} onClick={() => void act(() => joinTeam(r.id))}>
              Join team
            </button>
            <button type="button" className="btn btn-outline btn-inline" disabled={busy} onClick={() => void act(() => removeMember(r.id))}>
              Decline
            </button>
          </div>
        </div>
      ))}

      {membership ? (
        <>
          <p>
            You're on <b>{membership.owner_email ?? 'a'}</b>'s Studio team.
            {workspace?.is_team_member
              ? ' You share its hours, brand kits and Best AI.'
              : ' Their Studio plan isn’t active right now, so you’re on your own plan.'}
          </p>
          <button
            type="button"
            className="btn btn-outline btn-inline"
            disabled={busy}
            onClick={() => window.confirm('Leave this team? You’ll go back to your own plan.') && void act(() => removeMember(membership.id))}
          >
            Leave team
          </button>
        </>
      ) : isOwner ? (
        <>
          <p className="muted small">
            Your team: {teamSize} people (you and {teamSize - 1} others{extraSeats ? `, including ${extraSeats} extra seat${extraSeats === 1 ? '' : 's'}` : ''}). Your team shares the plan's {plan.hours} hours, brand
            kits, cloud listening and Best AI.
          </p>
          <ul className="team-list">
            <li>
              <span>{myEmail}</span>
              <span className="muted small">You · owner</span>
            </li>
            {myTeam.map((r) => (
              <li key={r.id}>
                <span>{r.email}</span>
                <span className="team-row-actions">
                  {r.status === 'invited' ? (
                    <>
                      <span className="muted small">Invited</span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          const text = `I've added you to my Hookcut team. Sign up at ${location.origin}/signup with ${r.email}, then open Account and click Join team.`;
                          void navigator.clipboard?.writeText(text).then(() => setCopied(r.id));
                        }}
                      >
                        {copied === r.id ? 'Copied' : 'Copy invite message'}
                      </button>
                    </>
                  ) : (
                    <span className="muted small">Member</span>
                  )}
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => window.confirm(`Remove ${r.email} from your team?`) && void act(() => removeMember(r.id))}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="seat-row">
            <span className="muted small">
              Studio includes {TEAM_SIZE} people. Each extra person is {seatPrice}, sharing the same hours.
            </span>
            {extraSeats < MAX_EXTRA_SEATS && !profile?.cancel_at && (
              <button type="button" className="btn btn-outline btn-inline" disabled={busy} onClick={() => changeSeats(extraSeats + 1)}>
                Add a seat
              </button>
            )}
            {extraSeats > 0 && (
              <button
                type="button"
                className="link-button"
                disabled={busy || myTeam.length > teamSize - 2}
                title={myTeam.length > teamSize - 2 ? 'Remove someone first' : undefined}
                onClick={() => changeSeats(extraSeats - 1)}
              >
                Remove a seat
              </button>
            )}
          </div>
          {myTeam.length < teamSize - 1 && (
            <form
              className="team-invite-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void act(async () => {
                  await invite(user.id, email);
                  setEmail('');
                });
              }}
            >
              <input type="email" placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email to invite" />
              <button type="submit" className="btn btn-primary btn-inline" disabled={busy}>
                Invite
              </button>
            </form>
          )}
          <p className="muted small">They sign up with that email, then click Join team on their Account page.</p>
        </>
      ) : (
        !invitesToMe.length && (
          <p className="muted">
            Work with others? Studio includes a team of {TEAM_SIZE} people sharing the plan's hours and brand kits.{' '}
            <Link to="#pricing">See Studio</Link>
          </p>
        )
      )}
    </section>
  );
}
