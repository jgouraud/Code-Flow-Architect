# CodeFlow Architect — MVP

A **local-first hierarchical software architecture designer**. Arrange blocks on a large canvas, connect them with directed data-flow lines, and double-click any block to open a dedicated drawing board for its decomposition. **No code is executed.**

![status](https://img.shields.io/badge/MVP-local--first-blue)

## Run locally

No package installation or build step is necessary. Requires a recent desktop browser and Python 3 (or another static HTTP server).

```bash
python3 -m http.server 5173
```

Then open **http://localhost:5173**. From this folder, `npm run dev` is an equivalent convenience command. Do not open `index.html` directly with `file://`: ES modules need an HTTP origin.

Run offline unit tests with Node.js 20+:

```bash
npm run check
```

## How to use

- Drag library blocks onto the canvas, or click a library item to add it in the center. Filter templates by H0/H1/H2/H3.
- Drag blocks to reposition them; drag the empty canvas to pan; scroll to zoom. Choose **Fit view** to center a board.
- Connect blocks by dragging from the right/output port to another block's left/input port. Alternatively, click an output port and then an input port. Use **Escape** to cancel.
- Single-click a block or connection to edit its properties in the inspector. Select an edge to change its kind to data, control, or error.
- Use **Source path / symbol** to annotate an entity (for example `src/model.js#makeBlock`). Choose a block's **nature** (file, module, class, function, method, interface, service or data) in the inspector; data blocks also have a format (database, CSV, JSON, Parquet, XML, YAML, binary or other). The library includes ready-made templates.
- Add a **Frontend zone** or **Backend zone** from the board toolbar. Drag or resize its outline to encompass blocks; zone position, label and size are editable and undoable. Zones visually group blocks but do not alter board ownership or move enclosed blocks.
- Collapse either side panel to expand the canvas; switch **Light/Dark** from the top bar. Theme choice is stored separately from the project.
- The **Nature key** on the board toolbar explains the nine block colors. Each block has a colored edge and a text nature badge, independent of frontend/backend zones and data/control/error connection colors.
- **P0 — Directed interfaces:** edges have arrowheads pointing into their target ports; output/input ports can be added on all four sides (up to 32 per block), named, reordered, repositioned, or removed. Removing/redirecting a connected port explicitly removes its affected edges after confirmation. Each edge supports authored annotations with position, caption, type, format, description and schema reference.
- **Schema v2:** JSON export writes v2; v1 JSON imports migrate in memory without changing the source file. The previous `codeflow-architect-project-v1` browser key is kept intact when opening a legacy project, and current saves use `codeflow-architect-project-v2`. Export a JSON backup before important edits.
- Double-click a block, or press **Enter** on a focused block, to create/open its decomposition board. Breadcrumbs navigate back to parent boards.
- Delete a selected block or connection with **Delete**; undo with Ctrl/⌘+Z and redo with Ctrl/⌘+Shift+Z. Focused blocks can be nudged with arrow keys (Shift = larger step).
- Projects save to this browser's `localStorage` automatically. Use **Export JSON** to back up or share a project, and **Import** to reopen it elsewhere. Browser storage is not a remote backup.

The app opens with a three-level example: **Take in data → Exploit data → Output results**, with child diagrams under **Take in data** and **Data preprocessing**. **New project** starts with a blank board.

## Design and scope

| Boundary | Implementation |
|---|---|
| Graph data model | `src/model.js` – normalized board ownership, block instances, port contracts, directed edges, validation and destructive subtree deletion |
| Template vocabulary | `src/library.js` – 45 starter components across H0–H3, stored separately from instances |
| Browser adapter/editor | `src/app.js` – canvas interactions, inspectors, navigation, undo/redo, JSON import/export, local persistence |
| Presentation | `src/styles.css` + `index.html` – desktop-first responsive UI |
| Pure model tests | `tests/model.test.js` – no network or third-party packages |

For simplicity this MVP uses **plain JavaScript, native HTML, CSS, and SVG**, not React Flow. The repository is empty and dependency installation is not available in the build environment. This keeps the first deliverable runnable without a package registry. A later iteration can adopt React Flow if its large-graph interactions justify the dependency and migration.

### Project data contract

`schemaVersion: 1`, a `rootBoardId`, a map of `boards`, and per-board `blocks`/`edges`/`zones`. A block's optional `childBoardId` points to an independently navigable board whose `ownerBlockId` points back to that block. Blocks can carry optional `nature`, `dataFormat` and `sourceRef` fields; the latter identifies a repository path/symbol for documentation purposes. Board zones are optional in legacy v1 projects and do not change block ownership or connection endpoints. Each block has one input and one output port in the MVP. Connections are board-local. Imported projects are checked for hierarchy cycles, dangling edges, malformed positions and ports, zone bounds, and size limits before replacing the current project. The project is persisted as one local JSON object.

### Known MVP limitations

- No authentication, accounts, collaboration, backend, or code execution; data is stored only in the current browser unless exported.
- One input and output port per block (names editable); arbitrary multi-port interfaces, port-to-parent boundaries, type checking, and architectural lint rules belong to a later phase.
- Freeform pan/zoom and simple cubic connectors; no automatic layout, minimap, or advanced line routing.
- Desktop pointer interaction is the primary editing mode; keyboard alternatives cover inserting blocks, selecting/entering blocks, nudging and deleting, but no complete keyboard-only connector-creation flow has been screen-reader tested.
- `localStorage` can be disabled or cleared and has quota limits. Export regularly for backups.

## Agentic policy

The bundled `AGENTS.md`, `.agents/skills`, `docs/agent-policy`, and `tools` are the supplied **Codex Engineering Rulebooks Docker v1.1**. Relevant rules for this MVP include **CORE.CODE1–7, CORE.WORK1/4/5/6/7/8, FE.ARCH2/3, FE.DATA1/3/5, FE.A11Y2/4/14, FE.TEST1/3/5/6/13/18, FE.BUILD3/5**. We use the front-end engineering skill and avoid unnecessary backend/Docker architecture. Run `python tools/audit_policy.py` to verify the bundled rule index.

## Manual acceptance checks

1. Add three blocks and connect them; verify both endpoints follow when a block moves.
2. Decompose a block twice, navigate back using breadcrumbs, and confirm unrelated boards are unchanged.
3. Rename a block and its ports, change an edge type, export JSON and import it; confirm the same hierarchy remains.
4. Delete a block with grandchildren and undo; confirm the nested boards return.
5. Reload the page after edits; confirm persisted names, positions, connections, and hierarchy.
6. Try corrupt JSON and an unsupported schema version; confirm import is rejected without replacing current work.
7. Verify smaller viewport layout and keyboard focus in a browser.
8. Collapse and expand both side panels at narrow and wide viewports. Confirm focusable controls remain reachable and do not remain focusable while hidden.
9. Switch light/dark themes, reload and verify the choice persists without changing exported project JSON.
10. Add a source-file, class method, CSV dataset and database; edit their nature/format, then export/import and verify metadata persists.
11. Add a frontend and backend zone, drag, resize and edit their size using the keyboard-accessible inspector; undo and redo, reload and verify placement. Deleting a zone must preserve enclosed blocks.

## CI

`.github/workflows/ci.yml` runs the zero-dependency JavaScript checks and policy audit on each push and pull request. No secrets are needed. The repository has no compile step and no production deployment workflow.

**Before publishing to a public GitHub repository:** inspect the original rulebook archives in `docs/agent-policy/sources/`. The provided Docker source examples reference internal organizational infrastructure and are not needed by the application at runtime. Remove or appropriately review such archival material if a public distribution is required, adjusting the policy audit accordingly.
