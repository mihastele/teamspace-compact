"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useCallback,
} from "react";
import type { useTeamspace } from "@/lib/client";
import s from "./AuthPanel.module.css";

type Api = ReturnType<typeof useTeamspace>;
type Mode = "login" | "register" | "reset" | "new-password";

export default function AuthPanel({ api }: { api: Api }) {
  const callback = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => {
      const params = new URLSearchParams(location.search);
      return JSON.stringify({
        mode: params.get("mode"),
        code: params.get("oobCode"),
        error: params.get("error_description"),
      });
    },
    () => "{}",
  );
  const callbackState = JSON.parse(callback) as {
    mode?: string;
    code?: string;
    error?: string;
  };
  const [mode, setMode] = useState<Mode>("login");
  const activeMode =
    api.passwordRecovery || callbackState.mode === "resetPassword"
      ? "new-password"
      : mode;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const busyGuard = useRef(false);
  const alive = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  const policy = api.authConfiguration;
  async function run(action: () => Promise<void>) {
    if (busyGuard.current) return;
    busyGuard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "Unable to continue. Try again.",
        );
    } finally {
      busyGuard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function submit() {
    if (!policy || api.authConfigurationError || api.authConfigurationLoading)
      return;
    await run(async () => {
      if (activeMode === "register") {
        if (password !== passwordAgain)
          throw new Error("Passwords do not match.");
        const result = await api.registerEmail(
          email.trim(),
          password,
          name.trim(),
        );
        if (!alive.current) return;
        setPassword("");
        setPasswordAgain("");
        if (result.confirmationSent) {
          setNotice(
            "Check your inbox for a confirmation link. Once confirmed, sign in to continue.",
          );
          setMode("login");
        }
      } else if (activeMode === "reset") {
        await api.resetPassword(email.trim());
        if (!alive.current) return;
        setNotice(
          "If this address has an account, a password reset email will arrive shortly. Check spam too.",
        );
        setCooldown(30);
      } else if (activeMode === "new-password") {
        if (password !== passwordAgain)
          throw new Error("Passwords do not match.");
        await api.completePasswordReset(password, callbackState.code);
        if (!alive.current) return;
        setPassword("");
        setPasswordAgain("");
        setMode("login");
        const url = new URL(location.href);
        for (const param of ["mode", "oobCode", "apiKey", "code", "auth"])
          url.searchParams.delete(param);
        history.replaceState({}, "", url);
        setNotice("Password updated. Sign in with your new password.");
      } else {
        await api.signInEmail(email.trim(), password);
        if (alive.current) setPassword("");
      }
    });
  }
  function changeMode(value: Mode) {
    setMode(value);
    setError("");
    setNotice("");
    setPassword("");
    setPasswordAgain("");
  }
  if (api.authConfigurationLoading)
    return <p role="status">Preparing secure sign-in…</p>;
  if (api.authConfigurationError || !policy)
    return (
      <section className={s.panel}>
        <p className={s.error} role="alert">
          {api.authConfigurationError ||
            "Authentication configuration is unavailable."}
        </p>
        <button type="button" onClick={api.retryAuthConfiguration}>
          Retry setup check
        </button>
      </section>
    );
  if (api.needsEmailConfirmation)
    return (
      <section className={s.panel} aria-label="Confirm email">
        <h2>Check your inbox.</h2>
        <p>
          Confirm <strong>{api.user?.email || "your email address"}</strong>{" "}
          before opening a workspace.
        </p>
        {(error || api.error) && (
          <p className={s.error} role="alert">
            {error || api.error}
          </p>
        )}
        {notice && (
          <p role="status" className={s.notice}>
            {notice}
          </p>
        )}
        <div className={s.actions}>
          <button
            type="button"
            className={s.primary}
            disabled={busy}
            onClick={() => void run(api.refreshConfirmation)}
          >
            I confirmed my email
          </button>
          <button
            type="button"
            disabled={busy || cooldown > 0}
            onClick={() =>
              void run(async () => {
                await api.resendConfirmation(api.user?.email || email);
                if (alive.current) {
                  setCooldown(30);
                  setNotice(
                    "Confirmation email requested. Check your inbox and spam folder.",
                  );
                }
              })
            }
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend email"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(api.signOut)}
          >
            Use another account
          </button>
        </div>
      </section>
    );
  return (
    <section className={s.panel} aria-label="Account sign-in">
      <h2>
        {activeMode === "register"
          ? "Make yourself at home."
          : activeMode === "reset"
            ? "Let’s get you back in."
            : activeMode === "new-password"
              ? "Choose a new password."
              : "Welcome back."}
      </h2>
      {activeMode === "register" && (
        <p>
          {policy.emailConfirmationRequired
            ? "Create an account, then confirm your email to continue."
            : "Create an account and start your workspace."}
        </p>
      )}
      {(error || callbackState.error) && (
        <p className={s.error} role="alert">
          {error || callbackState.error}
        </p>
      )}
      {notice && (
        <p className={s.notice} role="status">
          {notice}
        </p>
      )}
      {policy.passwordAuthEnabled ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {activeMode === "register" && (
            <label>
              Display name
              <input
                required
                maxLength={100}
                autoComplete="name"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {activeMode !== "new-password" && (
            <label>
              Email address
              <input
                required
                type="email"
                maxLength={320}
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {activeMode !== "reset" && (
            <label>
              {activeMode === "new-password" ? "New password" : "Password"}
              <input
                required
                type="password"
                minLength={activeMode === "login" ? undefined : 8}
                maxLength={4096}
                autoComplete={
                  activeMode === "login" ? "current-password" : "new-password"
                }
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {(activeMode === "register" || activeMode === "new-password") && (
            <label>
              Confirm password
              <input
                required
                type="password"
                minLength={8}
                maxLength={4096}
                autoComplete="new-password"
                value={passwordAgain}
                disabled={busy}
                onChange={(event) => setPasswordAgain(event.target.value)}
              />
            </label>
          )}
          <button
            className={s.primary}
            disabled={busy || (activeMode === "reset" && cooldown > 0)}
          >
            {busy
              ? "Working…"
              : activeMode === "register"
                ? "Create account"
                : activeMode === "reset"
                  ? cooldown
                    ? `Try again in ${cooldown}s`
                    : "Send reset link"
                  : activeMode === "new-password"
                    ? "Update password"
                    : "Sign in"}
          </button>
        </form>
      ) : (
        <p>Email/password sign-in is disabled for this deployment.</p>
      )}
      {policy.passwordAuthEnabled && activeMode !== "new-password" && (
        <div className={s.links}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              changeMode(activeMode === "register" ? "login" : "register")
            }
          >
            {activeMode === "register"
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          {activeMode === "login" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode("reset")}
            >
              Forgot password?
            </button>
          ) : activeMode === "reset" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode("login")}
            >
              Back to sign in
            </button>
          ) : null}
        </div>
      )}
      {policy.provider === "supabase" && policy.passwordAuthEnabled && policy.emailConfirmationRequired && activeMode === "login" && (
        <button type="button" disabled={busy || cooldown > 0 || !email.trim()} onClick={() => void run(async () => {
          await api.resendConfirmation(email.trim());
          if (alive.current) { setCooldown(30); setNotice("If this address needs confirmation, an email will arrive shortly. Check spam too."); }
        })}>{cooldown ? `Resend in ${cooldown}s` : "Resend confirmation email"}</button>
      )}
      {policy.googleAuthEnabled && activeMode !== "new-password" && (
        <>
          <div className={s.separator}>or</div>
          <button
            className={s.google}
            type="button"
            disabled={busy}
            onClick={() => void run(api.signIn)}
          >
            Continue with Google
          </button>
        </>
      )}
      {!policy.googleAuthEnabled && !policy.passwordAuthEnabled && (
        <p className={s.error}>
          All sign-in methods are disabled. Ask your administrator to enable
          one.
        </p>
      )}
    </section>
  );
}
