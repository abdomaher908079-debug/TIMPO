import { Link } from 'react-router-dom';
import Meter from '../components/Meter';
import Pricing from '../components/Pricing';
import { useAuth } from '../lib/auth';

const SAMPLE_CLIPS = [
  { score: 94, length: '0:42', caption: 'THIS CHANGED', title: 'How he lost everything in 2019', why: 'Strong story · emotional' },
  { score: 91, length: '0:31', caption: 'NEVER STOP', title: 'The one advice for beginners', why: 'Clear tip · shareable' },
  { score: 88, length: '0:55', caption: 'NOBODY TELLS', title: '"Nobody tells you this"', why: 'Hot take · debate' },
  { score: 85, length: '0:38', caption: "I COULDN'T", title: 'Funniest moment', why: 'Laughter detected' },
];

export default function Home() {
  const { user } = useAuth();
  const startLink = user ? '/new' : '/signup';
  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">For podcasters</p>
        <h1 className="hero-title">
          Turn your 2-hour episode into <span>10 ready-to-post clips.</span>
        </h1>
        <p className="hero-sub">
          PeakClip listens to your whole episode, finds the moments people will share, and cuts vertical clips with
          captions for TikTok, Reels and Shorts.
        </p>
        <Link to={startLink} className="btn btn-primary">
          {user ? 'New episode' : 'Try it free, 1 episode every week'}
        </Link>
        <p className="privacy-note">Your video never leaves your computer. No upload wait.</p>
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

      <Pricing />

      <section className="final-cta">
        <h2 className="section-heading">Your next episode deserves to be seen.</h2>
        <Link to={startLink} className="btn btn-primary">
          {user ? 'New episode' : 'Start free'}
        </Link>
      </section>
    </main>
  );
}
