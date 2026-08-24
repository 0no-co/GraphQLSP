const marketplaceQueryUrl =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

export async function marketplaceVersionExists(manifest, fetchImpl = fetch) {
  const extensionId = `${manifest.publisher}.${manifest.name}`;
  const response = await fetchImpl(marketplaceQueryUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json;api-version=7.2-preview.1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      filters: [
        {
          criteria: [{ filterType: 7, value: extensionId }],
          pageNumber: 1,
          pageSize: 1,
          sortBy: 0,
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      // ExtensionQueryFlags.IncludeVersions
      flags: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to query ${extensionId}: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();
  const extensions = result?.results?.[0]?.extensions;
  if (!Array.isArray(extensions)) {
    throw new Error(
      `Marketplace returned an invalid response for ${extensionId}`
    );
  }

  const extension = extensions.find(
    entry =>
      `${entry.publisher?.publisherName}.${entry.extensionName}`.toLowerCase() ===
      extensionId.toLowerCase()
  );
  if (!extension) return false;
  if (!Array.isArray(extension.versions)) {
    throw new Error(`Marketplace returned no versions for ${extensionId}`);
  }

  return extension.versions.some(entry => entry.version === manifest.version);
}
