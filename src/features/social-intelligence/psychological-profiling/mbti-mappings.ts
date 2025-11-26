/**
 * MBTI Mappings
 *
 * Research-based correlations between Big Five and MBTI personality frameworks.
 * Includes complete type descriptions for all 16 MBTI types.
 */

/**
 * Big Five to MBTI correlations (research-based)
 *
 * Sources:
 * - McCrae & Costa (1989): "Reinterpreting the Myers-Briggs Type Indicator From the Perspective of the Five-Factor Model of Personality"
 * - Furnham et al. (2003): "A comparison of two personality trait models"
 *
 * Correlation strengths:
 * - E/I ↔ Extraversion: r = 0.74 (strong positive)
 * - S/N ↔ Openness: r = -0.72 (strong negative, Intuition correlates with high Openness)
 * - T/F ↔ Agreeableness: r = -0.44 (moderate negative, Feeling correlates with high Agreeableness)
 * - J/P ↔ Conscientiousness: r = 0.49 (moderate positive)
 */
export const BIG_FIVE_TO_MBTI_CORRELATIONS = {
	E_I: {
		bigFiveTrait: "extraversion" as const,
		correlation: 0.74,
		// High Extraversion → E preference (+), Low Extraversion → I preference (-)
		mapping: (score: number): number => (score - 0.5) * 2,
	},
	S_N: {
		bigFiveTrait: "openness" as const,
		correlation: -0.72,
		// High Openness → N preference (+), Low Openness → S preference (-)
		mapping: (score: number): number => (score - 0.5) * 2,
	},
	T_F: {
		bigFiveTrait: "agreeableness" as const,
		correlation: -0.44,
		// High Agreeableness → F preference (+), Low Agreeableness → T preference (-)
		mapping: (score: number): number => (score - 0.5) * 2,
	},
	J_P: {
		bigFiveTrait: "conscientiousness" as const,
		correlation: 0.49,
		// High Conscientiousness → J preference (+), Low Conscientiousness → P preference (-)
		mapping: (score: number): number => (score - 0.5) * 2,
	},
} as const;

/**
 * MBTI Type Descriptions
 *
 * Descriptive keywords for all 16 Myers-Briggs personality types.
 * Used for enriching personality profiles with human-readable traits.
 */
export const MBTI_TYPE_DESCRIPTIONS: Record<string, string[]> = {
	// Analysts (NT)
	INTJ: [
		"analytical",
		"strategic",
		"independent",
		"conceptual",
		"determined",
		"innovative",
	],
	INTP: [
		"logical",
		"analytical",
		"curious",
		"abstract",
		"innovative",
		"theoretical",
	],
	ENTJ: [
		"strategic",
		"decisive",
		"assertive",
		"efficient",
		"leadership-oriented",
		"visionary",
	],
	ENTP: [
		"innovative",
		"debatable",
		"quick-witted",
		"entrepreneurial",
		"versatile",
		"strategic",
	],

	// Diplomats (NF)
	INFJ: [
		"insightful",
		"idealistic",
		"empathetic",
		"visionary",
		"principled",
		"creative",
	],
	INFP: [
		"idealistic",
		"empathetic",
		"creative",
		"authentic",
		"values-driven",
		"introspective",
	],
	ENFJ: [
		"empathetic",
		"charismatic",
		"inspirational",
		"organized",
		"altruistic",
		"persuasive",
	],
	ENFP: [
		"enthusiastic",
		"creative",
		"sociable",
		"spontaneous",
		"optimistic",
		"imaginative",
	],

	// Sentinels (SJ)
	ISTJ: [
		"practical",
		"reliable",
		"organized",
		"detail-oriented",
		"responsible",
		"traditional",
	],
	ISFJ: [
		"supportive",
		"reliable",
		"practical",
		"detail-oriented",
		"caring",
		"loyal",
	],
	ESTJ: [
		"organized",
		"practical",
		"direct",
		"responsible",
		"traditional",
		"decisive",
	],
	ESFJ: [
		"supportive",
		"sociable",
		"organized",
		"cooperative",
		"warm",
		"dutiful",
	],

	// Explorers (SP)
	ISTP: [
		"practical",
		"observant",
		"action-oriented",
		"adaptable",
		"hands-on",
		"logical",
	],
	ISFP: [
		"artistic",
		"sensitive",
		"adaptable",
		"spontaneous",
		"harmonious",
		"experiential",
	],
	ESTP: [
		"energetic",
		"pragmatic",
		"bold",
		"observant",
		"action-oriented",
		"sociable",
	],
	ESFP: [
		"enthusiastic",
		"spontaneous",
		"sociable",
		"entertaining",
		"practical",
		"observant",
	],

	// Neutral/Unknown types
	XXXX: [
		"balanced",
		"neutral",
		"adaptable",
		"moderate",
		"flexible",
		"versatile",
	],
};

/**
 * Get MBTI type string from dichotomy preferences
 */
export function getMBTITypeString(
	E_I: string,
	S_N: string,
	T_F: string,
	J_P: string
): string {
	return `${E_I}${S_N}${T_F}${J_P}`;
}

/**
 * Get descriptors for an MBTI type
 */
export function getMBTIDescriptors(type: string): string[] {
	return MBTI_TYPE_DESCRIPTIONS[type] || MBTI_TYPE_DESCRIPTIONS.XXXX;
}
