import { describe, expect, it } from 'vitest';
import { decideTransition, followUpDate, isActive, isFinal, pipelineRank } from './status';

describe('decideTransition', () => {
  it('always applies manual changes', () => {
    expect(decideTransition('offer', 'applied', 'manual').apply).toBe(true);
    expect(decideTransition('rejected', 'interview', 'manual').apply).toBe(true);
    expect(decideTransition('applied', 'withdrawn', 'manual').apply).toBe(true);
  });

  it('ignores no-op changes', () => {
    expect(decideTransition('applied', 'applied', 'manual').apply).toBe(false);
    expect(decideTransition('interview', 'interview', 'email').apply).toBe(false);
  });

  it('moves forward on automated signals', () => {
    expect(decideTransition('saved', 'applied', 'extension').apply).toBe(true);
    expect(decideTransition('applied', 'viewed', 'email').apply).toBe(true);
    expect(decideTransition('viewed', 'interview', 'email').apply).toBe(true);
    expect(decideTransition('applied', 'offer', 'email').apply).toBe(true);
  });

  it('never moves backwards automatically', () => {
    expect(decideTransition('interview', 'viewed', 'email').apply).toBe(false);
    expect(decideTransition('screening', 'applied', 'import').apply).toBe(false);
  });

  it('accepts rejections from any non-final status', () => {
    for (const s of ['saved', 'applied', 'viewed', 'screening', 'interview', 'ghosted'] as const) {
      expect(decideTransition(s, 'rejected', 'email').apply).toBe(true);
    }
  });

  it('protects final statuses from automation', () => {
    expect(decideTransition('offer', 'rejected', 'email').apply).toBe(false);
    expect(decideTransition('rejected', 'interview', 'email').apply).toBe(false);
    expect(decideTransition('withdrawn', 'viewed', 'email').apply).toBe(false);
  });

  it('only lets people withdraw', () => {
    expect(decideTransition('applied', 'withdrawn', 'email').apply).toBe(false);
    expect(decideTransition('applied', 'withdrawn', 'system').apply).toBe(false);
  });

  it('ghosts only active applications, only from the system', () => {
    expect(decideTransition('applied', 'ghosted', 'system').apply).toBe(true);
    expect(decideTransition('interview', 'ghosted', 'system').apply).toBe(true);
    expect(decideTransition('saved', 'ghosted', 'system').apply).toBe(false);
    expect(decideTransition('applied', 'ghosted', 'email').apply).toBe(false);
  });

  it('revives ghosted applications on new activity', () => {
    expect(decideTransition('ghosted', 'viewed', 'email').apply).toBe(true);
    expect(decideTransition('ghosted', 'applied', 'email').apply).toBe(true);
    expect(decideTransition('ghosted', 'saved', 'import').apply).toBe(false);
  });
});

describe('status helpers', () => {
  it('ranks the pipeline', () => {
    expect(pipelineRank('saved')).toBe(0);
    expect(pipelineRank('offer')).toBe(5);
    expect(pipelineRank('rejected')).toBeNull();
  });

  it('classifies active and final statuses', () => {
    expect(isActive('screening')).toBe(true);
    expect(isActive('saved')).toBe(false);
    expect(isFinal('withdrawn')).toBe(true);
    expect(isFinal('ghosted')).toBe(false);
  });

  it('computes follow-up dates in UTC', () => {
    expect(followUpDate('2026-01-30T15:00:00.000Z', 7)).toBe('2026-02-06T15:00:00.000Z');
  });
});
