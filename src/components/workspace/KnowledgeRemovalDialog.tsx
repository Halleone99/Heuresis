import { useMemo, useState } from "react";
import { ArrowLeft, FolderInput, Trash2, X } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";
import { Portal } from "./ui";

export type KnowledgeRemovalTarget = { kind: "subject" | "topic"; id: string; name: string };

/** Destructive actions are never a side effect of navigating or closing this dialog.
 * A topic/subject with children first offers a lossless move. Deletion requires
 * an explicit second step and typing the exact label for non-empty trees. */
export function KnowledgeRemovalDialog({ target, onClose, onRemoved }: {
  target: KnowledgeRemovalTarget;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const workspace = useWorkspace();
  const [step, setStep] = useState<"choice" | "move" | "delete">("choice");
  const [destination, setDestination] = useState("");
  const [verification, setVerification] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const affectedTopics = useMemo(() => target.kind === "subject"
    ? workspace.snapshot.topics.filter((topic) => topic.subject_id === target.id).map((topic) => topic.id)
    : workspace.subtreeIds(target.id),
    [target.id, target.kind, workspace.snapshot.topics, workspace.subtreeIds]);
  const affectedIds = useMemo(() => new Set(affectedTopics), [affectedTopics]);
  const records = workspace.snapshot.entries.filter((entry) => affectedIds.has(entry.topic_id)).length;
  const nonempty = records > 0 || (target.kind === "subject" ? affectedTopics.length > 0 : affectedTopics.length > 1);
  const destinations = target.kind === "subject"
    ? [...workspace.snapshot.subjects].filter((subject) => subject.id !== target.id)
      .sort((a, b) => a.name.localeCompare(b.name)).map((subject) => ({ id: subject.id, label: subject.name }))
    : [...workspace.snapshot.topics].filter((topic) => !affectedIds.has(topic.id))
      .sort((a, b) => workspace.pathLabel(a.id).localeCompare(workspace.pathLabel(b.id)))
      .map((topic) => ({ id: topic.id, label: workspace.pathLabel(topic.id) }));
  async function perform(action: "move" | "delete") {
    if (working || (action === "move" && !destinations.some((row) => row.id === destination))
      || (action === "delete" && verification !== target.name)) return;
    setWorking(true); setError("");
    try {
      if (target.kind === "subject") await workspace.manageSubjectTree(target.id, action, action === "move" ? destination : undefined);
      else await workspace.manageTopicTree(target.id, action, action === "move" ? destination : undefined);
      workspace.toast(action === "move"
        ? `Moved the contents and removed “${target.name}”.`
        : `Deleted “${target.name}” and its contents.`);
      onRemoved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation failed. Nothing else was removed.");
    } finally { setWorking(false); }
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation"
    onMouseDown={(event) => { if (!working && event.target === event.currentTarget) onClose(); }}>
    <div className="ws-dialog nb-remove-dialog" role="dialog" aria-modal="true" aria-labelledby="nb-remove-title"
      onKeyDown={(event) => { if (event.key === "Escape" && !working) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="ws-dialog-head"><h2 id="nb-remove-title">
        {step === "choice" ? "Remove " : step === "move" ? "Move contents of " : "Delete "}
        {target.name}
      </h2><button type="button" className="ws-icon-button" onClick={onClose} disabled={working} aria-label="Close"><X size={16}/></button></div>
      <p className="nb-remove-count">{affectedTopics.length} {affectedTopics.length === 1 ? "topic" : "topics"} · {records} {records === 1 ? "entry" : "entries"} visible</p>
      {step === "choice" ? <>
        <p>Would you like to move the contents somewhere else before removing this {target.kind}?</p>
        <div className="nb-remove-choices">
          <button type="button" disabled={!destinations.length} onClick={() => { setStep("move"); setError(""); }}>
            <FolderInput size={18}/><span><strong>Move contents first</strong><small>
              {target.kind === "subject" ? "Keep every note and the existing topic hierarchy in another subject"
                : "Move entries and attach subtopics beneath a different topic"}</small></span>
          </button>
          <button className="is-danger" type="button" onClick={() => { setStep("delete"); setError(""); }}>
            <Trash2 size={18}/><span><strong>{nonempty ? "Delete everything" : "Delete empty " + target.kind}</strong><small>
              Permanently delete this {target.kind}{nonempty ? ", its nested topics and all records, including Trash and practice history" : ""}</small></span>
          </button>
        </div>
      </> : step === "move" ? <>
        <p>Choose where to place the contents. Existing notes, mistakes, archived records and practice history will be preserved.</p>
        <label className="ws-field"><span>Destination {target.kind === "subject" ? "subject" : "topic"}</span>
          <select value={destination} disabled={working} onChange={(event) => setDestination(event.target.value)}>
            <option value="">Choose a destination…</option>
            {destinations.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="ws-dialog-actions"><button type="button" className="ws-button" disabled={working} onClick={() => setStep("choice")}><ArrowLeft size={14}/> Back</button>
          <button type="button" className="ws-button is-primary" disabled={!destination || working}
            onClick={() => void perform("move")}>{working ? "Moving…" : "Move and remove"}</button></div>
      </> : <>
        <p className="nb-remove-warning">This permanently deletes the selected {target.kind}, its subtopics and all contained records, including archived material and associated recall history. It cannot be undone.</p>
        <label className="ws-field"><span>Type <strong>{target.name}</strong> to confirm deletion</span>
          <input autoFocus type="text" value={verification} disabled={working} onChange={(event) => setVerification(event.target.value)}
            autoComplete="off" /></label>
        <div className="ws-dialog-actions"><button type="button" className="ws-button" disabled={working} onClick={() => setStep("choice")}><ArrowLeft size={14}/> Back</button>
          <button type="button" className="ws-button nb-remove-confirm" disabled={working || verification !== target.name}
            onClick={() => void perform("delete")}>{working ? "Deleting…" : "Confirm deletion"}</button></div>
      </>}
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    </div>
  </div></Portal>;
}
