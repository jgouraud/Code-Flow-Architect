/** P2 is an educational visualization of authored tour edges, never a code runner. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2];
const EDGE_DURATION_MS = 2400;
const BLOCK_DURATION_MS = 900;
const EPSILON = 1e-8;
const SVG_NS = 'http://www.w3.org/2000/svg';

function clamp(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

/** Runtime-only state: nothing here belongs in the project JSON. */
export function createPlayback(tour, speed = 1) {
  return {
    tourId: tour.id, stepKeys: tour.steps.map(step => `${step.id}\0${step.boardId}\0${step.edgeId ? 'edge:' : 'block:'}${step.edgeId ?? step.blockId}`),
    stepIndex: tour.steps.length ? 0 : -1, progress: 0, speed: PLAYBACK_SPEEDS.includes(speed) ? speed : 1,
    status: tour.steps.length ? 'paused' : 'completed', reached: tour.steps.map(() => 0)
  };
}

export function playbackMatches(state, tour) {
  return !!state && !!tour && state.tourId === tour.id &&
    state.stepKeys.length === tour.steps.length &&
    tour.steps.every((step, i) => state.stepKeys[i] === `${step.id}\0${step.boardId}\0${step.edgeId ? 'edge:' : 'block:'}${step.edgeId ?? step.blockId}`);
}

/** Seeking backwards retracts all future reveals; seeking forward does not mark skipped steps reached. */
export function seekPlayback(state, tour, index, progress = 0) {
  if (!playbackMatches(state, tour) || !tour.steps.length) return state;
  const nextIndex = Math.max(0, Math.min(tour.steps.length - 1, Math.round(index)));
  const reached = state.reached.map((value, i) => i > nextIndex ? 0 : value);
  reached[nextIndex] = clamp(progress);
  return { ...state, stepIndex: nextIndex, progress: reached[nextIndex], reached, status: 'paused' };
}

export function setPlaybackProgress(state, tour, position) {
  return seekPlayback(state, tour, state.stepIndex, position);
}

