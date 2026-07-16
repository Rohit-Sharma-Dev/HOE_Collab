# Colab — Local-First Collaborative Document Editor

A high-performance, offline-first collaborative document editor built on **Next.js 16**, **Supabase**, **Yjs (CRDT)**, and **Tiptap (ProseMirror)**.

---

## Key Features

| Feature | Implementation | Description |
| :--- | :--- | :--- |
| **Offline-First Editing** | Yjs + IndexedDB | All keystrokes and updates are written synchronously to the browser's IndexedDB, enabling 100% offline functionality. |
| **Connection Recovery** | window Event Listeners | Automatic detection of online/offline transitions, triggering immediate queues drain and missed update pulls. |
| **Dynamic ID Remapping** | Client-side Migrations | Create documents offline using temporary `offline-[uuid]` identifiers, which automatically register on the database and migrate local IndexedDB data once online. |
| **Real-time Collaboration** | Supabase Realtime | Postgres changes broadcasting ensures all edits propagate instantly between online collaborators. |
| **Conflict Resolution** | Yjs CRDTs | Commutative and associative CRDT updates resolve conflicts deterministically without requiring merge UIs. |
| **Safe Version Restore** | Forward-moving Deltas | Restore documents to past snapshots safely by computing forward deltas, preserving complete history. |
| **Offline Title Editing** | localStorage Queue | Title edits made offline are queued in `collab_pending_titles` and synced on connection recovery. |
| **Secure Purging** | IndexedDB Cleanups | Logging out purges all cached documents and deletes matching local IndexedDB CRDT stores. |

---

## System Architecture

```mermaid
graph TD
    subgraph Browser (Client-Side)
        A[Tiptap Editor] <--> B(In-Memory Y.Doc)
        B <-->|Synchronous writes| C[(IndexedDB Store)]
        B -->|Encodes Deltas| D{Connection Status}
        D -->|Online| E[Supabase Client]
        D -->|Offline| F[(localStorage Queue)]
        F -->|Regained Connection| E
    end

    subgraph Database (Server-Side)
        E <-->|Auth / Realtime / REST| G[(Supabase Postgres)]
        G -->|Applied state updates| H[Documents Table]
        G -->|Incremental deltas| I[Sync Updates Table]
    end
```

---

## How Offline Storage & Sync Works

Colab utilizes a **dual-storage strategy** to deliver a local-first user experience that protects against network loss:

### 1. IndexedDB: Full CRDT Hydration
* **Mechanism:** Every edit updates the in-memory Yjs Document (`Y.Doc`). The `y-indexeddb` persistence library handles saving the updated document binary state to a database named `collab-doc-[docId]`.
* **Reliability:** This write is synchronous in the same microtask as the keystroke. Even if the browser window is closed or crashes, the local state is preserved and restored instantly when the page loads again.

### 2. localStorage: Outgoing Change Queue
* **Mechanism:** Outgoing updates are handled by a custom `UpdateQueue`. When the client is offline, binary updates are encoded in base64 and pushed to `localStorage` under the key `collab_queue_[docId]`.
* **Recovery:** When the browser regains connectivity, the window `online` listener is triggered, causing the sync provider to sequentially push the queued updates to Supabase's `sync_updates` table.

### 3. Offline Document Creation (ID Remapping)
To support creating documents offline, Colab implements a client-side database remapping strategy:
1. **Creation:** Clicking "New Document" while offline generates a local client-side UUID prefix (`offline-[uuid]`).
2. **Buffering:** The temporary metadata is stored in `collab_cached_documents`, and the creation task is appended to `collab_pending_creations`.
3. **Redirection:** The client router navigates to `/editor/offline-[uuid]`, letting the user write immediately.
4. **Resolution:** When the connection is restored:
   * The client calls the Supabase `create_document` RPC to provision a real record and receive a database-generated ID (`realId`).
   * The client clones the temporary IndexedDB database contents into a new database named `collab-doc-[realId]`.
   * The client moves the local storage update queue to the new ID, renames the cache record, and silently switches the browser URL using `window.history.replaceState`.
   * Finally, it drains the queue to push all accumulated edits to the server.

---

## Conflict Resolution

This editor uses **Yjs** - a Commutative Replicated Data Type (CRDT) library.

* **Deterministic Ordering:** All insert and delete operations are represented as commutative, associative graphs. The final state merges to the exact same text on all clients, regardless of the order in which updates are received.
* **No Merge Conflicts:** There is no "last write wins" or manual diff-merge prompt. Concurrent updates from different users are interleaved automatically and safely.

---

## Safe Version Restore

Restoring a document to a previous snapshot is implemented as a **Forward-moving Delta** rather than a database overwrite:
1. **Load Snapshot:** Retrieve the target snapshot binary from `document_versions`.
2. **Compute Delta:** Compute the binary diff between the current live Yjs document state and the target snapshot.
3. **Apply Delta:** Apply and push the diff as a new `sync_update`.
4. **Result:** Collaborators' documents automatically transition to the restored content, while the full history timeline remains intact.

---

## Directory Structure

```
collab-editor/
├── __tests__/            # Jest unit tests (Yjs CRDT merge & sync queue behavior)
├── app/                  # Next.js App Router
│   ├── (auth)/           # Login and Register pages
│   ├── api/              # Backend route APIs
│   ├── dashboard/        # Client-side documents dashboard
│   ├── editor/           # Client-side text editor canvas
│   └── globals.css       # Core styling & styling system
├── components/           # Reusable React components
│   ├── auth/             # Login/Register forms and Logout button
│   ├── dashboard/        # New Document controls
│   ├── editor/           # Toolbar, collaborator status, and versions
│   └── PWARegistration.jsx # Client-side Service Worker registration
├── e2e/                  # Playwright E2E integration tests
├── hooks/                # Custom React Hooks (sync status, presence, document loaders)
├── lib/
│   ├── supabase/         # Supabase Client and Server initializers
│   ├── sync/             # SupabaseSyncProvider, UpdateQueue, and offline remapper
│   └── versions/         # Timeline version snapshot captures
├── public/               # Static assets, sw.js, and manifest.json
└── playwright.config.js  # Playwright E2E configuration
```

---

## Setup Guide

### 1. Clone & Install
```bash
git clone https://github.com/your-username/colab-editor.git
cd colab-editor
npm install --legacy-peer-deps
```

### 2. Configure Database & Migrations
1. Create a project at [supabase.com](https://supabase.com).
2. Run the database migrations in the SQL editor in order:
   * `supabase/migrations/001_initial_schema.sql`
   * `supabase/migrations/002_rls_policies.sql`
   * `supabase/migrations/003_functions.sql`
3. Turn on **Realtime** replication on the `sync_updates` table in your Supabase Dashboard settings.
4. Set the Site URL in authentication settings to `http://localhost:3000`.

### 3. Add Environment Variables
Create a `.env.local` or edit `.env` in the root:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run Development Server
```bash
npm run dev
```

---

## Running Tests

### Unit Tests (Jest)
Verify Yjs merge convergence and queue serialization:
```bash
npm test
```

### E2E Tests (Playwright)
Verify network connection state throttling and offline synchronization:
```bash
# Installs Chromium headless shell
npx playwright install chromium

# Runs tests (automatically spins up global database seed & logins)
npx playwright test
```
#   H O E _ C o l l a b  
 