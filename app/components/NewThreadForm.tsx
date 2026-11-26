import { useState } from "react";
import AbsurdityControl from "./AbsurdityControl";
import { DEFAULT_LEVEL } from "@/lib/escalation";
import type { LevelId } from "@/lib/types";
import type { NewThreadInput } from "@/lib/threads";

interface Props {
  onCreate: (input: NewThreadInput) => void;
  onCancel: (() => void) | null;
}

export default function NewThreadForm({ onCreate, onCancel }: Props) {
  const [body, setBody] = useState("");
  const [senderName, setSenderName] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState<LevelId>(DEFAULT_LEVEL);

  return (
    <form
      className="new-thread"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onCreate({ body, senderName, subject, level });
      }}
    >
      <header className="pane-head">
        <h1>New thread</h1>
        <p className="muted">
          Paste the cold email you received, or the whole thread so far. A reply draft is generated
          right away. Nothing is sent.
        </p>
      </header>
      <div className="new-thread-grid">
        <label className="field">
          <span className="field-label">From</span>
          <input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Salesperson's name (optional, detected if left blank)"
          />
        </label>
        <label className="field">
          <span className="field-label">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Email</span>
        <textarea
          className="paste"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"Hi Joe,\n\nI came across your company and thought you might be interested in..."}
          rows={14}
          autoFocus
        />
      </label>
      <AbsurdityControl value={level} onChange={setLevel} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!body.trim()}>
          Create thread and draft reply
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
