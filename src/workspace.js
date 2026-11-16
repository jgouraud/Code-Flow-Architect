/** P1 view state. Panes reference a single project; they do not contain board data. */
import { newId } from './model.js';

export const MAX_VISIBLE_PANES = 4;
const makePane = (boardId, viewport, id = newId()) => ({
  type: 'pane', id, boardId, viewport: { ...viewport }, selected: null,
  pendingSource: null, previewPoint: null, back: [], forward: [], tabs: [boardId]
});
export function createWorkspace(project) {
  const pane = makePane(project.rootBoardId, project.boards[project.rootBoardId].viewport);
  return { root: pane, activeId: pane.id };
}
export function panesIn(root) {
  return root.type === 'pane' ? [root] : root.children.flatMap(panesIn);
}
export function findPane(workspace, id) { return panesIn(workspace.root).find(pane => pane.id === id); }
export function splitPane(workspace, project, direction = 'horizontal', boardId) {
  const active = findPane(workspace, workspace.activeId);
  if (!active || !['horizontal','vertical'].includes(direction) || panesIn(workspace.root).length >= MAX_VISIBLE_PANES) return null;
  const destination = boardId && project.boards[boardId] ? boardId : active.boardId;
  const child = makePane(destination, destination === active.boardId ? active.viewport : project.boards[destination].viewport);
  function insert(node) {
    if (node === active) return { type: 'split', direction, ratio: .5, children: [node, child] };
    if (node.type === 'split') node.children = node.children.map(insert);
    return node;
  }
  workspace.root = insert(workspace.root);
  workspace.activeId = child.id;
  return child;
}
export function closePane(workspace, id) {
  if (panesIn(workspace.root).length === 1) return false;
  function remove(node) {
    if (node.type !== 'split') return node;
    if (node.children[0].type === 'pane' && node.children[0].id === id) return node.children[1];
    if (node.children[1].type === 'pane' && node.children[1].id === id) return node.children[0];
    node.children = node.children.map(remove);
    return node;
  }
  if (!findPane(workspace, id)) return false;
  workspace.root = remove(workspace.root);
  if (workspace.activeId === id) workspace.activeId = panesIn(workspace.root)[0].id;
  return true;
}
export function navigatePane(pane, project, boardId, selection = null, record = true) {
  if (!project.boards[boardId]) return false;
  if (record && (pane.boardId !== boardId || pane.selected?.id !== selection?.id || pane.selected?.type !== selection?.type)) {
    pane.back.push({ boardId: pane.boardId, selection: pane.selected });
    if (pane.back.length > 40) pane.back.shift();
    pane.forward.length = 0;
  }
  if (pane.boardId !== boardId) {
    pane.boardId = boardId;
    pane.viewport = { ...project.boards[boardId].viewport };
  }
  pane.selected = selection;
  if (!pane.tabs.includes(boardId)) pane.tabs.push(boardId);
  return true;
}
export function goHistory(pane, project, direction) {
  const from = direction === 'back' ? pane.back : pane.forward;
  const to = direction === 'back' ? pane.forward : pane.back;
  while (from.length) {
    const next = from.pop();
    if (!project.boards[next.boardId]) continue;
    to.push({ boardId: pane.boardId, selection: pane.selected });
    navigatePane(pane, project, next.boardId, next.selection, false);
    return true;
  }
  return false;
}
export function searchArchitecture(project, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const matches = [];
  for (const board of Object.values(project.boards)) {
    for (const block of board.blocks) {
      const haystack = `${block.label} ${block.level} ${block.nature ?? ''} ${block.category} ${block.sourceRef ?? ''} ${block.description}`.toLowerCase();
      if (terms.every(term => haystack.includes(term))) matches.push({ boardId: board.id, blockId: block.id, label: block.label, sourceRef: block.sourceRef ?? '', level: block.level, nature: block.nature ?? 'component' });
    }
  }
  return matches.slice(0, 100);
}
export function dependencyIds(board, selection) {
  if (!selection) return new Set();
  const ids = new Set();
  const blockId = selection.type === 'block' ? selection.id : null;
  for (const edge of board.edges) {
    if (edge.id === selection.id || edge.source.blockId === blockId || edge.target.blockId === blockId) {
      ids.add(edge.id); ids.add(edge.source.blockId); ids.add(edge.target.blockId);
    }
  }
  if (blockId) ids.add(blockId);
  return ids;
}
export function toLayoutTree(node) {
  if (node.type === 'pane') return { type: 'pane', id: node.id, boardId: node.boardId, weight: 1 };
  const ratio = node.ratio ?? .5;
  return { type: 'split', direction: node.direction, children: [
    { ...toLayoutTree(node.children[0]), weight: ratio },
    { ...toLayoutTree(node.children[1]), weight: 1 - ratio }
  ], weight: 1 };
}
export function restoreLayout(project, layout) {
  function convert(node) {
    if (node.type === 'pane') return makePane(node.boardId, project.boards[node.boardId].viewport, node.id);
    return { type: 'split', direction: node.direction,
      ratio: node.children[0].weight / (node.children[0].weight + node.children[1].weight),
      children: node.children.map(convert) };
  }
  const root = convert(layout.root);
  return { root, activeId: panesIn(root)[0].id };
}
export function reconcileWorkspace(workspace, project) {
  // Detached panels disappear; an affected last pane returns to the H0 board.
  for (const pane of panesIn(workspace.root)) {
    if (!project.boards[pane.boardId]) {
      navigatePane(pane, project, project.rootBoardId, null, false);
      pane.back = []; pane.forward = [];
    }
    if (pane.selected) {
      const board = project.boards[pane.boardId];
      const exists = pane.selected.type === 'block' ? board.blocks.some(x => x.id === pane.selected.id) :
        pane.selected.type === 'edge' ? board.edges.some(x => x.id === pane.selected.id) :
        pane.selected.type === 'zone' ? (board.zones ?? []).some(x => x.id === pane.selected.id) : false;
      if (!exists) pane.selected = null;
    }
    pane.tabs = pane.tabs.filter(id => project.boards[id]);
    if (!pane.tabs.includes(pane.boardId)) pane.tabs.push(pane.boardId);
  }
  return workspace;
}
