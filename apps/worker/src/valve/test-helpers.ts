import { encodeMatch } from 'csgo-sharecode';
import { parseShareCode } from '@cs-demo-cloud/shared';

export { createStorage, type Storage } from '@cs-demo-cloud/shared';

export function encodeShareCodeForTest(matchId: bigint) {
	const code = encodeMatch({ matchId, reservationId: matchId + 1n, tvPort: 27015 });
	const parsed = parseShareCode(code);
	if (parsed?.matchId !== matchId.toString())
		throw new Error(`Could not encode a share code for ${matchId}`);
	return parsed!;
}
