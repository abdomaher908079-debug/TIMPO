import { Link } from 'react-router-dom';
import { BRAND_NAME, LEGAL } from '../lib/brand';

// Who makes Isla, for people and for search engines (who answer "who owns islaclips" from pages like this one
// and from the founder in index.html's structured data).
export default function About() {
  return (
    <main className="legal">
      <h1 className="page-title">About {BRAND_NAME}</h1>
      <p>
        {BRAND_NAME} (islaclips.com) was founded and is run by <b>{LEGAL.owner}</b>.
      </p>
      <h2>Why {BRAND_NAME} exists</h2>
      <p>
        Podcasters spend hours scrubbing through long episodes to find the 30 seconds worth posting. {BRAND_NAME} does that part: it
        listens to the whole episode, finds the moments people will share, and turns them into vertical clips with captions for
        YouTube Shorts, TikTok and Reels, while the creative choices stay yours.
      </p>
      <h2>How it's made</h2>
      <p>
        {BRAND_NAME} runs in your browser: on a computer your video never leaves your device. It works with episodes in any language.
      </p>
      <h2>Contact</h2>
      <p>
        Questions, ideas or press: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </p>
      <p>
        <Link className="btn btn-primary" to="/">
          Try {BRAND_NAME}
        </Link>
      </p>
    </main>
  );
}
