const { config } = require('dotenv');
const { getCommitInfo } = require('@changesets/get-github-info');

config();

const REPO = '0no-co/GraphQLSP';
const SEE_LINE = /^See:\s*(.*)/i;
const TRAILING_CHAR = /[.;:]$/g;
const listFormatter = new Intl.ListFormat('en-US');

const getCommitLinks = async commit => {
  const info = await getCommitInfo({ repo: REPO, commit });
  return {
    commit: info?.commit.markdownLink,
    pull: info?.pull?.markdownLink,
    user: info?.author?.markdownLink,
  };
};

const getSummaryLines = cs => {
  let lines = cs.summary.trim().split(/\r?\n/);
  if (!lines.some(line => /```/.test(line))) {
    lines = lines.map(l => l.trim()).filter(Boolean);
    const size = lines.length;
    if (size > 0) {
      lines[size - 1] = lines[size - 1].replace(TRAILING_CHAR, '');
    }
  }
  return lines;
};

/** Creates a "(See X)" string from a template */
const templateSeeRef = links => {
  const humanReadableLinks = links.filter(Boolean).map(link => {
    if (typeof link === 'string') return link;
    return link.pull || link.commit;
  });

  const size = humanReadableLinks.length;
  if (size === 0) return '';

  const str = listFormatter.format(humanReadableLinks);
  return `(See ${str})`;
};

const changelogFunctions = {
  getDependencyReleaseLine: async (changesets, dependenciesUpdated) => {
    if (dependenciesUpdated.length === 0) return '';

    const dependenciesLinks = await Promise.all(
      changesets.map(async cs => {
        if (!cs.commit) return undefined;

        const lines = getSummaryLines(cs);
        const prLine = lines.find(line => SEE_LINE.test(line));
        if (prLine) {
          const match = prLine.match(SEE_LINE);
          return (match && match[1].trim()) || undefined;
        }

        return getCommitLinks(cs.commit);
      })
    );

    let changesetLink = '- Updated dependencies';

    const seeRef = templateSeeRef(dependenciesLinks);
    if (seeRef) changesetLink += ` ${seeRef}`;

    const detailsLinks = dependenciesUpdated.map(dep => {
      return `  - ${dep.name}@${dep.newVersion}`;
    });

    return [changesetLink, ...detailsLinks].join('\n');
  },
  getReleaseLine: async (changeset, type) => {
    let pull, commit, user;

    const lines = getSummaryLines(changeset);
    const prLineIndex = lines.findIndex(line => SEE_LINE.test(line));
    if (prLineIndex > -1) {
      const match = lines[prLineIndex].match(SEE_LINE);
      pull = (match && match[1].trim()) || undefined;
      lines.splice(prLineIndex, 1);
    }

    const [firstLine, ...futureLines] = lines;

    if (changeset.commit && !pull) {
      const links = await getCommitLinks(changeset.commit);

      pull = links.pull;
      commit = links.commit;
      user = links.user;
    }

    let annotation = '';
    if (type === 'patch' && /^\s*fix/i.test(firstLine)) {
      annotation = '⚠️ ';
    }

    let str = `- ${annotation}${firstLine}`;
    if (futureLines.length > 0) {
      str += `\n${futureLines.map(l => `  ${l}`).join('\n')}`;
    }

    const endsWithParagraph = /(?<=(?:[!;?.]|```) *)$/g;
    if (user && !endsWithParagraph) {
      str += `, by ${user}`;
    } else {
      str += `\nSubmitted by ${user}`;
    }

    if (pull || commit) {
      const seeRef = templateSeeRef([pull || commit]);
      if (seeRef) str += ` ${seeRef}`;
    }

    return str;
  },
};

module.exports = {
  ...changelogFunctions,
  default: changelogFunctions,
};
