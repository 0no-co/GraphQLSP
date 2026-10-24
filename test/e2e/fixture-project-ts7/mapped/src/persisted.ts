import { graphql } from './graphql.js';
import { PokemonDoc } from './Pokemon.graphql';

export const PersistedPokemon = graphql.persisted(
  'sha256:9f8ed4df6f77f52f0331b1358cedf2d35108ed8835cdb191c6b606726bf432a2',
  PokemonDoc
);

export const StalePokemon = graphql.persisted('sha256:outdated', PokemonDoc);
