import { DEFAULT_TEMPLATE, findTemplate } from './library.js';

export const SCHEMA_VERSION = 1;
export const BLOCK_WIDTH = 218;
export const BLOCK_HEIGHT = 104;
export const STORAGE_KEY = 'codeflow-architect-project-v1';

export function newId() { return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function createEmptyProject(name = 'Untitled project') {
  return {
    schemaVersion: SCHEMA_VERSION, id: newId(), name, rootBoardId: 'board-root',
    boards: { 'board-root': { id: 'board-root', name: 'System architecture', ownerBlockId: null, blocks: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }
  };
}

export function makeBlock(templateId, position, id = newId()) {
  const template = findTemplate(templateId) ?? DEFAULT_TEMPLATE;
  return {
    id, templateId: template.id, label: template.label, level: template.level,
    category: template.category, description: template.description,
    position: { x: Math.round(position.x), y: Math.round(position.y) }, childBoardId: null,
    ports: [
      { id: `${id}-in`, name: 'Input', direction: 'input', kind: 'data' },
      { id: `${id}-out`, name: 'Output', direction: 'output', kind: 'data' }
    ]
  };
}

export function addBlock(project, boardId, templateId, position) {
  const board = project.boards[boardId];
  if (!board) throw new Error('Board does not exist');
  const block = makeBlock(templateId, position);
  board.blocks.push(block);
  return block;
}

export function findBlock(project, blockId) {
  for (const board of Object.values(project.boards)) {
    const block = board.blocks.find(item => item.id === blockId);
    if (block) return { block, board };
  }
  return null;
}

export function createDecomposition(project, boardId, blockId) {
  const parent = project.boards[boardId];
  const block = parent?.blocks.find(item => item.id === blockId);
  if (!block) throw new Error('Block does not exist on this board');
  if (block.childBoardId) return block.childBoardId;
  const id = newId();
  project.boards[id] = { id, name: block.label, ownerBlockId: blockId, blocks: [], edges: [], viewport: { x: 45, y: 95, zoom: .78 } };
  block.childBoardId = id;
  return id;
}

export function connectBlocks(project, boardId, sourceBlockId, targetBlockId, kind = 'data') {
  const board = project.boards[boardId];
  const source = board?.blocks.find(block => block.id === sourceBlockId);
  const target = board?.blocks.find(block => block.id === targetBlockId);
  if (!source || !target || source.id === target.id) throw new Error('Choose different blocks on the same board');
  if (!['data', 'control', 'error'].includes(kind)) throw new Error('Unsupported connection type');
  if (board.edges.some(edge => edge.source.blockId === source.id && edge.target.blockId === target.id && edge.kind === kind)) {
    throw new Error('This connection already exists');
  }
  const edge = {
    id: newId(), kind, label: '',
    source: { blockId: source.id, portId: source.ports.find(port => port.direction === 'output').id },
    target: { blockId: target.id, portId: target.ports.find(port => port.direction === 'input').id }
  };
  board.edges.push(edge);
  return edge;
}

export function deleteBlock(project, boardId, blockId) {
  const board = project.boards[boardId];
  const block = board?.blocks.find(item => item.id === blockId);
  if (!block) return false;
  function removeDescendants(childBoardId) {
    const child = project.boards[childBoardId];
    if (!child) return;
    for (const descendant of child.blocks) if (descendant.childBoardId) removeDescendants(descendant.childBoardId);
    delete project.boards[childBoardId];
  }
  if (block.childBoardId) removeDescendants(block.childBoardId);
  board.blocks = board.blocks.filter(item => item.id !== blockId);
  board.edges = board.edges.filter(edge => edge.source.blockId !== blockId && edge.target.blockId !== blockId);
  return true;
}

export function boardPath(project, boardId) {
  const path = [];
  const visited = new Set();
  let current = project.boards[boardId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    if (!current.ownerBlockId) break;
    const owner = findBlock(project, current.ownerBlockId);
    current = owner?.board;
  }
  return path;
}

export function validateProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Project must be an object';
  if (value.schemaVersion !== SCHEMA_VERSION) return `Unsupported project version (expected ${SCHEMA_VERSION})`;
  if (typeof value.name !== 'string' || value.name.length > 200) return 'Invalid project name';
  if (!value.boards || typeof value.boards !== 'object' || Array.isArray(value.boards)) return 'Invalid boards';
  const boards = Object.values(value.boards);
  if (!boards.length || boards.length > 500) return 'Project must contain between 1 and 500 boards';
  if (!value.rootBoardId || !Object.hasOwn(value.boards, value.rootBoardId)) return 'Missing root board';
  const ids = new Set();
  const childIds = new Set();
  for (const board of boards) {
    if (!board || typeof board.id !== 'string' || value.boards[board.id] !== board || typeof board.name !== 'string' || board.name.length > 200 || (board.ownerBlockId !== null && typeof board.ownerBlockId !== 'string') || !Array.isArray(board.blocks) || !Array.isArray(board.edges)) return 'Invalid board structure';
    if (board.blocks.length > 2000 || board.edges.length > 5000) return 'Board exceeds size limit';
    if (!board.viewport || !['x','y','zoom'].every(key => Number.isFinite(board.viewport[key])) || board.viewport.zoom <= 0 || board.viewport.zoom > 10) return 'Invalid board viewport';
    for (const block of board.blocks) {
      if (!block || typeof block.id !== 'string' || ids.has(block.id) || typeof block.label !== 'string' || block.label.length > 200 || typeof block.description !== 'string' || block.description.length > 2000 || typeof block.templateId !== 'string' || typeof block.category !== 'string' || !['H0','H1','H2','H3'].includes(block.level) || (block.childBoardId !== null && typeof block.childBoardId !== 'string')) return 'Invalid or duplicate block';
      ids.add(block.id);
      if (!block.position || !Number.isFinite(block.position.x) || !Number.isFinite(block.position.y)) return 'Invalid block position';
      if (!Array.isArray(block.ports) || block.ports.length !== 2 || !['input','output'].every(direction => block.ports.some(port => port && port.direction === direction && typeof port.id === 'string' && port.id.length <= 150 && typeof port.name === 'string' && port.name.length <= 100 && ['data','control','error'].includes(port.kind)))) return 'Invalid block ports';
      if (block.childBoardId) {
        const child = value.boards[block.childBoardId];
        if (!child || child.ownerBlockId !== block.id || childIds.has(child.id) || child.id === board.id) return 'Invalid decomposition ownership';
        childIds.add(child.id);
      }
    }
    const edges = new Set();
    for (const edge of board.edges) {
      if (!edge || typeof edge.id !== 'string' || edges.has(edge.id) || !['data','control','error'].includes(edge.kind)) return 'Invalid connection';
      edges.add(edge.id);
      const source = board.blocks.find(block => block.id === edge.source?.blockId);
      const target = board.blocks.find(block => block.id === edge.target?.blockId);
      if (!source || !target || source.id === target.id || !source.ports.some(port => port.id === edge.source.portId && port.direction === 'output') || !target.ports.some(port => port.id === edge.target.portId && port.direction === 'input')) return 'Dangling connection';
      if (typeof edge.label !== 'string' || edge.label.length > 200) return 'Invalid connection label';
    }
  }
  if (value.boards[value.rootBoardId].ownerBlockId !== null || childIds.size !== boards.length - 1) return 'Unreachable or detached board';
  for (const board of boards) {
    const path = boardPath(value, board.id);
    if (!path.length || path[0].id !== value.rootBoardId || path[path.length - 1].id !== board.id) return 'Cycle or invalid board hierarchy';
  }
  return null;
}

export function createDemoProject() {
  const project = createEmptyProject('My architecture');
  const root = project.rootBoardId;
  project.boards[root].viewport = { x: 45, y: 95, zoom: .78 };
  const input = addBlock(project, root, 'data-ingestion', {x:90,y:190});
  input.label = 'Take in data';
  const process = addBlock(project, root, 'data-processing', {x:425,y:190});
  process.label = 'Exploit data';
  const output = addBlock(project, root, 'report-generation', {x:760,y:190});
  output.label = 'Output results';
  connectBlocks(project,root,input.id,process.id);
  connectBlocks(project,root,process.id,output.id);
  const inputBoard = createDecomposition(project,root,input.id);
  const frontend = addBlock(project,inputBoard,'frontend-form',{x:70,y:160});
  frontend.label = 'Frontend input';
  const backend = addBlock(project,inputBoard,'request-handler',{x:385,y:160});
  backend.label = 'Backend acceptance';
  const prep = addBlock(project,inputBoard,'clean-data',{x:700,y:160});
  prep.label = 'Data preprocessing';
  connectBlocks(project,inputBoard,frontend.id,backend.id);
  connectBlocks(project,inputBoard,backend.id,prep.id);
  const prepBoard = createDecomposition(project,inputBoard,prep.id);
  const validate = addBlock(project,prepBoard,'validate-schema',{x:70,y:160});
  const clean = addBlock(project,prepBoard,'clean-data',{x:385,y:160});
  const normalize = addBlock(project,prepBoard,'normalize-values',{x:700,y:160});
  connectBlocks(project,prepBoard,validate.id,clean.id);
  connectBlocks(project,prepBoard,clean.id,normalize.id);
  return project;
}
