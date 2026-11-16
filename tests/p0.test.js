import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, createEmptyProject, addBlock, addPort, removePort,
  connectBlocks, addAnnotation, migrateProject, validateProject, MAX_PORTS } from '../src/model.js';

test('multiple four-sided ports and independently addressed edges survive export', () => {
  const project = createEmptyProject();
  const id = project.rootBoardId;
  const first = addBlock(project, id, 'data-ingestion', { x:0, y:0 });
  const second = addBlock(project, id, 'data-processing', { x:350, y:0 });
  const output = addPort(project, id, first.id, 'top', 'output');
  const input = addPort(project, id, second.id, 'bottom');
  const firstEdge = connectBlocks(project, id, first.id, second.id);
  const secondEdge = connectBlocks(project, id, first.id, second.id, 'data', output.id, input.id);
  assert.notEqual(firstEdge.id, secondEdge.id);
  assert.throws(() => connectBlocks(project, id, first.id, second.id, 'data', output.id, input.id), /already exists/);
  assert.equal(validateProject(JSON.parse(JSON.stringify(project))), null);
  assert.equal(project.boards[id].edges.length, 2);
  assert.equal(input.side, 'bottom');
});

test('port removal clears only affected edges; empty interfaces and max port count are valid', () => {
  const p = createEmptyProject(), id=p.rootBoardId;
  const a=addBlock(p,id,'data-ingestion',{x:0,y:0});
  const b=addBlock(p,id,'data-processing',{x:300,y:0});
  const extra=addPort(p,id,a.id,'right','output');
  const to=addPort(p,id,b.id,'top');
  connectBlocks(p,id,a.id,b.id);
  connectBlocks(p,id,a.id,b.id,'data',extra.id,to.id);
  assert.equal(removePort(p,id,a.id,extra.id),1);
  assert.equal(p.boards[id].edges.length,1);
  assert.equal(validateProject(p),null);
  removePort(p,id,a.id,a.ports[0].id);
  removePort(p,id,a.id,a.ports[0].id);
  assert.equal(a.ports.length,0);
  assert.equal(validateProject(p),null);
  for(let i=0;i<MAX_PORTS;i++) addPort(p,id,a.id,'left');
  assert.throws(()=>addPort(p,id,a.id,'left'), /at most/);
});

test('schema v1 migration retains IDs, hierarchy, endpoints, zones and a recoverable original', () => {
  const current=createDemoProject(), legacy=structuredClone(current);
  legacy.schemaVersion=1;
  for(const board of Object.values(legacy.boards)) {
    for(const block of board.blocks) for(const port of block.ports) {
      delete port.side;delete port.offset;delete port.dataType;
    }
    for(const edge of board.edges) delete edge.annotations;
  }
  const backup=JSON.stringify(legacy);
  assert.equal(validateProject(legacy),null);
  const converted=migrateProject(legacy);
  assert.equal(converted.schemaVersion,2);
  assert.equal(validateProject(converted),null);
  assert.equal(JSON.stringify(legacy),backup);
  assert.deepEqual(Object.keys(converted.boards),Object.keys(legacy.boards));
  for (const board of Object.values(converted.boards)) for(const edge of board.edges) {
    assert.equal(edge.annotations.length,0);
    assert.ok(board.blocks.some(b=>b.ports.some(port=>port.id===edge.source.portId)));
  }
});

test('annotations are stable typed user text and malformed v2 inputs are rejected', () => {
  const base=createDemoProject();const id=base.rootBoardId;
  const edge=base.boards[id].edges[0];
  const note=addAnnotation(base,id,edge.id,.35);
  note.caption='summation of a & b';note.dataType='int';note.format='integer';
  note.description='User-authored <script> is plain text';
  assert.equal(validateProject(JSON.parse(JSON.stringify(base))),null);
  const invalidCases = [
    p => {p.boards[id].edges[0].annotations[0].at=1;},
    p => {p.boards[id].edges[0].annotations[0].description='x'.repeat(2001);},
    p => {p.boards[id].edges[0].annotations.push(structuredClone(p.boards[id].edges[0].annotations[0]));},
    p => {p.boards[id].blocks[0].ports[0].side='diagonal';},
    p => {p.boards[id].blocks[0].ports[0].offset=1.1;},
    p => {p.boards[id].blocks[0].ports[1].id=p.boards[id].blocks[0].ports[0].id;},
    p => {p.boards[id].edges[0].target.portId='missing';},
    p => {p.boards[id].edges[0].annotations[0].format='x'.repeat(201);},
    p => {p.boards[id].blocks[0].ports.push(...Array.from({length:31},(_,i)=>({...p.boards[id].blocks[0].ports[0],id:`other-${i}`})));}
  ];
  for(const edit of invalidCases){const project=structuredClone(base);edit(project);assert.notEqual(validateProject(project),null);}
});
