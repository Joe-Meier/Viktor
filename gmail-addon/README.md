# Per My Last Uncle for Gmail

A Gmail side panel for the same idea as the web app. Open a sales email and the panel shows that thread's **Uncle Registry** (uncles and their roles and authority, disagreements, outstanding requests, established facts), an absurdity control, and a **Generate reply** button. The reply appears in an editable box with **Create Gmail draft**, **Send reply**, **Complicate matters** (try again, further), and **I sent it**.

**Nothing is sent without your say-so.** "Create Gmail draft" opens a reply draft in that thread for you to send yourself. "Send reply" first shows a review card with the recipient, subject and full text; only **Send now** on that card sends.

It works in Gmail on the web and in the Gmail app on iPhone and Android. It runs from your own Google account: no server, no store listing.

## Install (about 5 minutes)

You need: your Google account, and an Anthropic API key (console.anthropic.com > API keys).

1. **Make the project.** Go to [script.google.com](https://script.google.com) and click **New project**. Click "Untitled project" at the top and name it `Per My Last Uncle`.
2. **Paste the code.**
   - The editor opens a file called `Code.gs`. Delete what's in it and paste in all of [`Code.gs`](Code.gs).
   - Click **+** next to "Files" > **Script**, name it `Shared` (the editor adds `.gs`), and paste in all of [`Shared.gs`](Shared.gs).
3. **Paste the manifest.** Click the gear (**Project Settings**) on the left and tick **Show "appsscript.json" manifest file in editor**. Go back to the editor (`< >` on the left), open `appsscript.json`, replace everything in it with [`appsscript.json`](appsscript.json), and press **Save** (the disk icon, or Ctrl/Cmd+S).
4. **Add your key.** Project Settings again > scroll to **Script properties** > **Add script property**. Property `ANTHROPIC_API_KEY`, value your key. **Save script properties.**
5. **Install it in your Gmail.** Top right, **Deploy** > **Test deployments**. Under "Application(s)", **Gmail** is listed; click **Install**, then **Done**.
6. **Use it.** Open (or reload) Gmail and open a sales email.
   - **Web:** in the narrow bar on the right edge, click the uncle icon (an elderly man with a cane). The panel opens beside the email.
   - **Phone:** open the email in the Gmail app and scroll to the bottom; tap the **Per My Last Uncle** row.

**The first time only**, the panel asks for access: click **Authorize access** and pick your account. Google lists what it can do. The big one is **"Read, compose, send, and permanently delete all your email from Gmail"**: that's the full-mail permission Gmail's script tools need to send a reply. The add-on only uses it to send when you tap Send now. It never deletes anything. The others: run as a Gmail add-on, read the email you have open, manage drafts when you use the add-on, connect to an external service (Anthropic), and see your email address (so it can tell your messages from theirs). Because this is your own unpublished script, Google may show **"Google hasn't verified this app"**: click **Advanced** > **Go to Per My Last Uncle (unsafe)**. That warning is about the app not being reviewed by Google; it's your own code running in your own account. On a company Google Workspace account an administrator may have blocked unverified scripts; if Install or authorization is refused, that's why.

## Using it

- **Absurdity** runs from "1. Minor family involvement" to "5. Constitutional uncle crisis". Pick it before you generate.
- **Generate reply** writes a 2-4 sentence reply that answers the actual pitch and adds one complication. Edit the text in the box as much as you like.
- **Complicate matters** writes a different version that goes a little further than the one in the box.
- **Create Gmail draft** puts the text from the box into a reply draft in this thread. Review and send it from Gmail.
  - One exception: when the sender's name has a comma in it (`"Silence, Brand!" <…@substack.com>`), Gmail's script tools can't reply to it. The add-on then opens a new draft to their bare address with "Re: <subject>". That draft isn't linked to the conversation. Apps Script's draft tools can't attach a new draft to a thread, so it can't be kept in the conversation.
- **Send reply** sends the text in the box without going through drafts. It opens a review card first: **To** (their bare address, or their Reply-To address if the email has one), **Subject** (`Re: …`) and the full reply, with **Send now** and **Back**. Back sends nothing.
  - Send now sends it as a normal Gmail reply in the same conversation.
  - Comma-name senders (like `"Silence, Brand!"`) are the exception: Gmail's script tools can't reply to them. The review card says **"Arrives as a new email, not in this conversation"**, and Send now sends a new email to their bare address with "Re: <subject>". It may show up as a separate conversation on both sides.
  - On success the panel says "Sent. The registry is now canon." and the draft's changes become canon, as if you'd tapped I sent it.
  - If Gmail refuses, you see its error, nothing is sent, and your reply and its *(in draft)* changes stay.
  - If you already made a Gmail draft of the same reply, delete that draft after sending.
- **Canon.** What a draft adds to the registry is marked *(in draft)* and stays tentative until the reply is sent. It becomes canon when you tap **I sent it**, or by itself the next time you open the thread after a newer message is in it (their reply, or your sent reply). Canon is never rewritten: an uncle who distrusts subscriptions still does three emails later.
- **Settings** (bottom of the panel): Reload, and *Clear this thread's registry* to start a thread over.

## Good to know

- **Separate from the web app.** The add-on keeps each thread's registry in your Google account (Apps Script user properties, keyed by Gmail thread), so it follows you between computer and phone. The web app keeps its threads in your browser. The two don't share threads.
- **Storage.** Google allows 500 KB per user. A long thread's registry is split across several entries automatically; if space ever runs out, the registries of the threads you touched least recently are removed first and the panel says so.
- **Model.** Defaults to `claude-sonnet-5-5`. To use another, add the script property `ANTHROPIC_MODEL`.
- **Other addresses.** It recognises your own messages by your Google account address. If you also send from an alias, add the script property `MY_EMAILS` with the addresses, comma-separated.
- **Errors** show as a card with the reason (missing key, key rejected, rate limit, Anthropic down) and **Try again**. Gmail stops an add-on action after about 30 seconds; a reply normally takes 3-5 seconds.
- **Updating.** Paste the new file contents and Save. The test deployment always runs your latest saved code; no need to reinstall.
- **Uninstall.** Deploy > Test deployments > **Uninstall**.
- **Your key** lives only in the project's Script properties, which only you (and anyone you share the project with) can see.

## Files

| File | What it is |
| --- | --- |
| `appsscript.json` | Manifest: Gmail side panel on any opened email, a homepage card, V8 runtime, scopes. |
| `Code.gs` | Cards, buttons, reading the Gmail thread, user-properties storage, the Anthropic call. |
| `Shared.gs` | Pure logic shared with the web app: system prompt and tone rules, absurdity levels, prompt builder, response parsing and retry, registry merge and canon, storage encoding. Runs under Node too. |
| `dev/` | Not part of the add-on. `harness.mjs` loads the `.gs` files under Node with stand-ins for Gmail and CardService (used by `tests/gmail-addon.test.ts`); `live-check.mjs` runs a real three-email conversation against Anthropic: `ANTHROPIC_API_KEY=... node gmail-addon/dev/live-check.mjs`. |

`tests/gmail-addon.test.ts` checks that the add-on's prompt, levels, registry merge and output parsing match the web app's `lib/` exactly, and drives the panel the way Gmail does (open email, Generate, edit, Create Gmail draft, I sent it, their reply arrives).

## Updating from an earlier version

Paste the new `Code.gs`, `Shared.gs` and `appsscript.json` over the old ones and save. When `appsscript.json` changes a permission (sending now uses the full-mail "Read, compose, send, and permanently delete all your email from Gmail" one), the panel shows **Authorize access** again the next time you open an email. Approve it the same way as the first time. The test deployment itself doesn't need to be reinstalled.

If an earlier version gave you "Gmail API has not been used in project … or it is disabled", that version sent through Gmail's web API. This one doesn't use it. Paste the new `appsscript.json` as is: it has no `dependencies` block. If you added the Gmail service under **Services**, you can remove it.
