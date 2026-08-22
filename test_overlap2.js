const obsList = [[0, 10, 0.8], [2, 10, 0.1]];
let t = 0;

  while (true) {
    let activeFactor = 1.0;
    let activeEnd = null;

    for (const [s, e, factor] of obsList) {
      if (s <= t && t < e) {
        if (activeEnd === null || factor < activeFactor) {
          activeFactor = factor;
          // activeEnd calculation is buggy if a new slower obstruction starts before this one ends.
          activeEnd = activeEnd === null ? e : Math.min(activeEnd, e);
        }
      }
    }
    console.log(`t: ${t}, factor: ${activeFactor}, end: ${activeEnd}`);
    break;
  }
