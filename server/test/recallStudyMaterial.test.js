// Run with: node test/recallStudyMaterial.test.js
const assert = require("assert");
const {
  countTokens,
  selectPassages,
  splitIntoPassages,
} = require("../src/mcp/tools/recallStudyMaterial");

const doc = `
The sensor grid drifted out of calibration during the spring maintenance window.

Records show the sensor grid was last brought back into alignment on 14 March, after
technicians replaced the drift-prone gyroscope housing.

Unrelated: the canteen switched to a new supplier for rice on 2 February.

The archive vault humidity control was serviced on 9 January and has been stable since.
`;

const passages = splitIntoPassages(doc);
assert.ok(passages.length >= 3, "should split into multiple passages");

const selected = selectPassages(passages, "When was the sensor grid last brought back into alignment?");
assert.ok(selected.length > 0, "should select at least one passage");
assert.ok(
  selected.some((p) => p.includes("14 March")),
  "top passage should contain the answer fact"
);

const totalTokens = selected.reduce((sum, p) => sum + countTokens(p), 0);
assert.ok(totalTokens <= 900, `selected passages must fit the 900 token budget, got ${totalTokens}`);

// Budget enforcement: a huge pool of relevant passages should still be capped at 900 tokens.
const bigWord = "alignment ".repeat(150); // ~150 tokens per passage
const manyPassages = Array.from({ length: 20 }, (_, i) => `Sensor grid fact ${i}: ${bigWord}`);
const bigSelection = selectPassages(manyPassages, "sensor grid alignment");
const bigTotal = bigSelection.reduce((sum, p) => sum + countTokens(p), 0);
assert.ok(bigTotal <= 900, `must respect 900 token cap under heavy relevance, got ${bigTotal}`);

console.log("recallStudyMaterial.test.js: all assertions passed");
