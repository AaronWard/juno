/** Confirm deleting a workspace.
 *
 *  Names the exact number of songs that will be affected before you commit,
 *  and is explicit that they go to Trash rather than being destroyed — a
 *  workspace is a container, and deleting a folder shouldn't eat the audio.
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { api } from "../lib/api";

export function WorkspaceDeleteModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { workspaces, songs, notify, removeWorkspace, trashSong, activeWorkspaceId, setActiveWorkspaceId } = useJuno();
  const [busy, setBusy] = useState(false);
  const ws = workspaces.find((w) => w.id === workspaceId);
  const defaultId = workspaces[0]?.id;
  const affected = songs.filter((s) => !s.trashed && (s.workspaceId ?? defaultId) === workspaceId);

  if (!ws) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.deleteWorkspace(workspaceId);
      // Don't leave the app pointing at a workspace that no longer exists.
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspaceId(workspaces.find((w) => w.id !== workspaceId)?.id || "");
      }
      // Mirror the server's trashing locally so the list updates without a reload.
      for (const s of affected) trashSong(s.id);
      removeWorkspace(workspaceId);
      notify(
        res.trashed > 0
          ? `Deleted "${ws.name}" — ${res.trashed} song(s) moved to Trash.`
          : `Deleted "${ws.name}".`,
        "success"
      );
      onClose();
    } catch (e: any) {
      notify(e?.message || "Could not delete the workspace", "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete "${ws.name}"?`}
      open
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={confirm}>
            Delete workspace
          </Button>
        </>
      }
    >
      {affected.length > 0 ? (
        <>
          <p>
            <strong>{affected.length}</strong> song{affected.length === 1 ? "" : "s"} in this workspace will be moved
            to Trash.
          </p>
          <p className="inline-hint">
            Nothing is destroyed — they stay in Trash for 14 days and can be restored individually. Anything already
            in Trash is unaffected.
          </p>
        </>
      ) : (
        <p>This workspace is empty. Deleting it won't affect any songs.</p>
      )}
    </Modal>
  );
}
