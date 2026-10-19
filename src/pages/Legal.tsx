import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND_NAME, LEGAL } from '../lib/brand';
import { PLANS } from '../lib/plans';
import { PACK, PICKS_PER_EPISODE } from '../../supabase/functions/_shared/plans';

// Plain-language legal pages: Terms, Privacy and Refunds. Payments go through NOWPayments (crypto, or card
// through its on-ramp), and paid plans aren't sold in the Russian Federation. Have them checked by a
// lawyer before taking real payments.

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
        finds the best moments and makes your clips there too. <b>Your video is never uploaded.</b> Your audio is only sent
        when the episode is listened to in the cloud (below).
      </p>

      <h2>What we send to AI</h2>
      <p>
        {BRAND_NAME}'s AI is powered by <b>Google's Gemini</b>. To pick the best moments, we send{' '}
        <b>the written transcript only</b> to Gemini through our server. Today we use Google's free Gemini service, and Google
        may use what it receives to improve its products, which can include people reviewing it. We plan to move paid plans to
        Google's paid service, which Google doesn't use to improve its products, and will update this page when we do. We use
        your transcripts only to run {BRAND_NAME}, never to train AI or for advertising. Don't upload episodes containing
        information you aren't allowed to share with an AI service.
      </p>

      <h2>Cloud listening (phones and slow computers)</h2>
      <p>
        Phones, and computers too slow to listen to a full episode, listen in the cloud: we send{' '}
        <b>the episode's audio only</b> (never the video), a few minutes at a time, through our server to{' '}
        <b>Google's Gemini</b>, which writes down what's said. On a computer you can choose this or listening on your
        device. Today we use Google's free Gemini service, so as above Google may use the audio it receives to improve its
        products, which can include people reviewing it. So that you can leave the page while this happens, each piece of
        audio waits in our private storage only until it's transcribed, then it's deleted (at the latest within 7 days if
        something goes wrong). We keep the transcript and the moments found for 7 days, so you can come back to them. The
        word timing for your clips' captions still happens on your device.
      </p>

      <h2>Your saved work</h2>
      <p>
        So you can come back to an episode, on any device, we save its transcript, the clips found and your edits with your
        account. We keep them for 1 day after your last change on Free and 30 days on paid plans, then delete them
        automatically; you can delete them sooner in your Library. Your video is never uploaded: your browser keeps its own
        copy on your device for the same time, when there's room. Exported clips are kept only in your browser, on your
        device, for the same time.
      </p>

      <h2>Brand kits and teams</h2>
      <p>
        Your brand kits (name, logo, colors and caption style) are saved with your account until you delete them. On Studio,
        we keep the email addresses you invite to your team and who is on it, so members can join and use your plan. Removing
        someone deletes them from your team.
      </p>

      <h2>Your account</h2>
      <p>
        We keep your email address, your plan, and how much of your plan you've used (the length of each episode processed and
        a code identifying the file, not the file itself). For each AI request we also note which AI model was used and how
        much of it, without any of your content, for 90 days; after that only monthly totals are kept. If you sign in with
        Google, we receive your name and email from Google. If you tap "Notify me" on a paid plan, we keep that request with
        your email until the plan opens and we've told you, or until you ask us to remove it.
      </p>

      <h2>Payments</h2>
      <p>
        Payments are handled by NOWPayments, which takes crypto and, through its card partners, cards. NOWPayments and its card
        partners collect what they need to take your payment (for cards, this can include an identity check) under{' '}
        their own privacy policies (see <a href="https://nowpayments.io">nowpayments.io</a>). We never see your card number or
        your wallet's private keys: we only receive what you bought, its price, the payment's status and its reference.
      </p>
      <p>
        Paid plans aren't sold in the Russian Federation. To check this, when you open our pricing page or start a payment, we
        use the country Cloudflare, our host, works out from your internet address. We store the country with your order (for
        example "DE"), not your internet address.
      </p>

      <h2>Who helps us run {BRAND_NAME}</h2>
      <p>
        We share data only with the companies that run parts of {BRAND_NAME} for us, and only what each one needs:
      </p>
      <ul>
        <li><b>Supabase</b>: accounts, our database, our server and private storage.</li>
        <li><b>Cloudflare</b>: hosts the website, tells us your country (above) and forwards email sent to {mail}.</li>
        <li><b>Google</b>: Gemini, the AI described above, and "Sign in with Google" if you use it.</li>
        <li><b>NOWPayments</b> and its card partners: payments.</li>
        <li><b>Brevo</b>: sends our emails (receipts, reminders and account messages).</li>
      </ul>
      <p>We never sell your data.</p>

      <h2>Cookies and storage</h2>
      <p>
        We use your browser's storage only to keep you signed in, to remember the speech recognition model so it downloads
        once, to keep your episodes' copies and exported clips on your device (above), and to remember small choices like your
        export size. We don't use advertising or tracking cookies.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, or for your account and data to be deleted, at any time: email {mail}. If you live
        in the EU or UK you also have the right to complain to your data protection authority.
      </p>

      <h2>Children</h2>
      <p>{BRAND_NAME} isn't meant for anyone under 16, and we don't knowingly keep data about them.</p>

      <h2>Changes to this page</h2>
      <p>If we change how we handle your data, we'll update this page and its date, and email you about important changes.</p>
    </Page>
  );
}

