import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectStructureV6FibQualifiedRange } from '../structureV6Engine';
import { CURRENT_ALGORITHM_VERSION, ALGORITHM_VERSION_V6_REV3 } from '../structureTypes';
import { StructureEngine } from '../structureEngine';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('V6 production selection paths', () => {
  it('declares REV3 as the current/default V6 version', () => {
    assert.equal(CURRENT_ALGORITHM_VERSION, ALGORITHM_VERSION_V6_REV3);
    assert.equal(detectStructureV6FibQualifiedRange([]).algorithmVersion, ALGORITHM_VERSION_V6_REV3);
    assert.equal(new StructureEngine().detectStructure([]).algorithmVersion, ALGORITHM_VERSION_V6_REV3);
  });

  it('has no parameter-shape based dispatcher and keeps legacy versions explicit', () => {
    const source = read('../structureEngine.ts');
    assert.doesNotMatch(source, /initialSeed\s*&&\s*!version/);
    assert.doesNotMatch(source, /legacyPivotOverlay\s*&&\s*!version/);
    assert.doesNotMatch(source, /lookbackCandles\s*&&[^\n]+!version/);
    assert.match(source, /version === ALGORITHM_VERSION_V2/);
  });

  it('forces candle sync persistence through CURRENT_ALGORITHM_VERSION, never V2', () => {
    const source = read('../../marketData/candleService.ts');
    assert.match(source, /detectAndSaveStructure[\s\S]+algorithmVersion: CURRENT_ALGORITHM_VERSION/);
    assert.doesNotMatch(source, /detectAndSaveStructure[\s\S]{0,250}ALGORITHM_VERSION_V2/);
  });

  it('forces the atomic Setup Lab snapshot through CURRENT_ALGORITHM_VERSION', () => {
    const route = read('../../marketData/marketRoutes.ts');
    const service = read('../../../src/services/setupLabService.ts');
    assert.match(route, /setup-lab\/snapshot[\s\S]+algorithmVersion: CURRENT_ALGORITHM_VERSION/);
    assert.match(service, /getSnapshot[\s\S]+algorithmVersion: CURRENT_ALGORITHM_VERSION/);
  });

  it('requires an explicit algorithm version for persistence retrieval', () => {
    const source = read('../structureRepository.ts');
    assert.doesNotMatch(source, /algorithmVersion:\s*string\s*=/);
    assert.doesNotMatch(source, /STRUCTURE_V1/);
  });
});
