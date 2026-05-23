import type { ContentBlock } from './types';

export function contentText(block: ContentBlock): string {
  if ('text' in block && typeof block.text === 'string') {
    return block.text;
  }
  return '';
}
