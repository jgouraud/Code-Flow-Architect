import { DEFAULT_TEMPLATE, findTemplate } from './library.js';

export const SCHEMA_VERSION = 2;
export const PORT_SIDES = ['top', 'right', 'bottom', 'left'];
export const FLOW_KINDS = ['data', 'control', 'error'];
export const MAX_PORTS = 32;
export const MAX_ANNOTATIONS = 16;
export const BLOCK_NATURES = ['component', 'file', 'module', 'class', 'function', 'method', 'interface', 'service', 'data'];
export const DATA_FORMATS = ['database', 'csv', 'json', 'parquet', 'xml', 'yaml', 'binary', 'other'];
export const ZONE_KINDS = ['frontend', 'backend'];
export const BLOCK_WIDTH = 218;
export const BLOCK_HEIGHT = 104;
export const STORAGE_KEY = 'codeflow-architect-project-v2';
export const LEGACY_STORAGE_KEY = 'codeflow-architect-project-v1';

export function newId() { return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function createEmptyProject(name = 'Untitled project') {
  return {
    schemaVersion: SCHEMA_VERSION, id: newId(), name, rootBoardId: 'board-root',
    boards: { 'board-root': { id: 'board-root', name: 'System architecture', ownerBlockId: null, blocks: [], edges: [], zones: [], viewport: { x: 0, y: 0, zoom: 1 } } }
  };
}

export function makeBlock(templateId, position, id = newId()) {
  const template = findTemplate(templateId) ?? DEFAULT_TEMPLATE;
  return {
    id, templateId: template.id, label: template.label, level: template.level,
    category: template.category, description: template.description,
    nature: template.nature, dataFormat: template.dataFormat, sourceRef: '',
    position: { x: Math.round(position.x), y: Math.round(position.y) }, childBoardId: null,
    ports: [
      { id: `${id}-in`, name: 'Input', direction: 'input', kind: 'data', side: 'left', offset: 0.5, dataType: '' },
      { id: `${id}-out`, name: 'Output', direction: 'output', kind: 'data', side: 'right', offset: 0.5, dataType: '' }
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

export function addZone(project, boardId, kind, position) {
  const board = project.boards[boardId];
  if (!board) throw new Error('Board does not exist');
  if (!ZONE_KINDS.includes(kind)) throw new Error('Unsupported zone type');
  const zone = {
    id: newId(), kind, label: `${kind === 'frontend' ? 'Frontend' : 'Backend'} zone`,
    position: { x: Math.round(position.x), y: Math.round(position.y) }, width: 600, height: 300
  };
  (board.zones ??= []).push(zone);
  return zone;
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
  project.boards[id] = { id, name: block.label, ownerBlockId: blockId, blocks: [], edges: [], zones: [], viewport: { x: 45, y: 95, zoom: .78 } };
  block.childBoardId = id;
  return id;
}

export function addPort(project, boardId, blockId, side, direction = 'input') {
  const block = project.boards[boardId]?.blocks.find(item => item.id === blockId);
  if (!block) throw new Error('Block does not exist on this board');
  if (!PORT_SIDES.includes(side) || !['input', 'output'].includes(direction)) throw new Error('Invalid port orientation');
  if (block.ports.length >= MAX_PORTS) throw new Error(`A block supports at most ${MAX_PORTS} ports`);
  const count = block.ports.filter(item => item.side === side).length;
  const port = { id: newId(), name: `${direction === 'input' ? 'Input' : 'Output'} ${block.ports.length + 1}`,
    direction, kind: 'data', side, offset: (count + 1) / (count + 2), dataType: '' };
  block.ports.push(port);
  return port;
}

export function removePort(project, boardId, blockId, portId) {
  const board = project.boards[boardId];
  const block = board?.blocks.find(item => item.id === blockId);
  if (!block?.ports.some(port => port.id === portId)) throw new Error('Port does not exist');
  const originalCount = board.edges.length;
  block.ports = block.ports.filter(port => port.id !== portId);
  board.edges = board.edges.filter(edge => !((edge.source.blockId === blockId && edge.source.portId === portId) ||
    (edge.target.blockId === blockId && edge.target.portId === portId)));
  return originalCount - board.edges.length;
}

export function connectBlocks(project, boardId, sourceBlockId, targetBlockId, kind = 'data', sourcePortId, targetPortId) {
  const board = project.boards[boardId];
  const source = board?.blocks.find(block => block.id === sourceBlockId);
  const target = board?.blocks.find(block => block.id === targetBlockId);
  if (!source || !target || source.id === target.id) throw new Error('Choose different blocks on the same board');
  if (!FLOW_KINDS.includes(kind)) throw new Error('Unsupported connection type');
  const output = source.ports.find(port => port.id === (sourcePortId ?? source.ports.find(p => p.direction === 'output')?.id) && port.direction === 'output');
  const input = target.ports.find(port => port.id === (targetPortId ?? target.ports.find(p => p.direction === 'input')?.id) && port.direction === 'input');
  if (!output || !input) throw new Error('Choose an output and an input port');
  if (board.edges.some(edge => edge.source.portId === output.id && edge.target.portId === input.id && edge.kind === kind)) {
    throw new Error('This connection already exists');
  }
  const edge = {
    id: newId(), kind, label: '', annotations: [],
    source: { blockId: source.id, portId: output.id },
    target: { blockId: target.id, portId: input.id }
  };
  board.edges.push(edge);
  return edge;
}

export function addAnnotation(project, boardId, edgeId, at = 0.5) {
  const edge = project.boards[boardId]?.edges.find(item => item.id === edgeId);
  if (!edge) throw new Error('Connection does not exist');
  if (!Number.isFinite(at) || at <= 0 || at >= 1) throw new Error('Annotation position must be between 0 and 1');
  if (edge.annotations.length >= MAX_ANNOTATIONS) throw new Error(`At most ${MAX_ANNOTATIONS} annotations per connection`);
  const annotation = { id: newId(), at, caption: '', dataType: '', format: '', description: '', schemaRef: '' };
  edge.annotations.push(annotation);
  return annotation;
}

// Migration is non-destructive: the caller retains the original v1 JSON/legacy storage key.
export function migrateProject(value) {
  if (value?.schemaVersion !== 1) return value;
  const copy = structuredClone(value);
  copy.schemaVersion = SCHEMA_VERSION;
  for (const board of Object.values(copy.boards ?? {})) {
    for (const block of board?.blocks ?? []) {
      for (const port of block?.ports ?? []) {
        port.side = port.direction === 'input' ? 'left' : 'right';
        port.offset = 0.5;
        port.dataType = '';
      }
    }
    for (const edge of board?.edges ?? []) if (edge) edge.annotations = [];
  }
  return copy;
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
  if (value.schemaVersion === 1) return validateProject(migrateProject(value));
  if (value.schemaVersion !== SCHEMA_VERSION) return `Unsupported project version (expected ${SCHEMA_VERSION})`;
  if (typeof value.name !== 'string' || value.name.length > 200) return 'Invalid project name';
  if (!value.boards || typeof value.boards !== 'object' || Array.isArray(value.boards)) return 'Invalid boards';
  const boards = Object.values(value.boards);
  if (!boards.length || boards.length > 500) return 'Project must contain between 1 and 500 boards';
  if (!value.rootBoardId || !Object.hasOwn(value.boards, value.rootBoardId)) return 'Missing root board';
  const ids = new Set();
  const childIds = new Set();
  const zoneIds = new Set();
  const portIds = new Set();
  const edgeIds = new Set();
  const annotationIds = new Set();
  for (const board of boards) {
    if (!board || typeof board.id !== 'string' || value.boards[board.id] !== board || typeof board.name !== 'string' || board.name.length > 200 || (board.ownerBlockId !== null && typeof board.ownerBlockId !== 'string') || !Array.isArray(board.blocks) || !Array.isArray(board.edges)) return 'Invalid board structure';
    if (board.blocks.length > 2000 || board.edges.length > 5000) return 'Board exceeds size limit';
    if (!board.viewport || !['x','y','zoom'].every(key => Number.isFinite(board.viewport[key])) || board.viewport.zoom <= 0 || board.viewport.zoom > 10) return 'Invalid board viewport';
    // Older v1 projects have no zones; a missing array is intentionally valid.
    if (board.zones !== undefined) {
      if (!Array.isArray(board.zones) || board.zones.length > 100) return 'Invalid zones';
      for (const zone of board.zones) {
        if (!zone || typeof zone.id !== 'string' || zoneIds.has(zone.id) || !ZONE_KINDS.includes(zone.kind) || typeof zone.label !== 'string' || zone.label.length > 120 || !zone.position || !Number.isFinite(zone.position.x) || !Number.isFinite(zone.position.y) || !Number.isFinite(zone.width) || !Number.isFinite(zone.height) || zone.width < 180 || zone.height < 120 || zone.width > 10000 || zone.height > 10000) return 'Invalid zone';
        zoneIds.add(zone.id);
      }
    }
    for (const block of board.blocks) {
      if (!block || typeof block.id !== 'string' || ids.has(block.id) || typeof block.label !== 'string' || block.label.length > 200 || typeof block.description !== 'string' || block.description.length > 2000 || typeof block.templateId !== 'string' || typeof block.category !== 'string' || !['H0','H1','H2','H3'].includes(block.level) || (block.childBoardId !== null && typeof block.childBoardId !== 'string') || (block.nature !== undefined && !BLOCK_NATURES.includes(block.nature)) || (block.dataFormat !== undefined && block.dataFormat !== null && !DATA_FORMATS.includes(block.dataFormat)) || (block.sourceRef !== undefined && (typeof block.sourceRef !== 'string' || block.sourceRef.length > 500))) return 'Invalid or duplicate block';
      ids.add(block.id);
      if (!block.position || !Number.isFinite(block.position.x) || !Number.isFinite(block.position.y)) return 'Invalid block position';
      if (!Array.isArray(block.ports) || block.ports.length > MAX_PORTS) return 'Invalid block ports';
      for (const port of block.ports) {
        if (!port || typeof port.id !== 'string' || !port.id || port.id.length > 150 || portIds.has(port.id) ||
          typeof port.name !== 'string' || port.name.length > 100 || !['input', 'output'].includes(port.direction) ||
          !FLOW_KINDS.includes(port.kind) || !PORT_SIDES.includes(port.side) ||
          !Number.isFinite(port.offset) || port.offset < 0 || port.offset > 1 ||
          (port.dataType !== undefined && (typeof port.dataType !== 'string' || port.dataType.length > 120))) return 'Invalid or duplicate block port';
        portIds.add(port.id);
      }
      if (block.childBoardId) {
        const child = value.boards[block.childBoardId];
        if (!child || child.ownerBlockId !== block.id || childIds.has(child.id) || child.id === board.id) return 'Invalid decomposition ownership';
        childIds.add(child.id);
      }
    }
    const connections = new Set();
    for (const edge of board.edges) {
      if (!edge || typeof edge.id !== 'string' || !edge.id || edge.id.length > 150 || edgeIds.has(edge.id) || !FLOW_KINDS.includes(edge.kind)) return 'Invalid connection';
      edgeIds.add(edge.id);
      const source = board.blocks.find(block => block.id === edge.source?.blockId);
      const target = board.blocks.find(block => block.id === edge.target?.blockId);
      if (!source || !target || source.id === target.id || !source.ports.some(port => port.id === edge.source.portId && port.direction === 'output') || !target.ports.some(port => port.id === edge.target.portId && port.direction === 'input')) return 'Dangling connection';
      const pair = `${edge.source.portId}\0${edge.target.portId}\0${edge.kind}`;
      if (connections.has(pair)) return 'Duplicate connection ports';
      connections.add(pair);
      if (typeof edge.label !== 'string' || edge.label.length > 200) return 'Invalid connection label';
      if (!Array.isArray(edge.annotations) || edge.annotations.length > MAX_ANNOTATIONS) return 'Invalid connection annotations';
      for (const note of edge.annotations) {
        if (!note || typeof note.id !== 'string' || !note.id || note.id.length > 150 || annotationIds.has(note.id) ||
          !Number.isFinite(note.at) || note.at <= 0 || note.at >= 1 ||
          typeof note.caption !== 'string' || note.caption.length > 200 ||
          typeof note.dataType !== 'string' || note.dataType.length > 120 ||
          typeof note.format !== 'string' || note.format.length > 200 ||
          typeof note.description !== 'string' || note.description.length > 2000 ||
          (note.schemaRef !== undefined && (typeof note.schemaRef !== 'string' || note.schemaRef.length > 500))) return 'Invalid or duplicate annotation';
        annotationIds.add(note.id);
      }
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
  addZone(project, inputBoard, 'frontend', {x:35,y:95}).width = 290;
  addZone(project, inputBoard, 'backend', {x:350,y:95});
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
