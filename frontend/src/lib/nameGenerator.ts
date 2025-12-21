import {
  uniqueNamesGenerator,
  adjectives,
  animals,
  Config
} from 'unique-names-generator';

/**
 * 生成适合用作 branch 名称的简短随机单词
 * 格式：形容词-动物（例如：clever-tiger、brave-falcon、swift-dolphin）
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
 * 生成适合用作 workspace 名称的随机名字
 * 格式：形容词-动物（例如：clever-tiger）
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
 * 生成较短的名称（两个单词）
 * 格式：形容词-动物（例如：brave-falcon）
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
