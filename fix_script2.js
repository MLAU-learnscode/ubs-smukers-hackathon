const fs = require('fs');
const code = fs.readFileSync('server/src/controllers/kanCheongController.js', 'utf-8');

// There's a problem: 'factor' inside 'activeEnd \!== null' block was calculated differently for different overlaps.
/*
What if multiple obstructions start within activeEnd? 
Let's just iterate over all obstructions properly by finding the next "event" time.
Any start or end time forms an event. The factor is the min of all active obstructions, or 1.0 if none.
*/

const newTraverse = `function traverse(entryTime, baseDuration, obsList) {
  let remaining = baseDuration;
  if (remaining === 0) return entryTime;
  if (obsList.length === 0) return entryTime + remaining;
  let t = entryTime;

  while (true) {
    let factor = 1.0;
    
    // Calculate current factor
    for (const [s, e, f] of obsList) {
      if (s <= t && t < e) {
        if (f < factor) factor = f;
      }
    }
    
    if (factor === 0) return null;

    // Find next event time > t
    let nextEvent = null;
    for (const [s, e] of obsList) {
      if (s > t && (nextEvent === null || s < nextEvent)) nextEvent = s;
      if (e > t && (nextEvent === null || e < nextEvent)) nextEvent = e;
    }

    if (nextEvent === null) {
      return t + remaining / factor;
    } else {
      const available = nextEvent - t;
      const progressPossible = available * factor;
      if (progressPossible >= remaining) {
        return t + remaining / factor;
      } else {
        remaining -= progressPossible;
        t = nextEvent;
      }
    }
  }
}`;

const oldStart = 'function traverse(entryTime, baseDuration, obsList) {';
const oldEnd = '  }'; // Find the full block for replacement

let fixed = code.replace(/function traverse\([\s\S]*?\}\n\}/, newTraverse);
fs.writeFileSync('server/src/controllers/kanCheongController.js', fixed);