/** Frame advancement is deterministic and independent of the browser/render cadence. */
export function advancePlayback(state, tour, elapsedMs) {
  if (!playbackMatches(state, tour) || state.status !== 'playing' || state.stepIndex < 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return state;
  const reached = [...state.reached];
  let index = state.stepIndex, progress = state.progress;
  let remaining = Math.min(elapsedMs, 60000) * state.speed;
  while (remaining > 0 && index < tour.steps.length) {
    const duration = tour.steps[index].edgeId ? EDGE_DURATION_MS : BLOCK_DURATION_MS;
    const left = (1 - progress) * duration;
    if (remaining + EPSILON < left) {
      progress += remaining / duration;
      remaining = 0;
    } else {
      progress = 1;
      remaining -= left;
    }
    reached[index] = clamp(progress);
    if (progress >= 1 - EPSILON) {
      if (index === tour.steps.length - 1) return { ...state, stepIndex: index, progress: 1, reached, status: 'completed' };
      index += 1;
      progress = 0;
    }
  }
  return { ...state, stepIndex: index, progress: clamp(progress), reached };
}

/** A keyboard Step lands exactly on the next annotation, or the end of an edge/block. */
export function stepPlayback(state, tour, project) {
  if (!playbackMatches(state, tour) || state.stepIndex < 0) return state;
  const step = tour.steps[state.stepIndex];
  const edge = step.edgeId ? project.boards[step.boardId]?.edges.find(item => item.id === step.edgeId) : null;
  const next = (edge?.annotations ?? []).map(note => note.at)
    .filter(at => at > state.progress + EPSILON).sort((a, b) => a - b)[0];
  if (next !== undefined) return seekPlayback(state, tour, state.stepIndex, next);
  if (state.progress < 1 - EPSILON) return seekPlayback(state, tour, state.stepIndex, 1);
  if (state.stepIndex < tour.steps.length - 1) return seekPlayback(state, tour, state.stepIndex + 1, 0);
  return { ...state, status: 'completed' };
}

/** Exactly the author's notes whose normalized path coordinates have been reached. */
export function revealedAnnotations(project, tour, state) {
  if (!playbackMatches(state, tour)) return [];
  const revealed = [];
  tour.steps.forEach((step, i) => {
    if (!step.edgeId || !state.reached[i]) return;
    const edge = project.boards[step.boardId]?.edges.find(item => item.id === step.edgeId);
    for (const note of edge?.annotations ?? []) {
      if (note.at <= state.reached[i] + EPSILON) {
        revealed.push({ key: `${step.id}\0${note.id}`, boardId: step.boardId, edgeId: edge.id, note });
      }
    }
  });
  return revealed;
}

export function pointOnCurve(path, fraction) {
  // P0 stores M x y C c1x c1y c2x c2y x y; use its exact cubic parameter
  // so a pulse crossing `at` coincides with the annotation marker.
  const numbers = path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)?.map(Number);
  if (!numbers || numbers.length !== 8 || numbers.some(value => !Number.isFinite(value))) return null;
  const t = clamp(fraction), u = 1 - t;
  return { x: u ** 3 * numbers[0] + 3 * u ** 2 * t * numbers[2] + 3 * u * t ** 2 * numbers[4] + t ** 3 * numbers[6],
    y: u ** 3 * numbers[1] + 3 * u ** 2 * t * numbers[3] + 3 * u * t ** 2 * numbers[5] + t ** 3 * numbers[7] };
}

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  node.className = className; node.textContent = content; return node;
}
function svg(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function annotationText(note) {
  return [note.caption + (note.dataType ? ` [${note.dataType}]` : ''), note.format,
    note.description, note.schemaRef].filter(Boolean).join('. ');
}

/** Bind playback to P1's already-owned panes, board navigation and tour selector. */
export function installSimulation(api) {
  let playback = null, selectedId = null, frameId = null, timerId = null, lastFrame = 0;
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const graphics = new Map();
  let statusText = null, positionInput = null, announcements = null, playButton = null, pauseButton = null;
  let speedChoice = 1;
  const tour = () => (api.project().tours ?? []).find(item => item.id === selectedId);
  const active = () => playbackMatches(playback, tour());

  function clearSchedule() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    if (timerId !== null) clearTimeout(timerId);
    frameId = null; timerId = null;
  }
  function reset() {
    clearSchedule(); playback = null; selectedId = null; graphics.clear();
    statusText = null; positionInput = null; announcements = null;
  }
  function selectTour(id) {
    clearSchedule(); selectedId = id || null; playback = null;
    graphics.clear();
  }
  function exit() {
    clearSchedule(); playback = null; graphics.clear();
  }
  function currentStep() { return active() ? tour().steps[playback.stepIndex] : null; }
  function currentEdge() {
    const step = currentStep();
    return step?.edgeId ? api.project().boards[step.boardId]?.edges.find(edge => edge.id === step.edgeId) : null;
  }
  function ensurePlayback() {
    const selected = tour();
    if (!selected?.steps.length) { api.message('Choose a tour with at least one step to simulate.'); return false; }
    if (!active()) {
      playback = createPlayback(selected, speedChoice);
      const index = api.initialStepIndex?.() ?? -1;
      if (index > 0) playback = seekPlayback(playback, selected, index);
    }
    return true;
  }
  function announceReached(before) {
    if (!announcements || !active()) return;
    const previous = new Set(before.map(item => item.key));
    const arrived = revealedAnnotations(api.project(), tour(), playback).filter(item => !previous.has(item.key));
    // Only authors' already-reached text is ever placed in the live region.
    if (arrived.length) announcements.textContent = arrived.map(item => annotationText(item.note)).join(' — ');
  }
  function update(next, jump = false) {
    if (!active()) return;
    const before = revealedAnnotations(api.project(), tour(), playback);
    const priorStep = playback.stepIndex;
    playback = next;
    if (jump || priorStep !== playback.stepIndex) {
      api.showStep(playback.stepIndex);
      // showStep re-renders the pane tree and calls renderCanvas synchronously.
    } else if (before.length !== revealedAnnotations(api.project(), tour(), playback).length) {
      renderCanvas();
    } else paintParticles();
    paintControls();
    announceReached(before);
  }
  function play() {
    const newSession = !active() || playback?.status === 'completed';
    if (!ensurePlayback()) return;
    if (playback.status === 'completed') playback = createPlayback(tour(), playback.speed);
    if (reducedMotion) {
      if (newSession) api.showStep(playback.stepIndex);
      playback = { ...playback, status: 'playing' };
      clearSchedule(); scheduleDiscrete();
    } else {
      playback = { ...playback, status: 'playing' };
      if (newSession) api.showStep(playback.stepIndex);
      lastFrame = performance.now(); clearSchedule(); frameId = requestAnimationFrame(tick);
    }
    renderCanvas(); paintControls();
  }
  function pause() {
    if (!active() || playback.status !== 'playing') return;
    playback = { ...playback, status: 'paused' };
    clearSchedule(); paintControls();
  }
  function restart() {
    if (!ensurePlayback()) return;
    clearSchedule();
    playback = createPlayback(tour(), playback.speed);
    api.showStep(0); renderCanvas(); paintControls();
    if (announcements) announcements.textContent = '';
  }
  function step() {
    const newSession = !active();
    if (!ensurePlayback()) return;
    clearSchedule();
    update(stepPlayback(playback, tour(), api.project()), newSession || playback.status === 'completed');
  }
  function seek(index) {
    if (!ensurePlayback()) return;
    clearSchedule();
    update(seekPlayback(playback, tour(), index), true);
    if (announcements) announcements.textContent = '';
  }
  function setPosition(percent) {
    const newSession = !active();
    if (!ensurePlayback()) return;
    clearSchedule(); update(setPlaybackProgress(playback, tour(), Number(percent) / 100), newSession);
  }
  function tick(time) {
    frameId = null;
    if (!active() || playback.status !== 'playing') return;
    const elapsed = Math.min(100, Math.max(0, time - lastFrame));
    lastFrame = time;
    update(advancePlayback(playback, tour(), elapsed));
    if (playback.status === 'playing') frameId = requestAnimationFrame(tick);
  }
  function scheduleDiscrete() {
    if (!active() || playback.status !== 'playing') return;
    // No moving dots for reduced motion; progress jumps one authored milestone at a time.
    timerId = setTimeout(() => {
      timerId = null;
      if (!active() || playback.status !== 'playing') return;
      const before = revealedAnnotations(api.project(), tour(), playback);
      const previous = playback.stepIndex;
      const next = stepPlayback(playback, tour(), api.project());
      playback = { ...next, status: next.status === 'completed' ? 'completed' : 'playing' };
      if (previous !== playback.stepIndex) api.showStep(playback.stepIndex);
      else renderCanvas();
      paintControls(); announceReached(before);
      scheduleDiscrete();
    }, 1200 / playback.speed);
  }

  function paintControls() {
    if (!statusText || !active()) return;
    const step = currentStep(), board = api.project().boards[step.boardId];
    statusText.textContent = `${board?.name ?? 'Unknown board'} · ${playback.stepIndex + 1}/${tour().steps.length} · ${step.title} · ${Math.round(playback.progress * 100)}% · ${playback.status}`;
    if (positionInput) { positionInput.disabled = false; positionInput.value = String(Math.round(playback.progress * 100)); }
    if (playButton) { playButton.disabled = playback.status === 'playing'; playButton.textContent = playback.status === 'paused' && playback.progress > 0 ? 'Resume' : 'Play'; }
    if (pauseButton) pauseButton.disabled = playback.status !== 'playing';
  }
  function controls(parent, tourId) {
    if (selectedId !== tourId) selectTour(tourId);
    if (!tourId) return;
    const bar = element('div', 'simulation-controls');
    bar.setAttribute('aria-label', 'Educational data-flow simulation');
    const button = (label, action) => {
      const node = element('button', 'btn small ghost', label);
      node.type = 'button'; node.addEventListener('click', action); bar.append(node); return node;
    };
    playButton = button(playback?.status === 'paused' ? 'Resume' : 'Play', play);
    pauseButton = button('Pause', pause);
    button('Step', step); button('Restart', restart);
    const speed = element('select', 'field-input simulation-speed');
    speed.setAttribute('aria-label', 'Simulation speed');
    for (const value of PLAYBACK_SPEEDS) {
      const option = new Option(`${value}×`, String(value)); speed.append(option);
    }
    speed.value = String(playback?.speed ?? speedChoice);
    speed.addEventListener('change', () => {
      speedChoice = Number(speed.value);
      if (active()) playback = { ...playback, speed: speedChoice };
      if (timerId !== null) { clearTimeout(timerId); timerId = null; scheduleDiscrete(); }
    });
    bar.append(speed);
    positionInput = element('input', 'simulation-position');positionInput.type = 'range';
    positionInput.min = '0';positionInput.max = '100';positionInput.step = '1';
    positionInput.setAttribute('aria-label', 'Seek within the current tour step');
    positionInput.addEventListener('input', () => setPosition(positionInput.value));
    bar.append(positionInput);
    statusText = element('output', 'simulation-status'); statusText.setAttribute('aria-live', 'off');
    announcements = element('div', 'simulation-announcement'); announcements.setAttribute('role', 'status');
    announcements.setAttribute('aria-live', 'polite'); announcements.setAttribute('aria-atomic', 'true');
    bar.append(statusText, announcements);
    parent.append(bar);
    if (!active()) {
      statusText.textContent = 'Simulation ready · no live data is executed';
      pauseButton.disabled = true;
      positionInput.disabled = true;
    } else paintControls();
  }

  function scrubPane(pane, reached) {
    const dom = api.paneDom(pane.id); if (!dom) return;
    const board = api.project().boards[pane.boardId]; if (!board) return;
    const { edges: layer, scene } = dom.elements;
    const reachedIds = new Set(reached.filter(item => item.boardId === pane.boardId).map(item => `${item.edgeId}\0${item.note.id}`));
    const participating = new Set((tour()?.steps ?? []).filter(step => step.boardId === pane.boardId && step.edgeId).map(step => step.edgeId));
    let popups = scene.querySelector('.simulation-popups');
    if (!popups) {
      popups = element('div', 'simulation-popups'); scene.append(popups);
    }
    popups.replaceChildren();
    // The P0 renderer provides a circle and an optional type badge per annotation, in array order.
    // All future text and accessible names are removed before a browser paint can occur.
    for (const edge of board.edges) {
      if (!participating.has(edge.id)) continue;
      const dots = [...layer.querySelectorAll('.edge-note')].filter(dot => dot.dataset.edgeId === edge.id);
      const badges = [...layer.querySelectorAll('.edge-type')].filter(badge => badge.dataset.edgeId === edge.id);
      let badgeIndex = 0;
      edge.annotations.forEach((note, i) => {
        const dot = dots[i]; if (!dot) return;
        const revealed = reachedIds.has(`${edge.id}\0${note.id}`);
        dot.style.display = revealed ? '' : 'none';
        dot.setAttribute('aria-hidden', String(!revealed));
        dot.setAttribute('tabindex', revealed ? '0' : '-1');
        if (revealed) dot.setAttribute('aria-label', 'Reached flow annotation');
        else dot.removeAttribute('aria-label');
        if (note.dataType) {
          const badge = badges[badgeIndex++];
          if (badge) {
            badge.style.display = revealed ? '' : 'none';
            badge.textContent = revealed ? note.dataType.slice(0, 20) : '';
          }
        }
        if (!revealed) return;
        const popup = element('div', 'simulation-popup');
        popup.tabIndex = 0; popup.setAttribute('role', 'note');
        popup.style.left = `${Number(dot.getAttribute('cx'))}px`;
        popup.style.top = `${Number(dot.getAttribute('cy'))}px`;
        popup.append(element('strong', '', note.caption + (note.dataType ? ` [${note.dataType}]` : '')));
        if (note.format) popup.append(element('small', '', `Format: ${note.format}`));
        if (note.description) popup.append(element('p', '', note.description));
        if (note.schemaRef) popup.append(element('small', '', `Schema: ${note.schemaRef}`));
        popups.append(popup);
      });
    }
    // The normal edge inspector exposes all notes, so replace it while simulating.
    const context = api.context();
    if (context.boardId === pane.boardId && context.selected?.type === 'edge' && participating.has(context.selected.id) && pane.id === api.activePaneId()) {
      const inspector = document.getElementById('inspector-content');
      if (inspector) inspector.replaceChildren(element('p', 'inspector-copy', 'Playback is read-only. Annotation details appear only when the pulse reaches them. Exit the tour to edit.'));
    }
  }
  function paintParticles() {
    if (!active()) return;
    const step = currentStep(), edge = currentEdge();
    for (const pane of api.panes()) {
      const dom = api.paneDom(pane.id); if (!dom) continue;
      let existing = graphics.get(pane.id);
      if (pane.boardId !== step.boardId || !edge) {
        existing?.group.remove(); graphics.delete(pane.id); continue;
      }
      if (!existing?.group.isConnected || existing?.edgeId !== edge.id) {
        const path = [...dom.elements.edges.querySelectorAll('.visible-edge')].find(item => item.dataset.edgeId === edge.id);
        if (!path) { existing?.group.remove(); graphics.delete(pane.id); continue; }
        const d = path.getAttribute('d');
        existing?.group.remove();
        const group = svg('g', { class:'simulation-graphics', 'aria-hidden':'true' });
        const trace = svg('path', { class:'simulation-progress', d, fill:'none', 'stroke-width':5, 'stroke-linecap':'round' });
        const length = path.getTotalLength();
        // P0's annotation coordinate is a Bezier parameter, not arc length.
        // Map the trace to the same parameter so its tip meets the leading particle.
        const arc = [0];
        let previous = pointOnCurve(d, 0);
        for (let sample = 1; sample <= 40; sample++) {
          const next = pointOnCurve(d, sample / 40);
          arc.push(arc[sample - 1] + (previous && next ? Math.hypot(next.x - previous.x, next.y - previous.y) : 0));
          previous = next;
        }
        const total = arc[40] || 1;
        trace.setAttribute('stroke-dasharray', `${length} ${length}`);
        group.append(trace);
        const dots = [];
        if (!reducedMotion) for (let i = 0; i < 3; i++) {
          const circle = svg('circle', { r:i ? 3 : 5, class:'simulation-particle' });
          dots.push(circle);group.append(circle);
        }
        dom.elements.edges.append(group);
        graphics.set(pane.id, { d, edgeId:edge.id, group, trace, length, dots, arc: arc.map(value => value / total) });
      }
      const graphic = graphics.get(pane.id);
      const sample = playback.progress * 40, low = Math.floor(sample), high = Math.min(40, low + 1);
      const fraction = graphic.arc[low] + (graphic.arc[high] - graphic.arc[low]) * (sample - low);
      graphic.trace.setAttribute('stroke-dashoffset', String(graphic.length * (1 - fraction)));
      graphic.dots.forEach((dot, i) => {
        const fraction = playback.progress - i * .04;
        dot.style.display = fraction < 0 ? 'none' : '';
        if (fraction < 0) return;
        const point = pointOnCurve(graphic.d, fraction);
        if (point) {dot.setAttribute('cx', String(point.x));dot.setAttribute('cy', String(point.y));}
      });
    }
  }
  function renderCanvas() {
    if (!active()) {
      for (const pane of api.panes()) {
        const dom = api.paneDom(pane.id);
        dom?.elements.scene.querySelector('.simulation-popups')?.remove();
        dom?.elements.edges.querySelector('.simulation-graphics')?.remove();
      }
      graphics.clear(); return;
    }
    const revealed = revealedAnnotations(api.project(), tour(), playback);
    for (const pane of api.panes()) scrubPane(pane, revealed);
    for (const pane of api.panes()) api.paneDom(pane.id)?.elements.edges.querySelector('.simulation-graphics')?.remove();
    graphics.clear();paintParticles();paintControls();
  }
  function onProjectRender() {
    const selected = tour();
    const targetsExist = selected?.steps.every(step => {
      const board = api.project().boards[step.boardId];
      return board && (step.edgeId ? board.edges.some(edge => edge.id === step.edgeId) :
        board.blocks.some(block => block.id === step.blockId));
    });
    if (playback && (!active() || !targetsExist)) {
      clearSchedule(); playback = null;
      api.message('Tour changed; playback was reset to prevent stale annotations.');
    }
    renderCanvas();
  }
  function onMotionChange(event) {
    reducedMotion = event.matches;
    if (playback?.status === 'playing') pause();
    for (const pane of api.panes()) api.paneDom(pane.id)?.elements.edges.querySelector('.simulation-graphics')?.remove();
    graphics.clear();renderCanvas();
  }
  preference.addEventListener?.('change', onMotionChange);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  return { controls, selectTour, onProjectRender, reset, exit, seek, isActive:active, currentStep };
}
