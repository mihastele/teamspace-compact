"use client";

import { useEffect, useRef, useState } from "react";
import { browserConfigurationStatus } from "@/lib/client";
import s from "./SetupGuide.module.css";

const steps = [
  "Your project",
  "Connect the app",
  "Secure deployment",
  "Sign-in & workspace",
  "Launch checks",
];
const template = `# Browser configuration — Firebase Web app settings
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Server only — deployment environment, never NEXT_PUBLIC
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_STORAGE_BUCKET=
`;

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}

export default function SetupGuide() {
  const [open, setOpen] = useState(false);
  // Keep navigation when closing the guide; no credentials or progress saved to storage.
  const [step, setStep] = useState(0);
  return (
    <>
      <button
        className={s.launcher}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">✦</span> Set up your workspace
      </button>
      {open && (
        <GuideDialog
          step={step}
          setStep={setStep}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function GuideDialog({
  step,
  setStep,
  close,
}: {
  step: number;
  setStep: (step: number) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const prior = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      prior?.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    body.current?.scrollTo({ top: 0 });
    layout.current?.scrollTo({ top: 0 });
  }, [step]);
  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(template);
      setCopyStatus(
        "Empty template copied. Add values in your deployment settings.",
      );
    } catch {
      setCopyStatus(
        "Copy unavailable. Select the template below and copy it manually.",
      );
    }
  }
  const present = browserConfigurationStatus.filter(
    (item) => item.present,
  ).length;
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="setup-title"
      aria-describedby="setup-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className={s.header}>
        <div>
          <span className={s.eyebrow}>FROM LOCAL TO TOGETHER</span>
          <p id="setup-description">A guided path to your team’s own space.</p>
        </div>
        <button
          className={s.close}
          aria-label="Close setup guide"
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className={s.layout} ref={layout}>
        <nav className={s.steps} aria-label="Setup steps">
          {steps.map((label, index) => (
            <button
              key={label}
              onClick={() => setStep(index)}
              aria-current={step === index ? "step" : undefined}
            >
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className={s.body} ref={body}>
          <p className={s.stepLabel}>
            STEP {step + 1} OF {steps.length}
          </p>
          <h2 id="setup-title" ref={heading} tabIndex={-1}>
            {
              [
                "Give your team a home.",
                "Connect your Firebase app.",
                "Keep the keys behind the scenes.",
                "Let your team sign in.",
                "Ready means verified.",
              ][step]
            }
          </h2>
          {step === 0 && (
            <>
              <p>
                You’re exploring a local preview. Shared notes, accounts and
                uploads need a Firebase project and a deployed server.
              </p>
              <ol>
                <li>Create a Firebase project and register a Web app.</li>
                <li>
                  Enable Google sign-in and add localhost and your deployment
                  domain to authorized domains.
                </li>
                <li>
                  Create Firestore and a Storage bucket. Review the required
                  billing plan, budgets and alerts.
                </li>
              </ol>
              <ExternalLink href="https://console.firebase.google.com/">
                Open Firebase Console
              </ExternalLink>
              <aside className={s.notice}>
                This guide explains setup; it does not create cloud resources.
                Your local preview data stays in this browser and is not
                automatically imported.
              </aside>
            </>
          )}
          {step === 1 && (
            <>
              <p>
                Copy the Web app configuration into your local{" "}
                <code>.env.local</code> or Vercel environment settings. Use the
                empty template below as a starting point.
              </p>
              <div className={s.checks}>
                <strong>
                  {present} of 5 browser settings present in this build
                </strong>
                {browserConfigurationStatus.map((item) => (
                  <div key={item.name}>
                    <code>{item.name}</code>
                    <span>{item.present ? "Present" : "Missing"}</span>
                  </div>
                ))}
              </div>
              <p className={s.muted}>
                Presence is not a connection test. Restart locally or redeploy
                after changing these settings; reloading this page alone cannot
                update the build.
              </p>
              <button
                className={s.secondary}
                onClick={() => void copyTemplate()}
              >
                Copy empty environment template
              </button>
              <p role="status" className={s.muted}>
                {copyStatus}
              </p>
              <details>
                <summary>View environment template</summary>
                <pre>{template}</pre>
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <p>
                Set the four server-only values from the template in your server
                environment. Keep service-account credentials out of browser
                fields, shared notes and Git.
              </p>
              <ol>
                <li>
                  Set server and browser configuration for the same Firebase
                  project.
                </li>
                <li>
                  Deploy the repository’s Firestore rules, indexes and Storage
                  rules.
                </li>
                <li>
                  Configure Storage CORS for your domains, staging cleanup and
                  the TTL policies documented in the README, including presence
                  expiry.
                </li>
                <li>
                  Deploy to Vercel, then redeploy whenever browser settings
                  change.
                </li>
              </ol>
              <ExternalLink href="https://vercel.com/docs/environment-variables">
                Vercel environment settings
              </ExternalLink>
              <aside className={s.notice}>
                No secrets are collected by this wizard. Rules and deployment
                configuration must be applied through your trusted project
                tools.
              </aside>
            </>
          )}
          {step === 3 && (
            <>
              <h3>Set up Google OAuth</h3>
              <p>
                Teamspace already uses Firebase Authentication for Google
                sign-in. Configure the provider in your Firebase project:
              </p>
              <ol>
                <li>
                  Open Authentication → Sign-in method in Firebase Console.
                  Enable Google and save the provider settings.
                </li>
                <li>
                  In Authentication settings, add localhost and your deployed
                  app domain to Authorized domains.
                </li>
                <li>
                  Deploy with the Web app configuration from this same project,
                  then test Continue with Google with your own account.
                </li>
              </ol>
              <ExternalLink href="https://firebase.google.com/docs/auth/web/google-signin">
                Google OAuth setup guide
              </ExternalLink>
              <h3>Create your workspace</h3>
              <p>
                After deployment, Teamspace will offer{" "}
                <strong>Continue with Google</strong>. Sign in and choose a name
                to create your workspace.
              </p>
              <p>
                The authenticated creator becomes its owner, with invitations
                and member management. This is a workspace role; it does not
                grant Firebase project administration.
              </p>
              <details>
                <summary>Optional: two-factor authentication (2FA)</summary>
                <p>
                  2FA is optional by default. It is not required to set up a
                  workspace or use Google sign-in.
                </p>
                <p>
                  Authenticator-based 2FA requires Firebase Authentication with
                  Identity Platform. Enrollment and second-factor sign-in are
                  not implemented in Teamspace yet; enabling the provider alone
                  will not add that experience. Keep app-level enrollment
                  disabled until that flow is implemented and verified.
                </p>
                <ExternalLink href="https://firebase.google.com/docs/auth/web/totp-mfa">
                  Firebase authenticator setup
                </ExternalLink>
              </details>
            </>
          )}
          {step === 4 && (
            <>
              <p>
                Walking through the guide does not mark your deployment ready.
                Before inviting your team, verify these in the configured app:
              </p>
              <ul>
                <li>Google sign-in and workspace creation succeed.</li>
                <li>A second invited account sees the same board and notes.</li>
                <li>
                  Concurrent edits survive refresh and a temporary disconnect.
                </li>
                <li>
                  Private uploads work; an outsider cannot access workspace
                  content.
                </li>
                <li>
                  Authorized domains, CORS, rules and TTL policies match your
                  deployment.
                </li>
              </ul>
              <aside className={s.notice}>
                <strong>This build is still a local preview.</strong>
                <br />
                Finish deployment, then return to the configured app to sign in.
                Closing this guide preserves your preview session.
              </aside>
            </>
          )}
        </div>
      </div>
      <footer className={s.footer}>
        <button
          className={s.secondary}
          onClick={() => (step ? setStep(step - 1) : close())}
        >
          {step ? "Back" : "Later"}
        </button>
        <span>Guided setup · No credentials stored</span>
        <button
          className={s.primary}
          onClick={() =>
            step === steps.length - 1 ? close() : setStep(step + 1)
          }
        >
          {step === steps.length - 1 ? "Back to preview" : "Continue"}
        </button>
      </footer>
    </dialog>
  );
}
