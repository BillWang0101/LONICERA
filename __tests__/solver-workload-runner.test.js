const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectManifestEntries } = require('../solver-workload-runner');

describe('solver workload runner helpers', () => {
  test('selects manifest slices by start/end/maxParts', () => {
    const index = {
      manifests: [
        { path: '/tmp/part-001.json', filename: 'part-001.json' },
        { path: '/tmp/part-002.json', filename: 'part-002.json' },
        { path: '/tmp/part-003.json', filename: 'part-003.json' },
        { path: '/tmp/part-004.json', filename: 'part-004.json' },
      ],
    };

    expect(selectManifestEntries(index, { startPart: 2, endPart: 3 })).toEqual([
      { path: '/tmp/part-002.json', filename: 'part-002.json' },
      { path: '/tmp/part-003.json', filename: 'part-003.json' },
    ]);

    expect(selectManifestEntries(index, { startPart: 2, maxParts: 1 })).toEqual([
      { path: '/tmp/part-002.json', filename: 'part-002.json' },
    ]);
  });
});
