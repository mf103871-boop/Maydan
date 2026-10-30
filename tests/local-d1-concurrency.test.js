import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession, me } from '../server/accounts/session.mjs';

function ledger(t) {
  const db=new LocalD1();t.after(()=>db.close());
  db.database.exec('CREATE TABLE ledger(id TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value>0))');
  return db;
}

test('eight overlapping local D1 batches each commit their dependent statements without nested transactions',async t=>{
  const db=ledger(t),pending=Array.from({length:8},(_,index)=>db.batch([
    db.prepare('INSERT INTO ledger(id,value) VALUES(?,?)').bind(`${index}-first`,index+1),
    db.prepare('INSERT INTO ledger(id,value) SELECT ?,value+1 FROM ledger WHERE id=?').bind(`${index}-second`,`${index}-first`),
  ]));
  const settled=await Promise.allSettled(pending);
  assert.equal(settled.filter(result=>result.status==='fulfilled').length,8,'every independent batch must commit');
  for(const result of settled){assert.equal(result.value.length,2);assert.ok(result.value.every(statement=>statement.success&&statement.meta.changes===1));}
  const rows=(await db.prepare('SELECT id,value FROM ledger ORDER BY id').all()).results;
  assert.equal(rows.length,16);
  for(let index=0;index<8;index++){assert.equal(rows.find(row=>row.id===`${index}-first`).value,index+1);assert.equal(rows.find(row=>row.id===`${index}-second`).value,index+2);}
});

test('a failing batch rolls back its prefix while a concurrent successful batch commits and the adapter remains usable',async t=>{
  const db=ledger(t);await db.prepare('INSERT INTO ledger(id,value) VALUES(?,?)').bind('existing',9).run();
  const results=await Promise.allSettled([
    db.batch([db.prepare("INSERT INTO ledger(id,value) VALUES('rolled-back',1)"),db.prepare("INSERT INTO ledger(id,value) VALUES('existing',2)"),db.prepare("INSERT INTO ledger(id,value) VALUES('never-reached',3)")]),
    db.batch([db.prepare("INSERT INTO ledger(id,value) VALUES('committed',4)"),db.prepare("UPDATE ledger SET value=value+1 WHERE id='committed'")]),
  ]);
  assert.equal(results[0].status,'rejected');assert.match(results[0].reason.message,/UNIQUE constraint failed/);assert.equal(results[1].status,'fulfilled');
  assert.deepEqual((await db.prepare('SELECT id,value FROM ledger ORDER BY id').all()).results,[{id:'committed',value:5},{id:'existing',value:9}]);
  await db.prepare("INSERT INTO ledger(id,value) VALUES('after-rollback',1)").run();
  assert.equal(await db.prepare("SELECT value FROM ledger WHERE id='after-rollback'").first('value'),1);
});

test('a separate read/write cannot enter an unfinished batch or be lost in its rollback',async t=>{
  const db=ledger(t);
  const failed=db.batch([db.prepare("INSERT INTO ledger(id,value) VALUES('private-prefix',1)"),db.prepare('INSERT INTO absent_local_fixture VALUES(1)')]);
  const independent=db.prepare("INSERT INTO ledger(id,value) VALUES('independent',7)").run();
  const read=db.prepare("SELECT value FROM ledger WHERE id='private-prefix'").first();
  const settled=await Promise.allSettled([failed,independent,read]);
  assert.equal(settled[0].status,'rejected');assert.match(settled[0].reason.message,/no such table/);assert.equal(settled[1].status,'fulfilled');assert.equal(settled[2].status,'fulfilled');
  assert.equal(settled[2].value,null,'a reader must never see a prefix that will be rolled back');
  assert.deepEqual((await db.prepare('SELECT id,value FROM ledger').all()).results,[{id:'independent',value:7}]);
});

test('eight concurrent real account reads initialize one profile/achievement and preserve their session',async t=>{
  const DB=createLocalD1(),env={DB};t.after(()=>DB.close());const user=await createUser(env,{name:'شخصية محلية متزامنة'});
  const session=await issueSession(env,user.id);
  const settled=await Promise.allSettled(Array.from({length:8},()=>me(env,user)));
  assert.equal(settled.filter(result=>result.status==='fulfilled').length,8);
  assert.ok(settled.every(result=>result.value.user.id===user.id));
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND id=?').bind(user.id,session.id).first('n'),1);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM player_profiles WHERE user_id=?').bind(user.id).first('n'),1);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM player_achievements WHERE user_id=? AND achievement_id='welcome'").bind(user.id).first('n'),1);
});
