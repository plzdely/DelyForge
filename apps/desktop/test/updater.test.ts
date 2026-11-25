import { describe, expect, it } from 'vitest';
import { isNewer, parseLatestYml } from '../src/main/updater';

describe('local updater', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.2.1', '0.2.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
  });

  it('reads electron-builder’s latest.yml and refuses odd installer paths', () => {
    const yml = "version: 0.2.1\nfiles:\n  - url: DelyForge-Setup-0.2.1.exe\n    sha512: abc+/=\n    size: 1\npath: DelyForge-Setup-0.2.1.exe\nsha512: abc+/=\nreleaseDate: '2026-11-25T07:00:00.692Z'\n";
    expect(parseLatestYml(yml)).toEqual({ version: '0.2.1', path: 'DelyForge-Setup-0.2.1.exe', sha512: 'abc+/=' });
    expect(parseLatestYml(yml.replace('path: DelyForge', 'path: ..\\evil\\DelyForge'))).toBeNull();
    expect(parseLatestYml('nonsense')).toBeNull();
  });
});
