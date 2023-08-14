const fs = require("fs");

// merge the ipip json files.

// list all the files in www/data/ipip/*.json
const ipipFiles = fs.readdirSync("www/data/ipip");

// merge all the indexes into one.
// File format:
// ipipId => [testId, testId, ...]
const ipipIndex = {};

ipipFiles.forEach((file) => {
    const content = JSON.parse(fs.readFileSync(`www/data/ipip/${file}`));

    Object.entries(content).forEach(([ipipId, testIds]) => {
        const newTestIds = [...(ipipIndex[ipipId] || []), ...testIds];
        ipipIndex[ipipId] = [...new Set(newTestIds)];
    });
})


