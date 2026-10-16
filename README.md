# Instill

**Expert knowledge, carried forward.**

Instill is an English-language customs brokerage workspace for Singapore. Employees prepare outward-facing documents, specialist agents review them before management approval, and senior decisions become reusable knowledge. The central product is the knowledge and approval loop: advice has sources, people make decisions, and reviewed experience informs the next case, but only after a second person approves it.

Each area of expertise is an **Intelligence pill**: a named owner and a different approver, what the pill will and will not advise on, guardrails, the conditions that hand a case to a person, and numbered releases that can be rolled back.

This repository contains a local full-stack hackathon prototype built with React, Vite, TypeScript, Express, and SQLite. It includes seeded demonstration records and a deterministic local advisor so the core workflow runs without an AI account.

## Run locally

Install **Node.js 24 or later** and npm. Node's built-in SQLite API is used by the server.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The development server connects the browser to the local Express API. Keep the terminal running while using the application.

To serve the built client through Express:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. This is a local demonstration setup; building static assets does not make the application ready for public deployment.

Host the Docker containers on your own Linux amd64 or arm64 server using [DEPLOY.md](DEPLOY.md). GitHub publishes tested images to GHCR; you control rollout, HTTPS and backups. Tencent is used for [ADP and optional knowledge/storage services](deploy/tencent-access.md), with no CVM requirement.

The database is created at `data/clearport.db` on first run and seeded with fictional Singapore cases. It persists across browser reloads and server restarts. Set `DATA_PATH` to use another database path, or `PORT` to change the API port from `3001`.

Available verification commands:

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

The build checks TypeScript and produces the client bundle. The test commands run the repository's server/workflow and browser checks; command availability is not a claim that a particular checkout passed them.

## What the platform does

