import { describe, expect, it } from 'vitest';
import {
  canonicalPlace,
  describeLocation,
  findMetro,
  inMetro,
  isNationwide,
  matchPlace,
  SF_BAY_AREA,
  stateCode,
} from './locations';

describe('metro areas', () => {
  it('recognises the Bay Area by any of its names', () => {
    for (const name of [
      'San Francisco Bay Area',
      'SF Bay Area',
      'Bay Area',
      'bay area, CA',
      'Silicon Valley',
    ]) {
      expect(findMetro(name)?.name).toBe('San Francisco Bay Area');
      expect(canonicalPlace(name)).toBe('San Francisco Bay Area');
    }
    expect(findMetro('San Francisco, CA')).toBeNull();
    expect(canonicalPlace('Austin, TX')).toBe('Austin, TX');
  });

  it('treats "United States" and friends as the whole country', () => {
    for (const name of ['United States', 'USA', 'US', 'Anywhere in the US', 'Nationwide']) {
      expect(isNationwide(name)).toBe(true);
      expect(canonicalPlace(name)).toBeNull();
    }
    expect(isNationwide('Austin, TX')).toBe(false);
  });

  it('puts Bay Area cities in the metro, with or without a state', () => {
    for (const where of [
      'San Francisco, CA',
      'South San Francisco, California',
      'Oakland',
      'Emeryville, CA',
      'Palo Alto, CA, United States',
      'Mountain View, CA (Hybrid)',
      'San Jose, CA 95113',
      'Menlo Park, CA; Seattle, WA',
      'Remote - San Francisco Bay Area',
      'Bay Area, CA',
    ]) {
      expect(inMetro(SF_BAY_AREA, where), where).toBe(true);
    }
  });

  it('keeps same-named places elsewhere out', () => {
    for (const where of [
      'Dublin, Ireland',
      'Dublin',
      'Dublin, OH',
      'Newark, NJ',
      'Concord, NH',
      'Oakland, MI',
      'San Jose, Costa Rica',
      'Berkeley Heights, New Jersey',
      'San Diego, CA',
      'Richmond, VA',
    ]) {
      expect(inMetro(SF_BAY_AREA, where), where).toBe(false);
    }
    expect(inMetro(SF_BAY_AREA, 'Dublin, CA')).toBe(true);
    expect(inMetro(SF_BAY_AREA, 'Newark, California')).toBe(true);
  });
});

describe('states', () => {
  it('reads state codes and names', () => {
    expect(stateCode('TX')).toBe('tx');
    expect(stateCode(' california ')).toBe('ca');
    expect(stateCode('Texas 78701')).toBe('tx');
    expect(stateCode('Remote')).toBeNull();
    expect([...describeLocation('Charleston, West Virginia').states]).toEqual(['wv']);
    expect([...describeLocation('Austin, TX').states]).toEqual(['tx']);
    expect(describeLocation('Remote - US').states.size).toBe(0);
    expect(describeLocation('Santa Fe, New Mexico').foreign).toBe(false);
    expect(describeLocation('Toronto, Canada').foreign).toBe(true);
  });
});

describe('matchPlace', () => {
  it('scores metros, cities and states', () => {
    expect(matchPlace('San Francisco Bay Area', 'Sunnyvale, CA')).toBe('match');
    expect(matchPlace('Bay Area', 'Los Angeles, CA')).toBe('same_state');
    expect(matchPlace('Bay Area', 'Denver, CO')).toBe('elsewhere');
    expect(matchPlace('San Jose, CA', 'San Francisco Bay Area')).toBe('match');
    expect(matchPlace('Austin, TX', 'Austin, Travis County')).toBe('match');
    expect(matchPlace('Austin, TX', 'Austin, MN')).toBe('elsewhere');
    expect(matchPlace('Austin, TX', 'Dallas, TX')).toBe('same_state');
    expect(matchPlace('Texas', 'Dallas, TX')).toBe('match');
    expect(matchPlace('78701', 'Dallas, TX')).toBe('unknown');
  });
});
