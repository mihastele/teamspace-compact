"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
  updateProfile,
  reload,
} from "firebase/auth";
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  orderBy,
  documentId,
  limit,
} from "firebase/firestore";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSnapshotRunner, collectionSnapshotRows, SnapshotReadError, type SnapshotRunner } from "./browser-sync";

export type BrowserUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
};
export type AuthConfiguration = {
  provider: "firebase" | "supabase";
  emailConfirmationRequired: boolean;
  passwordAuthEnabled: boolean;
  googleAuthEnabled: boolean;
  configured: boolean;
};
export const browserProvider =
  process.env.NEXT_PUBLIC_BACKEND_PROVIDER || "firebase";
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const browserConfigured =
  browserProvider === "supabase"
    ? Boolean(supabaseUrl && supabaseKey)
    : browserProvider === "firebase"
      ? Object.values(firebaseConfig).every(Boolean)
      : true;
export const browserConfigurationStatus =
  browserProvider === "supabase"
    ? [
        { name: "NEXT_PUBLIC_SUPABASE_URL", present: Boolean(supabaseUrl) },
        {
          name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          present: Boolean(supabaseKey),
        },
      ]
    : Object.entries(firebaseConfig).map(([key, value]) => ({
        name: `NEXT_PUBLIC_FIREBASE_${({ apiKey: "API_KEY", authDomain: "AUTH_DOMAIN", projectId: "PROJECT_ID", storageBucket: "STORAGE_BUCKET", appId: "APP_ID" } as Record<string, string>)[key]}`,
        present: Boolean(value),
      }));
let supabase: SupabaseClient | undefined;
let current: BrowserUser | null = null;
let recovery = false;
export const currentBrowserUser = () => current;
export const passwordRecoveryActive = () => recovery;
export function firebaseBrowserApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
export function supabaseBrowserClient() {
  if (!supabaseUrl || !supabaseKey)
    throw new Error("Supabase browser configuration is missing.");
  return (supabase ??= createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  }));
}
function callbackUrl(reset = false) {
  const url = new URL(window.location.href);
  url.hash = "";
  for (const name of [
    "code",
    "error",
    "error_code",
    "error_description",
    "mode",
    "oobCode",
    "apiKey",
  ])
    url.searchParams.delete(name);
  if (reset) url.searchParams.set("auth", "recovery");
  else url.searchParams.delete("auth");
  return url.toString();
}
export async function loadAuthConfiguration(): Promise<AuthConfiguration> {
  const response = await fetch("/api/config", { cache: "no-store" });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ||
        "Authentication configuration could not be loaded.",
    );
  if (
    value.provider !== browserProvider ||
    !["firebase", "supabase"].includes(value.provider) ||
    [
      "emailConfirmationRequired",
      "passwordAuthEnabled",
      "googleAuthEnabled",
      "configured",
    ].some((key) => typeof value[key] !== "boolean")
  )
    throw new Error(
      "Server and browser authentication configuration do not match. Ask your administrator to redeploy with matching provider settings.",
    );
  if (!value.configured)
    throw new Error(
      "The selected server backend is not configured. Ask your administrator to finish deployment.",
    );
  return value as AuthConfiguration;
}
export function observeBrowserAuth(
  next: (user: BrowserUser | null, recovering: boolean) => void,
  fail: (error: Error) => void,
) {
  let active = true;
  if (!["firebase", "supabase"].includes(browserProvider)) {
    queueMicrotask(() =>
      fail(
        new Error(
          "Unknown backend provider. Ask your administrator to configure firebase or supabase.",
        ),
      ),
    );
    return () => {
      active = false;
    };
  }
  let previous: string | undefined;
  const publish = (user: BrowserUser | null) => {
    if (!active) return;
    current = user;
    const signature = JSON.stringify([user, recovery]);
    if (signature !== previous) {
      previous = signature;
      next(user, recovery);
    }
  };
  if (browserProvider === "firebase") {
    const unsubscribe = onIdTokenChanged(
      getAuth(firebaseBrowserApp()),
      (user) =>
        publish(
          user
            ? {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                emailVerified: user.emailVerified,
              }
            : null,
        ),
      fail,
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }
  const client = supabaseBrowserClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    recovery =
      event === "PASSWORD_RECOVERY" || (recovery && event !== "SIGNED_OUT");
    const user = session?.user;
    publish(
      user
        ? {
            uid: user.id,
            displayName:
              typeof user.user_metadata?.display_name === "string"
                ? user.user_metadata.display_name
                : typeof user.user_metadata?.full_name === "string"
                  ? user.user_metadata.full_name
                  : null,
            email: user.email || null,
            emailVerified: Boolean(user.email_confirmed_at),
          }
        : null,
    );
  });
  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}
