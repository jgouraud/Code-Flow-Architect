import { newId, boardPath, findBlock } from './model.js';
import { installSimulation } from './simulation.js';
import {
  createWorkspace, panesIn, findPane, splitPane, closePane, navigatePane, goHistory,
  searchArchitecture, dependencyIds, toLayoutTree, restoreLayout, reconcileWorkspace
} from './workspace.js';

/** Install multiple views over the existing canonical project and undo/redo stream. */
export function installWorkspace(api) {
  let workspace = createWorkspace(api.project());
  let currentPane = findPane(workspace, workspace.activeId);
  const nodeMap = new Map();
  const elements = api.elements;
  const fieldNames = ['canvas', 'scene', 'edges', 'blocks', 'zones'];
  const initial = Object.fromEntries(fieldNames.map(name => [name, elements[name]]));
  const canvas = initial.canvas;
  const workspaceHost = document.createElement('div');
  workspaceHost.className = 'pane-workspace';
  workspaceHost.id = 'pane-workspace';
  canvas.before(workspaceHost);
  let selectedTourId = null, tourIndex = -1;
  let simulation = null;
  const filter = { nature: '', level: '', flow: '', zone: '' };
  let showMinimap = false;
  const controlBar = document.createElement('div');
  controlBar.className = 'workspace-tools';
  document.querySelector('.board-header-actions').prepend(controlBar);

  function el(tag, className = '', content = '') {
    const node = document.createElement(tag); node.className = className; node.textContent = content; return node;
  }
  function btn(label, action, title = label) {
    const node = el('button', 'btn ghost small', label);
    node.type = 'button'; node.title = title; node.addEventListener('click', action); return node;
  }
  function syncFromActive() {
    if (!currentPane) return;
    const context = api.readContext();
    currentPane.boardId = context.boardId;
    currentPane.selected = context.selected;
    currentPane.pendingSource = context.pendingSource;
    currentPane.previewPoint = context.previewPoint;
  }
  function contextFor(pane) { return {
    boardId: pane.boardId, selected: pane.selected,
    pendingSource: pane.pendingSource, previewPoint: pane.previewPoint
  }; }
  function activate(pane, refresh = false) {
    if (!pane || !api.project().boards[pane.boardId]) return;
    if (pane === currentPane && !refresh) return;
    if (pane !== currentPane) syncFromActive();
    currentPane = pane; workspace.activeId = pane.id;
    Object.assign(elements, nodeMap.get(pane.id).elements);
    api.writeContext(contextFor(pane));
    for (const [id, dom] of nodeMap) dom.root.classList.toggle('active', id === pane.id);
    if (refresh) api.render();
    else { api.chrome(); renderControls(); simulation?.onProjectRender(); }
  }
  function withPane(pane, callback) {
    const saved = api.readContext(), before = currentPane;
    const previous = Object.fromEntries(fieldNames.map(key => [key, elements[key]]));
    currentPane = pane;
    Object.assign(elements, nodeMap.get(pane.id).elements);
    api.writeContext(contextFor(pane));
    try { callback(); } finally {
      pane.selected = api.readContext().selected;
      pane.pendingSource = api.readContext().pendingSource;
      pane.previewPoint = api.readContext().previewPoint;
      api.writeContext(saved); currentPane = before;
      Object.assign(elements, previous);
    }
  }
  function paneDom(pane) {
    if (nodeMap.has(pane.id)) return nodeMap.get(pane.id).root;
    const root = el('section', 'flow-pane');
    root.dataset.paneId = pane.id;
    root.setAttribute('aria-label', 'Architecture pane');
    const header = el('div', 'flow-pane-header');
    const tabs = el('div', 'flow-pane-tabs');
    tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Open board tabs');
    const actions = el('div', 'flow-pane-actions');
    header.append(tabs, actions);
    const paneCanvas = nodeMap.size === 0 ? canvas : canvas.cloneNode(true);
    if (nodeMap.size) {
      for (const item of [paneCanvas, ...paneCanvas.querySelectorAll('[id]')]) item.removeAttribute('id');
      paneCanvas.querySelector('.empty-state')?.remove();
      paneCanvas.querySelector('.canvas-bottom')?.remove();
      paneCanvas.querySelector('.canvas-hint')?.remove();
      registerCanvas(paneCanvas);
    }
    paneCanvas.classList.add('flow-pane-canvas');
    root.append(header, paneCanvas);
    const dom = { root, header, tabs, actions, canvas: paneCanvas,
      elements: {
        canvas: paneCanvas, scene: paneCanvas.querySelector('.scene'),
        edges: paneCanvas.querySelector('.edge-layer'),
        blocks: paneCanvas.querySelector('.blocks-layer'), zones: paneCanvas.querySelector('.zone-layer')
      } };
    dom.elements.edges.dataset.paneMarker = pane.id;
    nodeMap.set(pane.id, dom);
    root.addEventListener('pointerdown', () => activate(pane), true);
    root.addEventListener('dragenter', () => activate(pane), true);
    root.addEventListener('drop', () => activate(pane), true);
    root.addEventListener('wheel', () => activate(pane), true);
    root.addEventListener('focusin', () => { if (pane !== currentPane) activate(pane); }, true);
    return root;
  }
  // The first canvas retains its P0 handlers. Additional canvases share those
  // interaction contracts, but all edits go through the same api.mutate().
  function registerCanvas(target) {
    target.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', event => {
      event.preventDefault(); target.classList.remove('drag-over');
      const templateId = event.dataTransfer.getData('application/x-codeflow-template');
      if (!api.templateExists(templateId)) return;
      const point = api.worldPoint(event.clientX, event.clientY);
      api.addTemplate(templateId, { x: point.x - api.blockWidth / 2, y: point.y - api.blockHeight / 2 });
    });
    target.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('.block,.zone,.edge-hit,.edge-note,button')) return;
      api.select(null);
      const start = { x: event.clientX, y: event.clientY };
      const viewport = currentPane.viewport, original = { ...viewport };
      target.classList.add('panning');
      const move = e => { viewport.x = original.x + e.clientX - start.x; viewport.y = original.y + e.clientY - start.y; api.paintViewport(); };
      const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); target.classList.remove('panning'); };
      const stop = () => { cleanup(); renderControls(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
      window.addEventListener('pointercancel', stop, { once: true });
    });
    target.addEventListener('wheel', event => {
      event.preventDefault(); const rect = target.getBoundingClientRect();
      api.zoomTo(currentPane.viewport.zoom * (event.deltaY > 0 ? .91 : 1.09), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
  }
  function renderTreeNode(node) {
    if (node.type === 'pane') return paneDom(node);
    const container = el('div', `pane-split ${node.direction}`);
    node.dom = container;
    container.style.setProperty('--first-weight', `${Math.round(node.ratio * 1000) / 10}%`);
    const divider = el('div', 'pane-divider');
    divider.tabIndex = 0; divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', node.direction === 'horizontal' ? 'vertical' : 'horizontal');
    divider.setAttribute('aria-label', 'Resize architecture panes');
    divider.setAttribute('aria-valuemin', '20'); divider.setAttribute('aria-valuemax', '80');
    const resize = ratio => {
      node.ratio = Math.min(.8, Math.max(.2, ratio));
      container.style.setProperty('--first-weight', `${node.ratio * 100}%`);
      divider.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
    };
    resize(node.ratio);
    divider.addEventListener('keydown', event => {
      const step = event.shiftKey ? .1 : .025;
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step :
        event.key === 'ArrowRight' || event.key === 'ArrowDown' ? step : 0;
      if (delta) { event.preventDefault(); resize(node.ratio + delta); }
      if (event.key === 'Home') { event.preventDefault(); resize(.2); }
      if (event.key === 'End') { event.preventDefault(); resize(.8); }
    });
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); const start = node.ratio;
      const rect = container.getBoundingClientRect(); const origin = node.direction === 'horizontal' ? event.clientX : event.clientY;
      const size = node.direction === 'horizontal' ? rect.width : rect.height;
      const move = e => resize(start + ((node.direction === 'horizontal' ? e.clientX : e.clientY) - origin) / Math.max(1, size));
      const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
      window.addEventListener('pointercancel', end, { once: true });
    });
    container.append(renderTreeNode(node.children[0]), divider, renderTreeNode(node.children[1]));
    return container;
  }
  function buildLayout() {
    workspaceHost.replaceChildren(renderTreeNode(workspace.root));
    for (const [id, dom] of nodeMap) if (!findPane(workspace, id)) nodeMap.delete(id);
    for (const pane of panesIn(workspace.root)) paintPaneHeader(pane);
    if (window.matchMedia('(max-width: 920px)').matches) {
      for (const pane of panesIn(workspace.root)) nodeMap.get(pane.id).root.hidden = pane.id !== workspace.activeId;
    } else for (const pane of panesIn(workspace.root)) nodeMap.get(pane.id).root.hidden = false;
    activate(findPane(workspace, workspace.activeId));
  }
  function paintPaneHeader(pane) {
    const dom = nodeMap.get(pane.id); dom.tabs.replaceChildren(); dom.actions.replaceChildren();
    const project = api.project();
    pane.tabs = pane.tabs.filter(id => project.boards[id]);
    for (const boardId of pane.tabs) {
      const board = project.boards[boardId];
      const tab = btn(board.name, () => {
        activate(pane); navigatePane(pane, api.project(), boardId);
        api.writeContext(contextFor(pane)); api.render();
      });
      tab.className = `pane-tab ${boardId === pane.boardId ? 'current' : ''}`;
      tab.setAttribute('aria-current', boardId === pane.boardId ? 'page' : 'false');
      dom.tabs.append(tab);
    }
    dom.actions.append(btn('↤', () => { activate(pane); if (goHistory(pane, api.project(), 'back')) { api.writeContext(contextFor(pane)); api.render(); } }, 'Back in this pane'));
    dom.actions.append(btn('↦', () => { activate(pane); if (goHistory(pane, api.project(), 'forward')) { api.writeContext(contextFor(pane)); api.render(); } }, 'Forward in this pane'));
    dom.actions.append(btn('×', () => { if (closePane(workspace, pane.id)) { buildLayout(); api.render(); } }, 'Close this pane'));
    const crumb = boardPath(project, pane.boardId).map(b => b.name).join(' / ');
    dom.root.setAttribute('aria-label', `Architecture pane: ${crumb}`);
  }
  function onNavigate(boardId, previousId) {
    if (!currentPane) return;
    // openBoard() sets the new board before this hook; preserve its old history.
    if (previousId !== boardId) {
      currentPane.back.push({ boardId: previousId, selection: currentPane.selected });
      if (currentPane.back.length > 40) currentPane.back.shift();
      currentPane.forward.length = 0;
      currentPane.viewport = { ...api.project().boards[boardId].viewport };
    }
    currentPane.boardId = boardId; currentPane.selected = null;
    if (!currentPane.tabs.includes(boardId)) currentPane.tabs.push(boardId);
  }
  function onSelect() {
    syncFromActive(); applyFilter(currentPane); simulation?.onProjectRender();
  }
  function afterRender() {
    if (!currentPane) return;
    reconcileWorkspace(workspace, api.project());
    syncFromActive();
    if (!api.project().boards[currentPane.boardId]) {
      currentPane.boardId = api.project().rootBoardId; currentPane.selected = null;
      api.writeContext(contextFor(currentPane));
    }
    for (const pane of panesIn(workspace.root)) {
      if (pane !== currentPane) withPane(pane, () => { api.renderPane(); applyFilter(pane); });
      else applyFilter(pane);
      paintPaneHeader(pane);
    }
    // The last secondary viewport paint must not overwrite active zoom status.
    api.paintViewport();
    renderExplorer(); renderControls(); simulation?.onProjectRender();
    for (const [id, dom] of nodeMap) dom.root.classList.toggle('active', id === workspace.activeId);
  }
  function applyFilter(pane) {
    const dom = nodeMap.get(pane.id);
    if (!dom) return;
    const board = api.project().boards[pane.boardId]; if (!board) return;
    const connections = dependencyIds(board, pane.selected);
    const zoneIds = new Set();
    if (filter.zone) for (const block of board.blocks) {
      if ((board.zones ?? []).some(z => z.kind === filter.zone && block.position.x >= z.position.x &&
        block.position.y >= z.position.y && block.position.x <= z.position.x + z.width && block.position.y <= z.position.y + z.height)) zoneIds.add(block.id);
    }
    for (const block of board.blocks) {
      const node = [...dom.elements.blocks.children].find(item => item.dataset.blockId === block.id);
      if (!node) continue;
      const matches = (!filter.nature || (block.nature ?? 'component') === filter.nature) &&
        (!filter.level || block.level === filter.level) && (!filter.zone || zoneIds.has(block.id));
      node.classList.toggle('dimmed', !matches);
      node.classList.toggle('dependency-focus', !!pane.selected && connections.has(block.id));
      node.classList.toggle('dependency-muted', !!pane.selected && !connections.has(block.id));
    }
    for (const shape of dom.elements.edges.querySelectorAll('[data-edge-id]')) {
      const edge = board.edges.find(item => item.id === shape.dataset.edgeId);
      shape.classList.toggle('dimmed', !edge || (!!filter.flow && edge.kind !== filter.flow));
      shape.classList.toggle('dependency-muted', !!pane.selected && !connections.has(edge?.id));
    }
    renderMinimap(pane);
  }
  function renderMinimap(pane) {
    const dom = nodeMap.get(pane.id);
    dom.root.querySelector('.pane-minimap')?.remove();
    if (!showMinimap) return;
    const blocks = api.project().boards[pane.boardId].blocks;
    if (!blocks.length) return;
    const minX = Math.min(...blocks.map(b => b.position.x));
    const maxX = Math.max(...blocks.map(b => b.position.x + api.blockWidth));
    const minY = Math.min(...blocks.map(b => b.position.y));
    const maxY = Math.max(...blocks.map(b => b.position.y + api.blockHeight));
    const root = el('div', 'pane-minimap'); root.setAttribute('aria-label', `Minimap of ${blocks.length} blocks`);
    for (const block of blocks) {
      const marker = el('span', 'minimap-block'); marker.title = block.label;
      marker.style.left = `${(block.position.x - minX) / Math.max(1, maxX - minX) * 90 + 3}%`;
      marker.style.top = `${(block.position.y - minY) / Math.max(1, maxY - minY) * 85 + 4}%`;
      root.append(marker);
    }
    dom.root.append(root);
  }
  function renderControls() {
    controlBar.replaceChildren();
    const project = api.project();
    const split = direction => {
      syncFromActive(); const pane = splitPane(workspace, project, direction);
      if (!pane) { api.message('Four visible panes maximum'); return; }
      buildLayout(); api.render();
    };
    controlBar.append(btn('Split right', () => split('horizontal')),
      btn('Split down', () => split('vertical')),
      btn('Two columns', () => preset('columns')),
      btn('2×2', () => preset('grid')));
    const panePicker = el('select','field-input workspace-layout-select');
    panePicker.setAttribute('aria-label','Active architecture pane');
    for(const pane of panesIn(workspace.root))panePicker.append(new Option(project.boards[pane.boardId]?.name??'Board',pane.id));
    panePicker.value=workspace.activeId;
    panePicker.addEventListener('change',()=>{activate(findPane(workspace,panePicker.value),true);resize();});
    controlBar.append(panePicker);
    const saved = el('select', 'field-input workspace-layout-select');
    saved.setAttribute('aria-label', 'Open saved workspace layout');
    saved.append(new Option('Layouts…', ''));
    for (const layout of project.workspaceLayouts ?? []) saved.append(new Option(layout.label, layout.id));
    saved.addEventListener('change', () => {
      const layout = (project.workspaceLayouts ?? []).find(x => x.id === saved.value);
      if (layout) { workspace = restoreLayout(project, layout); buildLayout(); api.render(); }
    });
    controlBar.append(saved, btn('Save layout', () => {
      const label = prompt('Layout name (saved in project export):', 'Onboarding view');
      if (!label?.trim()) return;
      api.mutate(() => {
        (project.workspaceLayouts ??= []).push({ id: newId(), label: label.slice(0,120), root: toLayoutTree(workspace.root) });
      });
    }));
    const filterBar = el('div', 'workspace-filter-bar');
    for (const [key, options] of [
      ['nature', ['component','file','module','class','function','method','interface','service','data']],
      ['level', ['H0','H1','H2','H3']], ['flow', ['data','control','error']], ['zone', ['frontend','backend']]
    ]) {
      const select = el('select','workspace-filter'); select.setAttribute('aria-label',`Dim by ${key}`);
      select.append(new Option(`${key}: all`,''));
      for (const option of options) select.append(new Option(option,option));
      select.value = filter[key]; select.addEventListener('change',()=>{filter[key]=select.value;api.render();});
      filterBar.append(select);
    }
    controlBar.append(filterBar,btn(showMinimap?'Minimap ✓':'Minimap',()=>{showMinimap=!showMinimap;api.render();}));
  }
  function preset(mode) {
    const project=api.project();const previous=panesIn(workspace.root).map(p=>p.boardId);
    const available=Object.keys(project.boards);
    const target=i=>previous[i]??available[i]??project.rootBoardId;
    workspace=createWorkspace(project);
    if (mode === 'columns') splitPane(workspace,project,'horizontal',target(1));
    else {
      splitPane(workspace,project,'horizontal',target(1));
      const [left,right]=panesIn(workspace.root);workspace.activeId=left.id;
      splitPane(workspace,project,'vertical',target(2));
      workspace.activeId=right.id;
      splitPane(workspace,project,'vertical',target(3));
    }
    buildLayout();api.render();
  }

  // Navigator: a deterministic tree in the same hierarchy as project.boards.
  const explorer = el('details','repository-explorer');
  explorer.append(el('summary','','Repository explorer'));
  const explorerSearch = el('input','field-input'); explorerSearch.type='search';
  explorerSearch.placeholder='Search boards and symbols'; explorerSearch.setAttribute('aria-label','Search architecture hierarchy');
  const explorerItems = el('div','repository-explorer-items');
  explorer.append(explorerSearch,explorerItems);
  document.querySelector('.library-panel .panel-body').prepend(explorer);
  explorerSearch.addEventListener('input',renderExplorer);
  function renderExplorer() {
    explorerItems.replaceChildren();
    const project=api.project(), query=explorerSearch.value.trim().toLowerCase();
    const boards=Object.values(project.boards).sort((a,b)=>boardPath(project,a.id).length-boardPath(project,b.id).length);
    for(const board of boards) {
      const depth=boardPath(project,board.id).length-1;
      const parent=board.ownerBlockId ? findBlock(project,board.ownerBlockId)?.block : null;
      const text=`${board.name} ${parent?.label??''} ${board.blocks.map(b=>`${b.label} ${b.sourceRef??''} ${b.nature??''}`).join(' ')}`.toLowerCase();
      if(query && !text.includes(query))continue;
      const group=el('div','explorer-group');group.style.paddingLeft=`${Math.min(depth,5)*10}px`;
      group.append(btn(`${depth?'↳ ':'◈ '}${board.name}`,()=>api.openBoard(board.id)));
      for(const block of board.blocks) {
        if(query && !`${block.label} ${block.sourceRef??''} ${block.nature??''} ${block.level}`.toLowerCase().includes(query)) continue;
        const button=btn(`${block.level} · ${block.label}${block.sourceRef?' · '+block.sourceRef:''}`,()=>jump(board.id,{type:'block',id:block.id}));
        button.className='explorer-symbol';button.title=`${block.nature??'component'} · ${block.sourceRef??'No source reference'}`;
        group.append(button);
      }
      explorerItems.append(group);
    }
  }
  const palette=el('dialog','jump-dialog');
  const paletteInput=el('input','field-input'); paletteInput.type='search';
  paletteInput.placeholder='Find class, file, method, board or source path';paletteInput.setAttribute('aria-label','Search all architecture boards');
  const paletteResults=el('div','jump-results');
  palette.append(paletteInput,paletteResults,btn('Close',()=>palette.close()));
  document.body.append(palette);
  function jump(boardId, selection) {
    if (!api.project().boards[boardId]) return;
    const before = currentPane.boardId;
    navigatePane(currentPane, api.project(), boardId, selection);
    api.writeContext(contextFor(currentPane));
    api.render();
    const board = api.project().boards[boardId];
    let point, focus;
    const dom = nodeMap.get(currentPane.id);
    if (selection?.type === 'block') {
      const block = board.blocks.find(b => b.id === selection.id);
      if (block) {
        point = {x:block.position.x + api.blockWidth/2,y:block.position.y + api.blockHeight/2};
        focus = dom.elements.blocks.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
      }
    } else if (selection?.type === 'edge') {
      const edge = board.edges.find(e => e.id === selection.id);
      const source = board.blocks.find(b => b.id === edge?.source.blockId);
      const target = board.blocks.find(b => b.id === edge?.target.blockId);
      if (source && target) {
        point = {x:(source.position.x + target.position.x + api.blockWidth)/2,
          y:(source.position.y + target.position.y + api.blockHeight)/2};
        focus = dom.elements.edges.querySelector(`.edge-hit[data-edge-id="${CSS.escape(edge.id)}"]`);
      }
    }
    if (point) {
      currentPane.viewport.x = dom.canvas.clientWidth/2 - point.x*currentPane.viewport.zoom;
      currentPane.viewport.y = dom.canvas.clientHeight/2 - point.y*currentPane.viewport.zoom;
      api.paintViewport();
      focus?.focus({preventScroll:true});
    }
    if (before !== boardId) api.message(`Opened ${board.name}`);
  }
  function searchNow() {
    paletteResults.replaceChildren();
    for(const match of searchArchitecture(api.project(),paletteInput.value)) {
      const b=btn(`${match.level} · ${match.label}   ${match.sourceRef}`,()=>{palette.close();jump(match.boardId,{type:'block',id:match.blockId});});
      b.className='jump-result'; paletteResults.append(b);
    }
    if(!paletteResults.childElementCount)paletteResults.append(el('p','inspector-copy','No matching source symbols'));
  }
  paletteInput.addEventListener('input',searchNow);
  document.addEventListener('keydown',event=>{
    if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {
      event.preventDefault();palette.showModal();paletteInput.value='';searchNow();paletteInput.focus();
    }
  });
  // Explicit tours reference existing board-local blocks or edges, never implicit cross-board wires.
  const tourBox=el('div','tour-controls');
  document.querySelector('.board-header').after(tourBox);
  function renderTourControls(){
    tourBox.replaceChildren(); const project=api.project(), tours=project.tours??[];
    const picker=el('select','field-input');picker.setAttribute('aria-label','Guided architecture tour');
    picker.append(new Option('Select tour…',''));
    for(const tour of tours)picker.append(new Option(tour.title,tour.id));
    if(!tours.some(t=>t.id===selectedTourId)){selectedTourId=null;tourIndex=-1;simulation?.selectTour(null);api.render();}
    picker.value=selectedTourId??'';
    picker.addEventListener('change',()=>{
      selectedTourId=picker.value||null;tourIndex=-1;simulation?.selectTour(selectedTourId);
      api.render(); // Restore ordinary annotation inspection when switching tours.
    });
    tourBox.append(picker,btn('New tour',()=>{
      const title=prompt('Tour title:','Architecture walkthrough');if(!title?.trim())return;
      let id;api.mutate(()=>{const tour={id:newId(),title:title.slice(0,200),description:'',steps:[]};(project.tours??=[]).push(tour);id=tour.id;});selectedTourId=id;renderTourControls();
    }));
    const tour=tours.find(t=>t.id===selectedTourId);
    if(!tour)return;
    tourBox.append(btn('Add selected',()=>{
      const current=api.readContext();if(!current.selected||!['block','edge'].includes(current.selected.type)){api.message('Select a block or edge before adding a tour step');return;}
      api.mutate(()=>{tour.steps.push({id:newId(),boardId:current.boardId,
        ...(current.selected.type==='edge'?{edgeId:current.selected.id}:{blockId:current.selected.id}),
        title:`Step ${tour.steps.length+1}`,narration:''});});tourIndex=tour.steps.length-1;
    }));
    tourBox.append(btn('Back',()=>moveTour(-1)),btn('Next',()=>moveTour(1)),btn('Exit',()=>{
      tourIndex=-1;simulation?.exit();api.render();
    }));
    const label=el('span','tour-status',tourIndex<0?`0 / ${tour.steps.length}`:`${tourIndex+1} / ${tour.steps.length}`);
    tourBox.append(label);
    if(tourIndex>=0 && tour.steps[tourIndex]){
      const step=tour.steps[tourIndex];
      tourBox.append(el('strong','tour-step-title',step.title),el('span','tour-narration',step.narration));
    }
    const edit=el('details','tour-editor');edit.append(el('summary','','Edit tour / steps'));
    function field(label,value,save,multiline=false){
      const wrap=el('label','field');wrap.append(el('span','field-label',label));
      const input=el(multiline?'textarea':'input','field-input');input.value=value;input.maxLength=multiline?2000:200;
      input.addEventListener('change',()=>api.mutate(()=>save(input.value)));wrap.append(input);edit.append(wrap);
    }
    field('Tour title',tour.title,value=>{tour.title=value||'Untitled tour';});
    field('Tour description',tour.description,value=>{tour.description=value;},true);
    tour.steps.forEach((step,i)=>{
      const info=el('div','tour-step-editor');
      info.append(el('strong','',`${i+1}. ${api.project().boards[step.boardId]?.name??'Missing board'} · ${step.edgeId?'Edge':'Block'}`));
      const name=el('input','field-input');name.value=step.title;name.maxLength=200;
      name.setAttribute('aria-label',`Tour step ${i+1} title`);name.addEventListener('change',()=>api.mutate(()=>{step.title=name.value;}));
      const narration=el('textarea','field-input');narration.value=step.narration;narration.maxLength=2000;
      narration.setAttribute('aria-label',`Tour step ${i+1} narration`);narration.addEventListener('change',()=>api.mutate(()=>{step.narration=narration.value;}));
      info.append(name,narration,btn('Remove step',()=>{api.mutate(()=>{tour.steps.splice(i,1);});tourIndex=Math.min(tourIndex,tour.steps.length-1);}),btn('Go',()=>{tourIndex=i;if(simulation?.isActive())simulation.seek(i);else showStep();}));
      edit.append(info);
    });
    edit.append(btn('Delete tour',()=>{if(!confirm('Delete this tour?'))return;api.mutate(()=>{project.tours=project.tours.filter(t=>t.id!==tour.id);});selectedTourId=null;tourIndex=-1;simulation?.selectTour(null);api.render();}));
    tourBox.append(edit);
    simulation?.controls(tourBox, selectedTourId);
  }
  function moveTour(delta) {
    const tour=(api.project().tours??[]).find(t=>t.id===selectedTourId);
    if(!tour?.steps.length)return;
    const candidate=Math.max(0,Math.min(tour.steps.length-1,tourIndex+delta));
    if(tourIndex===candidate && tourIndex!==-1)return;
    tourIndex=candidate;if(simulation?.isActive())simulation.seek(tourIndex);else showStep();
  }
  function showStep() {
    const step=(api.project().tours??[]).find(t=>t.id===selectedTourId)?.steps[tourIndex];if(!step)return;
    const visible=panesIn(workspace.root).find(p=>p.boardId===step.boardId);
    if (visible) activate(visible);
    else if (panesIn(workspace.root).length < 4) {
      syncFromActive();splitPane(workspace,api.project(),'horizontal',step.boardId);
      buildLayout();
    }
    else if (currentPane.boardId === api.project().rootBoardId) {
      // A full workspace keeps the H0 overview visible during H1 handoffs.
      const other=panesIn(workspace.root).find(p=>p.boardId!==api.project().rootBoardId);
      if (other) activate(other);
    }
    jump(step.boardId,{type:step.edgeId?'edge':'block',id:step.edgeId??step.blockId});
    renderTourControls();
  }
  function extendInspector(){
    const project=api.project();const {boardId,selected}=api.readContext();
    if(!selected || selected.type!=='block')return;
    const owner=project.boards[boardId]?.blocks.find(block=>block.id===selected.id);
    if(!owner)return;
    const area=document.getElementById('inspector-content');
    const group=el('div','p1-bindings');
    group.append(el('h4','inspector-section-title','Repository navigation'));
    const repo=el('input','field-input');repo.type='url';repo.maxLength=500;repo.value=project.repositoryUrl??'';
    repo.placeholder='https://github.com/owner/repo/blob/main/';repo.setAttribute('aria-label','Trusted source repository base URL');
    repo.addEventListener('change',()=>api.mutate(()=>{project.repositoryUrl=repo.value.trim();}));
    group.append(repo);
    if(owner.sourceRef){group.append(btn(`Open source: ${owner.sourceRef}`,()=>{
      try {
        const raw=owner.sourceRef;let target;
        if(/^https:\/\//.test(raw))target=new URL(raw);
        else if(project.repositoryUrl)target=new URL(raw.replace(/^\/+/,''),project.repositoryUrl);
        else throw new Error('Set the trusted HTTPS repository base URL first');
        if(target.protocol!=='https:')throw new Error('Only HTTPS source links are supported');
        window.open(target.href,'_blank','noopener,noreferrer');
      }catch(error){api.message(error.message);}
    }));}
    if(owner.childBoardId){
      const child=project.boards[owner.childBoardId];
      group.append(el('p','inspector-copy',`Parent ${owner.id} → child ${child.id} (ownerBlockId: ${child.ownerBlockId}). Physical wires stay on their own board.`));
      for(const mapping of child.interfaceBindings??[]){
        const block=child.blocks.find(x=>x.id===mapping.internal.blockId);
        group.append(el('p','inspector-copy',`${owner.ports.find(p=>p.id===mapping.ownerPortId)?.name} ↔ ${block?.label}.${block?.ports.find(p=>p.id===mapping.internal.portId)?.name}`));
        if(block)group.append(btn('Go to internal port block',()=>jump(child.id,{type:'block',id:block.id})));
        group.append(btn('Remove binding',()=>api.mutate(()=>{child.interfaceBindings=child.interfaceBindings.filter(x=>x!==mapping);})));}
      const ownerSelect=el('select','field-input');const internalSelect=el('select','field-input');
      ownerSelect.setAttribute('aria-label','Parent interface port');internalSelect.setAttribute('aria-label','Internal child port');
      for(const port of owner.ports)ownerSelect.append(new Option(`${port.name} (${port.direction})`,port.id));
      const refill=()=>{
        internalSelect.replaceChildren(); const direction=owner.ports.find(p=>p.id===ownerSelect.value)?.direction;
        for(const block of child.blocks)for(const port of block.ports)if(port.direction===direction)
          internalSelect.append(new Option(`${block.label} · ${port.name}`,`${block.id}\0${port.id}`));
      };
      ownerSelect.addEventListener('change',refill);refill();
      group.append(ownerSelect,internalSelect,btn('Bind parent ↔ child',()=>{
        if(!internalSelect.value)return api.message('Choose an internal port');
        const [blockId,portId]=internalSelect.value.split('\0');
        api.mutate(()=>{(child.interfaceBindings??=[]).push({ownerPortId:ownerSelect.value,internal:{blockId,portId}});});
      }));
    }
    area.append(group);
  }
  simulation = installSimulation({
    project: api.project, message: api.message,
    panes: () => panesIn(workspace.root), paneDom: id => nodeMap.get(id),
    activePaneId: () => workspace.activeId, context: api.readContext, initialStepIndex: () => tourIndex,
    showStep: index => {tourIndex=index;showStep();}
  });
  function afterMutation(){renderTourControls();}
  const resize=()=>{
    const narrow=window.matchMedia('(max-width: 920px)').matches;
    function visit(node) {
      if (node.type === 'pane') {
        nodeMap.get(node.id).root.hidden = narrow && node.id !== workspace.activeId;
        return node.id === workspace.activeId;
      }
      const active = node.children.map(visit).some(Boolean);
      node.dom.hidden = narrow && !active;
      return active;
    }
    visit(workspace.root);
  };
  window.addEventListener('resize',resize);
  buildLayout();renderExplorer();renderTourControls();
  return {
    boardView(canonical) {
      if(!canonical || !currentPane)return canonical;
      return new Proxy(canonical, {
        get(target,key) {return key==='viewport'?currentPane.viewport:Reflect.get(target,key);},
        set(target,key,value) {if(key==='viewport'){currentPane.viewport=value;return true;}return Reflect.set(target,key,value);}
      });
    }, afterRender() {afterRender();afterMutation();resize();}, extendInspector, onNavigate, onSelect,
    onReset() {
      workspace=createWorkspace(api.project());currentPane=findPane(workspace,workspace.activeId);
      nodeMap.clear();
      buildLayout();api.writeContext(contextFor(currentPane));
      selectedTourId=null;tourIndex=-1;simulation?.reset();
    }
  };
}
