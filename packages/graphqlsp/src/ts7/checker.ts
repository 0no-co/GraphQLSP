import type { HostChecker } from '../host';

/** Adapts a TypeScript 7.1 API checker to the TypeScript 5/6 checker API
 * that GraphQLSP's diagnostics use.
 *
 * @remarks
 * The TypeScript 7.1 API differs from TypeScript 5/6 where the checker hands
 * out objects:
 * - symbols' `declarations` and `valueDeclaration` are node handles, which
 *   have to be resolved to nodes against the project
 * - types have `getTypes()` instead of `types`, and no `isUnionOrIntersection()`
 * - types' `symbol` is a reference rather than a symbol (`getSymbol()`)
 *
 * Symbols, types, and signatures are wrapped in proxies providing these, and
 * are unwrapped again when they're passed back to the checker.
 */
export const createChecker = (checker: any, project: any): HostChecker => {
  const targets = new WeakMap<object, object>();
  const proxies = new WeakMap<object, object>();

  const unwrap = (value: any): any => {
    if (value && typeof value === 'object') {
      const target = targets.get(value);
      if (target) return target;
      if (Array.isArray(value)) return value.map(unwrap);
    }
    return value;
  };

  const resolveHandle = (handle: any): any => {
    if (!handle || typeof handle.resolve !== 'function') return handle;
    try {
      return handle.resolve(project);
    } catch (_error) {
      return undefined;
    }
  };

  const createProxy = <T extends object>(
    target: T,
    get: (target: any, key: PropertyKey) => { value: any } | undefined
  ): T => {
    let proxy = proxies.get(target) as T | undefined;
    if (!proxy) {
      const cache = new Map<PropertyKey, { value: any }>();
      proxy = new Proxy(target, {
        get(target, key) {
          let entry = cache.get(key);
          if (!entry) {
            entry = get(target, key);
            if (entry) {
              cache.set(key, entry);
            } else {
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          }
          return entry.value;
        },
      });
      proxies.set(target, proxy);
      targets.set(proxy, target);
    }
    return proxy;
  };

  const isSymbol = (value: any) =>
    'escapedName' in value && 'declarations' in value;
  const isType = (value: any) =>
    typeof value.getTypes === 'function' && 'flags' in value;
  const isSignature = (value: any) =>
    typeof value.getReturnType === 'function' && 'parameters' in value;

  const wrap = (value: any): any => {
    if (!value || typeof value !== 'object') {
      return value;
    } else if (Array.isArray(value)) {
      return value.map(wrap);
    } else if (targets.has(value)) {
      return value;
    } else if (isSymbol(value)) {
      return wrapSymbol(value);
    } else if (isType(value)) {
      return wrapType(value);
    } else if (isSignature(value)) {
      return wrapSignature(value);
    } else {
      return value;
    }
  };

  // Wraps a method whose arguments may be wrapped objects and whose result is wrapped
  const wrapMethod =
    (target: any, method: (...args: any[]) => any) =>
    (...args: any[]) =>
      wrap(method.apply(target, args.map(unwrap)));

  const wrapSymbol = (symbol: object) =>
    createProxy(symbol, (target, key) => {
      if (key === 'declarations') {
        const declarations = target.declarations;
        return {
          value: declarations
            ? declarations.map(resolveHandle).filter(Boolean)
            : undefined,
        };
      } else if (key === 'valueDeclaration') {
        return { value: resolveHandle(target.valueDeclaration) };
      }
      return undefined;
    });

  const wrapType = (type: object) =>
    createProxy(type, (target, key) => {
      switch (key) {
        case 'types':
          return {
            value:
              target.isUnionType() || target.isIntersectionType()
                ? wrap(target.getTypes())
                : undefined,
          };
        case 'symbol':
          return { value: wrap(target.getSymbol()) };
        case 'resolvedTypeArguments':
          return {
            value: target.isTypeReference()
              ? wrap(checker.getTypeArguments(target))
              : undefined,
          };
        case 'isUnion':
          return { value: () => target.isUnionType() };
        case 'isIntersection':
          return { value: () => target.isIntersectionType() };
        case 'isUnionOrIntersection':
          return {
            value: () => target.isUnionType() || target.isIntersectionType(),
          };
        case 'isStringLiteral':
          return { value: () => target.isStringLiteralType() };
        default: {
          const value = Reflect.get(target, key, target);
          return typeof value === 'function'
            ? { value: wrapMethod(target, value) }
            : undefined;
        }
      }
    });

  const wrapSignature = (signature: object) =>
    createProxy(signature, (target, key) => {
      if (key === 'declaration') {
        return { value: resolveHandle(target.declaration) };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? { value: wrapMethod(target, value) }
        : undefined;
    });

  return createProxy(checker, (target, key) => {
    const value = Reflect.get(target, key, target);
    return typeof value === 'function'
      ? { value: wrapMethod(target, value) }
      : undefined;
  }) as HostChecker;
};
