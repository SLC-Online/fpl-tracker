import { json, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase-server';
import type { RequestHandler } from './$types';

// CSV team abbreviations → FPL API short names
const TEAM_MAP: Record<string, string | null> = {
	'ARS': 'ARS', 'AVL': 'AVL', 'BOU': 'BOU', 'BRE': 'BRE',
	'BRI': 'BHA', 'CHE': 'CHE', 'COV': 'COV', 'CPL': 'CRY',
	'EVE': 'EVE', 'FUL': 'FUL', 'HUL': 'HUL', 'IPS': 'IPS',
	'LEE': 'LEE', 'LIV': 'LIV', 'MCI': 'MCI', 'MUN': 'MUN',
	'NEW': 'NEW', 'NOT': 'NFO', 'SUN': 'SUN', 'TOT': 'TOT',
	'WBA': null, 'WHU': null,
};

function stripAccents(s: string): string {
	return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function cleanName(name: string): string {
	return stripAccents(
		name
			.replace(/\s*\(.*?\)\s*/g, ' ')
			.replace(/�/g, '')
			.replace(/\uFFFD/g, '')
			.replace(/[''`´]/g, "'")  // normalize apostrophes
			.replace(/[""]/g, '"')    // normalize quotes
	).toLowerCase().trim();
}

function nameSimilarity(csvName: string, apiName: string): number {
	const a = cleanName(csvName);
	const b = cleanName(apiName);

	if (a === b) return 1.0;
	if (a.includes(b) || b.includes(a)) return 0.9;

	const aParts = a.split(/\s+/);
	const bParts = b.split(/\s+/);

	if (aParts.length && bParts.length && aParts[aParts.length - 1] === bParts[bParts.length - 1]) return 0.85;

	const aMeaningful = aParts.filter(p => p.length > 1);
	const bMeaningful = bParts.filter(p => p.length > 1);
	const shared = aMeaningful.filter(p => bMeaningful.includes(p));
	if (shared.length > 0) return 0.85 + 0.05 * Math.min(shared.length, 3);

	if (aParts.length && bParts.length && aParts[0] === bParts[0] && aParts[0].length > 2) return 0.80;

	// Sequence similarity (simple LCS-based)
	const longer = a.length > b.length ? a : b;
	const shorter = a.length > b.length ? b : a;
	if (longer.length === 0) return 1.0;
	let matches = 0;
	for (let i = 0; i < shorter.length; i++) {
		if (longer.includes(shorter[i])) matches++;
	}
	return matches / longer.length * 0.7;
}

interface ApiPlayer {
	element_id: number;
	web_name: string;
	first_name: string;
	second_name: string;
	team_short: string;
}

function matchPlayer(csvName: string, csvTeamApi: string, players: ApiPlayer[]): { match: ApiPlayer | null; score: number } {
	const teamPlayers = players.filter(p => p.team_short === csvTeamApi);
	let bestMatch: ApiPlayer | null = null;
	let bestScore = 0;

	for (const p of teamPlayers) {
		const candidates = [p.web_name, `${p.first_name} ${p.second_name}`, p.second_name, p.first_name];
		for (const candidate of candidates) {
			const score = nameSimilarity(csvName, candidate);
			if (score > bestScore) {
				bestScore = score;
				bestMatch = p;
			}
		}
	}

	return { match: bestMatch, score: bestScore };
}

function parseFloat2(s: string | undefined): number | null {
	if (!s || s.trim() === '' || s.trim() === '-') return null;
	const v = parseFloat(s.trim());
	return isNaN(v) ? null : v;
}

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const csvFile = formData.get('csv') as File;
	const season = formData.get('season') as string;
	const gameweek = parseInt(formData.get('gameweek') as string);

	if (!csvFile || !season || isNaN(gameweek)) {
		throw error(400, 'Missing required fields: csv, season, gameweek');
	}

	// Read CSV content — file is latin-1 encoded, decode properly
	const rawBytes = await csvFile.arrayBuffer();
	const csvText = new TextDecoder('latin1').decode(rawBytes);
	const lines = csvText.split('\n');
	const header = lines[0];

	// Get all players from DB
	const { data: dbPlayers } = await supabaseAdmin
		.from('players')
		.select('element_id, web_name, first_name, second_name, team_id, teams!inner(short_name)');

	if (!dbPlayers) throw error(500, 'Could not load players');

	const apiPlayers: ApiPlayer[] = dbPlayers.map((p: any) => ({
		element_id: p.element_id,
		web_name: p.web_name,
		first_name: p.first_name,
		second_name: p.second_name,
		team_short: p.teams.short_name,
	}));

	// Get existing mappings
	const { data: existingMappings } = await supabaseAdmin
		.from('csv_name_mapping')
		.select('csv_name, csv_team, element_id')
		.eq('season', season)
		.not('element_id', 'is', null);

	const mappingLookup = new Map<string, number>();
	for (const m of existingMappings || []) {
		mappingLookup.set(`${m.csv_name}||${m.csv_team}`, m.element_id);
	}

	// Also get ALL mappings (any season) for fallback cross-referencing
	const { data: allMappings } = await supabaseAdmin
		.from('csv_name_mapping')
		.select('csv_name, csv_team, element_id')
		.not('element_id', 'is', null);

	const allMappingLookup = new Map<string, number>();
	for (const m of allMappings || []) {
		allMappingLookup.set(`${m.csv_name}||${m.csv_team}`, m.element_id);
	}

	// Parse and match
	let matched = 0;
	const unmatched: any[] = [];
	const lowConfidence: any[] = [];
	const imports: any[] = [];
	const newMappings: any[] = [];

	for (let i = 1; i < lines.length; i++) {
		const row = lines[i].split(',');
		if (row.length < 10) continue;

		const name = row[3]?.trim();
		const team = row[4]?.trim();
		if (!name || name === '0' || !team) continue;

		const teamApi = TEAM_MAP[team];
		if (!teamApi) continue;

		const bcv = parseFloat2(row[1]);
		const position = row[2]?.trim();
		const price = parseFloat2(row[5]);
		const wMins = parseFloat2(row[6]);
		const wUppm = parseFloat2(row[7]);
		const ppgLt = parseFloat2(row[8]);
		const fixRatioStr = row[9]?.trim().replace('%', '');
		const fixRatio = fixRatioStr && fixRatioStr !== '-' ? parseFloat(fixRatioStr) / 100 : null;

		const gwProj: (number | null)[] = [];
		for (let j = 10; j < Math.min(18, row.length); j++) {
			gwProj.push(parseFloat2(row[j]));
		}
		while (gwProj.length < 8) gwProj.push(null);

		const projSum = row.length > 18 ? parseFloat2(row[18]) : null;

		// Try existing mapping
		const key = `${name}||${team}`;
		let elementId = mappingLookup.get(key);

		// Fallback: check all-season mappings (handles name staying same across GWs)
		if (!elementId) {
			elementId = allMappingLookup.get(key) || undefined;
		}

		if (!elementId) {
			// Fuzzy match
			const { match, score } = matchPlayer(name, teamApi, apiPlayers);

			if (match && score >= 0.75) {
				elementId = match.element_id;
				newMappings.push({
					csv_name: name, csv_team: team, element_id: elementId,
					confidence: score, source: score >= 0.85 ? 'auto' : 'auto-low',
					season
				});
				if (score < 0.85) {
					lowConfidence.push({ csvName: name, team, apiName: match.web_name, score: score.toFixed(2) });
				}
			} else {
				// Check if there are ANY players on this team — if not, player might not be in FPL
				const teamPlayers = apiPlayers.filter(p => p.team_short === teamApi);
				const notInFpl = !match || (teamPlayers.length > 0 && score < 0.3);
				unmatched.push({
					name, team,
					bestGuess: match?.web_name || '???',
					score: (score || 0).toFixed(2),
					reason: notInFpl ? 'Not in FPL database' : 'Low match confidence'
				});
				continue;
			}
		}

		matched++;
		imports.push({
			season, gameweek, element_id: elementId,
			csv_name: name, csv_team: team, position,
			bcv, projected_sum: projSum, csv_price: price,
			weighted_minutes: wMins, weighted_uppm: wUppm,
			ppg_longer_term: ppgLt, fixture_ratio: fixRatio,
			gw1: gwProj[0], gw2: gwProj[1], gw3: gwProj[2], gw4: gwProj[3],
			gw5: gwProj[4], gw6: gwProj[5], gw7: gwProj[6], gw8: gwProj[7],
		});
	}

	// Write to DB
	if (newMappings.length > 0) {
		await supabaseAdmin.from('csv_name_mapping').upsert(newMappings, {
			onConflict: 'csv_name,csv_team,season'
		});
	}

	if (imports.length > 0) {
		// Batch insert in chunks of 100
		for (let i = 0; i < imports.length; i += 100) {
			const chunk = imports.slice(i, i + 100);
			await supabaseAdmin.from('csv_imports').upsert(chunk, {
				onConflict: 'season,gameweek,element_id'
			});
		}
	}

	const total = matched + unmatched.length;
	return json({
		matched,
		total,
		matchRate: total > 0 ? ((matched / total) * 100).toFixed(1) : '0',
		unmatched,
		lowConfidence
	});
};
