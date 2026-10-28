interface Inspection {
  defaultValue?: boolean;
  globalValue?: boolean;
  workspaceValue?: boolean;
  workspaceFolderValue?: boolean;
  globalLanguageValue?: boolean;
  workspaceLanguageValue?: boolean;
  workspaceFolderLanguageValue?: boolean;
}

/** Mirrors native-preview's precedence between its new key and legacy alias. */
export function nativeModeSetting(
  current?: Inspection,
  legacy?: Inspection
): boolean | undefined {
  const value = (inspection?: Inspection): boolean | undefined =>
    inspection &&
    (inspection.workspaceFolderLanguageValue ??
      inspection.workspaceLanguageValue ??
      inspection.globalLanguageValue ??
      inspection.workspaceFolderValue ??
      inspection.workspaceValue ??
      inspection.globalValue);
  const scope = (inspection?: Inspection) =>
    inspection?.workspaceFolderValue !== undefined
      ? 3
      : inspection?.workspaceValue !== undefined
        ? 2
        : inspection?.globalValue !== undefined
          ? 1
          : undefined;
  const currentValue = value(current),
    legacyValue = value(legacy);
  if (currentValue === undefined && legacyValue === undefined) return undefined;
  const currentScope = scope(current),
    legacyScope = scope(legacy);
  const winner = Math.max(currentScope ?? 1, legacyScope ?? 1);
  return currentScope === winner ? currentValue : legacyValue;
}