export async function browserAccessToken(expectedUid?: string) {
  if (!current || (expectedUid && current.uid !== expectedUid))
    throw new Error(
      "The signed-in account changed. Return to the original account to recover pending work.",
    );
  if (browserProvider === "firebase") {
    const user = getAuth(firebaseBrowserApp()).currentUser;
    if (
      !user ||
      user.uid !== current.uid ||
      (expectedUid && user.uid !== expectedUid)
    )
      throw new Error(
        "The signed-in account changed. Return to the original account.",
      );
    return await user.getIdToken();
  }
  const { data, error } = await supabaseBrowserClient().auth.getSession();
  if (error) throw error;
  if (
    !data.session ||
    data.session.user.id !== current.uid ||
    (expectedUid && data.session.user.id !== expectedUid)
  )
    throw new Error("Sign in again to continue.");
  return data.session.access_token;
}
export async function browserSignIn(email: string, password: string) {
  if (browserProvider === "firebase") {
    await signInWithEmailAndPassword(
      getAuth(firebaseBrowserApp()),
      email,
      password,
    );
    return;
  }
  const { error } = await supabaseBrowserClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}
export async function browserRegister(
  email: string,
  password: string,
  displayName: string,
  confirmation: boolean,
) {
  if (browserProvider === "firebase") {
    const result = await createUserWithEmailAndPassword(
      getAuth(firebaseBrowserApp()),
      email,
      password,
    );
    await updateProfile(result.user, { displayName });
    if (confirmation)
      await sendEmailVerification(result.user, { url: callbackUrl() });
    await result.user.getIdToken(true);
    return { confirmationSent: confirmation };
  }
  const { data, error } = await supabaseBrowserClient().auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: callbackUrl(),
    },
  });
  if (error) throw error;
  return { confirmationSent: !data.session };
}
export async function browserGoogleSignIn() {
  if (browserProvider === "firebase") {
    await signInWithPopup(
      getAuth(firebaseBrowserApp()),
      new GoogleAuthProvider(),
    );
    return;
  }
  const { error } = await supabaseBrowserClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
  });
  if (error) throw error;
}
export async function browserSignOut() {
  recovery = false;
  if (browserProvider === "firebase")
    await signOut(getAuth(firebaseBrowserApp()));
  else {
    const { error } = await supabaseBrowserClient().auth.signOut();
    if (error) throw error;
  }
}
export async function browserResendConfirmation(email: string) {
  if (browserProvider === "firebase") {
    const user = getAuth(firebaseBrowserApp()).currentUser;
    if (!user)
      throw new Error("Sign in before requesting a confirmation email.");
    await sendEmailVerification(user, { url: callbackUrl() });
  } else {
    const { error } = await supabaseBrowserClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) throw error;
  }
}
export async function browserRefreshConfirmation() {
  if (browserProvider === "firebase") {
    const user = getAuth(firebaseBrowserApp()).currentUser;
    if (!user) return;
    await reload(user);
    await user.getIdToken(true);
  } else {
    const { error } = await supabaseBrowserClient().auth.refreshSession();
    if (error) throw error;
  }
}
export async function browserResetPassword(email: string) {
  if (browserProvider === "firebase")
    await sendPasswordResetEmail(getAuth(firebaseBrowserApp()), email, {
      url: callbackUrl(),
    });
  else {
    const { error } = await supabaseBrowserClient().auth.resetPasswordForEmail(
      email,
      { redirectTo: callbackUrl(true) },
    );
    if (error) throw error;
  }
}
export async function browserCompletePasswordReset(
  password: string,
  code?: string,
) {
  if (browserProvider === "firebase") {
    if (!code) throw new Error("Open the password reset link from your email.");
    await verifyPasswordResetCode(getAuth(firebaseBrowserApp()), code);
    await confirmPasswordReset(getAuth(firebaseBrowserApp()), code, password);
  } else {
    if (!recovery)
      throw new Error("Open the password recovery link from your email.");
    const { error } = await supabaseBrowserClient().auth.updateUser({
      password,
    });
    if (error) throw error;
    recovery = false;
    await browserSignOut();
  }
}
export function timestampMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    if ("toMillis" in value && typeof value.toMillis === "function")
      return value.toMillis();
    if ("$ts" in value && typeof value.$ts === "number") return value.$ts;
  }
  return 0;
}

