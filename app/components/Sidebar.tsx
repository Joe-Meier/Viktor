import type { Thread } from "@/lib/types";
import { formatDate } from "./format";

interface Props {
  threads: Thread[];
  activeId: string | null;
  composing: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function Sidebar({ threads, activeId, composing, onSelect, onNew }: Props) {
  const sorted = [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <aside className="sidebar" aria-label="Saved threads">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Per My Last Uncle</span>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={onNew}>
        New thread
      </button>
      <p className="sidebar-hint">Paste a real sales email to start.</p>
      <div className="sidebar-label">Threads</div>
      <ul className="thread-list">
        {sorted.map((t) => {
          const active = !composing && t.id === activeId;
          const last = t.messages[t.messages.length - 1];
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`thread-item${active ? " is-active" : ""}`}
                onClick={() => onSelect(t.id)}
                aria-current={active ? "true" : undefined}
              >
                <span className="thread-item-top">
                  <span className="thread-item-title">{t.title}</span>
                  <span className="thread-item-date">{formatDate(t.updatedAt)}</span>
                </span>
                <span className="thread-item-subject">{t.subject}</span>
                <span className="thread-item-meta">
                  {t.isSample && <span className="tag tag-sample">Sample</span>}
                  <span>
                    {t.registry.uncles.length} {t.registry.uncles.length === 1 ? "uncle" : "uncles"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{t.draft ? "Draft ready" : last?.from === "them" ? "Awaiting reply" : "Sent"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sidebar-foot">Drafts only. Nothing is sent from this app.</p>
    </aside>
  );
}
