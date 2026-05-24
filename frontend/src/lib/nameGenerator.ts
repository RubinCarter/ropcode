import {
  uniqueNamesGenerator,
  adjectives,
  animals,
  Config
} from 'unique-names-generator';

/**
 * Generate short random words suitable for branch names
 * Format: adjective-animal (e.g.: clever-tiger, brave-falcon, swift-dolphin)
 */
export function generateBranchName(): string {
  const config: Config = {
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  };

  return uniqueNamesGenerator(config);
}

/**
 * Generate random names suitable for workspace names
 * Format: adjective-animal (e.g.: clever-tiger)
 */
export function generateWorkspaceName(): string {
  const config: Config = {
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  };

  return uniqueNamesGenerator(config);
}

/**
 * Generate shorter names (two words)
 * Format: adjective-animal (e.g.: brave-falcon)
 */
export function generateShortName(): string {
  const config: Config = {
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  };

  return uniqueNamesGenerator(config);
}