type Row = Record<string, unknown> & { id: string };
type Observer = {
  path: string;
  next: (rows: Row[]) => void;
  fail: (error: Error) => void;
};
type Group = {
  route: string;
  paths: Set<string>;
  observers: Set<Observer>;
  runner: SnapshotRunner;
  cached: Record<string, Row[]> | null;
};
type Hub = {
  groups: Map<string, Group>;
  invalidate: (collection?: string, coalesce?: boolean) => void;
  makeGroup: (route: string, paths: Set<string>) => Group;
  stop: () => void;
};
const hubs = new Map<string, Hub>();
/** Realtime is an invalidation hint. Trusted, serialized snapshots remain canonical. */
function subscribeSupabaseCollection(
  path: string,
  next: (rows: Row[]) => void,
  fail: (error: Error) => void,
) {
  const uid = current?.uid;
  const workspace = path.split("/")[1];
  if (!uid || !workspace) throw new Error("Sign in and select a workspace.");
  const hubKey = `${uid}:${workspace}`;
  let hub = hubs.get(hubKey);
  if (!hub) {
    const groups = new Map<string, Group>();
    let active = true;
    const makeGroup = (route: string, paths: Set<string>) => {
      const runner = createSnapshotRunner({
        read: async () => {
        const token = await browserAccessToken(uid);
        const response = await fetch(`/api/${route}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok)
          throw new SnapshotReadError(
            data.error?.message || "Workspace synchronization failed.", response.status,
          );
        return collectionSnapshotRows(route, data);
        },
        isCurrent: () => active && current?.uid === uid && groups.get(route) === group,
        publish: (snapshot) => {
        group.cached = snapshot;
        for (const observer of group.observers)
          observer.next(group.cached![observer.path] || []);
        },
        fail: (error) => {
          for (const observer of group.observers)
            observer.fail(error);
        },
      });
      const group: Group = { route, paths, observers: new Set(), cached: null, runner };
      return group;
    };
    const invalidate = (changed?: string, coalesce = false) => {
      for (const group of groups.values())
        if (!changed || group.paths.has(changed)) group.runner.invalidate(coalesce);
    };
    const client = supabaseBrowserClient();
    const channel = client
      .channel(`teamspace:${hubKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teamspace_documents",
          filter: `workspace_id=eq.${workspace}`,
        },
        (event) => {
          const changed = (event.new as Record<string, unknown>)?.collection;
          invalidate(typeof changed === "string" ? changed : undefined);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") invalidate();
      });
    const poll = setInterval(() => {
      if (navigator.onLine) invalidate(undefined, true);
    }, 5000);
    const reconnect = () => invalidate();
    window.addEventListener("online", reconnect);
    hub = {
      groups,
      invalidate,
      makeGroup,
      stop: () => {
        active = false;
        for (const group of groups.values()) group.runner.stop();
        clearInterval(poll);
        window.removeEventListener("online", reconnect);
        void client.removeChannel(channel);
      },
    };
    hubs.set(hubKey, hub);
  }
  const isWorkspaceCollection = path.split("/").length === 3;
  const route = isWorkspaceCollection
    ? `workspaces/${workspace}/snapshot`
    : path;
  let group = hub.groups.get(route);
  if (!group) {
    group = hub.makeGroup(route, new Set(
        isWorkspaceCollection
          ? ["tasks", "notes", "members", "attachments", "boardProperties"].map(
              (name) => `workspaces/${workspace}/${name}`,
            )
          : [path],
      ));
    hub.groups.set(route, group);
  }
  const observer = { path, next, fail };
  group.observers.add(observer);
  if (group.cached) {
    const captured = group;
    queueMicrotask(() => {
      if (captured.observers.has(observer)) next(captured.cached![path] || []);
    });
  } else hub.invalidate(path);
  return () => {
    group!.observers.delete(observer);
    if (!group!.observers.size) { group!.runner.stop(); hub!.groups.delete(route); }
    if (!hub!.groups.size) {
      hub!.stop();
      hubs.delete(hubKey);
    }
  };
}
export function subscribeBrowserCollection(
  path: string,
  next: (rows: Row[]) => void,
  fail: (error: Error) => void,
  comments = false,
) {
  if (browserProvider === "supabase")
    return subscribeSupabaseCollection(path, next, fail);
  const source = collection(getFirestore(firebaseBrowserApp()), path);
  return onSnapshot(
    comments
      ? query(
          source,
          orderBy("createdAt", "desc"),
          orderBy(documentId(), "desc"),
          limit(50),
        )
      : source,
    (snapshot) =>
      next(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }))),
    fail,
  );
}
