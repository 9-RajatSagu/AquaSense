import { useCallback, useEffect, useState } from "react";
import CopyField from "./CopyField";
import { Notice } from "./Ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Device, Member } from "../lib/types";

export default function MembersPanel({ device }: { device: Device }) {
  const isOwner = device.role === "owner";
  const deviceId = encodeURIComponent(device.device_id);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{ code: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ members: Member[] }>(`/api/devices/${deviceId}/members`);
      setMembers(result.members);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ code: string; expires_at: string }>(`/api/devices/${deviceId}/invites`, { method: "POST" });
      setInvite({ code: result.code, expires: result.expires_at });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.email || "this person"} from "${device.name}"? They lose access straight away.`)) return;
    setError("");
    try {
      await api(`/api/devices/${deviceId}/members/${encodeURIComponent(member.user_id)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="members">
      {error && <Notice tone="bad">{error}</Notice>}
      {members === null && !error && <p className="loading">Loading</p>}
      {members !== null && (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id}>
              <div>
                <strong>{m.email || "Account"}</strong>
                {m.is_me && <span className="muted-text small"> (you)</span>}
              </div>
              <span className={`tag ${m.role === "owner" ? "tag-ok" : "tag-off"}`}>{m.role === "owner" ? "Owner" : "Member"}</span>
              {isOwner && !m.is_me && m.role === "member" && (
                <button type="button" className="btn btn-danger btn-small" onClick={() => void removeMember(m)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner ? (
        <>
          <p className="muted-text small">
            Members can see this tank and start or stop the pump. Only you can change settings or invite and remove people.
          </p>
          <div>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void createInvite()} disabled={busy}>
              {busy ? "Creating" : "Create invite code"}
            </button>
          </div>
          {invite && (
            <>
              <CopyField label="Invite code" value={invite.code} />
              <p className="muted-text small">
                Works once and expires {formatDateTime(invite.expires)}. The other person enters it under Devices, then Join with code.
              </p>
            </>
          )}
        </>
      ) : (
        <p className="muted-text small">You are a member. You can see this tank and control the pump. The owner manages settings and people.</p>
      )}
    </div>
  );
}
