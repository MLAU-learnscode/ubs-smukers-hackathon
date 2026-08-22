const fs = require('fs');
const code = fs.readFileSync('server/src/controllers/kanCheongController.js', 'utf-8');

const regex = /let minStart = null;\s*for \(const \[s\] of obsList\) \{\s*if \(s > t && \(minStart === null \|\| s < minStart\)\) minStart = s;\s*\}/g;

const replacement = `let minStart = null;
      for (const [s] of obsList) {
        if (s > t && (minStart === null || s < minStart)) minStart = s;
      }`;
      
const oldCode = `    for (const [s, e, factor] of obsList) {
      if (s <= t && t < e) {
        if (activeEnd === null || factor < activeFactor) {
          activeFactor = factor;
          activeEnd = activeEnd === null ? e : Math.min(activeEnd, e);
        }
      }
    }`;

const newCode = `    for (const [s, e, factor] of obsList) {
      if (s <= t && t < e) {
        if (activeEnd === null || factor < activeFactor) {
          activeFactor = factor;
          activeEnd = e;
        } else if (factor === activeFactor) {
          activeEnd = Math.min(activeEnd, e);
        }
      }
    }
    
    // Also need to check if another obstruction starts *during* this activeEnd, 
    // we need to break early to re-evaluate if it has a smaller factor\!
    if (activeEnd \!== null) {
      for (const [s] of obsList) {
        if (s > t && s < activeEnd) {
          activeEnd = s;
        }
      }
    }`;

let fixed = code.replace(oldCode, newCode);
fs.writeFileSync('server/src/controllers/kanCheongController.js', fixed);
