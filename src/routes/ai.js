const express = require('express');
const axios = require('axios');
const db = require('../services/db');
const { WOW_SPECIALIZATIONS, WOW_CLASSES, WOW_CLASS_COLORS, WOW_SPEC_ROLES } = require('../config/constants');
const { getSpecEvolutionForSeason, getCompositionDataForSeason } = require('../services/meta-helpers');

const router = express.Router();

// Lightweight validators (no external deps)
function isNumberArray(a) { return Array.isArray(a) && a.every(n => typeof n === 'number' && Number.isFinite(n)); }
function isStringArray(a) { return Array.isArray(a) && a.every(s => typeof s === 'string'); }

// Minimal, safe logging for axios errors (avoid dumping headers)
function logAxiosError(prefix, error) {
  const status = error?.response?.status;
  const msg = error?.message;
  const apiMsg = error?.response?.data?.error?.message || error?.response?.data?.error;
  if (status) {
    console.error(`${prefix} ${status}: ${apiMsg || msg}`);
  } else if (error?.code === 'ECONNABORTED') {
    console.error(`${prefix} timeout: ${msg}`);
  } else {
    console.error(`${prefix} ${msg || 'Unknown error'}`);
  }
}

// Configurable performance caps (env overrides)
const AI_MAX_PERIODS = Number(process.env.AI_MAX_PERIODS) > 0 ? Number(process.env.AI_MAX_PERIODS) : 18;
const AI_MAX_KEYS_PER_PERIOD = Number(process.env.AI_MAX_KEYS_PER_PERIOD) > 0 ? Number(process.env.AI_MAX_KEYS_PER_PERIOD) : 1000;
const AI_MAX_TOKENS_PREDICTIONS = Number(process.env.AI_MAX_TOKENS_PREDICTIONS) > 0 ? Number(process.env.AI_MAX_TOKENS_PREDICTIONS) : 12000;
const AI_MAX_TOKENS_META = Number(process.env.AI_MAX_TOKENS_META) > 0 ? Number(process.env.AI_MAX_TOKENS_META) : 6000;
const AI_MAX_TOKENS_TIER = Number(process.env.AI_MAX_TOKENS_TIER) > 0 ? Number(process.env.AI_MAX_TOKENS_TIER) : 20000;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) > 0 ? Number(process.env.OPENAI_TIMEOUT_MS) : 210000;

