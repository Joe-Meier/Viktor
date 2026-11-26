import type { Registry } from "@/lib/types";

interface Props {
  committed: Registry;
  preview: Registry;
  hasDraft: boolean;
}

function Pending() {
  return <span className="tag tag-pending">In draft</span>;
}

export default function RegistryPanel({ committed, preview, hasDraft }: Props) {
  const has = <T extends { id: string }>(list: T[], id: string) => list.some((x) => x.id === id);
  const committedUncle = (id: string) => committed.uncles.find((u) => u.id === id);
  const open = preview.requests.filter((r) => r.status === "open");
  const resolved = preview.requests.filter((r) => r.status === "resolved");

  return (
    <aside className="registry" aria-label="Uncle Registry">
      <div className="registry-head">
        <h2>Uncle Registry</h2>
        <p className="registry-sub">
          Canon for this thread. New replies must stay consistent with it.
          {hasDraft && " Items marked In draft become canon once the draft is marked as sent."}
        </p>
      </div>

      <section className="reg-section">
        <h3>
          Uncles <span className="count">{preview.uncles.length}</span>
        </h3>
        {preview.uncles.length === 0 ? (
          <p className="empty">No uncles yet. The first reply will introduce one.</p>
        ) : (
          <ul className="uncle-list">
            {preview.uncles.map((u) => {
              const before = committedUncle(u.id);
              return (
                <li key={u.id} className="uncle">
                  <div className="uncle-top">
                    <span className="uncle-name">Uncle {u.name}</span>
                    {!before && <Pending />}
                  </div>
                  {u.role && <div className="uncle-role">{u.role}</div>}
                  {u.authority.length > 0 && (
                    <dl className="uncle-dl">
                      <dt>Authority</dt>
                      <dd>
                        {u.authority.map((a) => (
                          <span key={a} className="line">
                            {a}
                            {before && !before.authority.includes(a) && <Pending />}
                          </span>
                        ))}
                      </dd>
                    </dl>
                  )}
                  {u.traits.length > 0 && (
                    <dl className="uncle-dl">
                      <dt>Traits</dt>
                      <dd>
                        {u.traits.map((t) => (
                          <span key={t} className="line">
                            {t}
                            {before && !before.traits.includes(t) && <Pending />}
                          </span>
                        ))}
                      </dd>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="reg-section">
        <h3>
          Disagreements <span className="count">{preview.disagreements.length}</span>
        </h3>
        {preview.disagreements.length === 0 ? (
          <p className="empty">None on record.</p>
        ) : (
          <ul className="reg-list">
            {preview.disagreements.map((d) => (
              <li key={d.id}>
                <span className="reg-parties">{d.parties.join(" and ") || "The family"}</span>
                <span>{d.subject}</span>
                {!has(committed.disagreements, d.id) && <Pending />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="reg-section">
        <h3>
          Outstanding requests <span className="count">{open.length}</span>
        </h3>
        {open.length === 0 && resolved.length === 0 ? (
          <p className="empty">Nothing requested of the vendor yet.</p>
        ) : (
          <ul className="reg-list">
            {open.map((r) => (
              <li key={r.id}>
                {r.from && <span className="reg-parties">{r.from}</span>}
                <span>{r.request}</span>
                {!has(committed.requests, r.id) && <Pending />}
              </li>
            ))}
            {resolved.map((r) => (
              <li key={r.id} className="is-resolved">
                <span>{r.request}</span>
                <span className="tag tag-muted">Resolved</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="reg-section">
        <h3>
          Established facts <span className="count">{preview.facts.length}</span>
        </h3>
        {preview.facts.length === 0 ? (
          <p className="empty">None yet.</p>
        ) : (
          <ol className="fact-list">
            {preview.facts.map((f) => (
              <li key={f.id}>
                <span>{f.text}</span>
                {!has(committed.facts, f.id) && <Pending />}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