export function Terms() {
  const free = PLANS[0]!;
  return (
    <Page title="Terms of service">
      <p>
        These terms are an agreement between you and {LEGAL.owner} ("we") for using {BRAND_NAME}. By creating an account you
        agree to them. You must be at least 16 to use {BRAND_NAME}.
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
        permission to process your transcripts (and, for cloud listening, your audio) only as needed to provide the service.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don't use {BRAND_NAME} for illegal content, content that infringes others' rights, or to overload, resell or reverse
        engineer the service. We may suspend accounts that do.
      </p>

      <h2>Where paid plans are available</h2>
      <p>
        <b>Paid subscriptions are intended for international users and unavailable within the Russian Federation.</b> We don't
        accept payments from the Russian Federation and block payments started there. Don't buy a paid plan for use in the
        Russian Federation or from there by any means, such as a VPN. If you do, we may cancel the plan and refund what
        you paid.
      </p>

      <h2>Plans and payments</h2>
      <p>
        The {free.name} plan is free. Paid plans are paid upfront, in US dollars, for one month or one year, through our payment
        partner NOWPayments: in crypto (such as USDT), or by card through NOWPayments' card partners where we offer it. They{' '}
        <b>don't renew automatically</b>: when the time you paid for ends, your account moves to the {free.name} plan unless
        you buy more time. We email you before that. Buying more of the same plan adds the time to the end of your current
        one. Buying a different plan starts it as soon as the payment arrives, and the days left on your old plan are added
        to it, valued at the two plans' prices.
      </p>
      <p>
        Crypto payments are final on the blockchain: send the exact amount shown, on the network shown, before the payment
        page expires. Network fees and any card partner fees are yours. A plan starts once the payment is confirmed, usually
        within minutes. If you send too little, or the payment arrives after the page expired, email us: we'll complete
        your order once the rest arrives, or refund what arrived (minus network fees).
      </p>
      <p>
        Each plan's limits are shown on our{' '}
        <Link to="/pricing">pricing</Link>: hours and episodes per month (counted from the day your subscription
        started, also on yearly plans), cloud listening time, and up to {PICKS_PER_EPISODE - 1} free re-picks of the same
        episode each month. An episode counts as the longer of its length and the speech in it. Unused hours don't carry
        over. Extra hour packs are one-time purchases for {PACK.days} days, used after your monthly hours or episodes run
        out, and only while you're on a paid plan. Studio includes a team of 3; larger teams are arranged by email.
      </p>
      <h2>When a plan ends</h2>
      <p>
        There's nothing to cancel: a plan simply ends when the time you paid for runs out. When it ends, extra seats are
        removed and team members return to their own plan. Hour packs stay until they
        expire and work again if you subscribe again. Brand kits are kept (locked beyond your plan's number). Your saved work is
        kept for at least 30 days after a paid plan ends. Refunds follow our <Link to="/refunds">refund policy</Link>.
      </p>

      <h2>Teams</h2>
      <p>
        On Studio, the plan's owner can invite team members, who share the owner's plan, hours and brand kits. Only the owner
        pays and can change the plan, seats or billing; members can't buy anything on the team's behalf. The owner can remove a
        member at any time, and a member can leave. The owner is responsible for the team's use of {BRAND_NAME}.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can stop using {BRAND_NAME} at any time, and ask us to delete your account by emailing {mail}. Deleting your
        account ends any paid plan without a refund, except as our <Link to="/refunds">refund policy</Link> says. We may suspend or close accounts that break these terms; if we close yours without a good
        reason, we'll refund the unused part of your plan.
      </p>

      <h2>Changes and availability</h2>
      <p>
        We may change features, limits or prices. A price change never affects time you've already paid for. We work to keep {BRAND_NAME} running but can't promise it will always be available or error-free.
      </p>

      <h2>Liability</h2>
      <p>
        {BRAND_NAME} is provided "as is". As far as the law allows, we aren't liable for indirect losses, and our total
        liability is limited to what you paid us in the 12 months before the claim. Nothing here limits rights you have by law
        as a consumer.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we change these terms, we'll update this page and its date, and email you before important changes apply to you.
        Using {BRAND_NAME} after that means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </Page>
  );
}

export function Refunds() {
  return (
    <Page title="Refund policy">
      <p>We want you to be happy with {BRAND_NAME}. Plans are paid upfront and don't renew on their own, so you're never charged again without buying.</p>
      <h2>14-day refund</h2>
      <p>
        If you're not happy with your first paid plan, ask for a full refund within <b>14 days of paying</b>, no questions
        asked. Later purchases (more time, or another plan) can be refunded within 14 days if you haven't processed any
        episodes since buying them. Extra hour packs can be refunded within 14 days if none of their hours or episodes have
        been used. A refunded plan ends straight away and your account moves to the Free plan.
      </p>
      <h2>How refunds are paid</h2>
      <p>
        Crypto payments can't be reversed to a card or bank account, so refunds are sent in USDT, or in the coin you paid
        with, to a wallet address you give us, for the US dollar amount you paid, minus the network fee for sending it. This
        also applies if you paid by card through NOWPayments' card partners, because your card payment was turned into crypto
        when you paid. We send refunds within 10 business days of agreeing to them.
      </p>
      <h2>How to ask</h2>
      <p>
        Email {mail} from the email address you signed up with. Tell us what you bought and when, and the wallet address and
        network to refund to. Check the address carefully: crypto sent to a wrong address can't be recovered.
      </p>
      <h2>Payments we can't accept</h2>
      <p>
        Paid plans aren't available in the Russian Federation. If a payment is made from there anyway, we may cancel the plan
        and refund the payment as above. Your rights under consumer law where you live aren't limited by this policy.
      </p>
    </Page>
  );
}