function validatePredictionsResponse(resp) {
  const errors = [];
  if (!resp || typeof resp !== 'object') errors.push('response not an object');
  if (!Array.isArray(resp.predictions)) errors.push('predictions missing or not an array');
  if (!resp.analysis || typeof resp.analysis !== 'object') errors.push('analysis missing or not an object');
  if (Array.isArray(resp.predictions)) {
    // Sample-check first up to 15 items
    const sample = resp.predictions.slice(0, 15);
    for (let i = 0; i < sample.length; i++) {
      const p = sample[i];
      if (typeof p.specId !== 'number') errors.push(`predictions[${i}].specId must be number`);
      if (typeof p.specName !== 'string') errors.push(`predictions[${i}].specName must be string`);
      if (typeof p.className !== 'string') errors.push(`predictions[${i}].className must be string`);
      ['currentUsage','predictedChange','confidence','successRate'].forEach(k => {
        if (typeof p[k] !== 'number') errors.push(`predictions[${i}].${k} must be number`);
      });
      const td = p.temporalData || {};
      if (!isNumberArray(td.appearances || [])) errors.push(`predictions[${i}].temporalData.appearances must be number[]`);
      if (!isNumberArray(td.successRates || [])) errors.push(`predictions[${i}].temporalData.successRates must be number[]`);
      ['totalRuns','recentTrend','trendSlope','consistency','crossValidationScore'].forEach(k => {
        if (typeof td[k] !== 'number') errors.push(`predictions[${i}].temporalData.${k} must be number`);
      });
      if (errors.length > 20) break; // avoid noise
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateTierListResponse(resp) {
  const errors = [];
  if (!resp || typeof resp !== 'object') errors.push('response not an object');
  const tiers = resp.tiers;
  if (!tiers || typeof tiers !== 'object') errors.push('tiers missing or not an object');
  const allowedTiers = ['S', 'A', 'B', 'C', 'D'];
  if (tiers && typeof tiers === 'object') {
    const seen = new Set();
    allowedTiers.forEach(t => {
      const arr = tiers[t] || [];
      if (!Array.isArray(arr)) errors.push(`tiers.${t} must be array`);
      arr.slice(0, 20).forEach((e, i) => {
        if (typeof e !== 'object') { errors.push(`tiers.${t}[${i}] must be object`); return; }
        if (typeof e.specId !== 'number') errors.push(`tiers.${t}[${i}].specId must be number`);
        if (typeof e.specName !== 'string') errors.push(`tiers.${t}[${i}].specName must be string`);
        if (typeof e.className !== 'string') errors.push(`tiers.${t}[${i}].className must be string`);
        if (typeof e.role !== 'string') errors.push(`tiers.${t}[${i}].role must be string`);
        if (typeof e.usage !== 'number') errors.push(`tiers.${t}[${i}].usage must be number`);
        if (typeof e.specId === 'number') {
          if (seen.has(e.specId)) errors.push(`duplicate specId ${e.specId} across tiers`);
          seen.add(e.specId);
        }
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

function validateMetaHealthResponse(resp) {
  const errors = [];
  if (!resp || typeof resp !== 'object') errors.push('response not an object');
  if (!resp.metaSummary) errors.push('metaSummary missing');
  if (!resp.roleAnalysis) errors.push('roleAnalysis missing');
  if (!resp.compositionAnalysis) errors.push('compositionAnalysis missing');
  if (!Array.isArray(resp.balanceIssues)) errors.push('balanceIssues must be array');
  
  // Check for spec IDs in text fields (AI should use spec names, not IDs)
  const checkForSpecIds = (text) => {
    if (typeof text === 'string' && /\bSpec\s+\d+\b/i.test(text)) {
      return true;
    }
    return false;
  };
  
  // Check metaSummary
  if (resp.metaSummary) {
    if (checkForSpecIds(resp.metaSummary.summary)) {
      errors.push('metaSummary.summary contains spec IDs instead of names');
    }
    if (Array.isArray(resp.metaSummary.keyInsights)) {
      resp.metaSummary.keyInsights.forEach((insight, index) => {
        if (checkForSpecIds(insight)) {
          errors.push(`metaSummary.keyInsights[${index}] contains spec IDs instead of names`);
        }
      });
    }
  }
  
  // Check balanceIssues
  if (Array.isArray(resp.balanceIssues)) {
    resp.balanceIssues.forEach((issue, index) => {
      if (checkForSpecIds(issue.description)) {
        errors.push(`balanceIssues[${index}].description contains spec IDs instead of names`);
      }
    });
  }
  
  return { ok: errors.length === 0, errors };
}

// POST /ai/predictions
// Send data to OpenAI for AI-powered meta predictions
router.post('/predictions', async (req, res) => {
  console.log(`🤖 [AI] POST /ai/predictions - Season: ${req.body.seasonId || 'unknown'}`);
  try {
    const { seasonId, forceRefresh } = req.body;

    if (!seasonId) {
      return res.status(400).json({ error: 'Missing required data: seasonId' });
    }

    // Check for cached analysis first
    console.log(`📋 [AI] Checking cache for season ${seasonId}`);
    const cachedResult = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2 ORDER BY created_at DESC LIMIT 1',
      [seasonId, 'predictions']
    );

    if (cachedResult.rows.length > 0 && !forceRefresh) {
      const cached = cachedResult.rows[0];
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      const maxAge = 8 * 60 * 60 * 1000; // 8 hours
      
      if (cacheAge < maxAge) {
        console.log(`📋 [AI] Using cached analysis for season ${seasonId}`);
        let analysisData;
        if (typeof cached.analysis_data === 'string') {
          analysisData = JSON.parse(cached.analysis_data);
        } else {
          analysisData = cached.analysis_data;
        }
        
        // Include cache metadata in the response
        const responseWithCache = {
          ...analysisData,
          _cache: {
            created_at: cached.created_at,
            age_hours: Math.round(cacheAge / (1000 * 60 * 60)),
            max_age_hours: 8
          }
        };
        return res.json(responseWithCache);
      }
    } else if (forceRefresh) {
      console.log(`🔄 [AI] Force refresh requested for predictions season ${seasonId}, bypassing cache`);
    }

    // If no cache or expired, generate new analysis
    console.log(`📊 [AI] Fetching data for new analysis - Season: ${seasonId}`);
    
    // Use helper functions to get the required data
    console.log(`📊 [AI] Fetching composition and spec evolution data for season ${seasonId}`);
    
    // Get composition data using the helper function
    const seasonData = await getCompositionDataForSeason(seasonId);
    if (!seasonData) {
      return res.status(404).json({ error: 'No composition data found for this season' });
    }

    // Get spec evolution data using the helper function
    const specEvolution = await getSpecEvolutionForSeason(seasonId);
    if (!specEvolution) {
      return res.status(404).json({ error: 'No spec evolution data found for this season' });
    }


    console.log(`📊 [AI] Data fetched successfully - Periods: ${seasonData.periods.length}, Evolution entries: ${specEvolution.evolution.length}`);

    // Prepare data for AI analysis
    const analysisData = {
      season: {
        id: seasonId,
        totalPeriods: seasonData.total_periods,
        totalKeys: seasonData.total_keys
      },
      specData: {},
      temporalAnalysis: {},
      metaContext: {
        currentPatch: "10.2.7", // You might want to make this dynamic
        seasonType: "Mythic+",
        analysisScope: "Meta trend prediction and spec viability forecasting"
      }
    };

    // Process spec data for AI - optimized for large datasets
    const specTemporalData = {};
    
    // Limit processing to avoid memory issues with very large datasets
  const maxPeriodsToProcess = Math.min(seasonData.total_periods, AI_MAX_PERIODS);
    const periodsToProcess = seasonData.periods.slice(-maxPeriodsToProcess); // Use the last 25 periods
    
    // Processing periods for AI analysis
    
    if (periodsToProcess.length === 0) {
      return res.status(400).json({ error: 'No periods available for analysis' });
    }
    
    periodsToProcess.forEach((period, periodIndex) => {
      const periodKeys = period.keys;
      const totalLevel = periodKeys.reduce((sum, run) => sum + run.keystone_level, 0);
      const avgLevelForPeriod = periodKeys.length > 0 ? totalLevel / periodKeys.length : 0;
      
      // Limit keys processed per period to avoid memory issues
  const maxKeysPerPeriod = AI_MAX_KEYS_PER_PERIOD;
      const keysToProcess = periodKeys.slice(0, maxKeysPerPeriod);
      
      keysToProcess.forEach((run) => {
        run.members?.forEach((member) => {
          const specId = member.spec_id;
          if (!specTemporalData[specId]) {
            specTemporalData[specId] = {
              appearances: new Array(maxPeriodsToProcess).fill(0),
              successRates: new Array(maxPeriodsToProcess).fill(0),
              avgLevel: new Array(maxPeriodsToProcess).fill(0),
              totalRuns: 0,
              recentTrend: 0,
              trendSlope: 0,
              consistency: 0,
              officialTrend: 0,
              crossValidationScore: 0
            };
          }
          specTemporalData[specId].appearances[periodIndex]++;
          specTemporalData[specId].totalRuns++;
          if (run.keystone_level > avgLevelForPeriod) {
            specTemporalData[specId].successRates[periodIndex]++;
          }
          specTemporalData[specId].avgLevel[periodIndex] += run.keystone_level;
        });
      });
    });

    // Normalize per-period averages for specTemporalData
    Object.keys(specTemporalData).forEach((specIdStr) => {
      const specIdNum = parseInt(specIdStr);
      const entry = specTemporalData[specIdNum];
      if (!entry) return;
      for (let i = 0; i < maxPeriodsToProcess; i++) {
        const appearances = entry.appearances[i] || 0;
        if (appearances > 0) {
          // Convert accumulated keystone sum to average for the period
          entry.avgLevel[i] = Math.round(entry.avgLevel[i] / appearances);
          // Convert success count to a rate percentage (0-100)
          entry.successRates[i] = Math.round((entry.successRates[i] / appearances) * 100);
        } else {
          entry.avgLevel[i] = 0;
          entry.successRates[i] = 0;
        }
      }
    });

    // Cross-validate with official spec evolution data (align to same window)
    const slicedEvolution = (specEvolution && Array.isArray(specEvolution.evolution))
      ? specEvolution.evolution.slice(-maxPeriodsToProcess)
      : [];
    if (slicedEvolution.length > 0) {
      slicedEvolution.forEach((periodData, periodIndex) => {
        Object.entries(periodData.spec_counts).forEach(([specId, count]) => {
          const specIdNum = parseInt(specId);
          if (specTemporalData[specIdNum]) {
            const ourCount = specTemporalData[specIdNum].appearances[periodIndex] || 0;
            const officialCount = count;
            const difference = Math.abs(ourCount - officialCount);
            const maxCount = Math.max(ourCount, officialCount);
            const accuracy = maxCount > 0 ? (1 - difference / maxCount) * 100 : 100;
            specTemporalData[specIdNum].crossValidationScore += accuracy;
          }
        });
      });

      Object.keys(specTemporalData).forEach(specId => {
        const specIdNum = parseInt(specId);
        const periodsWithData = slicedEvolution.length;
        if (periodsWithData > 0) {
          specTemporalData[specIdNum].crossValidationScore /= periodsWithData;
        }
      });
    }

    // Create a slimmer view for the AI prompt to reduce tokens (omit avgLevel which isn't required in the response)
    const specTemporalDataForAI = {};
    Object.entries(specTemporalData).forEach(([specId, entry]) => {
      specTemporalDataForAI[specId] = {
        appearances: entry.appearances,
        successRates: entry.successRates,
        totalRuns: entry.totalRuns,
        recentTrend: entry.recentTrend,
        trendSlope: entry.trendSlope,
        consistency: entry.consistency,
        crossValidationScore: entry.crossValidationScore
      };
    });

    // Keep only the top N specs by totalRuns to reduce token usage
    const TOP_SPECS_FOR_PROMPT = 26;
    const sortedSpecIds = Object.keys(specTemporalDataForAI)
      .sort((a, b) => (specTemporalDataForAI[b].totalRuns || 0) - (specTemporalDataForAI[a].totalRuns || 0))
      .slice(0, TOP_SPECS_FOR_PROMPT);
    const specTemporalDataForAITrim = {};
    sortedSpecIds.forEach(id => { specTemporalDataForAITrim[id] = specTemporalDataForAI[id]; });

    // Prepare data for OpenAI
    const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini"; // Default to gpt-4o-mini for cost efficiency

    // Decide token parameter key based on model family
    const isGpt5Family = (openAIModel || '').toLowerCase().includes('gpt-5');
    const maxTokensPredictions = AI_MAX_TOKENS_PREDICTIONS;

    // Helper to build prompt payloads with correct token param
    const buildPrompts = (useCompletionTokensParam, opts = {}) => {
      const { includeTemperature = !isGpt5Family, includeSeed = true } = opts;
      const tokenParam = useCompletionTokensParam
        ? { max_completion_tokens: maxTokensPredictions }
        : { max_tokens: maxTokensPredictions };
      const base = {
        model: openAIModel,
        messages: [
        {
          role: "system",
          content: `You are an expert World of Warcraft Mythic+ meta analyst. Your task is to analyze spec performance data and predict meta trends.

CONTEXT:
- You're analyzing Mythic+ dungeon data from a specific season
- You have temporal data showing spec appearances, success rates, and trends over time
- You need to identify which specs are rising, declining, or stable in the meta
- Consider factors like: usage trends, success rates, consistency, cross-validation accuracy
- IMPORTANT: In temporalData, "successRates" are per-period percentages representing how often the spec's runs exceeded that period's average keystone level. They are NOT "timed" success rates.
- You are analyzing data from a specific season
- You know that a Mythic+ run is a 5 man group composed by a tank, a healer, a dps, a dps, and a dps
- You can identify the role of a spec by the following mapping:
    71: 'dps', 72: 'dps', 73: 'tank', 65: 'healer', 66: 'tank', 70: 'dps',
    253: 'dps', 254: 'dps', 255: 'dps', 259: 'dps', 260: 'dps', 261: 'dps',
    256: 'healer', 257: 'healer', 258: 'dps', 250: 'tank', 251: 'dps', 252: 'dps',
    262: 'dps', 263: 'dps', 264: 'healer', 62: 'dps', 63: 'dps', 64: 'dps',
    265: 'dps', 266: 'dps', 267: 'dps', 268: 'tank', 269: 'dps', 270: 'healer',
    102: 'dps', 103: 'dps', 104: 'tank', 105: 'healer', 577: 'dps', 581: 'tank',
    1467: 'dps', 1468: 'healer', 1473: 'dps'
- You can identify the class of a spec by the following mapping:
    1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 
    8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter', 13: 'Evoker',

ANALYSIS REQUIREMENTS:
1. Identify top 5 rising specs (increasing usage/performance)
2. Identify top 5 declining specs (decreasing usage/performance)
3. Try to always include at least one spec in the top of rising and declining lists
4. Provide confidence scores (0-100) for each prediction
5. Give detailed reasoning for each prediction
6. Provide overall meta insights and trends
7. Identify any new specs that are emerging in the meta
8. Identify any specs that are falling out of the meta
9. Consider role balance (tank, healer, dps) in your analysis
10. Note any role-specific trends (e.g., tank meta shifts, healer viability changes)
11. Keep reasoning succinct (<= 30 words each) and limit the predictions array to a maximum of 24 items, focusing on the most impactful specs.

RESPONSE FORMAT:
Return a JSON object with this exact structure:
{
  "predictions": [
    {
      "specId": number,
      "specName": string,
      "className": string,
      "currentUsage": number,
      "predictedChange": number,
      "confidence": number,
      "successRate": number,
      "reasoning": string,
      "temporalData": {
        "appearances": number[],
        "successRates": number[],
        "totalRuns": number,
        "recentTrend": number,
        "trendSlope": number,
        "consistency": number,
        "crossValidationScore": number
      }
    }
  ],
  "analysis": {
    "metaTrends": [string],
    "keyInsights": [string],
    "confidence": number,
    "dataQuality": string
  }
}`
        },
        {
          role: "user",
          content: `Analyze this Mythic+ season data and provide AI-powered meta predictions:

SEASON DATA:
- Season ID: ${seasonId}
- Total Periods: ${seasonData.total_periods}
- Total Keys: ${seasonData.total_keys}

SPEC TEMPORAL DATA:
${JSON.stringify(specTemporalDataForAITrim)}

SPEC EVOLUTION DATA (last ${maxPeriodsToProcess} periods):
${JSON.stringify({ evolution: slicedEvolution })}

SPEC NAMES REFERENCE:
Use these exact spec names in your predictions:
- Tank specs: 73 (Protection Warrior), 66 (Protection Paladin), 250 (Blood Death Knight), 104 (Guardian Druid), 581 (Vengeance Demon Hunter), 268 (Brewmaster Monk)
- Healer specs: 65 (Holy Paladin), 256 (Discipline Priest), 257 (Holy Priest), 264 (Restoration Shaman), 105 (Restoration Druid), 270 (Mistweaver Monk), 1468 (Preservation Evoker)
- DPS specs: 71 (Arms Warrior), 72 (Fury Warrior), 70 (Retribution Paladin), 253 (Beast Mastery Hunter), 254 (Marksmanship Hunter), 255 (Survival Hunter), 259 (Assassination Rogue), 260 (Outlaw Rogue), 261 (Subtlety Rogue), 258 (Shadow Priest), 251 (Frost Death Knight), 252 (Unholy Death Knight), 262 (Elemental Shaman), 263 (Enhancement Shaman), 62 (Arcane Mage), 63 (Fire Mage), 64 (Frost Mage), 265 (Affliction Warlock), 266 (Demonology Warlock), 267 (Destruction Warlock), 269 (Windwalker Monk), 102 (Balance Druid), 103 (Feral Druid), 577 (Havoc Demon Hunter), 1467 (Devastation Evoker), 1473 (Augmentation Evoker)

IMPORTANT: 
1. Use the exact spec names from the reference above (e.g., "Vengeance", "Discipline", "Unholy")
2. Use the exact class names from the reference above (e.g., "Demon Hunter", "Priest", "Death Knight")
3. CRITICAL: Each spec can only appear ONCE in the entire predictions array. Do NOT include the same specId more than once.
4. Do NOT include classColor in your response - we will handle colors on the backend
5. Respond ONLY with valid JSON in the exact format specified. Do not include any additional text, explanations, or markdown formatting. Start your response with { and end with }.`
        }
      ],
        ...(includeTemperature ? { temperature: 0.2 } : {}),
        ...(includeSeed ? { seed: 42 } : {}),
        ...tokenParam
      };
      return { base, withJson: { ...base, response_format: { type: "json_object" } } };
    };

    let includeTemperature = !isGpt5Family;
    let includeSeed = true;
    let { base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(isGpt5Family, { includeTemperature, includeSeed });

    // Call OpenAI API with retry logic for rate limits
    console.log(`🤖 [AI] Calling OpenAI API for season ${seasonId}...`);
    
  let openAIResponse;
  let retryCount = 0;
  const maxRetries = 3;
  let triedWithoutJsonFormat = false;
  let swappedTokenParamOnce = false;
  let removedTemperature = false;
  let removedSeed = false;
    
  while (retryCount <= maxRetries) {
      try {
        openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 210000 // configurable, default 210s
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 400 && !triedWithoutJsonFormat && (error.response?.data?.error?.message || '').toLowerCase().includes('response_format')) {
          // Fallback if the model doesn't support JSON response_format
          console.log(`🤖 [AI] response_format not supported by model '${openAIModel}', retrying without it...`);
          triedWithoutJsonFormat = true;
          continue;
        }
        // If the token parameter is not supported, flip between max_tokens and max_completion_tokens once
        const errMsg = (error.response?.data?.error?.message || '').toLowerCase();
        if (error.response?.status === 400 && !swappedTokenParamOnce && (errMsg.includes('unsupported parameter') || errMsg.includes('max_tokens') || errMsg.includes('max_completion_tokens'))) {
          swappedTokenParamOnce = true;
          const currentlyUsingCompletion = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
          console.log(`🤖 [AI] Detected token param mismatch for model '${openAIModel}'. Switching token field and retrying...`);
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(!currentlyUsingCompletion, { includeTemperature, includeSeed }));
          // keep triedWithoutJsonFormat as-is, just rebuild prompts
          continue;
        }
        // If temperature not supported, drop it and retry once
        if (error.response?.status === 400 && !removedTemperature && errMsg.includes('temperature')) {
          console.log(`🤖 [AI] Temperature not supported for model '${openAIModel}', removing temperature and retrying...`);
          removedTemperature = true;
          includeTemperature = false;
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature, includeSeed }));
          continue;
        }
        // If seed not supported, drop it and retry once
        if (error.response?.status === 400 && !removedSeed && errMsg.includes('seed')) {
          console.log(`🤖 [AI] Seed not supported for model '${openAIModel}', removing seed and retrying...`);
          removedSeed = true;
          includeSeed = false;
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature, includeSeed }));
          continue;
        }
        if (error.response?.status === 429 && retryCount < maxRetries) {
          retryCount++;
          // Respect Retry-After if present; otherwise exponential backoff with jitter
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          let delay = retryAfterHeader ? Number(retryAfterHeader) * 1000 : Math.pow(2, retryCount) * 1000;
          delay = Math.round(delay * (1 + Math.random() * 0.25));
          console.log(`🤖 [AI] Rate limit hit, retrying in ${Math.round(delay/1000)}s (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Re-throw if not a 429 or max retries reached
        }
      }
    }

    const aiMessage = openAIResponse.data.choices?.[0];
    const aiResponse = aiMessage?.message?.content || '';
    const finishReason = aiMessage?.finish_reason;
    const usage = openAIResponse.data.usage || {};
    if (finishReason) {
      console.log(`🤖 [AI] finish_reason=${finishReason} prompt_tokens=${usage.prompt_tokens || 'n/a'} completion_tokens=${usage.completion_tokens || 'n/a'}`);
    }

    let parsedResponse;
    let parseErrorMemo;

    function tryStandardParses(raw) {
      try {
        return JSON.parse(raw);
      } catch (e1) {
        // Try code block
        const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          try { return JSON.parse(codeBlockMatch[1]); } catch (e2) { /* fallthrough */ }
        }
        // Try any JSON object substring
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { return JSON.parse(jsonMatch[0]); } catch (e3) { /* fallthrough */ }
        }
        // Try simple brace-balance repair if it looks truncated
        const first = raw.indexOf('{');
        const last = raw.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last >= first) {
          let candidate = raw.slice(first, last + 1);
          const opens = (candidate.match(/\{/g) || []).length;
          const closes = (candidate.match(/\}/g) || []).length;
          if (opens > closes) {
            candidate = candidate + '}'.repeat(opens - closes);
            try { return JSON.parse(candidate); } catch (e4) { /* fallthrough */ }
          }
        }
        parseErrorMemo = e1;
        return undefined;
      }
    }

    parsedResponse = tryStandardParses(aiResponse);

    // If still not parsable or model cut off output, attempt one reformat retry
    if (!parsedResponse || finishReason === 'length') {
      console.warn('⚠️ [AI] Initial AI response invalid or truncated; attempting reformat retry');
      const useCompletionTokensParam = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
      const tokenParam = useCompletionTokensParam ? { max_completion_tokens: Math.min(maxTokensPredictions * 2, 20000) } : { max_tokens: Math.min(maxTokensPredictions * 2, 20000) };
      const reformatBase = {
        model: openAIModel,
        messages: [
          { role: 'system', content: 'You will be given your previous output which is intended to be JSON. Convert it into strictly valid JSON that matches the requested schema. Do not add commentary. Respond with JSON only.' },
          { role: 'user', content: aiResponse || 'null' }
        ],
        ...tokenParam
      };
      const reformatWithJson = { ...reformatBase, response_format: { type: 'json_object' } };
      try {
        const reformatResp = await axios.post('https://api.openai.com/v1/chat/completions', reformatWithJson, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
        const reformatted = reformatResp.data.choices?.[0]?.message?.content || '';
        parsedResponse = tryStandardParses(reformatted);
      } catch (rfErr) {
        console.warn('⚠️ [AI] Reformat retry failed, will return parse error');
      }
    }

    if (!parsedResponse) {
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: (parseErrorMemo && parseErrorMemo.message) || 'Invalid or truncated response',
        finishReason: finishReason || 'unknown',
        rawResponse: (aiResponse || '').substring(0, 2000)
      });
    }

    // Validate and process the AI response
    if (!parsedResponse.predictions || !Array.isArray(parsedResponse.predictions)) {
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    // Remove duplicate predictions by specId (keep the first occurrence)
    const uniquePredictions = [];
    const seenSpecIds = new Set();
    
    for (const pred of parsedResponse.predictions) {
      if (!seenSpecIds.has(pred.specId)) {
        seenSpecIds.add(pred.specId);
        uniquePredictions.push(pred);
      } else {
        console.log(`⚠️ [AI] Removed duplicate prediction for specId: ${pred.specId}`);
      }
    }
    
    // Process predictions to ensure they have all required fields
    const processedPredictions = uniquePredictions.map(pred => {
      // Find the spec by ID
      const spec = WOW_SPECIALIZATIONS.find(s => s.id === pred.specId);
      const specName = pred.specName || spec?.name || 'Unknown';
      
      // Find the class by ID
      const classInfo = WOW_CLASSES.find(c => c.id === spec?.classId);
      const className = pred.className || classInfo?.name || 'Unknown';
      // Always use our backend color mapping, ignore AI-provided colors
      const classColor = WOW_CLASS_COLORS[spec?.classId] || '#666666';
      
      return {
        ...pred,
        specName,
        className,
        classColor,
        temporalData: {
          appearances: pred.temporalData?.appearances || [],
          successRates: pred.temporalData?.successRates || [],
          totalRuns: pred.temporalData?.totalRuns || 0,
          recentTrend: pred.temporalData?.recentTrend || 0,
          trendSlope: pred.temporalData?.trendSlope || 0,
          consistency: pred.temporalData?.consistency || 0,
          crossValidationScore: pred.temporalData?.crossValidationScore || 0
        }
      };
    });

    const analysisResult = {
      predictions: processedPredictions,
      analysis: parsedResponse.analysis || {
        metaTrends: [],
        keyInsights: [],
        confidence: 75,
        dataQuality: 'Good'
      }
    };

    // Lightweight schema validation before caching
    const validation = validatePredictionsResponse(analysisResult);
    if (!validation.ok) {
      return res.status(500).json({ error: 'AI response failed validation', details: validation.errors.slice(0, 10) });
    }

    // Cache the analysis result
    try {
      // First, delete any existing predictions analysis for this season
      await db.pool.query(
        'DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
        [seasonId, 'predictions']
      );
      
      // Then insert the new analysis
      // Sanitize DB-bound fields to respect column constraints
      const rawConfidence = parsedResponse?.analysis?.confidence;
      const safeConfidence = Number.isFinite(Number(rawConfidence))
        ? Math.max(0, Math.min(100, Math.round(Number(rawConfidence) * 100) / 100))
        : 75;
      const rawQuality = parsedResponse?.analysis?.dataQuality;
      let safeQuality = 'good';
      if (typeof rawQuality === 'string') {
        safeQuality = rawQuality.trim();
      } else if (rawQuality != null) {
        safeQuality = String(rawQuality);
      }
      if (safeQuality.length > 20) safeQuality = safeQuality.slice(0, 20);

      await db.pool.query(
        `INSERT INTO ai_analysis (season_id, analysis_data, analysis_type, confidence_score, data_quality)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          seasonId,
          JSON.stringify(analysisResult),
          'predictions',
          safeConfidence,
          safeQuality
        ]
      );
      console.log(`✅ [AI] Analysis cached for season ${seasonId}`);
    } catch (cacheError) {
      console.error('❌ Failed to cache AI analysis:', cacheError);
      // Don't fail the request if caching fails
    }

    console.log(`✅ [AI] Analysis completed for season ${seasonId}`);
    res.json(analysisResult);

  } catch (error) {
    logAxiosError('[AI PREDICTIONS ERROR]', error);
    
    if (error.response) {
  // Minimal OpenAI API error logging without leaking headers/keys
  console.error('OpenAI API Error:', error.response.status, error.response.data?.error || 'Unknown error');
      
      // Handle model-specific errors
      if (error.response.data?.error?.code === 'model_not_found') {
        res.status(500).json({ 
          error: `Model '${openAIModel}' not available. Please check your OpenAI account or try a different model (gpt-4o-mini, gpt-3.5-turbo, etc.)` 
        });
      } else {
        res.status(500).json({ 
          error: `OpenAI API Error: ${error.response.status} - ${error.response.data?.error?.message || error.response.data?.error || 'Unknown error'}` 
        });
      }
    } else if (error.request) {
      console.error('Network Error:', error.message);
      res.status(500).json({ error: `Network Error: ${error.message}` });
    } else {
      console.error('Other Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /ai/meta-health
// Purpose: AI-powered analysis of meta health, diversity, and balance
router.post('/meta-health', async (req, res) => {
  const { seasonId, forceRefresh } = req.body;
  
  if (!seasonId) {
    return res.status(400).json({ error: 'Missing required data: seasonId' });
  }

  console.log(`🤖 [AI] POST /ai/meta-health - Season: ${seasonId}`);

  try {
    // Fetch required data using helper functions
    console.log(`📊 [AI] Fetching composition and spec evolution data for season ${seasonId}`);
    
    // Get composition data using the helper function
    const compositionData = await getCompositionDataForSeason(seasonId);
    if (!compositionData) {
      return res.status(404).json({ error: 'No composition data found for this season' });
    }

    // Get spec evolution data using the helper function
    const specEvolution = await getSpecEvolutionForSeason(seasonId);
    if (!specEvolution) {
      return res.status(404).json({ error: 'No spec evolution data found for this season' });
    }

    console.log(`📊 [AI] Data fetched successfully - Periods: ${compositionData.periods.length}, Evolution entries: ${specEvolution.evolution.length}`);

    // Check for cached analysis first
    console.log(`📋 [AI] Checking cache for season ${seasonId} (meta_health)`);
    const cachedResult = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2 ORDER BY created_at DESC LIMIT 1',
      [seasonId, 'meta_health']
    );

    if (cachedResult.rows.length > 0 && !forceRefresh) {
      const cacheAge = Date.now() - new Date(cachedResult.rows[0].created_at).getTime();
      const maxAge = 8 * 60 * 60 * 1000; // 8 hours
      
      console.log(`📋 [AI] Found cached data for season ${seasonId}, age: ${Math.round(cacheAge / (1000 * 60 * 60))} hours`);
      
      if (cacheAge < maxAge) {
        console.log(`📋 [AI] Using cached meta health analysis for season ${seasonId}`);
        return res.json(cachedResult.rows[0].analysis_data);
      } else {
        console.log(`📋 [AI] Cache expired for season ${seasonId}, will generate new analysis`);
      }
    } else if (forceRefresh) {
      console.log(`🔄 [AI] Force refresh requested for season ${seasonId}, bypassing cache`);
    } else {
      console.log(`📋 [AI] No cached data found for season ${seasonId}`);
    }

    // Simplified data processing - let AI do the analysis instead of duplicating logic
    console.log(`📊 [AI] Processing simplified data for meta health analysis...`);
    
    // Basic processing: collect all runs and simple spec usage counts
    const allRuns = [];
  const maxPeriodsToProcess = Math.min(compositionData.total_periods, AI_MAX_PERIODS);
    const periodsToProcess = compositionData.periods.slice(-maxPeriodsToProcess);
    
    // Collect runs from all periods
    periodsToProcess.forEach(period => {
  const maxKeysPerPeriod = AI_MAX_KEYS_PER_PERIOD;
      const keysToProcess = period.keys.slice(0, maxKeysPerPeriod);
      allRuns.push(...keysToProcess);
    });

    // Simple spec usage calculation by role
    const roleStats = { tank: {}, healer: {}, dps: {} };
    const roleRunCounts = { tank: 0, healer: 0, dps: 0 };
    const compositionCounts = {};

    allRuns.forEach(run => {
        const composition = [];
        const runRoles = new Set();
        
      run.members?.forEach(member => {
          const specId = member.spec_id;
          const role = WOW_SPEC_ROLES[specId] || 'dps';
          
        // Initialize spec if not seen
        if (!roleStats[role][specId]) {
          roleStats[role][specId] = { count: 0, totalLevel: 0 };
        }
        
        // Count spec appearance
        roleStats[role][specId].count++;
        roleStats[role][specId].totalLevel += run.keystone_level;
        
          composition.push(specId);
        });
        
      // Count unique roles per run (for percentage calculations)
      ['tank', 'healer', 'dps'].forEach(role => {
        if (run.members?.some(m => (WOW_SPEC_ROLES[m.spec_id] || 'dps') === role)) {
          roleRunCounts[role]++;
        }
      });

      // Track compositions (top 10 only to reduce size)
      const compKey = composition.sort().join(',');
      compositionCounts[compKey] = (compositionCounts[compKey] || 0) + 1;
    });

    // Calculate percentages and prepare final data with proper spec names
    const specUsageData = { tank: {}, healer: {}, dps: {} };
    
    Object.keys(roleStats).forEach(role => {
      const totalRuns = roleRunCounts[role];
      Object.keys(roleStats[role]).forEach(specId => {
        const stat = roleStats[role][specId];
        
        // Calculate usage percentage based on role slots (DPS has 3 slots, others have 1)
        let usagePercentage;
        if (role === 'dps') {
          usagePercentage = totalRuns > 0 ? (stat.count / (totalRuns * 3)) * 100 : 0;
        } else {
          usagePercentage = totalRuns > 0 ? (stat.count / totalRuns) * 100 : 0;
        }
        
        specUsageData[role][specId] = {
            specId: parseInt(specId),
          count: stat.count,
          usagePercentage: Math.round(usagePercentage * 100) / 100,
          avgLevel: stat.count > 0 ? Math.round(stat.totalLevel / stat.count) : 0,
          specName: (() => {
          const spec = WOW_SPECIALIZATIONS.find(s => s.id === parseInt(specId));
          if (spec) {
            const className = WOW_CLASSES.find(c => c.id === spec.classId)?.name || '';
            return className ? `${spec.name} ${className}` : spec.name;
          }
          return `Spec ${specId}`;
        })(),
          role: role
        };
      });
    });

    // Get top 10 compositions only with spec names instead of IDs
    const topCompositions = Object.entries(compositionCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([specs, count]) => {
        const specIds = specs.split(',').map(Number);
        const specNames = specIds.map(specId => {
          // Find the spec name and class name from WOW_SPECIALIZATIONS
          const spec = WOW_SPECIALIZATIONS.find(s => s.id === specId);
          if (spec) {
            const className = WOW_CLASSES.find(c => c.id === spec.classId)?.name || '';
            return className ? `${spec.name} ${className}` : spec.name;
          }
          return `Unknown Spec ${specId}`;
        });
        
        return {
          specs: specIds,
          specNames: specNames,
          count,
          percentage: (count / allRuns.length) * 100
        };
      });

    // Prepare simplified data for OpenAI analysis
  const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    
    const systemPrompt = `You are a WoW Mythic+ meta analyst. Analyze spec usage data to assess meta health.

CRITICAL: NEVER use "Spec [ID]" or spec ID numbers. ALWAYS use actual spec names.

EXAMPLES:
✅ "Restoration Shaman represents 60% of healer picks"
❌ "Spec 264 represents 60% of healer picks"

RESPONSE FORMAT (JSON):
{
  "metaSummary": {
    "overallState": "Healthy|Concerning|Unhealthy",
    "summary": "1-2 sentence overview using spec NAMES",
    "keyInsights": ["insight1 using spec NAMES", "insight2 using spec NAMES", "insight3 using spec NAMES"]
  },
  "roleAnalysis": {
    "tank": {
      "dominantSpecs": [{"specId": number, "usage": number, "name": string}],
      "underusedSpecs": [{"specId": number, "usage": number, "name": string}],
      "healthStatus": "Good|Concerning|Poor",
      "totalRuns": number
    },
    "healer": { /* same structure */ },
    "dps": { /* same structure */ }
  },
  "compositionAnalysis": {
    "mostPopularGroup": {
      "specs": [number], "specNames": [string], "usage": number, "count": number
    },
    "compositionDiversity": "High|Medium|Low",
    "dominantPatterns": ["pattern description using spec NAMES"]
  },
  "balanceIssues": [
    {"type": "dominance|underuse|diversity", "description": "description using spec NAMES", "severity": "low|medium|high"}
  ]
}

REQUIREMENTS:
- Use spec names from specName field, never spec IDs
- Include specId, usage %, and name for dominantSpecs/underusedSpecs
- Calculate totalRuns per role from spec usage data
- Use spec names in all text fields

GUIDELINES:
- Tanks/healers: >50% = concerning, >75% = poor
- DPS: >15% = concerning (3 slots available)`;

    // Create a spec ID to name mapping for the AI
    const aiSpecIdToName = {};
    Object.keys(specUsageData).forEach(role => {
      Object.keys(specUsageData[role]).forEach(specId => {
        aiSpecIdToName[specId] = specUsageData[role][specId].specName;
      });
    });
    
    // Debug: Log what spec names are being sent to the AI
    console.log(`🔍 [AI] Debug: Sample spec names being sent to AI:`);
    Object.keys(aiSpecIdToName).slice(0, 5).forEach(specId => {
      console.log(`  Spec ${specId} → ${aiSpecIdToName[specId]}`);
    });
    
    // Debug: Log some examples of class-disambiguated names
    console.log(`🔍 [AI] Debug: Examples of class-disambiguated names:`);
    const sampleSpecs = [264, 251, 73, 577, 62]; // Restoration, Frost, Protection, Havoc, Arcane
    sampleSpecs.forEach(specId => {
      const spec = WOW_SPECIALIZATIONS.find(s => s.id === specId);
      if (spec) {
        const className = WOW_CLASSES.find(c => c.id === spec.classId)?.name || '';
        const fullName = className ? `${spec.name} ${className}` : spec.name;
        console.log(`  ${specId} → ${fullName}`);
      }
    });

    const userPrompt = `Analyze this Mythic+ season data for meta health:

SEASON: ${seasonId} | RUNS: ${allRuns.length} | PERIODS: ${periodsToProcess.length}

SPEC USAGE BY ROLE:
${JSON.stringify(specUsageData, null, 2)}

SPEC ID TO NAME MAPPING:
${JSON.stringify(aiSpecIdToName, null, 2)}

TOP COMPOSITIONS:
${JSON.stringify(topCompositions, null, 2)}

REQUIREMENTS:
- Use specName from data, never "Spec [ID]" or spec ID numbers
- Never include spec IDs in parentheses like "Restoration (264)" - use "Restoration Shaman"
- Use spec names in all text fields (summary, insights, balance issues, patterns)

Respond with ONLY valid JSON in the exact format specified. No markdown, no explanations.`;

    // Decide token parameter key based on model family
    const isGpt5Family = (openAIModel || '').toLowerCase().includes('gpt-5');
  const maxTokensMetaHealth = AI_MAX_TOKENS_META;

    // Helper to build prompt payloads with correct token param
    const buildPrompts = (useCompletionTokensParam, opts = {}) => {
      const { includeTemperature = !isGpt5Family, includeSeed = true } = opts;
      const tokenParam = useCompletionTokensParam
        ? { max_completion_tokens: maxTokensMetaHealth }
        : { max_tokens: maxTokensMetaHealth };
      const base = {
        model: openAIModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        ...(includeTemperature ? { temperature: 0.2 } : {}),
        ...(includeSeed ? { seed: 42 } : {}),
        ...tokenParam
      };
      return { base, withJson: { ...base, response_format: { type: "json_object" } } };
    };
    let includeTemperatureMH = !isGpt5Family;
    let includeSeedMH = true;
    let { base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(isGpt5Family, { includeTemperature: includeTemperatureMH, includeSeed: includeSeedMH });

    // Call OpenAI API with retry logic for rate limits
    console.log(`🤖 [AI] Calling OpenAI API for meta health analysis...`);
    
  let openAIResponse;
  let retryCount = 0;
  const maxRetries = 3;
  let triedWithoutJsonFormat = false;
  let swappedTokenParamOnce = false;
  let removedTemperatureMH = false;
  let removedSeedMH = false;
    
    while (retryCount <= maxRetries) {
      try {
        openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 210000
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 400 && !triedWithoutJsonFormat && (error.response?.data?.error?.message || '').toLowerCase().includes('response_format')) {
          console.log(`🤖 [AI] response_format not supported by model '${openAIModel}', retrying without it...`);
          triedWithoutJsonFormat = true;
          continue;
        }
        // Handle token param mismatch by flipping param once
        const errMsg = (error.response?.data?.error?.message || '').toLowerCase();
        if (error.response?.status === 400 && !swappedTokenParamOnce && (errMsg.includes('unsupported parameter') || errMsg.includes('max_tokens') || errMsg.includes('max_completion_tokens'))) {
          swappedTokenParamOnce = true;
          const currentlyUsingCompletion = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
          console.log(`🤖 [AI] Detected token param mismatch for model '${openAIModel}'. Switching token field and retrying...`);
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(!currentlyUsingCompletion, { includeTemperature: includeTemperatureMH, includeSeed: includeSeedMH }));
          continue;
        }
        // If temperature not supported, drop it and retry once
        if (error.response?.status === 400 && !removedTemperatureMH && errMsg.includes('temperature')) {
          console.log(`🤖 [AI] Temperature not supported for model '${openAIModel}', removing temperature and retrying...`);
          removedTemperatureMH = true;
          includeTemperatureMH = false;
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature: includeTemperatureMH, includeSeed: includeSeedMH }));
          continue;
        }
        // If seed not supported, drop it and retry once
        if (error.response?.status === 400 && !removedSeedMH && errMsg.includes('seed')) {
          console.log(`🤖 [AI] Seed not supported for model '${openAIModel}', removing seed and retrying...`);
          removedSeedMH = true;
          includeSeedMH = false;
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature: includeTemperatureMH, includeSeed: includeSeedMH }));
          continue;
        }
        if (error.response?.status === 429 && retryCount < maxRetries) {
          retryCount++;
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          let delay = retryAfterHeader ? Number(retryAfterHeader) * 1000 : Math.pow(2, retryCount) * 1000;
          delay = Math.round(delay * (1 + Math.random() * 0.25));
          console.log(`🤖 [AI] Rate limit hit, retrying in ${Math.round(delay/1000)}s (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Re-throw if not a 429 or max retries reached
        }
      }
    }

    const aiMessage = openAIResponse.data.choices?.[0];
    const aiResponse = aiMessage?.message?.content || '';
    const finishReason = aiMessage?.finish_reason;
    const usage = openAIResponse.data.usage || {};
    if (finishReason) {
      console.log(`🤖 [AI] finish_reason=${finishReason} prompt_tokens=${usage.prompt_tokens || 'n/a'} completion_tokens=${usage.completion_tokens || 'n/a'}`);
    }
    
    // Log the AI response for debugging
    console.log(`🤖 [AI] Raw AI response received (first 500 chars):`, aiResponse.substring(0, 500));
    if (aiResponse.includes('Spec ')) {
      console.log(`⚠️ [AI] WARNING: AI response contains "Spec " patterns!`);
      console.log(`🤖 [AI] Full AI response:`, aiResponse);
    }

    let parsedResponse;
    let parseErrorMemo;

    function tryStandardParses(raw) {
      try {
        return JSON.parse(raw);
      } catch (e1) {
        const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          try { return JSON.parse(codeBlockMatch[1]); } catch (e2) { /* fallthrough */ }
        }
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { return JSON.parse(jsonMatch[0]); } catch (e3) { /* fallthrough */ }
        }
        // simple brace repair
        const first = raw.indexOf('{');
        const last = raw.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last >= first) {
          let candidate = raw.slice(first, last + 1);
          const opens = (candidate.match(/\{/g) || []).length;
          const closes = (candidate.match(/\}/g) || []).length;
          if (opens > closes) {
            candidate = candidate + '}'.repeat(opens - closes);
            try { return JSON.parse(candidate); } catch (e4) { /* noop */ }
          }
        }
        parseErrorMemo = e1;
        return undefined;
      }
    }

    parsedResponse = tryStandardParses(aiResponse);

    if (!parsedResponse || finishReason === 'length') {
      console.warn(`⚠️ [AI] Response truncated due to token limit (${finishReason}). Consider increasing AI_MAX_TOKENS_META or making prompts more concise. Attempting reformat retry...`);
      const useCompletionTokensParam = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
      const tokenParam = useCompletionTokensParam ? { max_completion_tokens: Math.min(maxTokensMetaHealth * 2, 8000) } : { max_tokens: Math.min(maxTokensMetaHealth * 2, 8000) };
      const reformatBase = {
        model: openAIModel,
        messages: [
          { role: 'system', content: 'You will be given your previous output which is intended to be JSON. Convert it into strictly valid JSON that matches the requested schema. Do not add commentary. Respond with JSON only.' },
          { role: 'user', content: aiResponse || 'null' }
        ],
        ...tokenParam
      };
      const reformatWithJson = { ...reformatBase, response_format: { type: 'json_object' } };
      try {
        const reformatResp = await axios.post('https://api.openai.com/v1/chat/completions', reformatWithJson, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
        const reformatted = reformatResp.data.choices?.[0]?.message?.content || '';
        parsedResponse = tryStandardParses(reformatted);
      } catch (rfErr) {
        console.warn('⚠️ [AI] Reformat retry failed for meta-health');
      }
    }

    if (!parsedResponse) {
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: (parseErrorMemo && parseErrorMemo.message) || 'Invalid or truncated response',
        finishReason: finishReason || 'unknown',
        rawResponse: (aiResponse || '').substring(0, 2000)
      });
    }

    // Post-process to fix any spec IDs BEFORE validation
    console.log(`🔧 [AI] Post-processing response to ensure spec names are used...`);
    const processedResponse = JSON.parse(JSON.stringify(parsedResponse)); // Deep copy
    
    // Create spec ID to name mapping for post-processing
    const postProcessSpecIdToName = {};
    Object.keys(specUsageData).forEach(role => {
      Object.keys(specUsageData[role]).forEach(specId => {
        postProcessSpecIdToName[specId] = specUsageData[role][specId].specName;
      });
    });
    
    // Function to replace spec IDs with names in text - more aggressive pattern matching
    const replaceSpecIdsWithNames = (text) => {
      if (typeof text !== 'string') return text;
      let processed = text;
      
      // Replace "Spec [ID]" patterns
      Object.keys(postProcessSpecIdToName).forEach(specId => {
        const patterns = [
          new RegExp(`\\bSpec\\s+${specId}\\b`, 'gi'),
          new RegExp(`\\bSpec\\s*${specId}\\b`, 'gi'),
          new RegExp(`\\b${specId}\\s*\\([^)]*\\)`, 'gi'), // Spec 264 (healer)
          new RegExp(`\\bSpec\\s*${specId}\\s*\\([^)]*\\)`, 'gi') // Spec 264 (healer)
        ];
        
        patterns.forEach(pattern => {
          processed = processed.replace(pattern, postProcessSpecIdToName[specId]);
        });
      });
      
      // Remove spec IDs in parentheses like "Restoration (264)" -> "Restoration"
      processed = processed.replace(/\s*\(\d+\)/g, '');
      
      // Also replace any remaining "Spec [number]" patterns with a generic message
      processed = processed.replace(/\bSpec\s+\d+\b/gi, 'Unknown Spec');
      
      return processed;
    };
    
    // Process metaSummary
    if (processedResponse.metaSummary) {
      processedResponse.metaSummary.summary = replaceSpecIdsWithNames(processedResponse.metaSummary.summary);
      if (Array.isArray(processedResponse.metaSummary.keyInsights)) {
        processedResponse.metaSummary.keyInsights = processedResponse.metaSummary.keyInsights.map(replaceSpecIdsWithNames);
      }
    }
    
    // Process balanceIssues
    if (Array.isArray(processedResponse.balanceIssues)) {
      processedResponse.balanceIssues.forEach(issue => {
        issue.description = replaceSpecIdsWithNames(issue.description);
      });
    }
    
    // Process dominantPatterns if they exist
    if (processedResponse.compositionAnalysis && Array.isArray(processedResponse.compositionAnalysis.dominantPatterns)) {
      processedResponse.compositionAnalysis.dominantPatterns = processedResponse.compositionAnalysis.dominantPatterns.map(replaceSpecIdsWithNames);
    }
    
    // Process roleAnalysis names
    if (processedResponse.roleAnalysis) {
      Object.keys(processedResponse.roleAnalysis).forEach(role => {
        const roleData = processedResponse.roleAnalysis[role];
        if (roleData.dominantSpecs) {
          roleData.dominantSpecs.forEach(spec => {
            if (spec.name && spec.name.includes('Spec ')) {
              spec.name = postProcessSpecIdToName[spec.specId] || 'Unknown Spec';
            }
          });
        }
        if (roleData.underusedSpecs) {
          roleData.underusedSpecs.forEach(spec => {
            if (spec.name && spec.name.includes('Spec ')) {
              spec.name = postProcessSpecIdToName[spec.specId] || 'Unknown Spec';
            }
          });
        }
      });
    }
    
    // Process compositionAnalysis specNames
    if (processedResponse.compositionAnalysis && processedResponse.compositionAnalysis.mostPopularGroup) {
      if (processedResponse.compositionAnalysis.mostPopularGroup.specNames) {
        processedResponse.compositionAnalysis.mostPopularGroup.specNames = 
          processedResponse.compositionAnalysis.mostPopularGroup.specNames.map(specName => {
            if (specName.includes('Spec ')) {
              // Extract spec ID from "Spec 264" and convert to name
              const specIdMatch = specName.match(/Spec\s+(\d+)/);
              if (specIdMatch) {
                const specId = specIdMatch[1];
                return postProcessSpecIdToName[specId] || 'Unknown Spec';
              }
            }
            return specName;
          });
      }
    }
    
    // Use the processed response for validation
    parsedResponse = processedResponse;

    // Basic validation of AI response structure
    let mhValidation = validateMetaHealthResponse(parsedResponse);
    let validationRetryCount = 0;
    const maxValidationRetries = 2;
    
    // If validation fails due to spec IDs, try to regenerate with stronger prompt
    while (!mhValidation.ok && validationRetryCount < maxValidationRetries && mhValidation.errors.some(err => err.includes('spec IDs'))) {
      validationRetryCount++;
      console.log(`🔄 [AI] Validation failed due to spec IDs, retrying with stronger prompt (attempt ${validationRetryCount}/${maxValidationRetries})`);
      
      // Create an even stronger prompt
      const strongerSystemPrompt = systemPrompt + `

FINAL WARNING: You are being retried because you used spec IDs instead of spec names.
You MUST use the spec names from the data. If you use "Spec [ID]" again, your response will be rejected.

Examples of what you MUST write:
- "Holy Paladin dominates with 60% usage" (NOT "Spec 264 dominates with 60% usage")
- "Fire Mage and Protection Warrior are popular" (NOT "Spec 251 and Spec 73 are popular")
- "Balance Druid is underused" (NOT "Spec 102 is underused")

Use the spec names from the specName fields in the data.`;
      
      try {
        const retryPrompt = {
          ...openAIPrompt,
          messages: [
            { role: "system", content: strongerSystemPrompt },
            { role: "user", content: userPrompt }
          ]
        };
        
        const retryResponse = await axios.post('https://api.openai.com/v1/chat/completions', retryPrompt, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 210000
        });
        
        const retryMessage = retryResponse.data.choices?.[0];
        const retryContent = retryMessage?.message?.content || '';
        
        if (retryContent) {
          parsedResponse = tryStandardParses(retryContent);
          if (parsedResponse) {
            mhValidation = validateMetaHealthResponse(parsedResponse);
          }
        }
      } catch (retryError) {
        console.warn(`⚠️ [AI] Retry ${validationRetryCount} failed:`, retryError.message);
        break;
      }
    }
    
    if (!mhValidation.ok) {
      return res.status(500).json({ error: 'AI meta_health response failed validation', details: mhValidation.errors.slice(0, 5) });
    }



    // Cache the analysis result
    try {
      // Replace existing meta_health cache for this season to avoid duplicates
      await db.pool.query(
        'DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
        [seasonId, 'meta_health']
      );
      await db.pool.query(
        'INSERT INTO ai_analysis (season_id, analysis_data, analysis_type, confidence_score, data_quality) VALUES ($1, $2, $3, $4, $5)',
        [seasonId, parsedResponse, 'meta_health', 85, 'ai_generated']
      );
    } catch (cacheError) {
      console.error('Failed to cache meta health analysis:', cacheError);
      // Continue without caching
    }

    console.log(`✅ [AI] Meta health analysis completed for season ${seasonId}`);
    res.json(parsedResponse);

  } catch (error) {
    logAxiosError('Meta health analysis error:', error);
    
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'OpenAI rate limit exceeded. Please try again later.' });
    }
    
    if (error.response?.status === 401) {
      return res.status(500).json({ error: 'OpenAI API key is invalid or missing.' });
    }
    
    res.status(500).json({ error: 'Failed to analyze meta health' });
  }
});

// GET /ai/analysis/:season_id
// Get cached AI analysis for a season
router.get('/analysis/:season_id', async (req, res) => {
  const analysisType = req.query.type || 'predictions';
  console.log(`🤖 [AI] GET /ai/analysis/${req.params.season_id} (type=${analysisType})`);
  try {
    const season_id = Number(req.params.season_id);
    
    if (!season_id) {
      return res.status(400).json({ error: 'season_id is required' });
    }

    // Get analysis type from query parameter, default to 'predictions'
    // const analysisType = req.query.type || 'predictions';
    
    // Check if we have cached analysis
    const cachedResult = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
      [season_id, analysisType]
    );

    if (cachedResult.rows.length > 0) {
      const cached = cachedResult.rows[0];
      
             try {
         // Handle both string and object formats
         let analysisData;
         if (typeof cached.analysis_data === 'string') {
           analysisData = JSON.parse(cached.analysis_data);
         } else {
           analysisData = cached.analysis_data;
         }

         // Special case: empty tier_list should be treated as invalid cache
         if (analysisType === 'tier_list') {
           const tiers = analysisData?.tiers || {};
           const totalEntries = ['S','A','B','C','D'].reduce((acc, k) => acc + ((tiers[k] || []).length || 0), 0);
           if (!Number.isFinite(totalEntries) || totalEntries === 0) {
             console.warn(`⚠️ [AI] Empty tier_list cache detected for season ${season_id}; clearing and returning 404.`);
             await db.pool.query(
               'DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
               [season_id, analysisType]
             );
             return res.status(404).json({ error: `No cached analysis available for type '${analysisType}'. Please use POST /ai/tier-list to generate new analysis.` });
           }
         }
         
         // Check if cache is still valid (less than 8 hours old)
         const cacheAge = Date.now() - new Date(cached.created_at).getTime();
         const maxAge = 8 * 60 * 60 * 1000; // 8 hours
         
                   if (cacheAge < maxAge) {
            // Include cache metadata in the response
            const responseWithCache = {
              ...analysisData,
              _cache: {
                created_at: cached.created_at,
                age_hours: Math.round(cacheAge / (1000 * 60 * 60)),
                max_age_hours: 8
              }
            };
            return res.json(responseWithCache);
          }
               } catch (parseError) {
          console.error('❌ Failed to process cached analysis, clearing corrupted cache:', parseError);
          // Clear the corrupted cache entry
          await db.pool.query(
            'DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
            [season_id, analysisType]
          );
        }
    }

  // If no cache or expired, do not auto-trigger generation; instruct the client explicitly per type
  const generateHint = analysisType === 'meta_health'
    ? 'POST /ai/meta-health'
    : analysisType === 'tier_list'
      ? 'POST /ai/tier-list'
      : 'POST /ai/predictions';
  res.status(404).json({ error: `No cached analysis available for type '${analysisType}'. Please use ${generateHint} to generate new analysis.` });

  } catch (error) {
    console.error('[AI ANALYSIS ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /ai/affix-insights
// MVP: Affix-aware insights using week-over-week deltas; cached per (seasonId, periodId)
router.post('/affix-insights', async (req, res) => {
  try {
    const { seasonId, periodId: requestedPeriodId, dungeonId } = req.body || {};
    if (!seasonId) return res.status(400).json({ error: 'Missing required data: seasonId' });

    // Fetch required season data
    const compositionData = await getCompositionDataForSeason(seasonId);
    const specEvolution = await getSpecEvolutionForSeason(seasonId);
    if (!compositionData || !specEvolution) {
      return res.status(404).json({ error: 'No data available for this season' });
    }

    // Resolve target period: use provided or latest non-empty
    const nonEmptyPeriods = (compositionData.periods || []).filter(p => (p.keys_count || 0) > 0);
    if (nonEmptyPeriods.length === 0) {
      return res.status(404).json({ error: 'No non-empty periods found for this season' });
    }
    const latestPeriod = nonEmptyPeriods[nonEmptyPeriods.length - 1];
    const periodId = requestedPeriodId || latestPeriod.period_id;

    // Cache key per season+period
    const analysisType = `affix_insights_${periodId}${dungeonId ? `_d${dungeonId}` : ''}`;

    // Check cache (8h)
    const cached = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2 ORDER BY created_at DESC LIMIT 1',
      [seasonId, analysisType]
    );
    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      const ageMs = Date.now() - new Date(row.created_at).getTime();
        if (ageMs < 8 * 60 * 60 * 1000) {
        const data = typeof row.analysis_data === 'string' ? JSON.parse(row.analysis_data) : row.analysis_data;
          return res.json({ ...data, _cache: { created_at: row.created_at, age_hours: Math.round(ageMs / 3600000), max_age_hours: 8 } });
      }
    }

    // Find current and previous evolution entries
    const evo = specEvolution.evolution || [];
    const currentIdx = evo.findIndex(e => e.period_id === periodId);
    const idx = currentIdx >= 0 ? currentIdx : evo.length - 1;
    const current = evo[idx];
    const previous = idx > 0 ? evo[idx - 1] : null;
    if (!current || !current.spec_counts) {
      return res.status(404).json({ error: 'No evolution data for requested period' });
    }

    // Optionally filter by dungeon (MVP: skip filtering; placeholder retained)
    // Compute usage shares per spec for current and previous
    const sumCounts = (obj) => Object.values(obj || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    const curTotal = Math.max(1, sumCounts(current.spec_counts));
    const prevTotal = Math.max(1, sumCounts(previous?.spec_counts || {}));

    const specIds = Array.from(new Set([...Object.keys(current.spec_counts), ...Object.keys(previous?.spec_counts || {})])).map(Number);
    const changes = specIds.map((sid) => {
      const cur = (current.spec_counts[sid] || 0) / curTotal;
      const prev = (previous?.spec_counts?.[sid] || 0) / prevTotal;
      const delta = cur - prev; // share delta
      const magnitude = Math.abs(delta);
      // Confidence heuristic: base 60 + scaled by magnitude and sample size
      const confidence = Math.max(50, Math.min(95, Math.round(60 + magnitude * 200 + Math.min(curTotal, 2000) / 200)));
      return { specId: sid, delta, confidence };
    });

    const winners = changes
      .filter(c => c.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 6)
      .map(c => ({ specId: c.specId, reason: `Week-over-week usage share increased by ${(c.delta * 100).toFixed(1)}%.`, confidence: c.confidence }));

    const losers = changes
      .filter(c => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 6)
      .map(c => ({ specId: c.specId, reason: `Week-over-week usage share decreased by ${(Math.abs(c.delta) * 100).toFixed(1)}%.`, confidence: c.confidence }));

    const response = {
      summary: `Period ${current.week || ''}: ${winners.length} rising, ${losers.length} declining specs compared to previous week.`.trim(),
      winners,
      losers,
      dungeonTips: [],
      citations: { periodIds: previous ? [previous.period_id, current.period_id] : [current.period_id] }
    };

    try {
      // Replace existing cache row for this key
      await db.pool.query('DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2', [seasonId, analysisType]);
      await db.pool.query(
        'INSERT INTO ai_analysis (season_id, analysis_data, analysis_type, confidence_score, data_quality) VALUES ($1, $2, $3, $4, $5)',
        [seasonId, JSON.stringify(response), analysisType, 80, 'good']
      );
    } catch (cacheErr) {
      console.warn('Affix insights cache write failed:', cacheErr.message);
    }

    return res.json(response);
  } catch (err) {
  logAxiosError('[AI AFFIX INSIGHTS ERROR]', err);
    return res.status(500).json({ error: 'Failed to generate affix insights' });
  }
});

// POST /ai/tier-list
// Purpose: AI-powered S–D tier list for specs in the season (tiers only)
router.post('/tier-list', async (req, res) => {
  try {
    const { seasonId, forceRefresh } = req.body || {};
    if (!seasonId) return res.status(400).json({ error: 'Missing required data: seasonId' });

    // Cache check (8h TTL)
    const analysisType = 'tier_list';
    const cached = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2 ORDER BY created_at DESC LIMIT 1',
      [seasonId, analysisType]
    );
    if (cached.rows.length > 0 && !forceRefresh) {
      const row = cached.rows[0];
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const maxAge = 8 * 60 * 60 * 1000;
      if (ageMs < maxAge) {
        const data = typeof row.analysis_data === 'string' ? JSON.parse(row.analysis_data) : row.analysis_data;
        return res.json({ ...data, _cache: { created_at: row.created_at, age_hours: Math.round(ageMs/3600000), max_age_hours: 8 } });
      }
    }

    // Fetch data needed for prompt
    const compositionData = await getCompositionDataForSeason(seasonId);
    const specEvolution = await getSpecEvolutionForSeason(seasonId);
    if (!compositionData || !specEvolution) {
      return res.status(404).json({ error: 'No data available for this season' });
    }

    // Build compact usage snapshot per spec similar to meta health usage calc
  const maxPeriodsToProcess = Math.min(compositionData.total_periods, AI_MAX_PERIODS);
  const recentPeriods = compositionData.periods.slice(-maxPeriodsToProcess);
  // Use only non-empty periods to compute usage
  const periodsToProcess = recentPeriods.filter(p => Array.isArray(p.keys) && p.keys.length > 0);
    const roleTotals = { tank: 0, healer: 0, dps: 0 };
    const roleSpec = { tank: {}, healer: {}, dps: {} };
  // New: collect per-spec distribution by keystone level; build dynamic brackets later
  const specLevelCounters = {}; // specId -> { byLevel: { [level]: count }, top: number, levels: number[] }
  let levelBrackets = []; // dynamic percentiles (e.g., P40–P60, P60–P80, P80–P90, P90+)
  const specBracketCounters = {}; // specId -> { [label]: count }
  const allLevels = []; // collect all levels to compute percentiles
  periodsToProcess.forEach((period) => {
  const keys = (period.keys || []).slice(0, AI_MAX_KEYS_PER_PERIOD);
    keys.forEach((run) => {
        const countedSpecs = new Set();
        const countedRoles = new Set();
        (run.members || []).forEach((m) => {
          const specId = m.spec_id;
          const role = WOW_SPEC_ROLES[specId] || 'dps';
          if (!roleSpec[role][specId]) roleSpec[role][specId] = { appearances: 0 };
          if (!countedSpecs.has(specId)) { roleSpec[role][specId].appearances++; countedSpecs.add(specId); }
          if (!countedRoles.has(role)) { roleTotals[role]++; countedRoles.add(role); }

      // Level counters per spec (defer bracket counting until dynamic brackets are derived)
      const lvl = Number(run.keystone_level) || 0;
      if (!specLevelCounters[specId]) specLevelCounters[specId] = { byLevel: {}, top: 0, levels: [] };
      specLevelCounters[specId].byLevel[lvl] = (specLevelCounters[specId].byLevel[lvl] || 0) + 1;
      if (lvl > specLevelCounters[specId].top) specLevelCounters[specId].top = lvl;
      specLevelCounters[specId].levels.push(lvl);
      allLevels.push(lvl);
        });
      });
    });
    // Derive dynamic level brackets from observed keystone level distribution
    const buildPercentile = (sorted, p) => {
      if (!sorted.length) return 0;
      const idx = (sorted.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      const w = idx - lo;
      return sorted[lo] * (1 - w) + sorted[hi] * w;
    };
    if (allLevels.length > 0) {
      const sorted = allLevels.slice().sort((a, b) => a - b);
      const p40 = Math.round(buildPercentile(sorted, 0.40));
      const p60 = Math.round(buildPercentile(sorted, 0.60));
      const p80 = Math.round(buildPercentile(sorted, 0.80));
      const p90 = Math.round(buildPercentile(sorted, 0.90));
      // Ensure strictly increasing thresholds to avoid overlaps after rounding
      const t40 = p40;
      const t60 = Math.max(t40 + 1, p60);
      const t80 = Math.max(t60 + 1, p80);
      const t90 = Math.max(t80 + 1, p90);
      levelBrackets = [
        { label: 'P40-60', min: t40, max: t60 },
        { label: 'P60-80', min: t60, max: t80 },
        { label: 'P80-90', min: t80, max: t90 },
        { label: 'P90+',   min: t90, max: Infinity }
      ];
    } else {
      // Fallback (should be rare given noRunsData check)
      levelBrackets = [
        { label: 'P40-60', min: 10, max: 15 },
        { label: 'P60-80', min: 15, max: 20 },
        { label: 'P80-90', min: 20, max: 25 },
        { label: 'P90+',   min: 25, max: Infinity }
      ];
    }
    // Now count per-spec levels into dynamic brackets (max exclusive except last bucket)
    const pickBucket = (lvl) => {
      for (let i = 0; i < levelBrackets.length; i++) {
        const b = levelBrackets[i];
        const isLast = i === levelBrackets.length - 1;
        if (isLast ? (lvl >= b.min) : (lvl >= b.min && lvl < b.max)) return b;
      }
      return levelBrackets[0];
    };
    Object.entries(specLevelCounters).forEach(([sid, obj]) => {
      if (!specBracketCounters[sid]) specBracketCounters[sid] = {};
      levelBrackets.forEach(b => { if (specBracketCounters[sid][b.label] == null) specBracketCounters[sid][b.label] = 0; });
      (obj.levels || []).forEach((lvl) => {
        const bucket = pickBucket(lvl);
        specBracketCounters[sid][bucket.label] = (specBracketCounters[sid][bucket.label] || 0) + 1;
      });
    });
    // Compute usage% per spec (DPS divided by 3 spots)
    const usageBySpec = {};
    Object.keys(roleSpec).forEach((role) => {
      const totals = roleTotals[role] || 0;
      Object.entries(roleSpec[role]).forEach(([sid, val]) => {
        const appearances = val.appearances || 0;
        let usage = totals > 0 ? (appearances / totals) * 100 : 0;
        if (role === 'dps') {
          const totalDpsSpots = totals * 3; // approximate, roleTotals already per-run role count
          usage = totalDpsSpots > 0 ? (appearances / totalDpsSpots) * 100 : 0;
        }
        usageBySpec[sid] = Math.round(usage * 100) / 100;
      });
    });

    // New: create compact distribution features per spec
    const levelDistributionBySpec = {}; // specId -> { byBracketPct: {label: pct}, topLevel: n, medianLevel: n, appearances: n }
    Object.entries(specLevelCounters).forEach(([sid, obj]) => {
      const total = Object.values(obj.byLevel).reduce((a, b) => a + b, 0);
      const appearances = total;
      const countsByBracket = {};
      levelBrackets.forEach(b => { countsByBracket[b.label] = 0; });
      const sbc = specBracketCounters[sid] || {};
      Object.entries(sbc).forEach(([label, count]) => { countsByBracket[label] = (countsByBracket[label] || 0) + count; });
      const byBracketPct = {};
      levelBrackets.forEach(b => {
        const c = countsByBracket[b.label] || 0;
        byBracketPct[b.label] = total > 0 ? Math.round((c / total) * 1000) / 10 : 0; // one decimal
      });
      // median level
      const lvls = obj.levels ? obj.levels.slice().sort((a,b) => a-b) : [];
      let median = 0;
      if (lvls.length > 0) {
        const mid = Math.floor(lvls.length / 2);
        median = lvls.length % 2 ? lvls[mid] : (lvls[mid - 1] + lvls[mid]) / 2;
      }
      levelDistributionBySpec[sid] = {
        byBracketPct,
        topLevel: obj.top || 0,
        medianLevel: Math.round(median * 10) / 10,
        appearances
      };
    });

    // Role-normalized usage: compare usage to per-role expected share so DPS aren't penalized for having more specs
    const roleSpecCounts = { tank: 0, healer: 0, dps: 0 };
    WOW_SPECIALIZATIONS.forEach(s => { const r = WOW_SPEC_ROLES[s.id] || 'dps'; if (roleSpecCounts[r] !== undefined) roleSpecCounts[r]++; });
    const expectedShareByRole = {
      tank: roleSpecCounts.tank > 0 ? 100 / roleSpecCounts.tank : 0,       // one tank spot
      healer: roleSpecCounts.healer > 0 ? 100 / roleSpecCounts.healer : 0, // one healer spot
      dps: roleSpecCounts.dps > 0 ? (100 * 3) / (roleSpecCounts.dps * 3) : 0 // percent of all DPS spots per spec = 100/numDps
    };
    const roleNormalizedUsageBySpec = {}; // usage / expectedShare(role)
    Object.entries(usageBySpec).forEach(([sid, u]) => {
      const specIdNum = Number(sid);
      const role = WOW_SPEC_ROLES[specIdNum] || 'dps';
      const expected = expectedShareByRole[role] || 0;
      const ratio = expected > 0 ? (Number(u) / expected) : 0;
      roleNormalizedUsageBySpec[sid] = Math.round(ratio * 1000) / 1000; // keep 3 decimals
    });

    // If there's no recent runs data, do not synthesize from evolution; surface as an error
    const noRunsData = periodsToProcess.length === 0 || (roleTotals.tank + roleTotals.healer + roleTotals.dps) === 0;
    const evoSlice = (specEvolution.evolution || []).slice(-maxPeriodsToProcess);
    if (noRunsData) {
      return res.status(409).json({ error: 'Insufficient recent runs data to build tier list', periodsConsidered: periodsToProcess.length, evolutionPoints: evoSlice.length });
    }

  // Limit evolution window and include last few periods spec_counts for trend hints
  // (evoSlice computed above)

  let openAIModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  let isGpt5Family = (openAIModel || '').toLowerCase().includes('gpt-5');
  const maxTokens = AI_MAX_TOKENS_TIER;
  const AI_DEBUG = String(process.env.AI_DEBUG || 'true').toLowerCase() === 'true';
  const systemPrompt = `You are an expert World of Warcraft Mythic+ analyst. Build a spec tier list (S–D) for the current season.

RULES:
- Consider role context: tanks and healers each have 1 spot, DPS have 3 per group.
- Use role-normalized usage = usage / expectedShareForRole to compare specs fairly across roles.
- PRIORITIZE HIGH-KEY PERFORMANCE: Heavily weight presence in higher keystone brackets. You'll receive:
  - levelBracketDefs: dynamic percentile brackets (e.g., P40–P60 … P90+).
  - bracketWeights: numeric weights per bracket label (later/higher brackets have greater weights).
  - levelDistributionBySpec.byBracketPct: percent of runs per bracket for each spec.
  - highKeyPriorityScoreBySpec: a precomputed composite score that already emphasizes higher keys more than popularity.
- Ranking guidance:
  1) Rank primarily by highKeyPriorityScoreBySpec (higher is better).
  2) Break close ties using roleNormalizedUsageBySpec, then raw popularityScoreBySpec if needed.
  3) Use evolution trends only as secondary hints.
- Keep S-tier small and meaningful; do not exceed 5 specs across all roles in S.
- Avoid duplicates; each spec appears in exactly one tier.
- Prefer improving trends; very low usage goes to C/D unless high-key data strongly contradicts.
OUTPUT: JSON only with { "tiers": { "S": SpecEntry[], "A": SpecEntry[], "B": SpecEntry[], "C": SpecEntry[], "D": SpecEntry[] } }.
Use EXACT uppercase keys: "S","A","B","C","D"; include all keys even if empty.
SpecEntry fields: { specId, specName, className, role, usage }.`;

    const specRef = WOW_SPECIALIZATIONS.reduce((acc, s) => { acc[s.id] = { name: s.name, classId: s.classId }; return acc; }, {});
    const classRef = WOW_CLASSES.reduce((acc, c) => { acc[c.id] = c.name; return acc; }, {});
    const roleRef = WOW_SPEC_ROLES;

    // Compute bracket-driven high-key weighting and composite scores to emphasize higher keys
    // Define progressive weights for brackets (last bracket highest). If number of brackets differs, extra brackets use last weight.
    const defaultBracketWeights = [0.2, 0.6, 1.2, 2.2];
    const bracketWeights = {};
    levelBrackets.forEach((b, idx) => {
      const w = idx < defaultBracketWeights.length
        ? defaultBracketWeights[idx]
        : defaultBracketWeights[defaultBracketWeights.length - 1] + (idx - defaultBracketWeights.length + 1) * 0.4;
      bracketWeights[b.label] = Math.round(w * 100) / 100;
    });

    // Compute high-key bias per spec: sum of (share_in_bracket * weight)
    const highKeyBiasBySpec = {};
    let maxHighKeyBias = 0;
    Object.entries(levelDistributionBySpec).forEach(([sid, dist]) => {
      const byPct = dist.byBracketPct || {};
      let bias = 0;
      levelBrackets.forEach((b) => {
        const sharePct = Number(byPct[b.label] || 0);
        const share = Math.max(0, Math.min(1, sharePct / 100));
        bias += share * (Number(bracketWeights[b.label]) || 0);
      });
      highKeyBiasBySpec[sid] = Math.round(bias * 1000) / 1000;
      if (bias > maxHighKeyBias) maxHighKeyBias = bias;
    });

    // Normalize role-normalized usage and raw popularity for composite scoring
    let maxRoleNorm = 0; Object.values(roleNormalizedUsageBySpec).forEach(v => { const n = Number(v) || 0; if (n > maxRoleNorm) maxRoleNorm = n; });
    let maxUsage = 0; Object.values(usageBySpec).forEach(u => { const n = Number(u) || 0; if (n > maxUsage) maxUsage = n; });
    const popularityScoreBySpec = {};
    Object.entries(usageBySpec).forEach(([sid, u]) => { popularityScoreBySpec[sid] = maxUsage > 0 ? Math.round((Number(u)/maxUsage) * 1000) / 1000 : 0; });

    // Composite score prioritizing higher keys but giving popularity a bit more weight
    const highKeyPriorityScoreBySpec = {};
    Object.keys(usageBySpec).forEach((sid) => {
      const rn = maxRoleNorm > 0 ? (Number(roleNormalizedUsageBySpec[sid] || 0) / maxRoleNorm) : 0;
      const hb = maxHighKeyBias > 0 ? (Number(highKeyBiasBySpec[sid] || 0) / maxHighKeyBias) : 0;
      // Blend role-normalized usage with raw popularity to reflect both fairness and actual pick rates
      const pop = Number(popularityScoreBySpec[sid] || 0);
      const usageComposite = 0.8 * rn + 0.2 * pop; // heavier on role-normalized, but include raw pop
      const score = 0.55 * hb + 0.45 * usageComposite; // still emphasize high keys, but give usage more weight than before
      highKeyPriorityScoreBySpec[sid] = Math.round(score * 1000) / 1000;
    });

    const payloadData = {
      seasonId,
      usageBySpec,
      expectedShareByRole,
      roleNormalizedUsageBySpec,
      popularityScoreBySpec,
      levelBracketDefs: levelBrackets,
      bracketWeights,
      levelDistributionBySpec,
      highKeyBiasBySpec,
      highKeyPriorityScoreBySpec,
      evolution: evoSlice.map(e => ({ period_id: e.period_id, spec_counts: e.spec_counts })),
      specRef,
      classRef,
      roleRef
    };

    const buildPrompts = (useCompletionTokensParam, opts = {}) => {
      // recompute in case model changed
      isGpt5Family = (openAIModel || '').toLowerCase().includes('gpt-5');
      const { includeTemperature = !isGpt5Family, includeSeed = true } = opts;
      const tokenParam = useCompletionTokensParam ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
      const base = {
        model: openAIModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Build a Mythic+ spec tier list using this data. Respond with JSON only.\n${JSON.stringify(payloadData)}` }
        ],
        ...(includeTemperature ? { temperature: 0.2 } : {}),
        ...(includeSeed ? { seed: 42 } : {}),
        ...tokenParam
      };
      return { base, withJson: { ...base, response_format: { type: 'json_object' } } };
    };

  let includeTemperature = !isGpt5Family;
    let includeSeed = true;
    let { base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(isGpt5Family, { includeTemperature, includeSeed });
    let openAIResponse;
    let retryCount = 0;
    const maxRetries = 3;
    let triedWithoutJsonFormat = false;
    let swappedTokenParamOnce = false;
    let removedTemperature = false;
    let removedSeed = false;
    let timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || 210000; // 210s default, configurable

  let switchedModel = false; // deprecated: no model fallback
  while (retryCount <= maxRetries) {
      try {
        const promptPayload = triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt;
        if (AI_DEBUG) {
          const usingCompletionParam = 'max_completion_tokens' in promptPayload;
          const tokenCap = usingCompletionParam ? promptPayload.max_completion_tokens : promptPayload.max_tokens;
          const rf = !!promptPayload.response_format;
          console.log(`🤖 [AI] tier-list request: model=${openAIModel} timeoutMs=${timeoutMs} tokenKey=${usingCompletionParam ? 'max_completion_tokens' : 'max_tokens'} cap=${tokenCap} response_format=${rf} includeTemperature=${!!promptPayload.temperature} includeSeed=${'seed' in promptPayload}`);
        }
        const t0 = Date.now();
        openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', promptPayload, {
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          timeout: timeoutMs
        });
        if (AI_DEBUG) {
          console.log(`⏱️ [AI] tier-list latency=${Date.now()-t0}ms`);
        }
        break;
      } catch (error) {
        const isTimeout = (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout'));
        // Retry on timeout/abort with backoff and increased timeout
        if (isTimeout && retryCount < maxRetries) {
          retryCount++;
          timeoutMs = Math.min(timeoutMs + 30000, 180000); // bump by 30s up to 180s
          const delay = Math.round(Math.pow(2, retryCount) * 500 * (1 + Math.random() * 0.25));
          console.warn(`🤖 [AI] OpenAI request timed out, retrying in ${Math.round(delay/1000)}s with timeout ${Math.round(timeoutMs/1000)}s (attempt ${retryCount}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        const errMsg = (error.response?.data?.error?.message || '').toLowerCase();
        if (error.response?.status === 400 && !triedWithoutJsonFormat && errMsg.includes('response_format')) { triedWithoutJsonFormat = true; continue; }
        if (error.response?.status === 400 && !swappedTokenParamOnce && (errMsg.includes('max_tokens') || errMsg.includes('max_completion_tokens') || errMsg.includes('unsupported parameter'))) {
          swappedTokenParamOnce = true;
          const currentlyUsingCompletion = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
          ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts(!currentlyUsingCompletion, { includeTemperature, includeSeed }));
          continue;
        }
        if (error.response?.status === 400 && !removedTemperature && errMsg.includes('temperature')) { removedTemperature = true; includeTemperature = false; ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature, includeSeed })); continue; }
        if (error.response?.status === 400 && !removedSeed && errMsg.includes('seed')) { removedSeed = true; includeSeed = false; ({ base: openAIPromptBase, withJson: openAIPrompt } = buildPrompts('max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt), { includeTemperature, includeSeed })); continue; }
        if (error.response?.status === 429 && retryCount < maxRetries) { retryCount++; let delay = Math.pow(2, retryCount) * 1000; delay = Math.round(delay * (1 + Math.random()*0.25)); await new Promise(r => setTimeout(r, delay)); continue; }
        throw error;
      }
    }

    const aiMessage = openAIResponse.data.choices?.[0];
    const aiRaw = aiMessage?.message?.content || '';
    const finishReason = aiMessage?.finish_reason;
    const usage = openAIResponse.data.usage || {};
    if (finishReason) {
      console.log(`🤖 [AI] tier-list finish_reason=${finishReason} prompt_tokens=${usage.prompt_tokens || 'n/a'} completion_tokens=${usage.completion_tokens || 'n/a'}`);
    }
    if (AI_DEBUG) {
      console.log(`📦 [AI] tier-list raw_length=${aiRaw.length} chars (showing preview)`);
      console.log((aiRaw || '').slice(0, 800));
    }
    const tryParse = (raw) => {
      try { return JSON.parse(raw); } catch (e1) {
        const code = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/); if (code) { try { return JSON.parse(code[1]); } catch {}};
        const any = raw.match(/\{[\s\S]*\}/); if (any) { try { return JSON.parse(any[0]); } catch {}};
        return undefined; }
    };
    let parsed = tryParse(aiRaw);
    if (!parsed || finishReason === 'length') {
      const useCompletionTokensParam = 'max_completion_tokens' in (triedWithoutJsonFormat ? openAIPromptBase : openAIPrompt);
      const tokenParam = useCompletionTokensParam ? { max_completion_tokens: Math.min(maxTokens*2, 16000) } : { max_tokens: Math.min(maxTokens*2, 16000) };
      const reformat = { model: openAIModel, messages: [ { role: 'system', content: 'You will be given your previous output which is intended to be JSON. Convert it into strictly valid JSON that matches the requested schema. Respond with JSON only.' }, { role: 'user', content: aiRaw || 'null' } ], ...tokenParam, response_format: { type: 'json_object' } };
      try {
        const rf = await axios.post('https://api.openai.com/v1/chat/completions', reformat, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
        const rfRaw = rf.data.choices?.[0]?.message?.content || '';
        parsed = tryParse(rfRaw);
      } catch {}
    }
    if (!parsed) return res.status(500).json({ error: 'Failed to parse AI response' });

    // Normalize and enrich spec entries with canonical names and classes
    const tiers = parsed.tiers || {};
    if (AI_DEBUG) {
      const rawTierKeys = Object.keys(tiers || {});
      console.log(`🧩 [AI] parsed keys=${Object.keys(parsed)} tier_keys_raw=${JSON.stringify(rawTierKeys)}`);
    }
    const normTiers = { S: [], A: [], B: [], C: [], D: [] };
    const normalizeTierKey = (key) => {
      if (typeof key !== 'string') return null;
      let k = key.trim();
      // remove suffix like " tier", "-tier", "_tier"
      k = k.replace(/\s*[-_\s]*tier$/i, '');
      // take first character and uppercase
      const ch = k.charAt(0).toUpperCase();
      return ['S','A','B','C','D'].includes(ch) ? ch : null;
    };
    const unknownTierKeys = [];
    const pushNorm = (tierKey, entry) => {
      const specId = Number(entry.specId);
      const spec = WOW_SPECIALIZATIONS.find(s => s.id === specId);
      const className = spec ? (WOW_CLASSES.find(c => c.id === spec.classId)?.name || 'Unknown') : (entry.className || 'Unknown');
      const role = WOW_SPEC_ROLES[specId] || entry.role || 'dps';
      const usage = typeof entry.usage === 'number' ? entry.usage : Number(usageBySpec[specId] || 0);
      normTiers[tierKey].push({
        specId,
        specName: spec?.name || entry.specName || `Spec ${specId}`,
        className,
        role,
  usage
      });
    };
    Object.entries(tiers).forEach(([k, arr]) => {
      const nk = normalizeTierKey(k);
      if (!nk || !Array.isArray(arr)) { unknownTierKeys.push(k); return; }
      arr.forEach(e => pushNorm(nk, e));
    });
    if (AI_DEBUG) {
      const counts = Object.fromEntries(['S','A','B','C','D'].map(k => [k, normTiers[k].length]));
      console.log(`📊 [AI] normalized tier counts=${JSON.stringify(counts)} unknown_keys_ignored=${JSON.stringify(unknownTierKeys)}`);
    }

    const result = { tiers: normTiers };

    // Validate + sanity check: require non-empty tiers overall
    const validation = validateTierListResponse(result);
    const totalEntries = ['S','A','B','C','D'].reduce((acc, k) => acc + (result.tiers[k]?.length || 0), 0);
    if (!validation.ok || totalEntries === 0) {
      console.warn('⚠️ [AI] Tier-list validation failed or empty result; attempting strict retry');
      const strictSystem = `${systemPrompt}\n- CRITICAL: Assign every viable spec to exactly one tier; do not leave tiers empty. Aim for 20-26 total entries.`;
      const mk = (useCompletionTokensParam) => {
        const strictCap = Math.min(AI_MAX_TOKENS_TIER * 2, 16000);
        const tokenParam = useCompletionTokensParam ? { max_completion_tokens: strictCap } : { max_tokens: strictCap };
        return {
          model: openAIModel,
          messages: [
            { role: 'system', content: strictSystem },
            { role: 'user', content: `Build a Mythic+ spec tier list using this data. Respond with JSON only.\n${JSON.stringify(payloadData)}` }
          ],
          temperature: 0.1,
          seed: 42,
          ...tokenParam,
          response_format: { type: 'json_object' }
        };
      };
      try {
        const strictPayload = mk(true);
        if (AI_DEBUG) {
          console.log(`🤖 [AI] strict retry: model=${openAIModel} tokenKey=max_completion_tokens cap=${strictPayload.max_completion_tokens} timeout=${OPENAI_TIMEOUT_MS}`);
        }
        const t1 = Date.now();
        const strictResp = await axios.post('https://api.openai.com/v1/chat/completions', strictPayload, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: OPENAI_TIMEOUT_MS });
        if (AI_DEBUG) console.log(`⏱️ [AI] strict latency=${Date.now()-t1}ms`);
        const strictRaw = strictResp.data.choices?.[0]?.message?.content || '';
        const strictFinish = strictResp.data.choices?.[0]?.finish_reason;
        const strictUsage = strictResp.data.usage || {};
        if (strictFinish) console.log(`🤖 [AI] strict finish_reason=${strictFinish} prompt_tokens=${strictUsage.prompt_tokens || 'n/a'} completion_tokens=${strictUsage.completion_tokens || 'n/a'} raw_length=${strictRaw.length}`);
        const tryParse2 = (raw) => { try { return JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : undefined; } catch { return undefined; } } };
        const strictParsed = tryParse2(strictRaw) || {};
        const strictTiers = strictParsed.tiers || {};
  const strictNorm = { S: [], A: [], B: [], C: [], D: [] };
        Object.entries(strictTiers).forEach(([k, arr]) => {
          const nk = normalizeTierKey(k);
          if (!nk || !Array.isArray(arr)) return;
          arr.forEach(e => pushNorm(nk, e));
        });
        const strictResult = { tiers: strictNorm };
        const totalStrict = ['S','A','B','C','D'].reduce((acc, k) => acc + (strictResult.tiers[k]?.length || 0), 0);
        const v2 = validateTierListResponse(strictResult);
        if (AI_DEBUG) {
          const counts2 = Object.fromEntries(['S','A','B','C','D'].map(k => [k, strictResult.tiers[k].length]));
          console.log(`📊 [AI] strict normalized counts=${JSON.stringify(counts2)} validation_ok=${v2.ok} total=${totalStrict}${v2.ok ? '' : ` errors=${JSON.stringify(v2.errors?.slice(0,10) || [])}`}`);
        }
        if (!v2.ok || totalStrict === 0) {
          console.warn('⚠️ [AI] Strict retry still invalid/empty. Returning error (no fallback).');
          const counts2 = Object.fromEntries(['S','A','B','C','D'].map(k => [k, strictResult.tiers[k].length]));
          return res.status(502).json({ error: 'AI tier list invalid after strict retry', details: v2.errors?.slice(0,10) || [], counts: counts2 });
        } else {
          Object.assign(result, strictResult);
        }
      } catch (reErr) {
        console.warn('⚠️ [AI] Strict retry errored. Returning error (no fallback).');
        return res.status(502).json({ error: 'AI tier list strict retry failed', message: reErr?.message || 'unknown error' });
      }
    }

    // Cache
    try {
      await db.pool.query('DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2', [seasonId, analysisType]);
      await db.pool.query(
        'INSERT INTO ai_analysis (season_id, analysis_data, analysis_type, confidence_score, data_quality) VALUES ($1, $2, $3, $4, $5)',
        [seasonId, JSON.stringify(result), analysisType, 85, 'ai_generated']
      );
    } catch (e) { console.warn('Tier list cache write failed:', e.message); }

    return res.json(result);
  } catch (err) {
    logAxiosError('[AI TIER LIST ERROR]', err);
  return res.status(500).json({ error: 'Failed to generate tier list' });
  }
});
// baseline builder removed to avoid non-AI fallbacks

module.exports = router; 