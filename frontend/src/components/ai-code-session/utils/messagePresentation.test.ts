import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./messagePresentation');
  } catch (error) {
    assert.fail(`messagePresentation module not implemented: ${error}`);
  }
}

test('classifies skill preamble text as collapsed by default', async () => {
  const { classifyCollapsibleText } = await loadModule();

  const text = `Base directory for this skill: /Users/rubin/.claude/plugins/cache/superpowers-marketplace/superpowers/3.6.2/skills/executing-plans\n\n## Executing Plans\n\n## Overview\nLoad plan, review critically, execute tasks in batches, report for review between batches.\n\n- **Core principle:** Batch execution with checkpoints for architect review.\n- **Announce at start:** \"I'm using the executing-plans skill to implement this plan.\"`;

  const result = classifyCollapsibleText(text);

  assert.equal(result.kind, 'skill_preamble');
  assert.equal(result.collapsible, true);
  assert.equal(result.defaultExpanded, false);
  assert.match(result.title, /Skill/i);
  assert.match(result.preview, /Base directory for this skill:/);
});

test('does not collapse short plain user text', async () => {
  const { classifyCollapsibleText } = await loadModule();

  const result = classifyCollapsibleText('继续');

  assert.equal(result.collapsible, false);
  assert.equal(result.kind, 'plain_text');
});

test('collapses long structured reference text even without exact skill prefix', async () => {
  const { classifyCollapsibleText } = await loadModule();

  const text = `# Debugging Workflow\n\n## Overview\nUse this workflow before making code changes.\n\n## Step 1\nRead the failing code path first.\n\n## Step 2\nWrite a reproducer before changing production code.\n\n## Step 3\nValidate the fix with focused tests and then broader verification.\n\n- Confirm the failure mode\n- Confirm the expected behavior\n- Confirm no unrelated regressions`;

  const result = classifyCollapsibleText(text);

  assert.equal(result.kind, 'structured_reference');
  assert.equal(result.collapsible, true);
  assert.equal(result.defaultExpanded, false);
});

test('builds collapsible metadata for user string messages', async () => {
  const { getUserMessagePresentation } = await loadModule();

  const result = getUserMessagePresentation({
    type: 'user',
    message: {
      content: `Base directory for this skill: /tmp/skill\n\n## Overview\nLong instruction body\n\n- step 1\n- step 2`,
    },
  });

  assert.equal(result.textKind, 'skill_preamble');
  assert.equal(result.collapsible, true);
  assert.equal(result.defaultExpanded, false);
});

test('builds collapsible metadata for user text content blocks', async () => {
  const { getUserMessagePresentation } = await loadModule();

  const result = getUserMessagePresentation({
    type: 'user',
    message: {
      content: [
        {
          type: 'text',
          text: `Base directory for this skill: /tmp/skill\n\n## Testing Anti-Patterns\n\n## Overview\nTests must verify real behavior, not mock behavior.\n\n- Rule 1\n- Rule 2`,
        },
      ],
    },
  });

  assert.equal(result.textKind, 'skill_preamble');
  assert.equal(result.collapsible, true);
  assert.equal(result.defaultExpanded, false);
});

test('collapses continued summaries from top-level live user content', async () => {
  const { getUserMessagePresentation } = await loadModule();

  const result = getUserMessagePresentation({
    type: 'user',
    content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent:\n- Fix message card defaults\n- Keep live views consistent`,
  });

  assert.equal(result.textKind, 'structured_reference');
  assert.equal(result.collapsible, true);
  assert.equal(result.defaultExpanded, false);
  assert.equal(result.title, 'Previous conversation summary');
});
