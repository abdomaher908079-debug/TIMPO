import { Link } from 'react-router-dom';
import Meter from '../components/Meter';
import LogoMark from '../components/LogoMark';
import { useAuth } from '../lib/auth';

// What Hookcut does, in the words a podcaster would use. Every item here is in the product.
const FEATURES: { title: string; text: string }[] = [
  {
    title: 'Finds the moments people share',
    text: 'Stories, hot takes, tips and laughs, each with a score and the reason it was picked. Not random 60-second cuts.',
  },
  {
    title: 'Hooks from the first second',
    text: 'Every clip starts on a line that stops the scroll and ends on its payoff, with an AI headline on top.',
  },
  {
    title: 'Captions that pop',
    text: 'Word-by-word captions in three styles, with the key words highlighted and quick zoom-ins on the punchlines.',
  },
  {
    title: 'Follows the speaker',
    text: 'Auto framing keeps whoever is talking in the vertical frame, so wide podcast shots work on TikTok and Reels.',
  },
  {
    title: 'Your video stays yours',
    text: 'Hookcut works right in your browser. Your video never leaves your computer, so there is no upload wait, even for 4 GB files.',
  },
  {
    title: 'Works on your phone',
    text: 'On phones, cloud listening takes over, and it keeps going if you leave the page.',
  },
  {
    title: 'Your show’s look',
    text: 'Brand kits with your font, colors and logo, applied to every clip. Studio has one per show.',
  },
  {
    title: 'Pick up where you left off',
    text: 'Your episodes, clips and edits are saved to your library and open on any device.',
  },
  {
    title: 'Made for teams',
    text: 'Studio teams share one plan: invite your editor or co-host and work on the same shows.',
  },
];

const SAMPLE_CLIPS = [
  { score: 94, length: '0:42', caption: 'THIS CHANGED', title: 'How he lost everything in 2019', why: 'Strong story · emotional' },
  { score: 91, length: '0:31', caption: 'NEVER STOP', title: 'The one advice for beginners', why: 'Clear tip · shareable' },
  { score: 88, length: '0:55', caption: 'NOBODY TELLS', title: '"Nobody tells you this"', why: 'Hot take · debate' },
  { score: 85, length: '0:38', caption: "I COULDN'T", title: 'Funniest moment', why: 'Laughter detected' },
];

export default function Home() {
  const { user, loading } = useAuth();
  // Wait for the login check, so signed-in people never see the visitor page first.
  if (loading) return <main className="welcome" />;
  // Signed in: just a warm welcome and the one thing to do next.
  if (user) return <Welcome name={user.name} />;
  const startLink = '/signup';
  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">For podcasters</p>
        <h1 className="hero-title">
          Turn your 2-hour episode into <span>10 ready-to-post clips.</span>
        </h1>
        <p className="hero-sub">
          Hookcut listens to your whole episode, finds the moments people will share, and cuts vertical clips with
          captions for TikTok, Reels and Shorts.
        </p>
        <Link to={startLink} className="btn btn-primary">
          Try it free, 1 episode every week
        </Link>
        <p className="privacy-note">
          Your video never leaves your computer. No upload wait. <Link to="/privacy">Privacy</Link>
        </p>
      </section>

      <section className="card demo" aria-label="Example result">
        <div className="demo-head">
          <span className="muted small">Episode 48 · 1h 52m</span>
          <span className="pill-ok">10 clips ready</span>
        </div>
        <Meter peaks={[8, 9, 10, 24, 25, 41, 42, 43]} />
        <div className="clip-grid">
          {SAMPLE_CLIPS.map((c) => (
            <div key={c.title} className="clip-card">
              <div className="clip-thumb">
                <span className="clip-score">{c.score}</span>
                <span className="clip-len">{c.length}</span>
                <span className="clip-caption">{c.caption}</span>
              </div>
              <div className="clip-meta">
                <b>{c.title}</b>
                <span>{c.why}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small demo-note">Example. Your clips come from your own episode.</p>
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="section-heading">How it works</h2>
        <ol className="steps-list">
          <li>
            <b>Drop your episode.</b> Any length. It opens instantly, even a 4 GB file.
          </li>
          <li>
            <b>We find the best moments.</b> Stories, tips, hot takes and laughs, each with a score and the reason we
            picked it.
          </li>
          <li>
            <b>Edit and export.</b> Adjust any clip, pick a caption style, and export vertical clips ready to post.
          </li>
        </ol>
      </section>

      <section className="features" aria-labelledby="features-title">
        <h2 id="features-title" className="section-heading">Everything between your episode and the post</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <h2 className="section-heading">Your next episode deserves to be seen.</h2>
        <Link to={startLink} className="btn btn-primary">
          Start free
        </Link>
        <p className="muted small final-cta-note">
          Free every week, no card needed. <Link to="/pricing">See plans</Link>
        </p>
      </section>
    </main>
  );
}

function Welcome({ name }: { name?: string | null }) {
  const first = name?.trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Welcome back' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <main className="welcome">
      <div className="welcome-logo">
        <LogoMark size={112} />
      </div>
      <p className="welcome-greeting">
        {greeting}
        {first ? `, ${first}` : ''}.
      </p>
      <Link to="/new" className="btn btn-primary welcome-btn">
        New episode
      </Link>
    </main>
  );
}
