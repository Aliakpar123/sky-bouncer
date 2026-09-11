import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeApplication,
  esc,
  parseApproveArgs,
  parseRejectArgs,
  resolveApplication,
  shortId,
} from './format.js';

test('esc neutralises HTML in applicant-supplied text', () => {
  assert.equal(esc('<b>Cafe</b>'), '&lt;b&gt;Cafe&lt;/b&gt;');
  assert.equal(esc('Tom & Jerry'), 'Tom &amp; Jerry');
  // Ampersand must be escaped first, or the escapes themselves get mangled.
  assert.equal(esc('&lt;'), '&amp;lt;');
  assert.equal(esc(null), '');
});

test('a venue name cannot inject markup into the admin listing', () => {
  const message = describeApplication({
    id: 'abcdef12-1111-2222-3333-444444444444',
    name: '<b>Totally Legit</b>',
    offer_title: 'Free <i>everything</i>',
    contact: '@ok',
    lat: 41.31,
    lng: 69.28,
  });

  assert.ok(!message.includes('<b>Totally Legit</b>'));
  assert.ok(message.includes('&lt;b&gt;Totally Legit&lt;/b&gt;'));
  assert.ok(!message.includes('<i>everything</i>'));
  // The tags the message adds itself are still there.
  assert.ok(message.includes('<code>abcdef12</code>'));
});

test('optional fields are omitted rather than rendered empty', () => {
  const message = describeApplication({
    id: 'abcdef12-1111-2222-3333-444444444444',
    name: 'Corner Cafe',
    offer_title: 'Free tea',
    lat: 41.31,
    lng: 69.28,
  });

  assert.ok(!message.includes('Category:'));
  assert.ok(!message.includes('Contact:'));
});

test('shortId takes the first eight characters', () => {
  assert.equal(shortId('abcdef12-1111-2222-3333-444444444444'), 'abcdef12');
});

test('parseApproveArgs defaults the reward and validates the range', () => {
  assert.deepEqual(parseApproveArgs('abcdef12'), { handle: 'abcdef12', rewardPoints: 150 });
  assert.deepEqual(parseApproveArgs('  abcdef12   200 '), {
    handle: 'abcdef12',
    rewardPoints: 200,
  });

  assert.ok(parseApproveArgs('').error);
  assert.ok(parseApproveArgs('abcdef12 -5').error);
  assert.ok(parseApproveArgs('abcdef12 5000').error);
  assert.ok(parseApproveArgs('abcdef12 1e3').error);
  assert.ok(parseApproveArgs('abcdef12 abc').error);
  assert.ok(parseApproveArgs('abcdef12 12.5').error);
  // A stray third argument is a typo, not an approval at some other price.
  assert.ok(parseApproveArgs('abcdef12 200 oops').error);
});

test('parseRejectArgs keeps the whole reason', () => {
  assert.deepEqual(parseRejectArgs('abcdef12 outside our coverage area'), {
    handle: 'abcdef12',
    reason: 'outside our coverage area',
  });
  assert.deepEqual(parseRejectArgs('abcdef12'), { handle: 'abcdef12', reason: null });
  assert.ok(parseRejectArgs('   ').error);
});

test('resolveApplication refuses an ambiguous handle instead of guessing', () => {
  const apps = [
    { id: 'abcdef12-1111-1111-1111-111111111111', name: 'One' },
    { id: 'abcdef12-2222-2222-2222-222222222222', name: 'Two' },
    { id: 'beef0000-3333-3333-3333-333333333333', name: 'Three' },
  ];

  assert.equal(resolveApplication(apps, 'beef0000').application.name, 'Three');
  assert.ok(resolveApplication(apps, 'abcdef12').error);
  assert.ok(resolveApplication(apps, 'nothere0').error);
  assert.ok(resolveApplication([], 'beef0000').error);
});

test('handles are matched case-insensitively', () => {
  const apps = [{ id: 'abcdef12-1111-1111-1111-111111111111', name: 'One' }];
  assert.equal(resolveApplication(apps, 'ABCDEF12').application.name, 'One');
});
