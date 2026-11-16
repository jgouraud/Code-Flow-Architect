import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProject, addBlock, createDecomposition, connectBlocks, deleteBlock, validateProject, boardPath, createDemoProject } from '../src/model.js';

test('demo architecture contains three nested levels and valid connections', () => {
  const project = createDemoProject();
  assert.equal(validateProject(project), null);
  assert.equal(project.boards[project.rootBoardId].blocks.length,3);
  assert.equal(project.boards[project.rootBoardId].edges.length,2);
  const first = project.boards[project.rootBoardId].blocks[0];
  const child = project.boards[first.childBoardId];
  assert.equal(child.blocks.length,3);
  assert.equal(boardPath(project, child.blocks[2].childBoardId).length,3);
});

test('decomposition is idempotent and removing a block removes only its descendants', () => {
  const project = createEmptyProject();
  const first = addBlock(project,project.rootBoardId,'data-ingestion',{x:0,y:0});
  const second = addBlock(project,project.rootBoardId,'data-processing',{x:300,y:0});
  const childId = createDecomposition(project,project.rootBoardId,first.id);
  assert.equal(createDecomposition(project,project.rootBoardId,first.id),childId);
  const grandchild = addBlock(project,childId,'clean-data',{x:0,y:0});
  const grandchildBoardId = createDecomposition(project,childId,grandchild.id);
  connectBlocks(project,project.rootBoardId,first.id,second.id);
  assert.equal(deleteBlock(project,project.rootBoardId,first.id),true);
  assert.equal(project.boards[childId],undefined);
  assert.equal(project.boards[grandchildBoardId],undefined);
  assert.equal(project.boards[project.rootBoardId].blocks.length,1);
  assert.equal(project.boards[project.rootBoardId].edges.length,0);
  assert.equal(validateProject(project),null);
});

test('connections reject self loops, cross-board references and duplicates', () => {
  const project = createEmptyProject(); const id=project.rootBoardId;
  const first=addBlock(project,id,'data-ingestion',{x:0,y:0});
  const second=addBlock(project,id,'data-processing',{x:300,y:0});
  connectBlocks(project,id,first.id,second.id);
  assert.throws(()=>connectBlocks(project,id,first.id,second.id),/already exists/);
  assert.throws(()=>connectBlocks(project,id,first.id,first.id),/different blocks/);
  assert.throws(()=>connectBlocks(project,id,'missing',second.id),/different blocks/);
});

test('import validator rejects invalid schema, missing ports, detached boards and dangling edges', () => {
  const base=createDemoProject();
  const clone=()=>structuredClone(base);
  const badVersion=clone();badVersion.schemaVersion=999;
  assert.match(validateProject(badVersion),/Unsupported project version/);
  const badPort=clone();badPort.boards[badPort.rootBoardId].blocks[0].ports=[];
  assert.match(validateProject(badPort),/ports/);
  const detached=clone();detached.boards['unknown']={id:'unknown',name:'Detached',ownerBlockId:null,blocks:[],edges:[],viewport:{x:0,y:0,zoom:1}};
  assert.match(validateProject(detached),/Unreachable/);
  const dangling=clone();dangling.boards[dangling.rootBoardId].edges[0].target.blockId='missing';
  assert.match(validateProject(dangling),/Dangling/);
});

test('JSON round-trip preserves nested boards and valid project', () => {
  const serialized=JSON.stringify(createDemoProject());
  const parsed=JSON.parse(serialized);
  assert.equal(validateProject(parsed),null);
  assert.equal(Object.keys(parsed.boards).length,3);
});
