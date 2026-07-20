import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './weak-module.mjs';

// Deliberately weak: only exercises the trivial n===0 path, leaving every comparison operator
// (>, <, >=) totally unpinned — a mutant flipping any of them should SURVIVE.
test('zero', () => assert.equal(classify(0), 'zero'));
