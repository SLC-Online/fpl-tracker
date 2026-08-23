// Core data types

export interface Player {
	element_id: number;
	web_name: string;
	first_name: string;
	second_name: string;
	team_id: number;
	element_type: number; // 1=GK, 2=DEF, 3=MID, 4=FWD
	code: number;
}

export interface Team {
	team_id: number;
	name: string;
	short_name: string;
	code: number;
}

export interface PlayerLatest {
	element_id: number;
	web_name: string;
	first_name: string;
	second_name: string;
	team_id: number;
	element_type: number;
	code: number;
	team_name: string;
	team_short: string;
	team_code: number;
	now_cost: number;
	cost_change_start: number;
	cost_change_event: number;
	price_change_percent: string;
	price_change_hourly_rate: number;
	price_change_projections: object[];
	transfers_in: number;
	transfers_out: number;
	transfers_in_event: number;
	transfers_out_event: number;
	selected_by_percent: number;
	status: string;
	news: string;
	news_added: string | null;
	chance_of_playing_next_round: number | null;
	total_points: number;
	event_points: number;
	form: string;
	points_per_game: string;
	ep_this: string;
	ep_next: string;
	expected_goals: string;
	expected_assists: string;
	expected_goal_involvements: string;
	snapshot_time: string;
}

export interface PlayerSnapshot {
	timestamp: string;
	now_cost: number;
	transfers_in: number;
	transfers_out: number;
	transfers_in_event: number;
	transfers_out_event: number;
	selected_by_percent: number;
	price_change_percent: string;
	price_change_hourly_rate: number;
	price_change_projections: object[];
}

export interface PriceChange {
	id: number;
	element_id: number;
	old_cost: number;
	new_cost: number;
	change: number;
	detected_at: string;
	transfers_in_event: number;
	transfers_out_event: number;
	selected_by_percent: number;
	// joined
	web_name?: string;
	team_short?: string;
	team_code?: number;
}

export const POSITIONS: Record<number, string> = {
	1: 'GKP',
	2: 'DEF',
	3: 'MID',
	4: 'FWD'
};

export const POSITION_COLORS: Record<number, string> = {
	1: '#f59e0b', // amber
	2: '#22c55e', // green
	3: '#3b82f6', // blue
	4: '#ef4444', // red
};

// Image URL helpers
export function playerPhotoUrl(code: number, size: '40x40' | '110x140' | '250x250' = '250x250'): string {
	return `https://resources.premierleague.com/premierleague/photos/players/${size}/p${code}.png`;
}

export function playerPhotoFallback(teamCode: number, isGk = false): string {
	// When player photo returns 403, show their team shirt
	const suffix = isGk ? '_1' : '';
	return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${suffix}-110.webp`;
}

export function teamBadgeUrl(teamCode: number): string {
	// SVGs are missing for some promoted clubs — use PNG which always works
	return `https://resources.premierleague.com/premierleague/badges/100/t${teamCode}.png`;
}

export function teamShirtUrl(teamCode: number, isGk = false): string {
	const suffix = isGk ? `_1` : '';
	return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${suffix}-110.webp`;
}
