// =============================================================================
// components/auth/UserManagement.tsx
// Admin-only: list, create, edit, password change (with current pw for self), delete
// =============================================================================

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useAuth } from "../../context/AuthContext";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

interface User {
  id: string; username: string; email: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}

const ROLE_BADGE: Record<string, string> = {
  ADMIN:    "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
  OPERATOR: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  VIEWER:   "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300",
};

function useAuthHeaders(): Record<string, string> {
  const { token } = useAuth();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}

export function UserManagement() {
  const { token, user: me } = useAuth();
  const headers = useAuthHeaders();

  const { data: users = [], isLoading } = useSWR<User[]>(
    `${BASE}/users`,
    (url: string) => fetch(url, { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json()),
    { refreshInterval: 30_000 }
  );

  const [showCreate,  setShowCreate]  = useState(false);
  const [editUser,    setEditUser]    = useState<User | null>(null);
  const [pwUser,      setPwUser]      = useState<User | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [busy,        setBusy]        = useState(false);
  const [successMsg,  setSuccessMsg]  = useState<string | null>(null);

  const reload = () => mutate(`${BASE}/users`);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // ── Create user ─────────────────────────────────────────────────────────
  const CreateForm = () => {
    const [form, setForm] = useState({ username: "", email: "", password: "", role: "OPERATOR" });
    const set = (k: keyof typeof form) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(p => ({ ...p, [k]: e.target.value }));

    const submit = async (e: React.FormEvent) => {
      e.preventDefault(); setBusy(true); setError(null);
      try {
        const res = await fetch(`${BASE}/users`, { method: "POST", headers, body: JSON.stringify(form) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed");
        reload(); setShowCreate(false); showSuccess(`User "${form.username}" created`);
      } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
      finally { setBusy(false); }
    };

    return (
      <form onSubmit={submit} className="rounded-lg border bg-background p-4 space-y-3 mt-3">
        <h3 className="text-sm font-medium">New user</h3>
        <div className="grid grid-cols-2 gap-3">
          {([ ["username","Username","text"], ["email","Email","email"], ["password","Password","password"] ] as const).map(([k, l, t]) => (
            <div key={k} className={cn("space-y-1", k === "password" && "col-span-2")}>
              <label className="text-xs text-muted-foreground">{l}</label>
              <input type={t} value={(form as any)[k]} onChange={set(k as keyof typeof form)} required
                className="h-8 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Role</label>
            <select value={form.role} onChange={set("role")}
              className="h-8 w-full rounded border border-border bg-background px-2 text-sm">
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { setShowCreate(false); setError(null); }}
            className="h-7 px-3 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          <button type="submit" disabled={busy}
            className="h-7 px-3 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    );
  };

  // ── Edit role/active ─────────────────────────────────────────────────────
  const EditForm = ({ u }: { u: User }) => {
    const [role, setRole]     = useState(u.role);
    const [active, setActive] = useState(u.isActive);

    const submit = async () => {
      setBusy(true); setError(null);
      try {
        const res = await fetch(`${BASE}/users/${u.id}`, {
          method: "PATCH", headers, body: JSON.stringify({ role, isActive: active }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        reload(); setEditUser(null); showSuccess("User updated");
      } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
      finally { setBusy(false); }
    };

    return (
      <div className="rounded-lg border bg-background p-4 mt-3 space-y-3">
        <h3 className="text-sm font-medium">Edit {u.username}</h3>
        <div className="flex gap-4 items-center flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as any)}
              className="h-8 rounded border border-border bg-background px-2 text-sm block">
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer mt-4">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="rounded"/>
            Active
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setEditUser(null); setError(null); }}
            className="h-7 px-3 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="h-7 px-3 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    );
  };

  // ── Password form — always shows currentPassword for self, admin can omit it for others ──
  const PwForm = ({ u }: { u: User }) => {
    const isSelf = u.id === me?.id;
    const [currentPw, setCurrentPw] = useState("");
    const [newPw,     setNewPw]     = useState("");
    const [confirmPw, setConfirmPw] = useState("");

    const submit = async () => {
      if (!newPw || newPw.length < 8) { setError("New password must be at least 8 characters"); return; }
      if (newPw !== confirmPw) { setError("Passwords do not match"); return; }
      if (isSelf && !currentPw) { setError("Current password is required"); return; }

      setBusy(true); setError(null);
      try {
        const body: any = { newPassword: newPw };
        if (isSelf) body.currentPassword = currentPw;

        const res = await fetch(`${BASE}/users/${u.id}/password`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
        setPwUser(null); showSuccess("Password updated successfully");
      } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
      finally { setBusy(false); }
    };

    return (
      <div className="rounded-lg border bg-background p-4 mt-3 space-y-3">
        <h3 className="text-sm font-medium">
          {isSelf ? "Change your password" : `Reset password for ${u.username}`}
        </h3>

        <div className="space-y-2">
          {/* Current password — required when changing own password */}
          {isSelf && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Current password</label>
              <input type="password" value={currentPw} onChange={e => { setCurrentPw(e.target.value); setError(null); }}
                placeholder="Your current password"
                className="h-8 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
            </div>
          )}
          {!isSelf && (
            <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded px-2 py-1.5">
              As admin you can reset this user's password without their current password.
            </p>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">New password</label>
            <input type="password" value={newPw} onChange={e => { setNewPw(e.target.value); setError(null); }}
              placeholder="Minimum 8 characters"
              className="h-8 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Confirm new password</label>
            <input type="password" value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setError(null); }}
              placeholder="Repeat new password"
              className="h-8 w-full rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setPwUser(null); setError(null); }}
            className="h-7 px-3 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="h-7 px-3 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : "Set password"}
          </button>
        </div>
      </div>
    );
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await fetch(`${BASE}/users/${u.id}`, { method: "DELETE", headers });
      reload(); showSuccess(`User "${u.username}" deleted`);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">User management</h2>
          <p className="text-xs text-muted-foreground">{users.length} user{users.length !== 1 ? "s" : ""} · ADMIN only</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditUser(null); setPwUser(null); setError(null); }}
          className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
          {showCreate ? "Cancel" : "+ New user"}
        </button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          {successMsg}
        </div>
      )}

      {/* Inline forms */}
      {showCreate && <CreateForm />}
      {editUser   && <EditForm u={editUser} />}
      {pwUser     && <PwForm   u={pwUser}   />}

      {/* User table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium">Username</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Email</th>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Last login</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 w-32 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground text-sm">Loading…</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className={cn("hover:bg-muted/30 transition-colors", !u.isActive && "opacity-50")}>
                <td className="px-3 py-2.5 font-medium">
                  {u.username}
                  {u.id === me?.id && <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">(you)</span>}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{u.email}</td>
                <td className="px-3 py-2.5">
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", ROLE_BADGE[u.role])}>
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border",
                    u.isActive
                      ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400"
                  )}>
                    {u.isActive ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => { setEditUser(editUser?.id === u.id ? null : u); setPwUser(null); setShowCreate(false); setError(null); }}
                      className={cn("h-6 px-2 text-[10px] rounded border transition-colors",
                        editUser?.id === u.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                      )}>Edit</button>
                    <button
                      onClick={() => { setPwUser(pwUser?.id === u.id ? null : u); setEditUser(null); setShowCreate(false); setError(null); }}
                      className={cn("h-6 px-2 text-[10px] rounded border transition-colors",
                        pwUser?.id === u.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                      )}>Pw</button>
                    {u.id !== me?.id && (
                      <button onClick={() => handleDelete(u)}
                        className="h-6 px-2 text-[10px] rounded border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20">Del</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
