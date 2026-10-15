import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND_NAME, LEGAL } from '../lib/brand';
import { PLANS } from '../lib/plans';

// Plain-language legal pages. Paddle (our payment provider) requires Terms, Privacy and Refunds
// pages before it approves the site. Have them checked before taking real payments.

const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal">
      <h1 className="page-title">{title}</h1>
      <p className="muted small">Last updated {LEGAL.updated}</p>
      {children}
    </main>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy">
      <p>
        {LEGAL.owner !== BRAND_NAME && `${BRAND_NAME} is run by ${LEGAL.owner}. `}This page explains what happens to your data, in
        plain words.
      </p>

      <h2>Your video stays on your computer</h2>
      <p>
        When you choose an episode, your browser reads it on your own computer. It turns the speech into text (a transcript),
        finds the best moments and makes your clips there too. <b>Your video and audio are never uploaded</b>, except when
        you choose cloud processing (below).
      </p>

      <h2>What we send to AI</h2>
      <p>
        To pick the best moments, we send <b>the written transcript only</b> to Google's Gemini AI through our server. Today we
        use Google's free Gemini service, and Google may use what it receives to improve its products, which can include
        people reviewing it. We plan to move paid plans to Google's paid service, which Google doesn't use to improve its
        products, and will update this page when we do. We don't use your transcripts for anything else, and we don't keep
        them after your moments are found. Don't upload episodes containing information you aren't allowed to share with an
        AI service.
      </p>

      <h2>Cloud processing (optional)</h2>
      <p>
        If your computer or phone is too slow, you can choose to process an episode in the cloud. Then we upload{' '}
        <b>the episode's audio only</b> (never the video) to our server, turn it into a transcript, and delete the audio as soon
        as that's done. The transcript is deleted from our server within an hour.
      </p>

      <h2>Your account</h2>
      <p>
        We keep your email address, your plan, and how much of your plan you've used (the length of each episode processed and
        a code identifying the file, not the file itself). Accounts are stored with Supabase. If you sign in with Google, we
        receive your name and email from Google.
      </p>

      <h2>Payments</h2>
      <p>
        Payments are handled by Paddle, our reseller and merchant of record. Paddle collects your payment details and billing
        address under <a href="https://www.paddle.com/legal/privacy">its own privacy policy</a>. We never see your card number.
      </p>

      <h2>Cookies and storage</h2>
      <p>
        We use your browser's storage only to keep you signed in and to remember the speech recognition model, so it
        downloads once. We don't use advertising or tracking cookies.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, or for your account and data to be deleted, at any time: email {mail}. If you live
        in the EU or UK you also have the right to complain to your data protection authority.
      </p>
    </Page>
  );
}

export function Terms() {
  const free = PLANS[0]!;
  return (
    <Page title="Terms of service">
      <p>
        These terms are an agreement between you and {LEGAL.owner} ("we") for using {BRAND_NAME}. By creating an account you
        agree to them.
      </p>

      <h2>The service</h2>
      <p>
        {BRAND_NAME} finds the best moments in your podcast episodes and helps you turn them into short vertical clips. Most of
        the work happens in your browser, so speed depends on your device. The AI's picks, transcripts and captions can contain
        mistakes; check your clips before you post them.
      </p>

      <h2>Your content</h2>
      <p>
        You keep all rights to your episodes and clips. Only process content you own or have permission to use. You give us
        permission to process your transcripts (and, for cloud processing, your audio) only as needed to provide the service.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don't use {BRAND_NAME} for illegal content, content that infringes others' rights, or to overload, resell or reverse
        engineer the service. We may suspend accounts that do.
      </p>

      <h2>Plans and payments</h2>
      <p>
        The {free.name} plan is free. Paid plans are subscriptions billed monthly or yearly through Paddle, our reseller and
        merchant of record, and renew automatically until you cancel. Each plan's limits are shown on our{' '}
        <Link to="/#pricing">pricing</Link>. Unused hours don't carry over. You can cancel any time in Account → Manage
        billing; your plan stays active until the end of the period you paid for. Refunds follow our{' '}
        <Link to="/refunds">refund policy</Link>.
      </p>

      <h2>Changes and availability</h2>
      <p>
        We may change features, limits or prices. We'll give at least 30 days' notice by email before a price change affects
        your subscription. We work to keep {BRAND_NAME} running but can't promise it will always be available or error-free.
      </p>

      <h2>Liability</h2>
      <p>
        {BRAND_NAME} is provided "as is". As far as the law allows, we aren't liable for indirect losses, and our total
        liability is limited to what you paid us in the 12 months before the claim. Nothing here limits rights you have by law
        as a consumer.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </Page>
  );
}

export function Refunds() {
  return (
    <Page title="Refund policy">
      <p>We want you to be happy with {BRAND_NAME}.</p>
      <h2>14-day refund</h2>
      <p>
        If you're not happy with a paid plan, ask for a full refund within <b>14 days of your first payment</b> and you'll get
        your money back, no questions asked. Renewals can be refunded within 14 days if you haven't processed any episodes since
        the renewal.
      </p>
      <h2>How to ask</h2>
      <p>
        Email {mail} with the email address you signed up with, or reply to your Paddle receipt. Refunds are made by Paddle to
        your original payment method, usually within 5–10 business days.
      </p>
      <h2>Cancelling</h2>
      <p>
        You can cancel any time in Account → Manage billing. You keep your plan until the end of the period you paid for and
        won't be charged again.
      </p>
    </Page>
  );
}
