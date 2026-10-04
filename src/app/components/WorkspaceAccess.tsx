"use client";

import { useEffect, useRef, useState } from "react";
import type { useTeamspace } from "@/lib/client";
import type { Member, Workspace } from "@/lib/model";
import s from "../page.module.css";

type Api = ReturnType<typeof useTeamspace>;
const message = (error: unknown) => error instanceof Error ? error.message : "Access could not be updated. Retry this request.";

export function MemberAdder({ api, workspaceId, onAdded }: { api: Api; workspaceId: string; onAdded?: () => Promise<void> }) {
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const request = useRef<{ account: string; operationId: string } | null>(null);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <section className={s.panel} aria-label="Add registered member">
    <h2>Add someone directly</h2>
    <p>Use an existing account’s email or ID. Access is granted immediately, without an invitation email. Email confirmation requirements still apply.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setError(""); setFeedback("");
      if (!request.current || request.current.account !== account.trim()) request.current = { account: account.trim(), operationId: crypto.randomUUID() };
      try {
        const result = await api.addWorkspaceMember(workspaceId, request.current.account, request.current.operationId);
        if (!active.current) return;
        setFeedback(result.removed ? "This request was already processed, but the member has since been removed. Edit the account field to start a new addition." : result.alreadyMember ? "This account is already a member." : "Member added. They can refresh their workspace list to open it.");
        if (!result.removed) { request.current = null; setAccount(""); }
        if (onAdded) {
          try { await onAdded(); }
          catch { if (active.current) setFeedback("Addition acknowledged. Refresh members to see the latest list."); }
        }
      } catch (error) { if (active.current) setError(message(error)); }
      finally { pending.current = false; if (active.current) setBusy(false); }
    }}>
      <label className={s.field}>Email or account ID<input required maxLength={254} value={account} disabled={busy} autoComplete="off" onChange={event => { setAccount(event.target.value); request.current = null; setFeedback(""); }} /></label>
      {error && <p className={s.error} role="alert">{error} Retrying keeps the same request identity.</p>}
      {feedback && <p className={s.hint} role="status">{feedback}</p>}
      <button className={s.primary} disabled={busy || !account.trim()}>{busy ? "Adding…" : error ? "Retry addition" : "Add member"}</button>
    </form>
  </section>;
}

function RootWorkspace({ api, workspace }: { api: Api; workspace: Workspace }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const active = useRef(false);
  const pending = useRef(false);
  const sequence = useRef(0);
  const loadMembers = api.listAdministrationMembers;
  async function reload() {
    const request = ++sequence.current;
    const rows = await loadMembers(workspace.id);
    if (active.current && request === sequence.current) setMembers(rows);
  }
  useEffect(() => {
    active.current = true;
    const request = ++sequence.current;
    void loadMembers(workspace.id).then(rows => { if (active.current && request === sequence.current) setMembers(rows); })
      .catch(error => { if (active.current && request === sequence.current) setError(message(error)); })
      .finally(() => { if (active.current && request === sequence.current) setBusy(false); });
    return () => { active.current = false; };
    // WorkspaceAccess keys this component by account/workspace, fencing late results.
  }, [loadMembers, workspace.id]);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); await reload(); } catch (error) { if (active.current) setError(message(error)); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <div>
    <h3>{workspace.name}</h3>
    <MemberAdder api={api} workspaceId={workspace.id} onAdded={reload} />
    {error && <p className={s.error} role="alert">{error}</p>}
    <button className={s.secondary} disabled={busy} onClick={() => void run(async () => {})}>{busy ? "Working…" : "Refresh members"}</button>
    {members.map(member => <div className={s.memberRow} key={member.id}>
      <div className={s.memberInfo}>{member.displayName}<small>{member.role === "owner" ? "Workspace owner" : member.role === "admin" ? "Workspace admin" : "Member"}</small></div>
      {member.id !== workspace.ownerId && member.role !== "owner" && <>
        <button className={s.secondary} disabled={busy} onClick={() => {
          if (confirm(`Change workspace admin access for ${member.displayName}?`)) void run(() => api.setAdministrationRole(workspace.id, member.id, member.role === "admin" ? "member" : "admin"));
        }}>{member.role === "admin" ? "Make member" : "Make admin"}</button>
        <button className={s.secondary} disabled={busy} onClick={() => { if (confirm(`Remove ${member.displayName} from ${workspace.name}?`)) void run(() => api.removeAdministrationMember(workspace.id, member.id)); }}>Remove</button>
      </>}
    </div>)}
  </div>;
}

export default function WorkspaceAccess({ api }: { api: Api }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState("");
  const [manualId, setManualId] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!api.isRootAdmin) return null;
  const workspace = workspaces.find(space => space.id === selected);
  return <details className={s.panel}>
    <summary>Root administration</summary>
    <p>Manage workspace access. This does not grant automatic access to private pages or files.</p>
    <button className={s.secondary} disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true; setBusy(true); setError("");
      try {
        const result = await api.listAdministrationWorkspaces();
        if (active.current) { setWorkspaces(result.workspaces); setTruncated(result.truncated); }
      } catch (error) { if (active.current) setError(message(error)); }
      finally { pending.current = false; if (active.current) setBusy(false); }
    }}>{busy ? "Loading…" : "Load workspaces"}</button>
    {error && <p className={s.error} role="alert">{error}</p>}
    {truncated && <p className={s.hint}>Showing the first 1,000 workspaces. Enter a workspace ID to manage one outside this list.</p>}
    <label className={s.field}>Workspace<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a workspace</option>{workspaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
    <form onSubmit={event => {
      event.preventDefault();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(manualId.trim())) { setError("Enter a valid workspace ID."); return; }
      const id = manualId.trim();
      setWorkspaces(current => current.some(space => space.id === id) ? current : [...current, { id, name: id, ownerId: "" }]); setSelected(id);
    }}><label className={s.field}>Or use a workspace ID<input value={manualId} maxLength={128} onChange={event => setManualId(event.target.value)} /></label><button className={s.secondary}>Manage access</button></form>
    {workspace && <RootWorkspace key={`${api.user?.uid}:${workspace.id}`} api={api} workspace={workspace} />}
  </details>;
}
