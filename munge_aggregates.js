const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const util = require('util');
const path = require('path');
const matter = require('gray-matter');

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
            parent_test_full_name,
            GROUP_CONCAT(DISTINCT test_run_version) AS versions
        FROM TestResult
        GROUP BY full_name, name
        ORDER BY name
    `;
    const testsRows = await all(testsQuery);
    const groups = {};
    for (const row of testsRows) {
        const { versions, full_name, name, parent_test_full_name } = row;
        const slug = slugify(full_name);

        if (!groups[parent_test_full_name]) {
            groups[parent_test_full_name] = {};
        }

        groups[parent_test_full_name][full_name] = { versions: versions.split(','), name, full_name, slug };
    }
    outputJSON("data/testgroups.json", groups);

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
                tr.parent_test_full_name,
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
        outputJSON(`data/testresults/${id}/${version}.json`, testResults);
    }

    // Generate Test taxonomies
    // List all the tests full names.
    const testsTaxonomyQuery = `
        SELECT DISTINCT
            full_name,
            name,
            test_run_version
        FROM TestResult
        ORDER BY full_name
    `;
    const testsTaxonomyRows = await all(testsTaxonomyQuery);

    const testsTaxonomy = {};
    for (const row of testsTaxonomyRows) {
        const { full_name, name, test_run_implementation_id, test_run_version } = row;
        const slug = slugify(full_name);

        if (!testsTaxonomy[full_name]) {
            testsTaxonomy[full_name] = {
                slug,
                name,
                full_name,
                versions: [],
            };
        }

        testsTaxonomy[full_name].versions.push(
            test_run_version,
        );
    }

    for (const test of Object.values(testsTaxonomy)) {
        outputFrontmatter(`content/tests/${test.slug}/_index.md`, {
            ...test,
            title: test.name
        });
    }

    // Generate Results taxonomies
    // List all the tests implementation / version / tests full names / outcome
    const resultsTaxonomyQuery = `
        SELECT
            test_run_implementation_id AS implementation_id,
            test_run_version AS version,
            full_name,
            outcome
        FROM TestResult
        ORDER BY test_run_implementation_id, test_run_version, full_name
    `;
    const resultsTaxonomyRows = await all(resultsTaxonomyQuery);

    const resultsTaxonomy = {};
    for (const row of resultsTaxonomyRows) {
        const { implementation_id, version, full_name, outcome } = row;
        const slug = slugify(full_name);

        if (!resultsTaxonomy[implementation_id]) {
            resultsTaxonomy[implementation_id] = {};
        }

        if (!resultsTaxonomy[implementation_id][version]) {
            resultsTaxonomy[implementation_id][version] = {};
        }

        if (!resultsTaxonomy[implementation_id][version][full_name]) {
            resultsTaxonomy[implementation_id][version][full_name] = {
                slug,
                full_name,
                outcome,
            };
        }
    }

    for (const [implementation_id, versions] of Object.entries(resultsTaxonomy)) {
        outputFrontmatter(`content/results/${implementation_id}/_index.md`, {
            implementation_id,
            title: implementation_id
        });

        for (const [version, tests] of Object.entries(versions)) {
            outputFrontmatter(`content/results/${implementation_id}/${version}/_index.md`, {
                implementation_id,
                version,
                title: version
            });

            for (const test of Object.values(tests)) {
                outputFrontmatter(`content/results/${implementation_id}/${version}/${test.slug}/_index.md`, {
                    ...test,
                    implementation_id,
                    version,
                    title: test.full_name
                });
            }
        }
    }

    // Generate ipips taxonomies
    // TODO

    // Close the database connection when you're done
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Closed the database connection.');
    });
}

const slugify = (str) => {
    return str.toLowerCase().replace(/[\s\=\/\.\:]/g, "-");
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

const outputFrontmatter = (p, data) => {
    const fullPath = `${hugoOutput}/${p}`;

    // TODO: implement update frontmatter

    const folders = path.dirname(fullPath);
    if (!fs.existsSync(folders)) {
        fs.mkdirSync(folders, { recursive: true });
    }

    // if file exists, load it with gray matter
    const content = {
        content: "",
        data: {}
    }
    if (fs.existsSync(fullPath)) {
        const existing = matter.read(fullPath);
        content.content = existing.content;
        content.data = existing.data;
    }
    content.data = { ...content.data, ...data };

    const md = matter.stringify(content.content, content.data);
    fs.writeFileSync(fullPath, md);
}

main()
    .then(() => {
        console.log("done");
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })