import { useState } from "react";
import AbsurdityControl from "./AbsurdityControl";
import { formatFullDate, initials } from "./format";
import { statusLine } from "@/lib/registry";
import type { LevelId, Registry, Thread } from "@/lib/types";

export interface Notice {
  kind: "setup" | "error";
  text: string;
}

interface Props {
  thread: Thread;
  preview: Registry;
  busy: boolean;
  notice: Notice | null;
  onGenerate: (complicate: boolean) => void;
  onDraftChange: (text: string) => void;
  onLevelChange: (level: LevelId) => void;
  onMarkSent: () => void;
  onDiscard: () => void;
  onAddReply: (body: string) => void;
  onDelete: () => void;
  onResetSample: () => void;
}

export default function ThreadView(props: Props) {
  const { thread, preview, busy, notice } = props;
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [showReplyBox, setShowReplyBox] = useState(false);
  const last = thread.messages[thread.messages.length - 1];
  const awaitingDraft = last?.from === "them" && !thread.draft;
  const replyBoxOpen = showReplyBox || (!thread.draft && last?.from === "me");

  const copy = async () => {
    if (!thread.draft) return;
    try {
      await navigator.clipboard.writeText(thread.draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="thread" aria-label="Email thread">
      <header className="pane-head thread-head">
        <div className="thread-head-row">
          <h1 className="thread-subject">{thread.subject}</h1>
          <div className="thread-head-actions">
            {thread.isSample ? (
              <button type="button" className="btn btn-quiet btn-small" onClick={props.onResetSample}>
                Reset sample
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => {
                  if (window.confirm("Delete this thread and its registry?")) props.onDelete();
                }}
              >
                Delete thread
              </button>
            )}
          </div>
        </div>
        <div className="thread-meta">
          {thread.isSample && <span className="tag tag-sample">Sample conversation</span>}
          <span>With {thread.counterparty}</span>
          <span aria-hidden>·</span>
          <span>
            {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}
          </span>
          <span aria-hidden>·</span>
          <span className="status-line" role="status">
            {statusLine(preview)}
          </span>
        </div>
      </header>

      <div className="thread-scroll">
        <ol className="messages">
          {thread.messages.map((m) => (
            <li key={m.id} className={`message message-${m.from}`}>
              <div className="message-head">
                <span className={`avatar avatar-${m.from}`} aria-hidden>
                  {m.from === "me" ? "You" : initials(m.senderName)}
                </span>
                <div className="message-from">
                  <span className="message-sender">{m.from === "me" ? "You" : m.senderName}</span>
                  <span className="message-to">
                    {m.from === "me" ? `to ${thread.counterparty}` : "to you"}
                  </span>
                </div>
                <time className="message-date" dateTime={m.createdAt}>
                  {formatFullDate(m.createdAt)}
                </time>
              </div>
              <div className="message-body">{m.body}</div>
            </li>
          ))}
        </ol>

        {notice && (
          <div className={`notice notice-${notice.kind}`} role="alert">
            {notice.kind === "setup" ? (
              <>
                <strong>Setup needed.</strong> Put your key in <code>.env.local</code> as{" "}
                <code>ANTHROPIC_API_KEY=...</code>, then restart <code>npm run dev</code>.
                <div className="notice-detail">{notice.text}</div>
              </>
            ) : (
              <>
                <strong>The reply could not be generated.</strong> {notice.text}
              </>
            )}
          </div>
        )}

        {(thread.draft || awaitingDraft) && (
          <section className="composer" aria-label="Reply draft">
            <div className="composer-head">
              <span className="composer-title">
                {thread.draft ? "Draft reply" : "Reply"}
                <span className="composer-to"> to {thread.counterparty}</span>
              </span>
              <span className="composer-flag">Draft only. Copy it into your email client to send.</span>
            </div>
            {thread.draft ? (
              <textarea
                className="draft"
                value={thread.draft.text}
                onChange={(e) => props.onDraftChange(e.target.value)}
                rows={Math.min(14, Math.max(6, thread.draft.text.split("\n").length + 2))}
                aria-label="Reply draft text"
                disabled={busy}
              />
            ) : (
              <div className="draft-empty">
                {busy ? "Consulting the family…" : "No draft yet for the latest email."}
              </div>
            )}
            <div className="composer-foot">
              <AbsurdityControl value={thread.level} onChange={props.onLevelChange} disabled={busy} />
              <div className="actions">
                {thread.draft ? (
                  <>
                    <button type="button" className="btn btn-primary" onClick={copy} disabled={busy}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button type="button" className="btn" onClick={() => props.onGenerate(true)} disabled={busy}>
                      {busy ? "Complicating…" : "Complicate matters"}
                    </button>
                    <button type="button" className="btn" onClick={props.onMarkSent} disabled={busy}>
                      Mark as sent
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={props.onDiscard} disabled={busy}>
                      Discard
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => props.onGenerate(false)} disabled={busy}>
                    {busy ? "Drafting…" : "Draft reply"}
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="their-reply">
          {replyBoxOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!reply.trim()) return;
                props.onAddReply(reply);
                setReply("");
                setShowReplyBox(false);
              }}
            >
              <label className="field">
                <span className="field-label">Their reply</span>
                <textarea
                  className="paste"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={6}
                  placeholder={`Paste ${thread.counterparty}'s follow-up here.`}
                />
              </label>
              {thread.draft && (
                <p className="muted small">The current draft will be added to the thread as sent.</p>
              )}
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={!reply.trim() || busy}>
                  Add to thread and draft reply
                </button>
                {thread.draft && (
                  <button type="button" className="btn btn-quiet" onClick={() => setShowReplyBox(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <button type="button" className="btn btn-dashed btn-block" onClick={() => setShowReplyBox(true)}>
              Add their reply
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
