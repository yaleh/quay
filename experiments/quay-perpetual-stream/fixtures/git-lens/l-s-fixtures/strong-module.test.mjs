import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './strong-module.mjs';

test('zero', () => assert.equal(classify(0), 'zero'));
test('small positive lower bound', () => assert.equal(classify(1), 'small-positive'));
test('small positive upper bound', () => assert.equal(classify(9), 'small-positive'));
test('large positive boundary', () => assert.equal(classify(10), 'large-positive'));
test('large positive', () => assert.equal(classify(20), 'large-positive'));
test('negative', () => assert.equal(classify(-5), 'negative'));
