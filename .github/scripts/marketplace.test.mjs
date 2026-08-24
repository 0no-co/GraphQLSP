import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { marketplaceVersionExists } from './marketplace.mjs';

const manifest = {
  name: 'vscode-graphqlsp',
  publisher: '0no-co',
  version: '0.1.0',
};

const response = body => ({
  ok: true,
  json: async () => body,
});

const galleryResult = extensions => ({ results: [{ extensions }] });

describe('marketplaceVersionExists', () => {
  it('finds an exact published extension version', async () => {
    const fetchImpl = async (_url, options) => {
      const query = JSON.parse(options.body);
      assert.equal(
        query.filters[0].criteria[0].value,
        '0no-co.vscode-graphqlsp'
      );
      return response(
        galleryResult([
          {
            publisher: { publisherName: '0no-co' },
            extensionName: 'vscode-graphqlsp',
            versions: [{ version: '0.2.0' }, { version: '0.1.0' }],
          },
        ])
      );
    };

    assert.equal(await marketplaceVersionExists(manifest, fetchImpl), true);
  });

  it('reports an unpublished version or extension', async () => {
    const otherVersion = async () =>
      response(
        galleryResult([
          {
            publisher: { publisherName: '0no-co' },
            extensionName: 'vscode-graphqlsp',
            versions: [{ version: '0.0.1' }],
          },
        ])
      );
    const missingExtension = async () => response(galleryResult([]));

    assert.equal(await marketplaceVersionExists(manifest, otherVersion), false);
    assert.equal(
      await marketplaceVersionExists(manifest, missingExtension),
      false
    );
  });

  it('fails closed on request and response errors', async () => {
    const failedRequest = async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    });
    const malformedResponse = async () => response({ results: [] });

    await assert.rejects(
      marketplaceVersionExists(manifest, failedRequest),
      /503 Unavailable/
    );
    await assert.rejects(
      marketplaceVersionExists(manifest, malformedResponse),
      /invalid response/
    );
  });
});
