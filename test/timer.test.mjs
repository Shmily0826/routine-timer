import test from 'node:test'; import assert from 'node:assert/strict';
const m=await import('../src/domain/timer.ts');
const rounds=[{name:'A',workSec:10,restSec:5},{name:'B',workSec:20,restSec:0},{name:'C',workSec:5,restSec:0}];
test('work countdown and exact boundary enters rest',()=>{const s=m.createSession(rounds,0);assert.equal(m.reconcile(s,9999).remainingMs,1);assert.equal(m.reconcile(s,10000).session.phase,'rest')});
test('rest then next work',()=>{const s=m.createSession(rounds,0);assert.equal(m.reconcile(s,15000).session.currentRoundIndex,1);assert.equal(m.reconcile(s,15000).session.phase,'work')});
test('multi phase background recovery and completion',()=>{const s=m.createSession(rounds,0);assert.equal(m.reconcile(s,100000).session.status,'completed');assert.equal(m.reconcile(m.reconcile(s,100000).session,200000).session.status,'completed')});
test('pause freezes and resume restores',()=>{let s=m.pause(m.createSession(rounds,0),4000);assert.equal(m.remainingMs(s,99999),6000);s=m.resume(s,10000);assert.equal(m.remainingMs(s,15999),1)});
test('next always enters next work; previous clamps',()=>{let s=m.next(m.createSession(rounds,0),1);assert.equal(s.currentRoundIndex,1);assert.equal(s.phase,'work');assert.equal(m.previous(m.createSession(rounds,0),1).currentRoundIndex,0);assert.equal(m.next(m.next(m.next(m.createSession(rounds,0),1),2),3).status,'completed')});
test('zero rest and invalid values',()=>{const s=m.createSession([{name:'only',workSec:0,restSec:0}],0);assert.equal(m.reconcile(s,1).session.status,'completed');assert.equal(m.normalizeSeconds(-1,7),7);assert.equal(m.normalizeSeconds(5000,7),7)});
