#!/usr/bin/env node
'use strict';
require('../dist/lsp.js')
  .runLanguageServer()
  .catch(error => {
    process.stderr.write(`[graphqlsp] ${error.stack || error}\n`);
    process.exitCode = 1;
  });
