import { useState } from 'react';
import { INVITE_REWARD, inviteLink, useMyInvite } from '../lib/invite';

// Plan & settings: your invite link, and how many friends it brought.
export default function InviteCard() {
  const invite = useMyInvite();
  const [copied, setCopied] = useState(false);
  if (!invite) return null;
  const link = inviteLink(invite.code);
  const text = `I make my podcast clips with Isla. Sign up with my link and we both get ${INVITE_REWARD.hours} free hours:`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Isla', text, url: link });
        return;
      } catch {
        // Closed the share sheet: copy instead.
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy your link:', link);
    }
  }

  return (
    <section className="card account-card invite-card" aria-labelledby="invite-title">
      <h2 id="invite-title" className="account-section-title">
        Invite friends, get free hours
      </h2>
      <p className="muted">
        When a friend signs up with your link and makes their first episode, you both get{' '}
        <b>
          +{INVITE_REWARD.hours} hours and +{INVITE_REWARD.episodes} episodes
        </b>
        , free for {INVITE_REWARD.days} days. Works on every plan, Free too.
      </p>
      <div className="pay-copy-row">
        <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-outline btn-inline" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <button type="button" className="btn btn-primary" onClick={() => void share()}>
        Share my link
      </button>
      <p className="muted small">
        {invite.joined === 0
          ? 'No friends yet.'
          : `${invite.joined} friend${invite.joined === 1 ? '' : 's'} signed up · ${invite.rewarded} made their first episode (+${invite.rewarded * INVITE_REWARD.hours} hours for you).`}{' '}
        Up to 10 rewards a month.
      </p>
    </section>
  );
}
