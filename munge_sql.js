const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const util = require('util');

const main = async () => {
    let db = new sqlite3.Database('./munged/munged.db', (err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Connected to the database.');
    });

    const run = util.promisify(db.run.bind(db));

    // Create the TestResult table if it doesn't exist
    await run(`
        CREATE TABLE IF NOT EXISTS TestRun (
            implementation_id TEXT,
            version TEXT,
            time DATETIME,

            -- primary key is the concat of implem and version:
            PRIMARY KEY (implementation_id, version)
        );
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS TestResult (
            test_run_implementation_id TEXT,
            test_run_version TEXT,

            full_name TEXT,
            name TEXT,
            outcome TEXT CHECK(outcome IN ('pass', 'fail', 'skip')),

            parent_test_full_name TEXT,

            PRIMARY KEY (test_run_implementation_id, test_run_version, full_name),

            -- parent hierarchy
            FOREIGN KEY (test_run_implementation_id, test_run_version, parent_test_full_name)
                REFERENCES TestResult (test_run_implementation_id, test_run_version, full_name),
            
            -- test run
            FOREIGN KEY (test_run_implementation_id, test_run_version)
                REFERENCES TestRun (implementation_id, version)
        );
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS TestMetadata (
            test_run_implementation_id TEXT,
            test_run_version TEXT,
            test_full_name TEXT,

            key TEXT,
            value JSON,

            PRIMARY KEY (test_run_implementation_id, test_run_version, test_full_name, key),

            -- test run
            FOREIGN KEY (test_run_implementation_id, test_run_version)
                REFERENCES TestRun (implementation_id, version)

            -- test result
            FOREIGN KEY (test_run_implementation_id, test_run_version, test_full_name)
                REFERENCES TestResult (test_run_implementation_id, test_run_version, full_name)
        );
    `)

    // list all the files in ./munged/*.json
    let files = fs.readdirSync("./munged");
    files = files.filter((file) => file.endsWith(".json"));

    for (const file of files) {
        const implemId = file.replace(".json", "");
        const content = JSON.parse(fs.readFileSync(`./munged/${file}`));
        const { TestMetadata, ...tests } = content;

        const { version, time } = TestMetadata.meta;

        await run(`
            INSERT INTO TestRun (implementation_id, version, time)
            VALUES (?, ?, ?)
            ON CONFLICT (implementation_id, version) DO UPDATE SET
                time = excluded.time
        `, [implemId, version, time]);

        // process all the tests. Start with the roots.
        const sorted = Object.keys(tests).sort();

        for (testName of sorted) {
            const test = tests[testName];

            const fullName = testName
            const name = test.path[test.path.length - 1];
            const outcome = test.outcome;
            const parentFullName = test.path.slice(0, -1).join("/") || null;

            await run(`
                INSERT INTO TestResult (test_run_implementation_id, test_run_version, full_name, name, outcome, parent_test_full_name)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [implemId, version, fullName, name, outcome, parentFullName]);

            for (const [key, value] of Object.entries(test.meta ?? {})) {
                await run(`
                    INSERT INTO TestMetadata (test_run_implementation_id, test_run_version, test_full_name, key, value)
                    VALUES (?, ?, ?, ?, ?)
                `, [implemId, version, fullName, key, JSON.stringify(value)]);
            }
        }
    }

    // Close the database connection when you're done
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Closed the database connection.');
    });
}

main()
    .then(() => {
        console.log("done");
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })