import { expect, it } from 'vitest';
import { nativeModeSetting } from '../../packages/vscode-graphqlsp/src/typescript7/nativeMode';

it('lets a workspace legacy setting override a global current setting', () => {
  expect(
    nativeModeSetting({ globalValue: true }, { workspaceValue: false })
  ).toBe(false);
  expect(
    nativeModeSetting({ globalValue: false }, { workspaceValue: true })
  ).toBe(true);
});
it('lets workspace-folder settings win and current keys win ties', () => {
  expect(
    nativeModeSetting({ workspaceValue: false }, { workspaceFolderValue: true })
  ).toBe(true);
  expect(
    nativeModeSetting({ workspaceValue: false }, { workspaceValue: true })
  ).toBe(false);
  expect(nativeModeSetting({ globalValue: true }, { globalValue: false })).toBe(
    true
  );
});
it('uses explicit language values and does not mistake defaults for an override', () => {
  expect(
    nativeModeSetting({ globalValue: true, globalLanguageValue: false })
  ).toBe(false);
  expect(nativeModeSetting({ defaultValue: false })).toBeUndefined();
  expect(nativeModeSetting()).toBeUndefined();
});
