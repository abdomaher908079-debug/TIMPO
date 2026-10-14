import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const POPULAR = ['LG OE', 'Samsung 4C', 'Bosch E24', 'Samsung UE', 'LG IE', 'Bosch E15'];

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="home">
      <div className="lcd lcd-hero" aria-hidden="true">
        OE
      </div>
      <h1 className="hero-title">
        Your appliance shows an error code? <span>Fix it yourself.</span>
      </h1>
      <p className="hero-sub">
        Snap the error code and the model label. Get the cause, the fix, and the exact part for your model in about 30
        seconds.
      </p>

      <ul className="card features">
        <li>Washers, dryers &amp; dishwashers</li>
        <li>Step-by-step fixes with repair videos</li>
        <li>The exact replacement part for your model</li>
        <li>Your appliances and repair history saved</li>
      </ul>

      <Link to={user ? '/diagnose' : '/signup'} className="btn btn-primary">
        {user ? 'Start a diagnosis' : "Get started, it's free"}
      </Link>

      <p className="popular">Popular: {POPULAR.join(' · ')}</p>
    </main>
  );
}
