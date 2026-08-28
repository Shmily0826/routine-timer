import test from 'node:test'; import assert from 'node:assert/strict';
const s=await import('../miniprogram/domain/storage.ts');
test('valid routine and missing optional lastUsedAt',()=>{const x=s.parseRoutines([{id:'1',name:'A',rounds:[{name:'x',workSec:5,restSec:0}],createdAt:1,updatedAt:2}]);assert.equal(x[0].rounds[0].workSec,5);assert.equal(x[0].lastUsedAt,undefined)});
test('corrupted storage is safe and session parser validates',()=>{assert.deepEqual(s.parseRoutines('{bad'),[]);assert.equal(s.parseSession(null),null);assert.equal(s.parseSession({status:'bad'}),null)});
test('round overrides normalize on reload',()=>{const x=s.parseRoutines([{id:'1',name:'A',rounds:[{name:'',workSec:-5,restSec:'x'}]}]);assert.equal(x[0].rounds[0].workSec,0);assert.equal(x[0].rounds[0].restSec,0)});
