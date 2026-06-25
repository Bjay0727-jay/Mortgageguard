"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";

const ROLES = ["company_admin", "qualifying_individual", "loan_originator", "processor", "compliance_officer", "read_only"];

interface UserRow { id: string; name: string; email: string; role: string; nmlsId: string | null; status: string; createdAt: string; }
interface InviteRow { id: string; email: string; role: string; invitedBy: string | null; expiresAt: string; status: string; inviteUrl?: string; }

export default function UsersPage() {
  const { can } = useCapabilities();
  const allowed = can("manageUsers") || can("manageInvites");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: "", role: "loan_originator", expiresInDays: "7" });
  const [createdInviteUrl, setCreatedInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setError("");
    try {
      const [usersData, invitesData] = await Promise.all([
        can("manageUsers") ? api.get<{ users: UserRow[] }>("/api/v1/users") : Promise.resolve({ users: [] }),
        can("manageInvites") ? api.get<{ invites: InviteRow[] }>("/api/v1/users/invites") : Promise.resolve({ invites: [] }),
      ]);
      setUsers(usersData.users);
      setInvites(invitesData.invites);
    } catch (e: any) {
      setError(e.message || "Unable to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (allowed) load(); }, [allowed]);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreatedInviteUrl("");
    try {
      const data = await api.post<{ inviteUrl: string }>("/api/v1/users/invites", { email: form.email, role: form.role, expiresInDays: Number(form.expiresInDays) });
      setCreatedInviteUrl(data.inviteUrl);
      setForm({ email: "", role: "loan_originator", expiresInDays: "7" });
      await load();
    } catch (e: any) {
      setError(e.message || "Unable to create invite");
    }
  }

  async function revoke(id: string) {
    await api.post(`/api/v1/users/invites/${id}/revoke`);
    await load();
  }

  async function resend(id: string) {
    const data = await api.post<{ inviteUrl: string }>(`/api/v1/users/invites/${id}/resend`);
    setCreatedInviteUrl(data.inviteUrl);
    await load();
  }

  if (!allowed) return <InsufficientPermission />;
  if (loading) return <p className="text-sm text-gray-500">Loading users...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0F7B46]">Admin</p>
          <h1 className="mt-2 text-2xl font-bold text-[#1B3A6B]">Users & Invites</h1>
          <p className="mt-2 text-sm text-gray-600">Invite team members and manage company-scoped access.</p>
        </div>
        {can("manageInvites") && <button onClick={() => setShowInvite(true)} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298]">Invite User</button>}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {createdInviteUrl && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Invite link created: <button onClick={() => navigator.clipboard?.writeText(createdInviteUrl)} className="font-semibold underline">Copy invite link</button><div className="mt-1 break-all text-xs">{createdInviteUrl}</div></div>}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#1B3A6B]">Existing Users</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500"><th className="py-2">Name</th><th>Email</th><th>Role</th><th>NMLS ID</th><th>Status</th><th>Created</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => <tr key={u.id}><td className="py-3 font-medium text-gray-900">{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.nmlsId || "—"}</td><td>{u.status}</td><td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td></tr>)}
              {users.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#1B3A6B]">Invites</h2>
        <div className="space-y-3">
          {invites.map((invite) => (
            <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <div><p className="text-sm font-semibold text-gray-900">{invite.email}</p><p className="text-xs text-gray-500">{invite.role} · {invite.status} · expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div>
              {invite.status === "pending" && <div className="flex gap-2"><button onClick={() => resend(invite.id)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">Resend</button><button onClick={() => revoke(invite.id)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700">Revoke</button></div>}
            </div>
          ))}
          {invites.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">No invites yet.</p>}
        </div>
      </section>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && setShowInvite(false)}>
          <form onSubmit={createInvite} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#1B3A6B]">Invite user</h2>
            <div className="mt-4 space-y-4">
              <input required type="email" placeholder="email@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>
              <input type="number" min="1" max="30" value={form.expiresInDays} onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowInvite(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium">Cancel</button><button type="submit" className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white">Create invite</button></div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
