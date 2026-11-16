import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, validateProject } from '../src/model.js';
import {
  createPlayback, playbackMatches, advancePlayback, seekPlayback, stepPlayback,
  setPlaybackProgress, revealedAnnotations, pointOnCurve
} from '../src/simulation.js';

function example() {
  const project = createDemoProject();
  const [root, child] = Object.values(project.boards);
  const mainEdge = project.boards[project.rootBoardId].edges[0];
  mainEdge.annotations = [
    { id:'early', at:.35, caption:'a + b', dataType:'int', format:'integer', description:'User-entered: addition result', schemaRef:'' },
    { id:'later', at:.70, caption:'summation of a & b <script>', dataType:'int', format:'integer', description:'Authored, not executed', schemaRef:'types.ts#Sum' }
  ];
  const childEdge = child.edges[0];
  childEdge.annotations = [
    { id:'child-note', at:.2, caption:'Child handoff', dataType:'JSON', format:'json', description:'From author', schemaRef:'' }
  ];
  const tour = { id:'guided-tour', title:'Walk through H0 and H1', description:'', steps:[
    { id:'s0', boardId:project.rootBoardId, edgeId:mainEdge.id, title:'H0 flow', narration:'' },
    { id:'s1', boardId:child.id, edgeId:childEdge.id, title:'H1 flow', narration:'' },
    { id:'s2', boardId:project.rootBoardId, blockId:root.blocks[1].id, title:'Finish', narration:'' }
  ] };
  project.tours = [tour];
  assert.equal(validateProject(project), null);
  return { project, tour, mainEdge, childEdge };
}

function keys(project, tour, state) {
  return revealedAnnotations(project, tour, state).map(x => x.note.id);
}

test('early pulse never exposes future annotation text or metadata', () => {
  const { project, tour } = example();
  const state = createPlayback(tour);
  assert.deepEqual(keys(project, tour, state), []);
  const at35 = setPlaybackProgress(state, tour, .35);
  assert.deepEqual(keys(project, tour, at35), ['early']);
  assert.deepEqual(keys(project, tour, setPlaybackProgress(state, tour, .69)), ['early']);
  const at70 = setPlaybackProgress(state, tour, .70);
  const revealed = revealedAnnotations(project, tour, at70);
  assert.deepEqual(revealed.map(x => x.note.id), ['early', 'later']);
  assert.equal(revealed[1].note.caption, 'summation of a & b <script>');
  assert.equal(revealed[1].note.description, 'Authored, not executed');
});

test('pause retains reached notes, backward seek retracts future notes, restart clears all', () => {
  const { project, tour } = example();
  const start = createPlayback(tour);
  const running = { ...start, status:'playing' };
  const progress = advancePlayback(running, tour, 1680);
  assert.equal(progress.progress, .7);
  assert.deepEqual(keys(project, tour, progress), ['early', 'later']);
  const paused = { ...progress, status:'paused' };
  assert.equal(advancePlayback(paused, tour, 2500), paused);
  assert.deepEqual(keys(project, tour, paused), ['early', 'later']);
  assert.deepEqual(keys(project, tour, setPlaybackProgress(paused, tour, .35)), ['early']);
  const skippedAhead = seekPlayback(progress, tour, 2);
  assert.deepEqual(keys(project, tour, skippedAhead), ['early', 'later']);
  const rewound = seekPlayback(skippedAhead, tour, 0);
  assert.deepEqual(keys(project, tour, rewound), []);
  assert.deepEqual(keys(project, tour, createPlayback(tour)), []);
});

test('manual Step stops at authored positions in order before continuing across boards', () => {
  const { project, tour } = example();
  let state = createPlayback(tour);
  state = stepPlayback(state, tour, project);
  assert.equal(state.progress, .35);
  assert.deepEqual(keys(project, tour, state), ['early']);
  state = stepPlayback(state, tour, project);
  assert.equal(state.progress, .70);
  assert.deepEqual(keys(project, tour, state), ['early', 'later']);
  state = stepPlayback(state, tour, project);
  assert.equal(state.progress, 1);
  state = stepPlayback(state, tour, project);
  assert.equal(state.stepIndex, 1);
  assert.equal(state.progress, 0);
  assert.deepEqual(keys(project, tour, state), ['early', 'later']);
  state = stepPlayback(state, tour, project);
  assert.equal(state.progress, .2);
  assert.deepEqual(keys(project, tour, state), ['early', 'later', 'child-note']);
  assert.equal(revealedAnnotations(project, tour, state)[2].boardId, tour.steps[1].boardId);
});

test('speed changes timing but not event order, and empty/block tour steps are safe', () => {
  const { project, tour } = example();
  const slow = { ...createPlayback(tour, .5), status:'playing' };
  const fast = { ...createPlayback(tour, 2), status:'playing' };
  const atSlow = advancePlayback(slow, tour, 1680);
  const atFast = advancePlayback(fast, tour, 420);
  assert.equal(atSlow.progress, .35);
  assert.equal(atFast.progress, .35);
  assert.deepEqual(keys(project, tour, atSlow), keys(project, tour, atFast));
  const finished = advancePlayback(fast, tour, 60000);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.stepIndex, 2);
  assert.deepEqual(keys(project, tour, finished), ['early', 'later', 'child-note']);
  const empty = { ...tour, id:'empty', steps:[] };
  assert.equal(createPlayback(empty).status, 'completed');
  assert.deepEqual(revealedAnnotations(project, empty, createPlayback(empty)), []);
});

test('state invalidates edited/reordered tour steps without modifying serialized project', () => {
  const { project, tour } = example();
  const serialized = JSON.stringify(project);
  const state = createPlayback(tour);
  const moved = { ...tour, steps:[tour.steps[1], tour.steps[0], tour.steps[2]] };
  assert.equal(playbackMatches(state, moved), false);
  const retargeted = { ...tour, steps:[{ ...tour.steps[0], edgeId:undefined, blockId:tour.steps[0].edgeId }, ...tour.steps.slice(1)] };
  assert.equal(playbackMatches(state, retargeted), false);
  const running = { ...state, status:'playing' };
  assert.equal(advancePlayback(running, moved, 100), running);
  assert.equal(JSON.stringify(project), serialized);
  assert.equal(validateProject(JSON.parse(serialized)), null);
  assert.doesNotMatch(serialized, /"(?:progress|reached|status|speed|stepKeys)":/);
});

test('pulse geometry follows P0 cubic parameter at each annotation coordinate', () => {
  const d = 'M 15 20 C 100 15, -30 150, 30 75';
  assert.deepEqual(pointOnCurve(d, 0), { x:15, y:20 });
  assert.deepEqual(pointOnCurve(d, 1), { x:30, y:75 });
  const at35 = pointOnCurve(d, .35), at70 = pointOnCurve(d, .70);
  assert.notDeepEqual(at35, at70);
  assert.equal(pointOnCurve('M 0 0 L 1 1', .5), null);
  assert.deepEqual(pointOnCurve(d, Infinity), pointOnCurve(d, 0));
});
