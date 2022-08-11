import ts from "typescript/lib/tsserverlibrary";

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
}

function create(info: ts.server.PluginCreateInfo) {
  // const config = info.config;
  // TODO: get schema, this should be derived from the above config
  // the config here are the additional options passed to the plugin in the tsconfig

  const proxy = createBasicDecorator(info);

  proxy.getCompletionsAtPosition = (filename: string, position: number, options: ts.GetCompletionsAtPositionOptions | undefined, formattingSettings?: ts.FormatCodeSettings | undefined) => {
    // Can be used to autocomplete stuff, i.e. we can detect when we are in an invocation of gql`` or someone dong /** GraphQL */ to activate this
    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: []
    };
  }

  // TODO: how to hook into TypeScript to show errors
  // TODO: we have to register fragments we find in invocations of gql for auto-completion
  // TODO: should we auto-generate typed-document nodes for the result of gql`` invocations?

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export default init;
