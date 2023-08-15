const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const util = require('util');
const path = require('path');

// first parameter: the input database file
// second parameter: the output www/ folder
const dbFile = process.argv[2];
const hugoOutput = process.argv[3];

if (!dbFile || !hugoOutput) {
    console.error("Usage: node munge_sql.js <input.db> <output>");
    process.exit(1);
}

const main = async () => {
    let db = new sqlite3.Database(dbFile, (err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Connected to the database.');
    });

    // Promisify the needed methods
    const run = util.promisify(db.run.bind(db));
    const all = util.promisify(db.all.bind(db));

    // Query to fetch all implementations
    const implementationsQuery = `
        SELECT implementation_id AS id, version, time
        FROM TestRun
        ORDER BY implementation_id, version, time;
    `;
    const allRuns = await all(implementationsQuery);

    const runs = {};
    for (const row of allRuns) {
        const { id, version, time } = row;
        if (!runs[id]) {
            runs[id] = [];
        }
        runs[id].push({ version, time });
    }
    console.log(runs);
    outputJSON("data/testruns.json", runs);

    // Query to fetch all the root tests / later replace with test groups
    const testsQuery = `
        SELECT
            full_name,
            name,
            GROUP_CONCAT(DISTINCT test_run_version) AS versions
        FROM TestResult
        WHERE parent_test_full_name is NULL
        GROUP BY full_name, name
        ORDER BY name
    `;
    const testsRows = await all(testsQuery);
    const rootTests = {};
    for (const row of testsRows) {
        const { versions, full_name, name } = row;
        rootTests[name] = { versions: versions.split(','), name, full_name };
    }
    console.log(rootTests);
    outputJSON("data/testroots.json", rootTests);

    // Generate test results for every run
    for ({ id, version } of allRuns) {
        const testResultQuery = `
            WITH LeafTests AS (
                -- Identify leaf tests (tests without a parent)
                SELECT full_name, outcome
                FROM TestResult tr1
                WHERE test_run_implementation_id = ? AND test_run_version = ?
                AND NOT EXISTS (
                    SELECT 1
                    FROM TestResult tr2
                    WHERE tr2.test_run_implementation_id = tr1.test_run_implementation_id
                        AND tr2.test_run_version = tr1.test_run_version
                        AND tr2.parent_test_full_name = tr1.full_name
                )
            )

            SELECT
                tr.full_name,
                tr.name,
                COUNT(CASE WHEN lt.outcome = 'pass' THEN 1 ELSE NULL END) AS passed_leave,
                COUNT(CASE WHEN lt.outcome = 'fail' THEN 1 ELSE NULL END) AS failed_leaves,
                COUNT(CASE WHEN lt.outcome = 'skip' THEN 1 ELSE NULL END) AS skipped_leaves,
                COUNT(lt.full_name) AS total_leaves
            FROM TestResult tr
            LEFT JOIN LeafTests lt
                ON lt.full_name LIKE tr.full_name || '%'
            WHERE tr.test_run_implementation_id = ? AND tr.test_run_version = ?
            GROUP BY tr.full_name
            ORDER BY tr.full_name;
        `;

        const rows2 = await all(testResultQuery, [id, version, id, version]);
        const testResults = {};

        for (const row of rows2) {
            testResults[row.full_name] = row;
        }
        console.log(testResults);
        outputJSON(`data/testresults/${id}/${version}.json`, testResults);
    }


    // Close the database connection when you're done
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Closed the database connection.');
    });
}

const outputJSON = (p, data) => {
    const json = JSON.stringify(data, null, 2);
    const fullPath = `${hugoOutput}/${p}`;

    const folders = path.dirname(fullPath);
    if (!fs.existsSync(folders)) {
        fs.mkdirSync(folders, { recursive: true });
    }

    fs.writeFileSync(fullPath, json);
}

main()
    .then(() => {
        console.log("done");
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })