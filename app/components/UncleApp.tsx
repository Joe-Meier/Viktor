"use client";

import { useCallback, useEffect, useState } from "react";
import NewThreadForm from "./NewThreadForm";
import RegistryPanel from "./RegistryPanel";
import Sidebar from "./Sidebar";
import ThreadView, { type Notice } from "./ThreadView";
import { createSampleThread } from "@/lib/sample";
import { loadState, saveState, type AppState } from "@/lib/storage";
import {
  addTheirReply,
  commitDraft,
  createThread,
  previewRegistry,
  setDraft,
  type NewThreadInput,
} from "@/lib/threads";
import { emptyRegistry, type LevelId, type RegistryUpdate, type Thread } from "@/lib/types";

interface ReplyResponse {
  reply?: string;
  update?: RegistryUpdate;
  error?: string;
  code?: string;
}

export default function UncleApp() {
  const [state, setState] = useState<AppState>(() => loadState(window.localStorage));
  const [composing, setComposing] = useState(() => state.threads.length === 0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice | null>>({});
  const [setup, setSetup] = useState<Notice | null>(null);

  useEffect(() => {
    saveState(window.localStorage, state);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: { configured: boolean; message?: string }) => {
        if (!cancelled && !s.configured) setSetup({ kind: "setup", text: s.message ?? "" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const active = composing ? null : (state.threads.find((t) => t.id === state.activeId) ?? null);

  const updateThread = useCallback((id: string, fn: (t: Thread) => Thread) => {
    setState((s) => ({ ...s, threads: s.threads.map((t) => (t.id === id ? fn(t) : t)) }));
  }, []);

  const generate = useCallback(
    async (thread: Thread, complicate: boolean) => {
      setBusyId(thread.id);
      setNotices((n) => ({ ...n, [thread.id]: null }));
      try {
        const res = await fetch("/api/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: thread.subject,
            counterparty: thread.counterparty,
            messages: thread.messages,
            registry: thread.registry,
            level: thread.level,
            previousDraft: complicate ? thread.draft?.text : undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as ReplyResponse;
        if (!res.ok || !data.reply || !data.update) {
          const notice: Notice =
            data.code === "missing_api_key"
              ? { kind: "setup", text: data.error ?? "" }
              : { kind: "error", text: data.error ?? `The server responded with ${res.status}.` };
          if (notice.kind === "setup") setSetup(notice);
          setNotices((n) => ({ ...n, [thread.id]: notice }));
          return;
        }
        const { reply, update } = data;
        updateThread(thread.id, (t) => setDraft(t, reply, update, t.level));
      } catch {
        setNotices((n) => ({
          ...n,
          [thread.id]: { kind: "error", text: "The app server could not be reached." },
        }));
      } finally {
        setBusyId(null);
      }
    },
    [updateThread],
  );

  const create = (input: NewThreadInput) => {
    const thread = createThread(input);
    setState((s) => ({ threads: [thread, ...s.threads], activeId: thread.id }));
    setComposing(false);
    void generate(thread, false);
  };

  const addReply = (thread: Thread, body: string) => {
    const next = addTheirReply(thread, body);
    updateThread(thread.id, () => next);
    void generate(next, false);
  };

  const remove = (id: string) => {
    setState((s) => {
      const threads = s.threads.filter((t) => t.id !== id);
      return { threads, activeId: threads[0]?.id ?? null };
    });
    setComposing((c) => c || state.threads.length <= 1);
  };

  const resetSample = () => {
    const fresh = createSampleThread();
    setState((s) => ({
      threads: s.threads.some((t) => t.id === fresh.id)
        ? s.threads.map((t) => (t.id === fresh.id ? fresh : t))
        : [...s.threads, fresh],
      activeId: fresh.id,
    }));
    setComposing(false);
  };

  const preview = active ? previewRegistry(active) : emptyRegistry();
  const notice = active ? (notices[active.id] ?? setup) : null;

  return (
    <div className="app">
      <Sidebar
        threads={state.threads}
        activeId={state.activeId}
        composing={composing}
        onSelect={(id) => {
          setComposing(false);
          setState((s) => ({ ...s, activeId: id }));
        }}
        onNew={() => setComposing(true)}
      />
      {active ? (
        <ThreadView
          key={active.id}
          thread={active}
          preview={preview}
          busy={busyId === active.id}
          notice={notice}
          onGenerate={(complicate) => void generate(active, complicate)}
          onDraftChange={(text) =>
            updateThread(active.id, (t) => (t.draft ? { ...t, draft: { ...t.draft, text } } : t))
          }
          onLevelChange={(level: LevelId) => updateThread(active.id, (t) => ({ ...t, level }))}
          onMarkSent={() => updateThread(active.id, (t) => commitDraft(t))}
          onDiscard={() => updateThread(active.id, (t) => ({ ...t, draft: null }))}
          onAddReply={(body) => addReply(active, body)}
          onDelete={() => remove(active.id)}
          onResetSample={resetSample}
        />
      ) : (
        <main className="thread">
          {setup && (
            <div className="notice notice-setup notice-top" role="alert">
              <strong>Setup needed.</strong> Put your key in <code>.env.local</code> as{" "}
              <code>ANTHROPIC_API_KEY=...</code>, then restart <code>npm run dev</code>.
            </div>
          )}
          <NewThreadForm
            onCreate={create}
            onCancel={state.threads.length > 0 ? () => setComposing(false) : null}
          />
        </main>
      )}
      {active ? (
        <RegistryPanel committed={active.registry} preview={preview} hasDraft={!!active.draft} />
      ) : (
        <aside className="registry">
          <div className="registry-head">
            <h2>Uncle Registry</h2>
            <p className="registry-sub">
              Each thread keeps its own registry of uncles, disagreements, outstanding requests and
              established facts. It fills in as replies are drafted.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
