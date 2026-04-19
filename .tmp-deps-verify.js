// End-to-end API + DB verification for Features #50 and #51.
// #50: Remove dependency between features (DELETE works, row gone from DB, list reflects it)
// #51: Circular dependency prevented (direct A<->A and transitive A->B->C->A blocked)

var http = require('http');
var Database = require('better-sqlite3');

function req(method, path, body) {
  return new Promise(function (resolve, reject) {
    var data = body == null ? null : JSON.stringify(body);
    var options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    var r = http.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function step(name, fn) {
  return Promise.resolve().then(fn).then(function (v) {
    console.log('\n[OK] ' + name);
    return v;
  }).catch(function (err) {
    console.log('\n[FAIL] ' + name + ': ' + (err && err.message ? err.message : err));
    throw err;
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ' expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
  }
}

async function main() {
  var dbPath = 'C:\\claude-code\\opensource-long-running-harness\\data\\localforge.db';
  var db = new Database(dbPath, { readonly: true });

  // 1) create a fresh project
  var stamp = Date.now();
  var projectName = 'DEP_VERIFY_' + stamp;
  var pres = await req('POST', '/api/projects', { name: projectName });
  console.log('create project:', pres.status, pres.body && pres.body.project && pres.body.project.id);
  if (pres.status !== 201) throw new Error('project create failed: ' + JSON.stringify(pres));
  var projectId = pres.body.project.id;

  // 2) create three features A, B, C in this project
  async function createFeature(category, title, description) {
    var r = await req('POST', '/api/projects/' + projectId + '/features', {
      category: category, title: title, description: description,
    });
    if (r.status !== 201) throw new Error('feature create failed: ' + JSON.stringify(r));
    return r.body.feature.id;
  }
  var aId = await createFeature('functional', 'DEPV_A_' + stamp, 'A');
  var bId = await createFeature('functional', 'DEPV_B_' + stamp, 'B');
  var cId = await createFeature('functional', 'DEPV_C_' + stamp, 'C');
  console.log('features A=', aId, 'B=', bId, 'C=', cId);

  /* ---------------------- Feature #50: remove dep ---------------------- */
  await step('add dep A -> B', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOnFeatureId: bId,
    });
    assertEqual(r.status, 201, 'add status');
  });

  await step('verify A has dep on B in DB', function () {
    var rows = db.prepare(
      'SELECT * FROM feature_dependencies WHERE feature_id = ? AND depends_on_feature_id = ?'
    ).all(aId, bId);
    assertEqual(rows.length, 1, 'rows count');
  });

  await step('verify GET /api/features/A/dependencies lists B', async function () {
    var r = await req('GET', '/api/features/' + aId + '/dependencies', null);
    assertEqual(r.status, 200, 'list status');
    var depIds = (r.body.dependencies || []).map(function (d) { return d.id; });
    if (!depIds.includes(bId)) {
      throw new Error('expected B in dependency list; got ' + JSON.stringify(depIds));
    }
  });

  await step('DELETE A -> B dependency', async function () {
    var r = await req('DELETE', '/api/features/' + aId + '/dependencies?dependsOnFeatureId=' + bId, null);
    assertEqual(r.status, 200, 'delete status');
  });

  await step('verify dep row is gone from DB after DELETE', function () {
    var rows = db.prepare(
      'SELECT * FROM feature_dependencies WHERE feature_id = ? AND depends_on_feature_id = ?'
    ).all(aId, bId);
    assertEqual(rows.length, 0, 'rows count after delete');
  });

  await step('verify GET list no longer includes B', async function () {
    var r = await req('GET', '/api/features/' + aId + '/dependencies', null);
    var depIds = (r.body.dependencies || []).map(function (d) { return d.id; });
    if (depIds.includes(bId)) {
      throw new Error('B still in list after delete: ' + JSON.stringify(depIds));
    }
  });

  /* -------- Feature #50 alt: bulk POST with empty array removes ------- */
  await step('add A -> B again to test bulk removal path', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOnFeatureId: bId,
    });
    assertEqual(r.status, 201, 'add status');
  });
  await step('bulk POST dependsOn:[] removes A -> B', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', { dependsOn: [] });
    assertEqual(r.status, 200, 'bulk status');
    var depIds = (r.body.dependencies || []).map(function (d) { return d.id; });
    if (depIds.length !== 0) throw new Error('expected empty list, got ' + JSON.stringify(depIds));
    var rows = db.prepare(
      'SELECT * FROM feature_dependencies WHERE feature_id = ?'
    ).all(aId);
    assertEqual(rows.length, 0, 'rows after bulk empty');
  });

  /* ----------------- Feature #51: cycle prevention ------------------- */
  // Setup: B depends on A
  await step('add B -> A (B depends on A)', async function () {
    var r = await req('POST', '/api/features/' + bId + '/dependencies', {
      dependsOnFeatureId: aId,
    });
    assertEqual(r.status, 201, 'add B->A status');
  });

  await step('Direct cycle: adding A -> B should fail with cycle error', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOnFeatureId: bId,
    });
    if (r.status === 201) throw new Error('expected cycle error but got 201');
    if (r.status !== 400) throw new Error('expected 400 status, got ' + r.status);
    var msg = (r.body && r.body.error) || '';
    if (!/cycle/i.test(msg)) throw new Error('expected cycle in error msg, got: ' + msg);
    console.log('  ' + r.status + ' "' + msg + '"');
    var rows = db.prepare(
      'SELECT * FROM feature_dependencies WHERE feature_id = ? AND depends_on_feature_id = ?'
    ).all(aId, bId);
    assertEqual(rows.length, 0, 'no row was added');
  });

  await step('Self-dep: A depends on A should fail', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOnFeatureId: aId,
    });
    if (r.status === 201) throw new Error('expected self-dep error but got 201');
    if (r.status !== 400) throw new Error('expected 400 status, got ' + r.status);
    var msg = (r.body && r.body.error) || '';
    console.log('  ' + r.status + ' "' + msg + '"');
  });

  // Build chain: B->A already, now add C->B, then try A->C (would form A->C->B->A cycle)
  await step('add C -> B (so chain is C->B->A)', async function () {
    var r = await req('POST', '/api/features/' + cId + '/dependencies', {
      dependsOnFeatureId: bId,
    });
    assertEqual(r.status, 201, 'add C->B status');
  });

  await step('Transitive cycle: A -> C should fail (would form A->C->B->A)', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOnFeatureId: cId,
    });
    if (r.status === 201) throw new Error('expected cycle error but got 201');
    if (r.status !== 400) throw new Error('expected 400, got ' + r.status);
    var msg = (r.body && r.body.error) || '';
    if (!/cycle/i.test(msg)) throw new Error('expected cycle in error msg, got: ' + msg);
    console.log('  ' + r.status + ' "' + msg + '"');
    var rows = db.prepare(
      'SELECT * FROM feature_dependencies WHERE feature_id = ? AND depends_on_feature_id = ?'
    ).all(aId, cId);
    assertEqual(rows.length, 0, 'no transitive cycle row was added');
  });

  /* -------- Feature #51 (bulk path): cycle blocked via bulk POST ------- */
  await step('Bulk POST dependsOn:[B] on A (would create A->B cycle) is rejected', async function () {
    var r = await req('POST', '/api/features/' + aId + '/dependencies', {
      dependsOn: [bId],
    });
    if (r.status === 200) throw new Error('expected error but got 200');
    if (r.status !== 400) throw new Error('expected 400, got ' + r.status);
    var msg = (r.body && r.body.error) || '';
    if (!/cycle/i.test(msg)) throw new Error('expected cycle msg, got: ' + msg);
    console.log('  ' + r.status + ' "' + msg + '"');
  });

  /* ---------------------- cleanup project ---------------------- */
  console.log('\nCleaning up project ' + projectId);
  var dr = await req('DELETE', '/api/projects/' + projectId, null);
  console.log('delete project status:', dr.status);

  console.log('\n================================');
  console.log('ALL CHECKS PASSED for #50 and #51');
  console.log('================================');
}

main().then(function () {
  process.exit(0);
}, function (err) {
  console.error('FATAL', err && err.stack ? err.stack : err);
  process.exit(1);
});
