// Manual calc:
// t=0 to t=2, factor=0.8. Available = 2 * 0.8 = 1.6. Remaining = 10 - 1.6 = 8.4
// t=2 to t=10, factor=0.1. Available = 8 * 0.1 = 0.8. Remaining = 8.4 - 0.8 = 7.6
// t=10 onwards, factor=1.0. 
// Duration expected: 10 + 7.6 / 1 = 17.6s. It should arrive at 17.6s.
// But the output says 12s\!
