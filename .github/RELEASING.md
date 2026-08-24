# Releasing

Releases are managed by Changesets through `.github/workflows/release.yaml`.
Merging the generated `Version Packages` pull request stages unpublished npm
packages and publishes unpublished versions of `vscode-graphqlsp` to the VS
Code Marketplace. The protected `npm` GitHub environment gates both release
channels.

## VS Code Marketplace setup

Marketplace publishing uses `vsce publish --azure-credential` with Microsoft
Entra workload identity federation. It does not use a long-lived Personal
Access Token.

Before enabling the workflow:

1. Create an Entra application and service principal for Marketplace
   publishing.
2. Add a federated credential that trusts GitHub's OIDC issuer for
   `repo:0no-co/GraphQLSP:environment:npm` with audience
   `api://AzureADTokenExchange`.
3. Add the service principal to the `0no-co` Visual Studio Marketplace
   publisher with permission to publish extensions.
4. Configure these GitHub variables for the protected `npm` environment:
   - `VSCE_AZURE_CLIENT_ID`
   - `VSCE_AZURE_TENANT_ID`

## Versioning the extension

`vscode-graphqlsp` is private on npm, but Changesets versions it and generates
its changelog. Include it in a changeset whenever extension code changes or a
new bundled `@0no-co/graphqlsp` version should reach Marketplace users. The
extension and npm package versions remain independent.

The release check queries both npm and the Marketplace. An extension-only
release therefore still starts the publish job. The workflow packages the VSIX
before mutating remote release state, stages npm packages, publishes the exact
VSIX, and then lets `changesets/action` push tags and create GitHub releases.

npm staging and Marketplace publishing are not atomic. If Marketplace
publishing fails after npm staging, inspect or discard the existing npm stage
before rerunning the workflow.
