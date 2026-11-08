"""Original decision probe, not the production importer. Only generated temporary data.
Run from repository root: python super-agent-references/analysis/wayfinder/legacy-cutover-probe.py
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def open_db(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=2)
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS control (
        id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT, owner TEXT, epoch INTEGER,
        confirmed INTEGER, snapshot TEXT);
      INSERT OR IGNORE INTO control VALUES(1,'legacy','legacy',1,0,NULL);
      CREATE TABLE IF NOT EXISTS archive (origin TEXT PRIMARY KEY, body TEXT);
      CREATE TABLE IF NOT EXISTS roles (origin TEXT PRIMARY KEY, label TEXT);
      CREATE TABLE IF NOT EXISTS review (origin TEXT PRIMARY KEY, reason TEXT);
      CREATE TABLE IF NOT EXISTS input (identity TEXT PRIMARY KEY, fingerprint TEXT,
        status TEXT, consumer TEXT);
      CREATE TABLE IF NOT EXISTS effects (identity TEXT PRIMARY KEY, consumer TEXT);
    ''')
    return db


def fixture(scope='old-profile'):
    return {'scope': scope, 'roles': {'writer': 'Writer'},
            'history': {'chat-1': ['user: draft plan', 'bot: investigating']},
            'unfinished': {'work-1': 'result-unknown'}, 'sessions': ['chat-1']}


def import_snapshot(db, data, available, fail=False):
    # Importing is inert: only archive, reviewed role labels and review records.
    if not set(data['sessions']).issubset(available):
        raise ValueError('missing session')
    fingerprint = digest(data)
    phase, previous = db.execute('SELECT phase,snapshot FROM control').fetchone()
    if previous:
        if previous != fingerprint:
            raise ValueError('changed snapshot requires a new reviewed run')
        return
    if phase != 'legacy':
        raise ValueError('wrong phase')
    db.execute('BEGIN IMMEDIATE')
    try:
        for key, value in data['history'].items():
            db.execute('INSERT INTO archive VALUES(?,?)',
                       (data['scope'] + ':' + key, json.dumps(value)))
        if fail:
            raise RuntimeError('injected import failure')
        for key, value in data['roles'].items():
            db.execute('INSERT INTO roles VALUES(?,?)', (data['scope']+':'+key,value))
        for key, value in data['unfinished'].items():
            db.execute('INSERT INTO review VALUES(?,?)', (data['scope']+':'+key,value))
        db.execute("UPDATE control SET phase='prepared', snapshot=?", (fingerprint,))
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise


def add_input(db, identity, content):
    old = db.execute('SELECT fingerprint FROM input WHERE identity=?',(identity,)).fetchone()
    if old and old[0] != digest(content):
        raise ValueError('identity collision')
    db.execute("INSERT OR IGNORE INTO input VALUES(?,?,'pending',NULL)",
               (identity,digest(content)))


def consume(db, identity, owner, epoch):
    db.execute('BEGIN IMMEDIATE')
    try:
        phase, current, generation = db.execute('SELECT phase,owner,epoch FROM control').fetchone()
        allowed = phase in ('legacy','prepared') if owner=='legacy' else phase=='active'
        if not allowed or current != owner or generation != epoch:
            raise ValueError('stale or inactive consumer')
        row = db.execute('SELECT status FROM input WHERE identity=?',(identity,)).fetchone()
        if row and row[0]=='pending':
            db.execute("UPDATE input SET status='accepted',consumer=? WHERE identity=?",(owner,identity))
            db.execute('INSERT INTO effects VALUES(?,?)',(identity,owner))
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise


def quiesce(db, confirmed):
    if not confirmed:
        raise ValueError('old ingress/jobs/callbacks not proven quiescent')
    db.execute('BEGIN IMMEDIATE')
    try:
        if db.execute('SELECT phase FROM control').fetchone()[0]!='prepared':
            raise ValueError('not prepared')
        db.execute("UPDATE control SET phase='quiesced',owner=NULL,epoch=epoch+1,confirmed=1")
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise


def activate(db, crash=None):
    db.execute('BEGIN IMMEDIATE')
    phase, confirmed = db.execute('SELECT phase,confirmed FROM control').fetchone()
    if phase=='active':
        db.execute('COMMIT')
        return
    if phase!='quiesced' or not confirmed:
        db.execute('ROLLBACK')
        raise ValueError('activation barrier missing')
    db.execute("UPDATE control SET phase='active',owner='new',epoch=epoch+1")
    if crash=='before':
        os._exit(37)
    db.execute('COMMIT')
    if crash=='after':
        os._exit(38)


def rollback_before_activation(db):
    db.execute('BEGIN IMMEDIATE')
    phase = db.execute('SELECT phase FROM control').fetchone()[0]
    if phase not in ('prepared','quiesced'):
        db.execute('ROLLBACK')
        raise ValueError('post-activation needs reverse handoff and reconciliation')
    db.execute("UPDATE control SET phase='prepared',owner='legacy',confirmed=0,epoch=epoch+1")
    db.execute('COMMIT')


def expect_error(operation):
    try:
        operation()
    except (ValueError,RuntimeError):
        return
    raise AssertionError('operation should have been rejected')


def run():
    results=[]
    def case(name, fn):
        with tempfile.TemporaryDirectory(prefix='dsbot-cutover-probe-') as folder:
            path=Path(folder)/'protocol.sqlite'
            db=open_db(path)
            try:
                fn(db,path)
                results.append({'case':name,'passed':True})
            finally:
                db.close()
    def prepared(db): import_snapshot(db,fixture(),{'chat-1'})
    def active(db): prepared(db); quiesce(db,True); activate(db)
    def scalar(db,table): return db.execute('SELECT count(*) FROM '+table).fetchone()[0]

    # Negative controls demonstrate why copying old executable state or dual consumers fails.
    def naive_replay(db,path):
        data=fixture(); naive_queue=list(data['unfinished'])
        assert naive_queue, 'control must expose an old work replay'
    case('negative: copying unfinished work creates executable replay', naive_replay)
    def dual_consumer(db,path):
        old_effects=['same-input']; new_effects=['same-input']
        assert len(old_effects+new_effects)!=len(set(old_effects+new_effects))
    case('negative: independent receipts allow duplicate intent', dual_consumer)
    def inert(db,path):
        source=Path(path.parent)/'fictional-old.json'
        source.write_text(json.dumps(fixture()),encoding='utf-8')
        before=source.read_bytes()
        import_snapshot(db,json.loads(source.read_text()),{'chat-1'})
        assert scalar(db,'archive')==scalar(db,'roles')==scalar(db,'review')==1
        assert scalar(db,'effects')==0 and before==source.read_bytes()
    case('archive/role mapping is inert and source bytes unchanged',inert)
    def failure(db,path):
        expect_error(lambda:import_snapshot(db,fixture(),{'chat-1'},True))
        assert scalar(db,'archive')==0
        assert db.execute('SELECT phase FROM control').fetchone()[0]=='legacy'
        prepared(db); assert scalar(db,'archive')==1
    case('import failure rolls back and retry succeeds',failure)
    def repeat(db,path):
        prepared(db); prepared(db); assert scalar(db,'archive')==1
        data=fixture(); data['roles']['writer']='Changed'
        expect_error(lambda:import_snapshot(db,data,{'chat-1'}))
    case('same snapshot is idempotent; changed snapshot rejected',repeat)
    def missing(db,path):
        expect_error(lambda:import_snapshot(db,fixture(),set()))
        assert scalar(db,'archive')==0
    case('missing required history blocks publication',missing)
    def identities(db,path):
        add_input(db,'instance-a:github:repo-a:message-1','hello')
        add_input(db,'instance-a:github:repo-b:message-1','hello')
        assert scalar(db,'input')==2
        expect_error(lambda:add_input(db,'instance-a:github:repo-a:message-1','changed'))
    case('fully qualified input identities and collision rejection',identities)
    def barrier(db,path):
        prepared(db); expect_error(lambda:quiesce(db,False))
        expect_error(lambda:activate(db))
        assert db.execute('SELECT owner FROM control').fetchone()[0]=='legacy'
    case('activation blocked without old consumer/job proof',barrier)
    def cutover(db,path):
        prepared(db); add_input(db,'old-seen','a'); consume(db,'old-seen','legacy',1)
        quiesce(db,True); add_input(db,'during-gap','b')
        expect_error(lambda:consume(db,'during-gap','legacy',1))
        activate(db); epoch=db.execute('SELECT epoch FROM control').fetchone()[0]
        consume(db,'old-seen','new',epoch); consume(db,'during-gap','new',epoch)
        consume(db,'during-gap','new',epoch)
        assert db.execute('SELECT * FROM effects ORDER BY identity').fetchall()==[('during-gap','new'),('old-seen','legacy')]
    case('cutover receipts suppress duplicates and preserve gap input',cutover)
    def crash_case(when, expected):
        def check(db,path):
            prepared(db); quiesce(db,True)
            result=subprocess.run([sys.executable,__file__,'--crash',str(path),when],check=False)
            assert result.returncode==({'before':37,'after':38}[when])
            assert db.execute('SELECT phase FROM control').fetchone()[0]==expected
            activate(db); epoch=db.execute('SELECT epoch FROM control').fetchone()[0]
            activate(db)
            assert db.execute('SELECT epoch FROM control').fetchone()[0]==epoch
        return check
    case('process death before activation commit retains barrier',crash_case('before','quiesced'))
    case('process death after commit reconciles active without new epoch',crash_case('after','active'))
    def stale(db,path):
        peer=open_db(path)
        try:
            active(db); add_input(db,'late','hello')
            expect_error(lambda:consume(peer,'late','legacy',1))
            assert scalar(db,'effects')==0
        finally: peer.close()
    case('second connection rejects stale legacy epoch',stale)
    def rollback(db,path):
        prepared(db); quiesce(db,True); rollback_before_activation(db)
        assert db.execute('SELECT owner FROM control').fetchone()[0]=='legacy'
        quiesce(db,True); activate(db)
        expect_error(lambda:rollback_before_activation(db))
    case('rollback before activation allowed; active reverse requires handoff',rollback)
    def review(db,path):
        active(db)
        assert scalar(db,'review')==1 and scalar(db,'effects')==0
    case('unknown old work stays manual review after activation',review)
    report={'kind':'original SQLite protocol model; not DS Bot/DSH integration',
            'sqlite':sqlite3.sqlite_version,'cases':results,'passed':len(results),
            'limits':['quiescence proof is an input, not actual OS process termination',
                      'shared receipt ledger is modeled; legacy ingress bridge is not implemented',
                      'no external side effects/exactly-once or real user migration verified']}
    target=Path(__file__).with_name('legacy-cutover-results.json')
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':len(results),'result':str(target)},ensure_ascii=False))


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--crash':
        activate(open_db(Path(sys.argv[2])),sys.argv[3])
    else:
        run()
