import test from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, addPort, connectBlocks, createEmptyProject, createDecomposition, deleteBlock, validateProject } from '../src/model.js';
import { createWorkspace, panesIn, splitPane, closePane, navigatePane, goHistory, searchArchitecture,
  dependencyIds, toLayoutTree, restoreLayout, reconcileWorkspace } from '../src/workspace.js';

function graph() {
  const project=createEmptyProject('Onboarding');
  const root=project.rootBoardId;
  const front=addBlock(project,root,'frontend-application',{x:20,y:20});front.label='Client';front.sourceRef='src/ui/Client.tsx';
  const back=addBlock(project,root,'backend-service',{x:280,y:20});back.label='API';back.sourceRef='src/api/handler.js';
  const edge=connectBlocks(project,root,front.id,back.id);
  const frontId=createDecomposition(project,root,front.id);
  const backId=createDecomposition(project,root,back.id);
  const form=addBlock(project,frontId,'frontend-form',{x:10,y:10});form.label='Form';form.sourceRef='src/ui/Form.tsx';
  const handler=addBlock(project,backId,'request-handler',{x:10,y:10});handler.label='Handle request';
  return {project,root,front,back,edge,frontId,backId,form,handler};
}

test('one canonical project supports H0 and two H1 panes with independent camera and history',()=>{
  const {project,root,frontId,backId}=graph();
  const workspace=createWorkspace(project);
  const first=panesIn(workspace.root)[0];
  const second=splitPane(workspace,project,'horizontal',frontId);
  const third=splitPane(workspace,project,'vertical',backId);
  assert.equal(panesIn(workspace.root).length,3);
  assert.deepEqual(panesIn(workspace.root).map(p=>p.boardId),[root,frontId,backId]);
  second.viewport.zoom=2;third.viewport.x=800;
  assert.notEqual(first.viewport.zoom,second.viewport.zoom);
  assert.notEqual(first.viewport.x,third.viewport.x);
  assert.equal(splitPane(workspace,project,'horizontal',root)?.boardId,root);
  assert.equal(splitPane(workspace,project,'horizontal',root),null);
  assert.equal(panesIn(workspace.root).length,4);
  assert.equal(closePane(workspace,second.id),true);
  assert.equal(panesIn(workspace.root).length,3);
  assert.equal(navigatePane(first,project,frontId,{type:'block',id:'a'}),true);
  assert.equal(goHistory(first,project,'back'),true);
  assert.equal(first.boardId,root);
  assert.equal(goHistory(first,project,'forward'),true);
  assert.equal(first.boardId,frontId);
});

test('saved split tree preserves board references, ratios, and no independent project clones',()=>{
  const {project,frontId,backId}=graph();
  const workspace=createWorkspace(project);
  splitPane(workspace,project,'horizontal',frontId);
  splitPane(workspace,project,'vertical',backId);
  workspace.root.ratio=.4;
  const root=toLayoutTree(workspace.root);
  project.workspaceLayouts=[{id:'welcome',label:'Review overview',root}];
  assert.equal(validateProject(JSON.parse(JSON.stringify(project))),null);
  const restored=restoreLayout(project,project.workspaceLayouts[0]);
  assert.equal(restored.root.ratio,.4);
  assert.deepEqual(panesIn(restored.root).map(p=>p.boardId),panesIn(workspace.root).map(p=>p.boardId));
  assert.equal(Object.keys(project.boards).length,3);
  const invalid=structuredClone(project);invalid.workspaceLayouts[0].root.children[1].children[0].boardId='missing';
  assert.match(validateProject(invalid),/workspace layout/i);
});

test('source search scans all boards and local dependency highlight remains board-scoped',()=>{
  const {project,root,front,back,edge,form}=graph();
  assert.deepEqual(searchArchitecture(project,'Form.tsx').map(x=>x.blockId),[form.id]);
  assert.deepEqual(searchArchitecture(project,'api handler').map(x=>x.blockId),[back.id]);
  assert.deepEqual(searchArchitecture(project,'no-such-symbol'),[]);
  assert.deepEqual(dependencyIds(project.boards[root],{type:'block',id:front.id}),new Set([front.id,back.id,edge.id]));
});

test('child-board interface bindings validate exact parent and child endpoints',()=>{
  const {project,front,frontId,form}=graph();
  const child=project.boards[frontId];
  child.interfaceBindings=[{ownerPortId:front.ports[0].id,internal:{blockId:form.id,portId:form.ports[0].id}}];
  assert.equal(validateProject(project),null);
  for(const update of [
    p=>p.boards[frontId].interfaceBindings[0].ownerPortId='missing',
    p=>p.boards[frontId].interfaceBindings[0].internal.portId='missing',
    p=>p.boards[frontId].interfaceBindings[0].internal.portId=p.boards[frontId].blocks[0].ports[1].id,
    p=>p.boards[frontId].interfaceBindings.push(structuredClone(p.boards[frontId].interfaceBindings[0]))
  ]) {const invalid=structuredClone(project);update(invalid);assert.match(validateProject(invalid),/binding/);}
});

test('nonanimated tours cross boards, reject orphaned targets and round-trip unchanged',()=>{
  const {project,root,frontId,backId,front,form,handler,edge}=graph();
  project.tours=[{id:'guide',title:'Request flow',description:'Manual walkthrough',steps:[
    {id:'s1',boardId:root,edgeId:edge.id,title:'Overview',narration:'See the system request'},
    {id:'s2',boardId:frontId,blockId:form.id,title:'Frontend',narration:'Review frontend input'},
    {id:'s3',boardId:backId,blockId:handler.id,title:'Backend',narration:'Review backend handler'}
  ]}];
  assert.equal(validateProject(project),null);
  assert.deepEqual(JSON.parse(JSON.stringify(project)).tours,project.tours);
  for(const update of [
    p=>{p.tours[0].steps[1].boardId='missing';},
    p=>{p.tours[0].steps[0].edgeId='missing';},
    p=>{p.tours[0].steps[2].narration='x'.repeat(2001);},
    p=>{p.tours[0].steps[0].blockId=front.id;}
  ]){const invalid=structuredClone(project);update(invalid);assert.match(validateProject(invalid),/tour step/);}
  assert.equal(deleteBlock(project,frontId,form.id),true);
  assert.match(validateProject(project),/tour step/);
  project.tours[0].steps.splice(1,1);
  assert.equal(validateProject(project),null);
});

test('destroyed board references are recovered without deleting unrelated panes',()=>{
  const {project,frontId,backId,front,root}=graph();
  const workspace=createWorkspace(project);
  splitPane(workspace,project,'horizontal',frontId);
  splitPane(workspace,project,'vertical',backId);
  deleteBlock(project,root,front.id);
  reconcileWorkspace(workspace,project);
  assert.deepEqual(panesIn(workspace.root).map(p=>p.boardId),[root,root,backId]);
});
