import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKv1 } from './kv1.ts';

test('parses nested keyvalues and merges repeated blocks', () => {
	const parsed = parseKv1(`"items_game"
{
	// comment
	"paint_kits"
	{
		"941" { "name" "cu_ak-47_phantom_disruptor" "style" "7" }
	}
	"paint_kits"
	{
		"942" { "name" "gs_aug_thunderstorm" }
	}
	plain value
	"escaped" "a\\"b"
}`);
	const game = parsed.items_game as Record<string, Record<string, Record<string, string>>>;
	assert.equal(game.paint_kits!['941']!.name, 'cu_ak-47_phantom_disruptor');
	assert.equal(game.paint_kits!['942']!.name, 'gs_aug_thunderstorm');
	assert.equal((parsed.items_game as Record<string, string>).plain, 'value');
	assert.equal((parsed.items_game as Record<string, string>).escaped, 'a"b');
});
