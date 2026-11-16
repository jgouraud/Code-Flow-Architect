import { BLOCK_TEMPLATES, DEFAULT_TEMPLATE, findTemplate } from './library.js';
import {
  BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_NATURES, DATA_FORMATS, STORAGE_KEY, LEGACY_STORAGE_KEY,
  MAX_PORTS, PORT_SIDES, addAnnotation, addPort, removePort, addBlock, addZone,
  boardPath, connectBlocks, createDecomposition, createDemoProject, createEmptyProject,
  deleteBlock, findBlock, migrateProject, validateProject
} from './model.js';

const $ = id => document.getElementById(id);
const elements = {
  canvas: $('canvas'), scene: $('scene'), edges: $('edge-layer'), blocks: $('blocks-layer'), zones: $('zone-layer'),
  library: $('library-items'), inspector: $('inspector-content'), status: $('status-message')
};
const kindColor = { data: '#4aa3ff', control: '#a4acc2', error: '#ffae80' };
const lightKindColor = { data: '#246bb3', control: '#5c6980', error: '#b4533b' };
let project;
let currentBoardId;
let selected = null;
let libraryLevel = 'All';
let pendingSource = null;
let previewPoint = null;
let undoStack = [];
let redoStack = [];

function message(text) { elements.status.textContent = text; }
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').textContent = theme === 'light' ? '☀ Light' : '☾ Dark';
  $('theme-toggle').setAttribute('aria-pressed', String(theme === 'light'));
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f3f7fd' : '#0b1120';
  if (project) renderEdges();
}
function setupTheme() {
  let theme = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
  try { const stored = localStorage.getItem('codeflow-architect-theme'); if (['light','dark'].includes(stored)) theme = stored; } catch { /* Storage may be disabled. */ }
  applyTheme(theme);
}
function togglePanel(side) {
  const panel = document.querySelector(`.${side}-panel`);
  const collapsed = panel.classList.toggle('collapsed');
  document.querySelector('.workspace').classList.toggle(`${side}-collapsed`, collapsed);
  const control = $(`toggle-${side}`);
  control.setAttribute('aria-expanded', String(!collapsed));
  control.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${side === 'library' ? 'block library' : 'inspector'}`);
  control.title = control.getAttribute('aria-label');
  control.textContent = side === 'library' ? (collapsed ? '›' : '‹') : (collapsed ? '‹' : '›');
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    $('save-status').textContent = '● Saved locally';
    $('save-status').classList.remove('warning');
  } catch {
    $('save-status').textContent = '⚠ Not saved — export JSON';
    $('save-status').classList.add('warning');
    message('Browser storage unavailable. Export your project to keep your work.');
  }
}
function load() {
  try {
    // Keep the v1 key untouched as a recoverable copy of a legacy project.
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored) {
      const candidate = JSON.parse(stored);
      const error = validateProject(candidate);
      if (!error) return migrateProject(candidate);
      message(`Stored project was invalid (${error}); loaded an example instead.`);
    }
  } catch { message('Could not load local project; loaded an example instead.'); }
  return createDemoProject();
}
function board() { return project.boards[currentBoardId]; }
function cloneProject() { return JSON.stringify(project); }
function mutate(operation) {
  const snapshot = cloneProject();
  try {
    operation();
    const invalid = validateProject(project);
    if (invalid) throw new Error(invalid);
  } catch (error) { project = JSON.parse(snapshot); message(error.message || 'Could not complete operation'); return false; }
  undoStack.push(snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  save();
  render();
  return true;
}
function travelHistory(direction) {
  const source = direction === 'undo' ? undoStack : redoStack;
  const dest = direction === 'undo' ? redoStack : undoStack;
  if (!source.length) return;
  dest.push(cloneProject());
  project = JSON.parse(source.pop());
  if (!project.boards[currentBoardId]) currentBoardId = project.rootBoardId;
  selected = null; pendingSource = null;
  save(); render(); message(direction === 'undo' ? 'Undid last edit' : 'Redid last edit');
}
function element(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}
function button(label, cls, action, title = label) {
  const node = element('button', cls, label);
  node.type = 'button'; node.title = title; node.addEventListener('click', action);
  return node;
}
function renderLibrary() {
  const filters = $('level-filters'); filters.replaceChildren();
  for (const level of ['All', 'H0', 'H1', 'H2', 'H3']) {
    const item = button(level, `filter-pill ${libraryLevel === level ? 'active' : ''}`, () => { libraryLevel = level; renderLibrary(); });
    item.setAttribute('aria-pressed', String(libraryLevel === level));
    filters.append(item);
  }
  const query = $('library-search').value.trim().toLowerCase();
  const filtered = BLOCK_TEMPLATES.filter(item => (libraryLevel === 'All' || item.level === libraryLevel) && `${item.label} ${item.description} ${item.group} ${item.category}`.toLowerCase().includes(query));
  elements.library.replaceChildren();
  let group = '';
  for (const template of filtered) {
    const key = `${template.level} · ${template.group}`;
    if (key !== group) { elements.library.append(element('div', 'library-group', key)); group = key; }
    const item = element('button', 'template-row');
    item.type = 'button'; item.draggable = true; item.title = `Add ${template.label} to canvas`;
    item.dataset.nature = template.nature ?? 'component';
    const glyph = element('span', `template-icon category-${template.category.toLowerCase()}`, template.icon);
    glyph.setAttribute('aria-hidden', 'true');
    const text = element('span', 'template-info');
    text.append(element('strong', '', template.label), element('small', '', template.description));
    const add = element('span', 'template-add', '+'); add.setAttribute('aria-hidden','true');
    item.append(glyph, text, add);
    item.addEventListener('click', () => addTemplate(template.id));
    item.addEventListener('dragstart', event => {
      event.dataTransfer.setData('application/x-codeflow-template', template.id);
      event.dataTransfer.setData('text/plain', template.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    elements.library.append(item);
  }
  if (!filtered.length) elements.library.append(element('p', 'no-results', 'No blocks found. Try another search.'));
}
function addTemplate(templateId, position = null) {
  const center = position ?? worldPointFromScreen(elements.canvas.getBoundingClientRect().left + elements.canvas.clientWidth / 2, elements.canvas.getBoundingClientRect().top + elements.canvas.clientHeight / 2);
  const count = board().blocks.length;
  const blockPosition = position ?? { x: center.x - BLOCK_WIDTH/2 + (count%4)*14, y: center.y - BLOCK_HEIGHT/2 + (count%4)*18 };
  let id;
  if (mutate(() => { id = addBlock(project, currentBoardId, templateId, blockPosition).id; })) {
    selected = { type: 'block', id }; render(); message('Block added. Double-click to decompose it.');
  }
}
function getTemplateIcon(block) { return findTemplate(block.templateId)?.icon ?? '▣'; }
function renderBreadcrumbs() {
  const breadcrumbs = $('breadcrumbs'); breadcrumbs.replaceChildren();
  const path = boardPath(project, currentBoardId);
  path.forEach((entry,index) => {
    if (index) breadcrumbs.append(element('span','breadcrumb-separator','›'));
    const label = index === 0 ? 'Overview' : entry.name;
    const crumb = button(label, `breadcrumb ${entry.id === currentBoardId ? 'current' : ''}`, () => openBoard(entry.id));
    if (entry.id === currentBoardId) crumb.setAttribute('aria-current','page');
    breadcrumbs.append(crumb);
  });
  $('board-meta').textContent = `${board().name} · ${path.length === 1 ? 'H0 · System overview' : `Depth ${path.length - 1} · Decomposition`}`;
}
function renderZones() {
  elements.zones.replaceChildren();
  for (const zone of board().zones ?? []) {
    const active = selected?.type === 'zone' && selected.id === zone.id;
    const node = element('div', `zone zone-${zone.kind} ${active ? 'selected' : ''}`);
    node.dataset.zoneId = zone.id;
    node.style.left = `${zone.position.x}px`;
    node.style.top = `${zone.position.y}px`;
    node.style.width = `${zone.width}px`;
    node.style.height = `${zone.height}px`;
    node.tabIndex = 0;
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', `${zone.kind} zone: ${zone.label}. Use arrow keys to reposition.`);
    node.append(element('span', 'zone-caption', zone.label));
    const grip = button('↘', 'zone-resize', () => select({type:'zone',id:zone.id}), `Resize ${zone.label}`);
    grip.setAttribute('aria-label', `Resize ${zone.label}`);
    grip.addEventListener('pointerdown', event => startZoneDrag(event, zone, 'resize'));
    node.append(grip);
    node.addEventListener('click', event => { event.stopPropagation(); select({type:'zone',id:zone.id}); });
    node.addEventListener('pointerdown', event => startZoneDrag(event, zone, 'move'));
    node.addEventListener('keydown', event => {
      if (event.target !== node || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 20 : 10;
      const delta = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[event.key];
      mutate(() => { zone.position.x += delta[0]; zone.position.y += delta[1]; });
      elements.zones.querySelector(`[data-zone-id="${CSS.escape(zone.id)}"]`)?.focus();
    });
    elements.zones.append(node);
  }
}
function renderBlocks() {
  elements.blocks.replaceChildren();
  for (const block of board().blocks) {
    const node = element('div', `block ${selected?.type === 'block' && selected.id === block.id ? 'selected' : ''}`);
    const nature = block.nature ?? 'component';
    node.dataset.nature = nature;
    node.dataset.blockId = block.id; node.style.left = `${block.position.x}px`; node.style.top = `${block.position.y}px`;
    node.tabIndex = 0; node.setAttribute('role','group');
    node.setAttribute('aria-label', `${block.label}, ${block.level} ${nature}${block.dataFormat && nature === 'data' ? `, ${block.dataFormat}` : ''}${block.childBoardId ? ', has decomposition' : ''}`);
    const top = element('div','block-top');
    const icon = element('span','block-icon',getTemplateIcon(block)); icon.setAttribute('aria-hidden','true');
    top.append(icon,element('span','block-level',block.level), element('span','block-nature',nature === 'data' && block.dataFormat ? `data · ${block.dataFormat}` : nature));
    if (block.childBoardId) { const mark = element('span','decomposed-mark','▤'); mark.title = 'Has decomposition'; top.append(mark); }
    const name = element('div','block-name',block.label);
    const description = element('div','block-description',block.sourceRef || block.description || 'Architectural component');
    node.append(top,name,description);
    for (const port of block.ports) {
      const control = button('', `port ${port.direction} side-${port.side} ${pendingSource && port.direction === 'input' ? 'connection-target' : ''}`, event => {
        event.stopPropagation();
        if (port.direction === 'input' && pendingSource) completeConnection(pendingSource, block.id, port.id);
        else if (port.direction === 'output') {
          pendingSource = { blockId: block.id, portId: port.id }; previewPoint = null;
          renderEdges(); message('Choose an input port to connect, or press Escape.');
        }
      }, `${port.direction} port: ${port.name}`);
      control.style.setProperty('--port-offset', `${port.offset * 100}%`);
      control.setAttribute('aria-label', `${block.label}, ${port.direction} ${port.kind} port ${port.name}, ${port.side} side${port.dataType ? `, ${port.dataType}` : ''}`);
      control.dataset.portId = port.id;
      if (port.direction === 'output') control.addEventListener('pointerdown', event => startConnectionDrag(event, block.id, port.id));
      node.append(control);
    }
    node.addEventListener('click', event => {
      if (event.target.closest('.port')) return;
      select({type:'block',id:block.id});
    });
    node.addEventListener('dblclick', event => {
      if (!event.target.closest('.port')) openDecomposition(block.id);
    });
    node.addEventListener('keydown', event => {
      if (event.target !== node) return;
      if (event.key === 'Enter') { event.preventDefault(); openDecomposition(block.id); }
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
        event.preventDefault(); const step = event.shiftKey ? 20 : 10;
        const d = {ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
        mutate(() => { block.position.x += d[0]; block.position.y += d[1]; });
        elements.blocks.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)?.focus();
      }
    });
    node.addEventListener('pointerdown', event => startBlockDrag(event, block));
    elements.blocks.append(node);
  }
}
function portAnchor(block, port) {
  const { x, y } = block.position;
  const along = port.offset;
  if (port.side === 'top') return { x: x + BLOCK_WIDTH * along, y, dx: 0, dy: -1 };
  if (port.side === 'bottom') return { x: x + BLOCK_WIDTH * along, y: y + BLOCK_HEIGHT, dx: 0, dy: 1 };
  if (port.side === 'left') return { x, y: y + BLOCK_HEIGHT * along, dx: -1, dy: 0 };
  return { x: x + BLOCK_WIDTH, y: y + BLOCK_HEIGHT * along, dx: 1, dy: 0 };
}
function edgeGeometry(source, target) {
  const span = Math.hypot(target.x - source.x, target.y - source.y);
  const bend = Math.max(42, Math.min(180, span * .4));
  const c1 = { x: source.x + source.dx * bend, y: source.y + source.dy * bend };
  const c2 = { x: target.x + target.dx * bend, y: target.y + target.dy * bend };
  return {
    d: `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,
    at(t) {
      const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t ** 2, d = t ** 3;
      return { x: a * source.x + b * c1.x + c * c2.x + d * target.x,
        y: a * source.y + b * c1.y + c * c2.y + d * target.y };
    }
  };
}
function svg(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function renderEdges() {
  elements.edges.replaceChildren();
  const current = board();
  const lookup = new Map(current.blocks.map(block => [block.id,block]));
  const palette = document.documentElement.dataset.theme === 'light' ? lightKindColor : kindColor;
  const defs = svg('defs', {});
  for (const [kind, color] of Object.entries(palette)) {
    const marker = svg('marker', { id: `arrow-${kind}`, viewBox: '0 0 10 10', markerWidth: 11, markerHeight: 11,
      refX: 9, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svg('path', { d: 'M 0 1 L 9 5 L 0 9 Z', fill: color }));
    defs.append(marker);
  }
  elements.edges.append(defs);
  for (const edge of current.edges) {
    const source = lookup.get(edge.source.blockId), target = lookup.get(edge.target.blockId);
    const output = source?.ports.find(port => port.id === edge.source.portId);
    const input = target?.ports.find(port => port.id === edge.target.portId);
    if (!output || !input) continue;
    const geometry = edgeGeometry(portAnchor(source, output), portAnchor(target, input));
    const color = palette[edge.kind] ?? palette.data;
    const isSelected = selected?.type === 'edge' && selected.id === edge.id;
    const visible = svg('path', { d: geometry.d, stroke: color, 'stroke-width': isSelected ? 3.5 : 2.5,
      fill: 'none', 'stroke-dasharray': edge.kind === 'control' ? '7 6' : edge.kind === 'error' ? '3 6' : 'none',
      'marker-end': `url(#arrow-${edge.kind})`, class: 'visible-edge' });
    const hit = svg('path', { d: geometry.d, stroke: 'transparent', 'stroke-width': 18,
      fill: 'none', class: 'edge-hit', tabindex: '0', role: 'button',
      'aria-label': `Select ${edge.kind} connection from ${source.label}, ${output.name} to ${target.label}, ${input.name}` });
    hit.addEventListener('click', event => { event.stopPropagation(); select({type:'edge',id:edge.id}); });
    hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select({type:'edge',id:edge.id}); } });
    elements.edges.append(visible, hit);
    if (edge.label) {
      const at = geometry.at(.5);
      const text = svg('text', { x: at.x, y: at.y - 18, fill: document.documentElement.dataset.theme === 'light' ? '#334b70' : '#cbd5e1',
        'font-size': 12, 'text-anchor': 'middle', 'pointer-events': 'none' });
      text.textContent = edge.label.slice(0, 40);
      elements.edges.append(text);
    }
    for (const note of edge.annotations) {
      const at = geometry.at(note.at);
      const label = `Annotation: ${note.caption || 'Untitled'}. ${note.dataType ? `Type ${note.dataType}.` : ''} Press Enter to inspect.`;
      const dot = svg('circle', { cx: at.x, cy: at.y, r: isSelected ? 8 : 6, fill: color,
        stroke: document.documentElement.dataset.theme === 'light' ? '#fff' : '#18243d', 'stroke-width': 2,
        class: 'edge-note', tabindex: 0, role: 'button', 'aria-label': label });
      dot.addEventListener('click', event => { event.stopPropagation(); select({ type:'edge', id:edge.id }); });
      dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select({type:'edge',id:edge.id}); } });
      elements.edges.append(dot);
      if (note.dataType) {
        const badge = svg('text', { x: at.x + 10, y: at.y - 10, class:'edge-type', 'pointer-events':'none' });
        badge.textContent = note.dataType.slice(0, 20);
        elements.edges.append(badge);
      }
    }
  }
  if (pendingSource && previewPoint) {
    const source = lookup.get(pendingSource.blockId);
    const output = source?.ports.find(port => port.id === pendingSource.portId);
    if (output) {
      const start = portAnchor(source, output);
      elements.edges.append(svg('path', { d: `M ${start.x} ${start.y} L ${previewPoint.x} ${previewPoint.y}`,
        stroke: '#89c0ff', 'stroke-width': 2, fill: 'none', 'stroke-dasharray': '7 5', 'pointer-events': 'none' }));
    }
  }
}
function renderInspector() {
  const area = elements.inspector; area.replaceChildren();
  if (!selected) {
    const hint = element('div','inspector-empty');
    hint.append(element('div','inspector-empty-icon','◇'),element('h3','','Nothing selected'),element('p','','Select a block or connection to edit its details. Double-click any block to enter a decomposition board.'));
    const guide = element('div','quick-guide');
    guide.append(element('strong','','Quick start'),element('p','','1. Drag a block from the library\n2. Connect output → input ports\n3. Double-click to decompose\n4. Export your design as JSON'));
    area.append(hint,guide);return;
  }
  if (selected.type === 'zone') {
    const zone = (board().zones ?? []).find(item => item.id === selected.id);
    if (!zone) { selected=null; renderInspector(); return; }
    area.append(element('span','eyebrow','SELECTED ZONE'), element('h3','inspector-title','Architecture zone'));
    addSelectField(area,'Boundary',zone.kind,['frontend','backend'],value=>mutate(()=>{zone.kind=value;}));
    addTextField(area,'Zone label',zone.label,value=>mutate(()=>{zone.label=value.slice(0,120)||'Untitled zone';}));
    addNumberField(area,'Width',zone.width,180,10000,value=>mutate(()=>{zone.width=value;}));
    addNumberField(area,'Height',zone.height,120,10000,value=>mutate(()=>{zone.height=value;}));
    area.append(element('p','inspector-copy','Drag the zone to move it. Use its lower-right handle to resize it. Zones are visual boundaries, not containers that move blocks.'));
    area.append(button('Delete zone','btn danger wide',()=>{const id=zone.id;mutate(()=>{board().zones=board().zones.filter(item=>item.id!==id);});selected=null;render();}));
    return;
  }
  if (selected.type === 'edge') {
    const edge = board().edges.find(item => item.id===selected.id);
    if (!edge) {selected=null;renderInspector();return;}
    area.append(element('span','eyebrow','SELECTED CONNECTION'),element('h3','inspector-title','Directed connection'));
    const from = board().blocks.find(block => block.id === edge.source.blockId);
    const to = board().blocks.find(block => block.id === edge.target.blockId);
    const out = from?.ports.find(port => port.id === edge.source.portId);
    const input = to?.ports.find(port => port.id === edge.target.portId);
    area.append(element('p','inspector-copy', `${from?.label} · ${out?.name} (${out?.side}) → ${to?.label} · ${input?.name} (${input?.side})`));
    area.append(element('p','inspector-copy', `Flow kind: ${edge.kind}. Source type: ${out?.dataType || 'unspecified'}. Target type: ${input?.dataType || 'unspecified'}.`));
    addSelectField(area,'Flow type',edge.kind,['data','control','error'],value=>mutate(()=>{edge.kind=value;}));
    addTextField(area,'Label',edge.label,value=>mutate(()=>{edge.label=value;}));
    area.append(element('div','inspector-divider'),element('h4','inspector-section-title','Connection annotations'));
    for (const note of edge.annotations) {
      const item = element('div','port-editor');
      item.append(element('strong','',note.caption || 'Annotation'));
      addNumberField(item,'Position along arrow (%)',Math.round(note.at*100),1,99,value=>mutate(()=>{note.at=value/100;}));
      addTextField(item,'Caption',note.caption,value=>mutate(()=>{note.caption=value;}),200);
      addTextField(item,'Data type',note.dataType,value=>mutate(()=>{note.dataType=value;}),120);
      addTextField(item,'Format',note.format,value=>mutate(()=>{note.format=value;}),200);
      addTextareaField(item,'Description',note.description,value=>mutate(()=>{note.description=value;}));
      addTextField(item,'Schema reference',note.schemaRef ?? '',value=>mutate(()=>{note.schemaRef=value;}),500);
      item.append(button('Remove annotation','btn danger small',()=>mutate(()=>{edge.annotations=edge.annotations.filter(other=>other.id!==note.id);})))
      area.append(item);
    }
    area.append(button('+ Annotation','btn wide accent',()=>mutate(()=>addAnnotation(project,currentBoardId,edge.id, .5))));
    area.append(button('Delete connection','btn danger wide',()=>{mutate(()=>{board().edges=board().edges.filter(item=>item.id!==edge.id);});selected=null;render();}));
    return;
  }
  const entry = findBlock(project,selected.id);
  if (!entry || entry.board.id!==currentBoardId) {selected=null;renderInspector();return;}
  const {block} = entry;
  const summary = element('div','inspector-summary');
  summary.append(element('span','inspector-glyph',getTemplateIcon(block)),element('div','inspector-summary-text',`${block.level} · ${block.category}`));
  area.append(element('span','eyebrow','SELECTED COMPONENT'),summary);
  addTextField(area,'Block name',block.label,value=>mutate(()=>{block.label=value.slice(0,200)||'Untitled block';if(block.childBoardId)project.boards[block.childBoardId].name=block.label;}));
  addTextareaField(area,'Purpose / notes',block.description,value=>mutate(()=>{block.description=value.slice(0,2000);}));
  addTextField(area,'Source path / symbol',block.sourceRef ?? '',value=>mutate(()=>{block.sourceRef=value.slice(0,500);}));
  addSelectField(area,'Abstraction level',block.level,['H0','H1','H2','H3'],value=>mutate(()=>{block.level=value;}));
  addSelectField(area,'Block nature',block.nature ?? 'component',BLOCK_NATURES,value=>mutate(()=>{block.nature=value;if(value==='data' && !block.dataFormat) block.dataFormat='json';}));
  if ((block.nature ?? 'component') === 'data') addSelectField(area,'Data format',block.dataFormat ?? 'other',DATA_FORMATS,value=>mutate(()=>{block.dataFormat=value;}));
  area.append(element('div','inspector-divider'));
  area.append(element('h4','inspector-section-title','Interface contract'));
  area.append(element('p','inspector-copy', `${block.ports.length} / ${MAX_PORTS} ports. Select a port to begin a directed connection. Positions use 0–100% along the chosen side.`));
  for (const port of block.ports) {
    const editor = element('div','port-editor');
    editor.append(element('strong','',`${port.name} · ${port.direction}`));
    addTextField(editor,'Name',port.name,value=>mutate(()=>{port.name=value;}),100);
    addSelectField(editor,'Direction',port.direction,['input','output'],value=>changePort(block,port,'direction',value));
    addSelectField(editor,'Side',port.side,PORT_SIDES,value=>mutate(()=>{port.side=value;}));
    addNumberField(editor,'Position on side (%)',Math.round(port.offset*100),0,100,value=>mutate(()=>{port.offset=value/100;}));
    addSelectField(editor,'Flow type',port.kind,['data','control','error'],value=>mutate(()=>{port.kind=value;}));
    addTextField(editor,'Data type',port.dataType ?? '',value=>mutate(()=>{port.dataType=value;}),120);
    const actions = element('div','port-actions');
    actions.append(button('↑','btn ghost small',()=>mutate(()=>{const i=block.ports.indexOf(port);if(i>0)[block.ports[i-1],block.ports[i]]=[block.ports[i],block.ports[i-1]];}),'Move port up'));
    actions.append(button('↓','btn ghost small',()=>mutate(()=>{const i=block.ports.indexOf(port);if(i<block.ports.length-1)[block.ports[i+1],block.ports[i]]=[block.ports[i],block.ports[i+1]];}),'Move port down'));
    actions.append(button('Remove','btn danger small',()=>{
      const count=board().edges.filter(edge=>(edge.source.blockId===block.id&&edge.source.portId===port.id)||(edge.target.blockId===block.id&&edge.target.portId===port.id)).length;
      if(count && !confirm(`Remove this port and its ${count} connection(s)?`)) return;
      mutate(()=>removePort(project,currentBoardId,block.id,port.id));
    }));
    editor.append(actions);area.append(editor);
  }
  const additions=element('div','port-actions');
  for(const side of PORT_SIDES){additions.append(button(`+ ${side}`,'btn ghost small',()=>mutate(()=>addPort(project,currentBoardId,block.id,side))));}
  area.append(additions);
  area.append(element('div','inspector-divider'));
  area.append(element('h4','inspector-section-title','Decomposition'));
  area.append(element('p','inspector-copy', block.childBoardId ? 'This block has a child board. Open it to edit the internal workflow.' : 'Create a child board to describe how this component works internally.'));
  area.append(button(block.childBoardId?'↗ Open child board':'+ Create decomposition','btn wide accent',()=>openDecomposition(block.id)));
  area.append(button('Delete block','btn danger wide',()=>{const id=block.id;mutate(()=>deleteBlock(project,currentBoardId,id));selected=null;render();}));
}
function changePort(block, port, key, value) {
  if (key === 'direction') {
    const count = board().edges.filter(edge => (edge.source.blockId === block.id && edge.source.portId === port.id) ||
      (edge.target.blockId === block.id && edge.target.portId === port.id)).length;
    if (count && !confirm(`Change direction and delete ${count} affected connection(s)?`)) { renderInspector(); return; }
    mutate(() => {
      board().edges = board().edges.filter(edge => !((edge.source.blockId === block.id && edge.source.portId === port.id) ||
        (edge.target.blockId === block.id && edge.target.portId === port.id)));
      port.direction = value;
    });
  }
}
function addTextField(parent,label,value,onSave,maxLength=200) {
  const wrapper=element('label','field');wrapper.append(element('span','field-label',label));
  const input=element('input','field-input');input.type='text';input.value=value;input.maxLength=maxLength;
  input.addEventListener('change',()=>{if(input.value!==value)onSave(input.value);});wrapper.append(input);parent.append(wrapper);
}
function addNumberField(parent,label,value,min,max,onSave) {
  const wrapper=element('label','field');wrapper.append(element('span','field-label',label));
  const input=element('input','field-input');input.type='number';input.min=String(min);input.max=String(max);input.step='1';input.value=String(value);
  input.addEventListener('change',()=>{
    const number=Number(input.value);
    if (input.value !== '' && Number.isFinite(number)) onSave(Math.max(min,Math.min(max,Math.round(number))));
    else input.value=String(value);
  });
  wrapper.append(input);parent.append(wrapper);
}
function addTextareaField(parent,label,value,onSave) {
  const wrapper=element('label','field');wrapper.append(element('span','field-label',label));
  const input=element('textarea','field-input field-textarea');input.rows=4;input.maxLength=2000;input.value=value;
  input.addEventListener('change',()=>{if(input.value!==value)onSave(input.value);});wrapper.append(input);parent.append(wrapper);
}
function addSelectField(parent,label,value,options,onSave) {
  const wrapper=element('label','field');wrapper.append(element('span','field-label',label));
  const select=element('select','field-input');
  for(const option of options){const item=element('option','',option.toUpperCase());item.value=option;select.append(item);}
  select.value=value;select.addEventListener('change',()=>onSave(select.value));wrapper.append(select);parent.append(wrapper);
}
function render() {
  $('project-name').value=project.name;
  renderBreadcrumbs();renderZones();renderBlocks();renderEdges();renderInspector();paintViewport();
  const zones = board().zones ?? [];
  $('board-counts').textContent=`${board().blocks.length} blocks · ${board().edges.length} connections · ${zones.length} zones`;
  $('empty-state').hidden=board().blocks.length>0 || zones.length>0;
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
}
function select(next) {
  selected = next;
  for (const node of elements.blocks.children) {
    node.classList.toggle('selected', next?.type === 'block' && node.dataset.blockId === next.id);
  }
  for (const node of elements.zones.children) {
    node.classList.toggle('selected', next?.type === 'zone' && node.dataset.zoneId === next.id);
  }
  renderEdges();
  renderInspector();
}
function openBoard(boardId) {
  if(!project.boards[boardId])return;
  currentBoardId=boardId;selected=null;pendingSource=null;previewPoint=null;
  render();elements.canvas.scrollLeft = 0;elements.canvas.scrollTop = 0;
  $('breadcrumbs').querySelector('[aria-current="page"]')?.focus({preventScroll:true});
  message(`Opened ${board().name}`);
}
function openDecomposition(blockId) {
  let nextId;
  const owner=board().blocks.find(item=>item.id===blockId);
  if (!owner)return;
  if(owner.childBoardId)nextId=owner.childBoardId;
  else mutate(()=>{nextId=createDecomposition(project,currentBoardId,blockId);});
  openBoard(nextId);
}
function completeConnection(source, targetId, targetPortId) {
  pendingSource=null;previewPoint=null;
  const ok=mutate(()=>connectBlocks(project,currentBoardId,source.blockId,targetId,'data',source.portId,targetPortId));
  if(ok)message('Connection created');
  else renderEdges();
}
function worldPointFromScreen(clientX,clientY) {
  const rect=elements.canvas.getBoundingClientRect();const {x,y,zoom}=board().viewport;
  return {x:(clientX-rect.left-x)/zoom,y:(clientY-rect.top-y)/zoom};
}
function startConnectionDrag(event, sourceId, sourcePortId) {
  if(event.button!==0)return;
  event.stopPropagation();pendingSource={blockId:sourceId,portId:sourcePortId};
  const sx=event.clientX,sy=event.clientY;
  let moved=false;
  const move=e=>{if(Math.hypot(e.clientX-sx,e.clientY-sy)>6)moved=true;previewPoint=worldPointFromScreen(e.clientX,e.clientY);renderEdges();};
  const up=e=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointercancel',cancel);
    previewPoint=null;
    if(moved){
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.port.input');
      const targetId=target?.closest('.block')?.dataset.blockId;
      if(targetId){completeConnection({blockId:sourceId,portId:sourcePortId},targetId,target.dataset.portId);return;}
      pendingSource=null;message('Connect by dropping on an input port.');
    }
    renderEdges();
  };
  const cancel=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);pendingSource=null;previewPoint=null;renderEdges();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});window.addEventListener('pointercancel',cancel,{once:true});
}
function startBlockDrag(event,block) {
  if(event.button!==0||event.target.closest('.port'))return;
  event.stopPropagation();
  select({type:'block',id:block.id});
  const origin={...block.position};const sx=event.clientX,sy=event.clientY;
  let moved=false;
  const node=elements.blocks.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
  const move=e=>{
    const dx=(e.clientX-sx)/board().viewport.zoom,dy=(e.clientY-sy)/board().viewport.zoom;
    if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
    if(!moved)return;
    block.position={x:Math.round(origin.x+dx),y:Math.round(origin.y+dy)};
    node.style.left=`${block.position.x}px`;node.style.top=`${block.position.y}px`;
    renderEdges();
  };
  const finish=()=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointercancel',cancel);
    if(moved){const next={...block.position};block.position=origin;mutate(()=>{block.position=next;});message('Block moved');}
  };
  const cancel=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);block.position=origin;render();};
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',finish,{once:true});window.addEventListener('pointercancel',cancel,{once:true});
}
function startZoneDrag(event, zone, mode) {
  if (event.button !== 0) return;
  event.stopPropagation();
  select({type:'zone',id:zone.id});
  const startX=event.clientX, startY=event.clientY;
  const before={position:{...zone.position},width:zone.width,height:zone.height};
  const node=elements.zones.querySelector(`[data-zone-id="${CSS.escape(zone.id)}"]`);
  let moved=false;
  const move=e=>{
    const dx=(e.clientX-startX)/board().viewport.zoom;
    const dy=(e.clientY-startY)/board().viewport.zoom;
    if (Math.abs(dx)+Math.abs(dy)>3) moved=true;
    if (!moved) return;
    if (mode === 'resize') {
      zone.width=Math.max(180,Math.min(10000,Math.round(before.width+dx)));
      zone.height=Math.max(120,Math.min(10000,Math.round(before.height+dy)));
      node.style.width=`${zone.width}px`;node.style.height=`${zone.height}px`;
    } else {
      zone.position={x:Math.round(before.position.x+dx),y:Math.round(before.position.y+dy)};
      node.style.left=`${zone.position.x}px`;node.style.top=`${zone.position.y}px`;
    }
  };
  const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);};
  const finish=()=>{
    cleanup();
    if (!moved) return;
    const after={position:{...zone.position},width:zone.width,height:zone.height};
    Object.assign(zone,before);
    mutate(()=>Object.assign(zone,after));
    message(mode === 'resize' ? 'Zone resized' : 'Zone moved');
  };
  const cancel=()=>{cleanup();Object.assign(zone,before);render();};
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',finish,{once:true});
  window.addEventListener('pointercancel',cancel,{once:true});
}
function paintViewport() {
  const {x,y,zoom}=board().viewport;
  elements.scene.style.transform=`translate(${x}px, ${y}px) scale(${zoom})`;
  elements.canvas.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;
  elements.canvas.style.backgroundPosition=`${x}px ${y}px`;
  $('zoom-label').textContent=`${Math.round(zoom*100)}%`;
}
function zoomTo(nextZoom,pointerX=elements.canvas.clientWidth/2,pointerY=elements.canvas.clientHeight/2) {
  const viewport=board().viewport;
  const zoom=Math.max(.3,Math.min(2.5,nextZoom));
  const worldX=(pointerX-viewport.x)/viewport.zoom,worldY=(pointerY-viewport.y)/viewport.zoom;
  viewport.x=pointerX-worldX*zoom;viewport.y=pointerY-worldY*zoom;viewport.zoom=zoom;
  paintViewport();save();
}
function fitView() {
  const current=board();
  const boxes=[...current.blocks.map(b=>({x:b.position.x,y:b.position.y,width:BLOCK_WIDTH,height:BLOCK_HEIGHT})),...(current.zones ?? []).map(z=>({x:z.position.x,y:z.position.y,width:z.width,height:z.height}))];
  if(!boxes.length){current.viewport={x:80,y:100,zoom:1};paintViewport();save();return;}
  const minX=Math.min(...boxes.map(b=>b.x));
  const maxX=Math.max(...boxes.map(b=>b.x+b.width));
  const minY=Math.min(...boxes.map(b=>b.y));
  const maxY=Math.max(...boxes.map(b=>b.y+b.height));
  const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);
  const zoom=Math.min(1.3,Math.max(.3,Math.min((elements.canvas.clientWidth-110)/width,(elements.canvas.clientHeight-160)/height)));
  current.viewport={x:(elements.canvas.clientWidth-width*zoom)/2-minX*zoom,y:(elements.canvas.clientHeight-height*zoom)/2-minY*zoom,zoom};
  paintViewport();save();
}
function connectEvents() {
  $('library-search').addEventListener('input',renderLibrary);
  $('toggle-library').addEventListener('click',()=>togglePanel('library'));
  $('toggle-inspector').addEventListener('click',()=>togglePanel('inspector'));
  $('theme-toggle').addEventListener('click',()=>{
    const next=document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('codeflow-architect-theme',next); } catch { message('Theme preference cannot be saved in this browser.'); }
  });
  $('undo').addEventListener('click',()=>travelHistory('undo'));
  $('redo').addEventListener('click',()=>travelHistory('redo'));
  $('add-blank').addEventListener('click',()=>addTemplate(DEFAULT_TEMPLATE.id));
  $('project-name').addEventListener('change',event=>{const name=event.target.value.trim()||'Untitled project';if(name!==project.name)mutate(()=>{project.name=name;});});
  $('fit-view').addEventListener('click',fitView);
  $('center-view').addEventListener('click',()=>{const current=board().viewport;current.x=80;current.y=95;current.zoom=1;paintViewport();save();});
  for (const kind of ['frontend','backend']) {
    $(`add-${kind}-zone`).addEventListener('click',()=>{
      const rect=elements.canvas.getBoundingClientRect();
      const center=worldPointFromScreen(rect.left+rect.width/2,rect.top+rect.height/2);
      let id;
      if (mutate(()=>{id=addZone(project,currentBoardId,kind,{x:center.x-300,y:center.y-150}).id;})) {
        selected={type:'zone',id};render();message(`${kind} zone added. Drag to move or resize.`);
      }
    });
  }
  $('zoom-in').addEventListener('click',()=>zoomTo(board().viewport.zoom*1.15));
  $('zoom-out').addEventListener('click',()=>zoomTo(board().viewport.zoom/1.15));
  $('new-project').addEventListener('click',()=>{
    if(!confirm('Create a blank project? Export your current project first if you need a backup.'))return;
    project=createEmptyProject();currentBoardId=project.rootBoardId;selected=null;undoStack=[];redoStack=[];pendingSource=null;save();render();message('New blank project created');
  });
  $('export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=url;link.download=`${project.name.toLowerCase().replace(/[^a-z0-9-]+/g,'-')||'codeflow'}-architecture.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('Project JSON exported');
  });
  $('import').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>2_000_000){message('Import rejected: JSON files must be smaller than 2 MB');return;}
    try{
      const candidate=JSON.parse(await file.text());const error=validateProject(candidate);
      if(error)throw new Error(error);
      project=migrateProject(candidate);currentBoardId=project.rootBoardId;selected=null;undoStack=[];redoStack=[];pendingSource=null;save();render();
      message(candidate.schemaVersion===1?'Legacy v1 project migrated to v2. Original import file remains unchanged.':'Project imported successfully');
    }catch(error){message(`Import failed: ${error.message}`);}
  });
  elements.canvas.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';elements.canvas.classList.add('drag-over');});
  elements.canvas.addEventListener('dragleave',()=>elements.canvas.classList.remove('drag-over'));
  elements.canvas.addEventListener('drop',event=>{
    event.preventDefault();elements.canvas.classList.remove('drag-over');
    const templateId=event.dataTransfer.getData('application/x-codeflow-template');
    if(!findTemplate(templateId))return;
    const point=worldPointFromScreen(event.clientX,event.clientY);
    addTemplate(templateId,{x:point.x-BLOCK_WIDTH/2,y:point.y-BLOCK_HEIGHT/2});
  });
  elements.canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0 || event.target.closest('.block') || event.target.closest('.zone') || event.target.closest('.edge-hit') || event.target.closest('.edge-note') || event.target.closest('button'))return;
    if(selected){selected=null;renderZones();renderBlocks();renderEdges();renderInspector();}
    const start={x:event.clientX,y:event.clientY};const position={...board().viewport};
    elements.canvas.classList.add('panning');
    const move=e=>{board().viewport.x=position.x+e.clientX-start.x;board().viewport.y=position.y+e.clientY-start.y;paintViewport();};
    const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointercancel',stop);elements.canvas.classList.remove('panning');save();};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});
  });
  elements.canvas.addEventListener('wheel',event=>{
    event.preventDefault();const rect=elements.canvas.getBoundingClientRect();zoomTo(board().viewport.zoom*(event.deltaY>0?.91:1.09),event.clientX-rect.left,event.clientY-rect.top);
  },{passive:false});
  document.addEventListener('keydown',event=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(event.key==='Escape'){pendingSource=null;previewPoint=null;renderEdges();message('Connection cancelled');return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();travelHistory(event.shiftKey?'redo':'undo');return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();travelHistory('redo');return;}
    if((event.key==='Delete'||event.key==='Backspace')&&selected){
      event.preventDefault();const chosen=selected;
      if(chosen.type==='block')mutate(()=>deleteBlock(project,currentBoardId,chosen.id));
      else if(chosen.type==='zone')mutate(()=>{board().zones=(board().zones ?? []).filter(zone=>zone.id!==chosen.id);});
      else mutate(()=>{board().edges=board().edges.filter(edge=>edge.id!==chosen.id);});
      selected=null;render();
    }
  });
}

project=load();currentBoardId=project.rootBoardId;
setupTheme();connectEvents();renderLibrary();
for (const nature of BLOCK_NATURES) {
  const entry = element('li', '', nature[0].toUpperCase() + nature.slice(1));
  entry.dataset.nature = nature;
  $('nature-legend-list').append(entry);
}
render();
