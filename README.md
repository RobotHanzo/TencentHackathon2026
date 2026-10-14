# Clearport

**Expert knowledge, carried forward.**

Clearport is an English-language customs brokerage workspace for Singapore. Employees prepare outward-facing documents, specialist agents review them before management approval, and senior decisions become reusable knowledge. The central product is the knowledge and approval loop: advice has sources, people make decisions, and reviewed experience informs the next case.

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

For the Docker image, GitHub image-publishing workflow, and manual Compose deployment, see [DEPLOY.md](DEPLOY.md). The deployment guide includes persistent storage, HTTPS access, backups, and rollback; the workflow publishes images without deploying a remote server.

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
- **Specialist knowledge:** organize reusable knowledge under Electronics, Food & produce, Automotive, and General cargo skills, all scoped to Singapore.
- **Evidence-backed recommendations:** review findings include severity, a suggested action, and supporting knowledge citations. Employees can inspect why a recommendation appeared.
- **Management review:** a manager accepts or rejects individual suggestions, records reasoning, requests revisions, and makes the document approval decision. All suggestions must receive a decision before approval, and a case author cannot approve their own case. Editing a case invalidates its earlier review. Case comments preserve the internal conversation.
- **Learning from decisions:** reviewed decisions become knowledge records, retaining the original case and the manager's reasoning for later retrieval.
- **Knowledge intake:** upload PDF, DOCX, TXT, MD, EML, or CSV documents, or supply text, associate content with a skill, and review imported knowledge before it becomes available to the advisor.
- **Agent consultation:** ask a case question and receive an answer with the selected specialist skills and citations from approved knowledge.
- **Persistent records:** cases, knowledge, review decisions, comments, and activity are stored by the API in a local SQLite database, rather than only in browser state.

Uploads are limited to 10 MB. PDF import extracts an existing text layer. Scanned PDFs require OCR outside this prototype; unreadable or empty extraction must not be treated as successful knowledge ingestion. DOCX and email extraction do not guarantee preservation of document layout, email attachments, or complex tables. Review extracted content before approving it.

## Local advisor and optional model connection

The default advisor uses deterministic checks and retrieval from approved local knowledge. This makes the demo reproducible, but it is not a trained language model, a complete regulatory engine, or a guarantee of legal correctness. Model-free consultation can be less capable with unusual wording and novel cases.

The server supports Tencent ADP and OpenAI-compatible providers. For a published **Tencent Cloud International ADP** application, configure:

```dotenv
AI_PROVIDER=adp
ADP_APP_KEY=your-published-application-key
ADP_ENDPOINT=https://wss.lke.tencentcloud.com/adp/v2/chat
```

ADP uses its native SSE API. Conversations are isolated by workspace user and selected skill; every document review starts a fresh conversation. The Settings page distinguishes configuration from a successful connection check. Unknown citations, failed requests and incomplete responses produce an explicit local fallback. See [the ADP agent setup](deploy/adp-agent.md) for the application instructions and [DEPLOY.md](DEPLOY.md) for credentials, Singapore hosting and verification.

Optional ADP knowledge synchronization queues manager-approved imports and accepted/rejected decisions in SQLite, uploads immutable Markdown snapshots, and tracks indexing and publication. Retries resume after restart. Automatic publication is disabled by default because Tencent's documented release API publishes every draft in the ADP application; enable it only for a dedicated Clearport application. This management integration uses Tencent credentials separately from the chat AppKey. Its documented International API is marked deprecated, so verify compatibility with the actual account before relying on synchronization.

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

1. Open the knowledge workspace. Inspect a Singapore specialist skill, its source records, and the distinction between pending and approved knowledge.
2. Import [the wireless sensor handover note](examples/wireless-sensor-handover.md) or [the produce email](examples/produce-customer-update.eml) into the appropriate skill. Review the extracted text and approve it using the manager persona.
3. Open an electronics case with a permit expiry before its shipment date, or create one. Run the pre-approval review and inspect the warning and supporting citations.
4. Use the manager persona to accept a relevant suggestion and reject an unsuitable one with a concrete explanation. Request changes when the document needs correction; approve only when the review is resolved appropriately.
5. Return to the knowledge workspace and find the captured reviewer decision. Open a similar case or ask the agent a related question to show that approved experience is available for future advice.
6. Inspect the case conversation and activity history to show who decided what.

Permit identifiers, dates, customers, cases, and operational notes in the demo are illustrative. A supplied number does not establish that an authority has issued or validated a permit.

## Why this workflow

The research in [the interview summary](docs/USER_STORY_SUMMARY.md) identifies a specific failure: employees can have the right SOP and still overlook a check at the moment of work. The interviewee also insists on human review and worries about extra record-keeping. Clearport therefore places advice in document preparation and captures knowledge from decisions managers already make.

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

`DEMO_MODE` defaults to enabled unless `NODE_ENV=production`. Outside demo mode, the server requires `APP_ACCESS_PASSWORD`, uses HTTP Basic authentication with username `clearport`, and fixes the persona to `APP_USER_ID` (default `manager-sarah`); role switching is disabled. This optional password gate is a single-user deployment aid, not enterprise identity management, and HTTP Basic must not be exposed without transport protection.

Before deployment, add authenticated identities and server-managed sessions, enforce organization and record access, establish data retention and backup policies, protect document uploads, and validate regulatory content with qualified owners. The current record history demonstrates accountability within the prototype; it is not a tamper-proof compliance archive. Formal capability release versioning and rollback require additional work before enterprise use.

The dependency audit reports three moderate findings from one [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), through Mammoth's command-line dependency chain. No patched version was available during verification. Clearport uses Mammoth's library text-extraction API; the exercised DOCX import path does not load `argparse` or `sprintf-js`. The installed dependency finding remains open.

## Hackathon preparation

See [HACKATHON_SUBMISSION.md](docs/HACKATHON_SUBMISSION.md) for the architecture, Keppel challenge mapping, demonstration narrative, and remaining submission evidence. The supplied handbook requires genuine CodeBuddy or WorkBuddy development usage and conversation evidence. This repository does not fabricate that evidence or claim the requirement has already been satisfied.
