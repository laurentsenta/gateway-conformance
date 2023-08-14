const fs = require("fs");

// # read json from stdin:
let tests = fs.readFileSync(0, "utf-8");
tests = JSON.parse(tests);

// # read implementation id and other args from command line
const implemId = process.argv[2];
// TODO: add run Id and other details to link workflows

// # pop out the TestMetadata from our tests
// this is just used to extract global metadata for the test run
const { TestMetadata, ...rest } = tests;
tests = rest;

// Extract metadata
const version = TestMetadata.meta.version;
const time = TestMetadata.meta.time;

// Assume folders is www/data for the implementation

// create folders if they don't exist
const folders = ["www/data/testrun", "www/data/testtree", "www/data/testlogs", "www/data/ipip", "www/data/group"];

folders.forEach((folder) => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
})

// # write the test run metadata
const testrun = `www/data/testrun/${implemId}.json`;

const testrunMetadata = {
    version,
    time,
    implemId,
};

fs.writeFileSync(testrun, JSON.stringify(testrunMetadata, null, 2));

// Generate recursive tree of tests
const tree = { children: {}, passed: 0, failed: 0, skipped: 0, total: 0 };

// 1. sort by test path
const sortedTests = Object.keys(tests).sort()

// 2. generate tree
sortedTests.forEach((key) => {
    const test = tests[key];
    const path = test.path;

    let current = tree;
    path.forEach((name) => {
        current = current.children;
        if (!current[name]) {
            current[name] = { children: {}, passed: 0, failed: 0, skipped: 0, total: 0 };
        }
        current = current[name];
    });

    current.outcome = test.outcome;
    current.meta = test.meta;
});

// 3. generate stats for each node
// super naive recursive call.
const updateStats = (node) => {
    if (Object.keys(node.children).length === 0) {
        node.passed = node.outcome === "pass" ? 1 : 0;
        node.failed = node.outcome === "fail" ? 1 : 0;
        node.skipped = node.outcome === "skip" ? 1 : 0;
        node.total = 1;
        return;
    }

    Object.values(node.children).forEach((child) => {
        updateStats(child);
        node.passed += child.passed;
        node.failed += child.failed;
        node.skipped += child.skipped;
        node.total += child.total;
    });
}

updateStats(tree);

const testtree = `www/data/testtree/${implemId}.json`;
fs.writeFileSync(testtree, JSON.stringify(tree.children, null, 2));

// Generate test logs
const testlogs = `www/data/testlogs/${implemId}.json`;
fs.writeFileSync(testlogs, JSON.stringify(tests, null, 2));

// Generate ipip index
const ipip = `www/data/ipip/${implemId}.json`;
const ipipIndex = {};
Object.entries(tests).forEach(([id, test]) => {
    const ipip = test.meta?.ipip;
    if (ipip) {
        ipipIndex[ipip] = [...(ipipIndex[ipip] || []), id];
    }
});
fs.writeFileSync(ipip, JSON.stringify(ipipIndex, null, 2));

// Generate group index
const group = `www/data/group/${implemId}.json`;
const groupIndex = {};
Object.entries(tests).forEach(([id, test]) => {
    const group = test.meta?.group;
    if (group) {
        groupIndex[group] = [...(groupIndex[group] || []), id];
    }
});
fs.writeFileSync(group, JSON.stringify(groupIndex, null, 2));