- **Case preparation and pre-approval advice:** create customs declaration, customer email, and contract drafts. Review document content and structured permit/shipment information before senior approval.
- **Intelligence pills:** reusable knowledge is organized under Electronics, Food & produce, Automotive, and General cargo pills, all scoped to Singapore. Each pill shows its owner, approver, scope, guardrails, escalation triggers, release history and how the advisor has fared on reviewed cases.
- **Evidence-backed recommendations:** review findings include severity, a suggested action, supporting knowledge citations, where the finding came from (rule check, past decision, connected AI, or reviewer) and which pill release produced it.
- **Bounded advice:** a pill's out-of-scope topics produce an "outside approved scope" finding instead of advice, and its escalation triggers (including any critical finding) hand the case to a named person. These rules run locally, never in the model.
- **Management review:** a manager accepts or rejects individual suggestions, records reasoning, requests revisions, and makes the document approval decision. All suggestions must receive a decision before approval, and a case author cannot approve their own case. Editing a case invalidates its earlier review. Case comments preserve the internal conversation.
- **Capturing what the advisor missed:** a manager can add a finding the advisor did not raise. Corrections are the undocumented know-how an organisation most needs to keep.
- **Reusable rules:** a one-line reason can be turned into a structured rule (applies when, check, does not apply when, evidence to attach). The connected AI drafts it and asks follow-up questions; the reviewer edits and confirms.
- **Governed learning:** every decision, added finding and import is a *candidate*. It is used by agents only after a second person (the pill's owner or approver, never its author) approves it. Approved knowledge is versioned: an edit is a proposed revision, retiring and restoring are recorded, and each change to a pill is a numbered release. A rollback restores a previous release's definition and exact knowledge versions, and is itself a new release.
- **Knowledge intake:** upload PDF, DOCX, TXT, MD, EML, or CSV documents, or supply text, associate content with a skill, and review imported knowledge before it becomes available to the advisor.
- **Agent consultation:** ask a case question and receive an answer with the selected specialist skills and citations from approved knowledge.
- **Persistent records:** cases, knowledge, review decisions, comments, and activity are stored by the API in a local SQLite database, rather than only in browser state.
- **Guided tour:** a first visit to a demo opens a short walkthrough that marks each step where Tencent ADP is involved, and says whether it is connected on that deployment. Replay it from the **?** button.

Uploads are limited to 10 MB. PDF import extracts an existing text layer. Scanned PDFs require OCR outside this prototype; unreadable or empty extraction must not be treated as successful knowledge ingestion. DOCX and email extraction do not guarantee preservation of document layout, email attachments, or complex tables. Review extracted content before approving it.

## Local advisor and optional model connection

The default advisor uses deterministic checks and retrieval from approved local knowledge. This makes the demo reproducible, but it is not a trained language model, a complete regulatory engine, or a guarantee of legal correctness.

Local retrieval ranks approved knowledge with BM25 and a small hand-written vocabulary of customs terms that mean the same thing (for example *lapsed*, *expired* and *overdue*, or *authorisation*, *licence* and *permit*), and needs two distinct ideas in common before it returns a source. On ten paraphrased questions written by the team it finds the right source in the top three for 10, against 5 for the word-overlap method it replaced (`npm test` prints this). Those questions were written after the vocabulary, so treat it as a regression check, not an accuracy claim; the vocabulary will not cover wording nobody anticipated.

With a model connected, it is used in four places, and each is bounded:

| Where | What the model does | What stays local |
| --- | --- | --- |
| Pre-review | Adds up to three observations the rules do not cover, and judges which recorded decisions apply to the case (the lexical ranking only shortlists). | Every rule check, scope limit and escalation. A finding with no approved source is discarded; one that restates a rule is dropped. |
| Rule drafting | Turns a reviewer's reason into applies-when, check, exceptions and evidence, and asks follow-up questions. | Nothing is saved until the reviewer confirms. A rejected finding is captured as an exception, never a requirement. |
| Ask an agent | Writes the answer from approved knowledge. | Citations are validated; an answer that cites nothing or an unknown source gets one correction, then falls back to local retrieval. |
| Connection check | Answers one grounded question. | The reachability test (DNS and TLS) runs first and costs no allowance. |

The server supports Tencent ADP and OpenAI-compatible providers. For a published **Tencent Cloud International ADP** application, configure:

```dotenv
AI_PROVIDER=adp
ADP_APP_KEY=your-published-application-key
ADP_ENDPOINT=https://wss.lke.tencentcloud.com/adp/v2/chat
```

ADP uses its native SSE API. Conversations are isolated by workspace user and selected skill; every document review starts a fresh conversation. The Settings page distinguishes configuration from a successful connection check. Unknown citations, failed requests and incomplete responses produce an explicit local fallback that **says why**: the reason appears in the interface and in the container log (`[ai] …`), and never includes the key or the provider's raw reply. ADP is given 40 seconds by default because its agent thinks and calls tools before it answers (`AI_TIMEOUT_MS` overrides this), and `AI_CALLS_PER_HOUR` (default 120) caps provider calls so a public demo cannot exhaust the Tencent allowance. If **Check connection** fails, [DEPLOY.md](DEPLOY.md#when-check-connection-fails) lists each reason and its fix. Chat needs only the published application key; it does not require CVM or CAM credentials. See [the ADP agent setup](deploy/adp-agent.md), [Tencent access](deploy/tencent-access.md), and [DEPLOY.md](DEPLOY.md) for self-hosting and verification.

Optional ADP knowledge synchronization queues manager-approved imports and accepted/rejected decisions in SQLite, uploads immutable Markdown snapshots, and tracks indexing and publication. Retries resume after restart. Automatic publication is disabled by default because Tencent's documented release API publishes every draft in the ADP application; enable it only for a dedicated Instill application. This management integration uses Tencent credentials separately from the chat AppKey. Its documented International API is marked deprecated, so verify compatibility with the actual account before relying on synchronization.

An optional private Singapore COS bucket retains original uploaded files. With archival enabled, imports fail visibly if COS cannot store the original. Without it, the workspace retains extracted text only. Scanned-PDF OCR remains outside the current import flow.

For an OpenAI-compatible provider:

```dotenv
AI_PROVIDER=openai
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-provider-key
AI_MODEL=your-provider-model
```

For this provider type, the server calls `/chat/completions`. Requests default to a 20-second timeout. `AI_PROVIDER=local` disables model calls; knowledge synchronization and COS archival have separate explicit configuration. Keep credentials out of source control. Configuration alone does not verify an external integration: use Settings → Check connection and inspect a real answer before demonstrating it. Remote providers receive case text, questions and supplied knowledge; knowledge synchronization and archival also transmit their configured document content.

## Five-minute product walkthrough

1. Take the guided tour on first load (or press **?**). It opens as Sarah Tan, a senior reviewer.
2. Open the knowledge workspace. Select an Intelligence pill to see its owner, approver, scope, guardrails, escalation triggers and release history, and the distinction between pending and approved knowledge.
3. Import [the wireless sensor handover note](examples/wireless-sensor-handover.md) or [the produce email](examples/produce-customer-update.eml) into the appropriate pill. Switch to **Daniel Wong** (the approver) and approve it: its author cannot.
4. As Sarah, open the electronics case whose permit expiry is before its shipment date. Run through the findings: note the escalation to the pill owner, accept the expiry finding with a reason, and use **Make this a reusable rule** to have the connected AI draft the structured rule. Reject an unsuitable suggestion with a reason, and add a finding the advisor missed. Request changes when the document needs correction; approve only when the review is resolved.
5. Open **Awaiting approval**. As Sarah, the new candidates cannot be approved; switch to Daniel and approve one. The pill's release number increases.
6. Open the draft vehicle remote-controls case as Amir, edit its permit dates, and run the review to see the approved decision come back as a precedent. Ask the agent a related question.
7. In the pill panel, propose a change as one reviewer, release it as the other, then roll it back. Inspect the case conversation and activity history to show who decided what.

Permit identifiers, dates, customers, cases, and operational notes in the demo are illustrative. A supplied number does not establish that an authority has issued or validated a permit.

## Why this workflow

The research in [the interview summary](docs/USER_STORY_SUMMARY.md) identifies a specific failure: employees can have the right SOP and still overlook a check at the moment of work. The interviewee also insists on human review and worries about extra record-keeping. Instill therefore places advice in document preparation and captures knowledge from decisions managers already make.

[The service description](docs/CUSTOMS_SERVICE.md) explains the real work behind the interface: receiving emailed documents, extracting shipment details, selecting goods classifications, checking supporting information, coordinating clearance, and communicating with customers. These source documents are qualitative discovery evidence, not a Singapore regulatory specification. The original Chinese documents and transcript are retained unchanged.

## Singapore references and boundaries

The product scope is Singapore. Official sources provide context for its example skill categories:

| Source | Relevant context |
| --- | --- |
| [Singapore Customs: Import Operations Overview](https://www.customs.gov.sg/doing-business/import-operations/import-operations-overview/) | Import declarations, controlled-goods checks, and the role of declaring agents. |
| [Singapore Customs: TradeNet](https://www.customs.gov.sg/doing-business/quick-links-for-traders/tradenet/) | Singapore's channel for import, export, and transhipment permit applications. |
| [IMDA: Equipment Registration](https://www.imda.gov.sg/regulations-and-licensing-listing/equipment-registration) | Registration schemes for relevant telecommunication and radio-communication equipment; applicability depends on the equipment and intended use. |
| [SFA: Import/Export Licence, Permit, and Registration Applications](https://www.sfa.gov.sg/food-import-export/licence-permit-registration/application-process-fees-for-licence-permit-registration-for-import-export) | Food-category-specific licensing or registration and related import requirements. |

These links were consulted on 14 October 2026. Seeded rules are illustrative internal review guidance, not a complete statement of those authorities' requirements. This application does not query authority registries, classify goods conclusively, submit TradeNet declarations, send customer emails, or confirm customs release. A manager's approval is an internal workflow decision.

## Access, governance, and deployment limits

The employee/manager selector is a **demo persona switch, not production authentication**. The local API's role checks help demonstrate the workflow, but a client-selected identity is not a secure authorization boundary. Run this prototype on localhost with sample data.

`DEMO_MODE` defaults to enabled unless `NODE_ENV=production`; container deployments default to `false`. Set `DEMO_MODE=true` in `.env.deploy` for a login-free demo, including when using the production Docker image. Demo mode does not require `APP_ACCESS_PASSWORD` and enables persona switching. Outside demo mode, the server requires an `APP_ACCESS_PASSWORD` of at least 12 characters, uses HTTP Basic authentication with username `instill`, and fixes the persona to `APP_USER_ID` (default `manager-sarah`); role switching is disabled. This optional password gate is a single-user deployment aid, not enterprise identity management, and HTTP Basic must not be exposed without transport protection.

Before deployment, add authenticated identities and server-managed sessions, enforce organization and record access, establish data retention and backup policies, protect document uploads, and validate regulatory content with qualified owners. The current record history demonstrates accountability within the prototype; it is not a tamper-proof compliance archive.

Governance limits to know about: pill owners and approvers are two named people, so the two-person rule needs at least two senior reviewers; guardrails are instructions to the model and criteria for human reviewers, whereas out-of-scope and escalation rules are matched on words in the document, so a paraphrase can slip past them; pills are fixed to four goods categories in the prototype, so a new domain (for example facilities) needs a category added in code; and ADP knowledge synchronization does not delete a retired entry from the ADP library, although Instill stops citing it.

The dependency audit reports three moderate findings from one [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), through Mammoth's command-line dependency chain. No patched version was available during verification. Instill uses Mammoth's library text-extraction API; the exercised DOCX import path does not load `argparse` or `sprintf-js`. The installed dependency finding remains open.

## Hackathon preparation

See [HACKATHON_SUBMISSION.md](docs/HACKATHON_SUBMISSION.md) for the architecture, Keppel challenge mapping, demonstration narrative, and remaining submission evidence. The supplied handbook requires genuine CodeBuddy or WorkBuddy development usage and conversation evidence. This repository does not fabricate that evidence or claim the requirement has already been satisfied.
