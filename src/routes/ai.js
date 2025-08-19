const express = require('express');
const axios = require('axios');
const db = require('../services/db');
const { WOW_SPECIALIZATIONS, WOW_CLASSES, WOW_CLASS_COLORS, WOW_SPEC_ROLES } = require('../config/constants');
const { getSpecEvolutionForSeason, getCompositionDataForSeason } = require('../services/meta-helpers');

const router = express.Router();

// Lightweight validators (no external deps)
function isNumberArray(a) { return Array.isArray(a) && a.every(n => typeof n === 'number' && Number.isFinite(n)); }
function isStringArray(a) { return Array.isArray(a) && a.every(s => typeof s === 'string'); }

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

function validateMetaHealthResponse(resp) {
  const errors = [];
  if (!resp || typeof resp !== 'object') errors.push('response not an object');
  const ms = resp.metaSummary;
  if (!ms || typeof ms !== 'object') errors.push('metaSummary missing');
  else {
    if (typeof ms.overallState !== 'string') errors.push('metaSummary.overallState must be string');
    if (typeof ms.summary !== 'string') errors.push('metaSummary.summary must be string');
    if (!isStringArray(ms.keyInsights || [])) errors.push('metaSummary.keyInsights must be string[]');
  }
  const ra = resp.roleAnalysis;
  if (!ra || typeof ra !== 'object') errors.push('roleAnalysis missing');
  else {
    ['tank','healer','dps'].forEach(role => {
      const r = ra[role];
      if (!r || typeof r !== 'object') { errors.push(`roleAnalysis.${role} missing`); return; }
      if (!Array.isArray(r.dominantSpecs)) errors.push(`roleAnalysis.${role}.dominantSpecs must be array`);
      if (!Array.isArray(r.underusedSpecs)) errors.push(`roleAnalysis.${role}.underusedSpecs must be array`);
      if (typeof r.healthStatus !== 'string') errors.push(`roleAnalysis.${role}.healthStatus must be string`);
      if (typeof r.totalRuns !== 'number') errors.push(`roleAnalysis.${role}.totalRuns must be number`);
    });
  }
  if (!Array.isArray(resp.balanceIssues)) errors.push('balanceIssues must be array');
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
  const maxPeriodsToProcess = Math.min(seasonData.total_periods, 18); // Limit to 18 periods max (token-friendly)
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
      const maxKeysPerPeriod = 1000;
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
    const maxTokensPredictions = 10000; // 10k

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
          timeout: 90000 // 90 second timeout
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
    console.error('[AI PREDICTIONS ERROR]', error);
    
    if (error.response) {
      console.error('OpenAI API Error:', error.response.status, error.response.data);
      
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

    // Process and condense data for AI analysis (similar to predictions endpoint)
    console.log(`📊 [AI] Processing data for meta health analysis...`);
    
    // Limit processing to avoid memory and token issues
  const maxPeriodsToProcess = Math.min(compositionData.total_periods, 18);
    const periodsToProcess = compositionData.periods.slice(-maxPeriodsToProcess);
    
    // Process composition data for meta health analysis
    const metaHealthData = {
      season: {
        id: seasonId,
        totalPeriods: compositionData.total_periods,
        totalKeys: compositionData.total_keys,
        processedPeriods: periodsToProcess.length
      },
      roleAnalysis: {
        tank: { specs: {}, totalRuns: 0, compositions: [] },
        healer: { specs: {}, totalRuns: 0, compositions: [] },
        dps: { specs: {}, totalRuns: 0, compositions: [] }
      },
      compositionAnalysis: {
        totalCompositions: 0,
        compositionCounts: {},
        roleBalance: { tank: 0, healer: 0, dps: 0 }
      },
      temporalAnalysis: {
        periodData: [],
        specEvolution: specEvolution.evolution.slice(-maxPeriodsToProcess) // Limit evolution data too
      }
    };

    // Process periods for meta health analysis
    periodsToProcess.forEach((period, periodIndex) => {
      const periodKeys = period.keys;
      const totalLevel = periodKeys.reduce((sum, run) => sum + run.keystone_level, 0);
      const avgLevelForPeriod = periodKeys.length > 0 ? totalLevel / periodKeys.length : 0;
      
      // Limit keys processed per period to avoid memory issues
      const maxKeysPerPeriod = 1000;
      const keysToProcess = periodKeys.slice(0, maxKeysPerPeriod);
      
      const periodStats = {
        period: periodIndex + 1,
        totalRuns: keysToProcess.length,
        avgLevel: avgLevelForPeriod,
        roleCounts: { tank: 0, healer: 0, dps: 0 },
        specCounts: {},
        compositions: []
      };

      keysToProcess.forEach((run) => {
        const composition = [];
        const roleCounts = { tank: 0, healer: 0, dps: 0 };
        
        // Track which specs appeared in this run
        const runSpecs = new Set();
        const runRoles = new Set();
        
        run.members?.forEach((member) => {
          const specId = member.spec_id;
          const role = WOW_SPEC_ROLES[specId] || 'dps';
          
          // Count specs by role (only once per run)
          if (!metaHealthData.roleAnalysis[role].specs[specId]) {
            metaHealthData.roleAnalysis[role].specs[specId] = {
              appearances: 0,
              totalRuns: 0,
              avgLevel: 0
            };
          }
          
          // Only count each spec once per run
          if (!runSpecs.has(specId)) {
            metaHealthData.roleAnalysis[role].specs[specId].appearances++;
            metaHealthData.roleAnalysis[role].specs[specId].totalRuns++;
            metaHealthData.roleAnalysis[role].specs[specId].avgLevel += run.keystone_level;
            runSpecs.add(specId);
          }
          
          // Only count each role once per run
          if (!runRoles.has(role)) {
            metaHealthData.roleAnalysis[role].totalRuns++;
            runRoles.add(role);
          }
          
          roleCounts[role]++;
          periodStats.roleCounts[role]++;
          periodStats.specCounts[specId] = (periodStats.specCounts[specId] || 0) + 1;
          composition.push(specId);
        });
        
        // Track composition
        const compositionKey = composition.sort().join(',');
        if (!metaHealthData.compositionAnalysis.compositionCounts[compositionKey]) {
          metaHealthData.compositionAnalysis.compositionCounts[compositionKey] = {
            count: 0,
            avgLevel: 0,
            specs: composition
          };
        }
        metaHealthData.compositionAnalysis.compositionCounts[compositionKey].count++;
        metaHealthData.compositionAnalysis.compositionCounts[compositionKey].avgLevel += run.keystone_level;
        metaHealthData.compositionAnalysis.totalCompositions++;
        
        // Track role balance
        metaHealthData.compositionAnalysis.roleBalance.tank += roleCounts.tank;
        metaHealthData.compositionAnalysis.roleBalance.healer += roleCounts.healer;
        metaHealthData.compositionAnalysis.roleBalance.dps += roleCounts.dps;
      });
      
      // Calculate averages for specs
      Object.keys(metaHealthData.roleAnalysis).forEach(role => {
        Object.keys(metaHealthData.roleAnalysis[role].specs).forEach(specId => {
          const spec = metaHealthData.roleAnalysis[role].specs[specId];
          if (spec.totalRuns > 0) {
            spec.avgLevel = Math.round(spec.avgLevel / spec.totalRuns);
          }
        });
      });
      
      metaHealthData.temporalAnalysis.periodData.push(periodStats);
    });

    // Calculate averages for compositions and limit to top compositions only
    const sortedCompositions = Object.entries(metaHealthData.compositionAnalysis.compositionCounts)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 30); // Only keep top 30 compositions
    
    const limitedCompositionCounts = {};
    sortedCompositions.forEach(([key, comp]) => {
      if (comp.count > 0) {
        comp.avgLevel = Math.round(comp.avgLevel / comp.count);
      }
      limitedCompositionCounts[key] = comp;
    });
    
    metaHealthData.compositionAnalysis.compositionCounts = limitedCompositionCounts;

    // Enhanced composition analysis: focus on the most popular group and spec replacements
    const compositionAnalysis = {
      mostPopularGroup: null,
      specReplacements: {},
      compositionDiversity: 'Medium',
      dominantPatterns: []
    };

    // Find the single most popular composition
    const topCompositions = Object.entries(limitedCompositionCounts)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 1); // Only the most popular composition

    if (topCompositions.length > 0) {
      const mostPopularComposition = topCompositions[0][1];
      const mostPopularSpecs = new Set(mostPopularComposition.specs);
      
      // Set the most popular group
      compositionAnalysis.mostPopularGroup = {
        specs: mostPopularComposition.specs,
        specNames: mostPopularComposition.specs.map(specId => WOW_SPECIALIZATIONS[specId] || `Spec ${specId}`),
        usage: (mostPopularComposition.count / metaHealthData.compositionAnalysis.totalCompositions) * 100,
        avgLevel: mostPopularComposition.avgLevel,
        count: mostPopularComposition.count
      };

      // Analyze spec replacements for each member of the most popular group
      const specReplacements = {};
      
      mostPopularComposition.specs.forEach(specId => {
        const specName = WOW_SPECIALIZATIONS[specId] || `Spec ${specId}`;
        const role = WOW_SPEC_ROLES[specId] || 'dps';
        
        // Find all compositions where this spec is replaced by another spec
        const replacements = [];
        const replacementCounts = {};
        
        Object.entries(limitedCompositionCounts).forEach(([key, comp]) => {
          if (comp.specs.length !== 5) return; // Only 5-spec compositions
          
          // Check if this composition shares 4 specs with the most popular group
          const sharedSpecs = comp.specs.filter(spec => mostPopularSpecs.has(spec));
          if (sharedSpecs.length === 4) {
            // Find which spec is different (the replacement)
            const differentSpec = comp.specs.find(spec => !mostPopularSpecs.has(spec));
            const replacedSpec = mostPopularComposition.specs.find(spec => !comp.specs.includes(spec));
            
            // Only count if this composition is replacing the specific spec we're analyzing
            if (replacedSpec === specId && differentSpec) {
              const replacementRole = WOW_SPEC_ROLES[differentSpec] || 'dps';
              
              // Only count if the replacement is the same role as the original spec
              if (replacementRole === role) {
                if (!replacementCounts[differentSpec]) {
                  replacementCounts[differentSpec] = {
                    count: 0,
                    avgLevel: 0,
                    specName: WOW_SPECIALIZATIONS[differentSpec] || `Spec ${differentSpec}`,
                    role: replacementRole
                  };
                }
                replacementCounts[differentSpec].count += comp.count;
                replacementCounts[differentSpec].avgLevel += comp.avgLevel * comp.count;
              }
            }
          }
        });
        
        // Convert to array and sort by count
        const sortedReplacements = Object.entries(replacementCounts)
          .map(([specId, data]) => ({
            specId: parseInt(specId),
            specName: data.specName,
            count: data.count,
            avgLevel: Math.round(data.avgLevel / data.count),
            usage: (data.count / metaHealthData.compositionAnalysis.totalCompositions) * 100,
            role: data.role
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5); // Top 5 replacements
        
        specReplacements[specId] = {
          specName: specName,
          role: role,
          replacements: sortedReplacements
        };
      });
      
      compositionAnalysis.specReplacements = specReplacements;
    }

    // Assess composition diversity
    const uniqueCompositions = Object.keys(limitedCompositionCounts).length;
    const totalRuns = metaHealthData.compositionAnalysis.totalCompositions;
    const diversityRatio = uniqueCompositions / totalRuns;
    
    if (diversityRatio > 0.1) {
      compositionAnalysis.compositionDiversity = 'High';
    } else if (diversityRatio > 0.05) {
      compositionAnalysis.compositionDiversity = 'Medium';
    } else {
      compositionAnalysis.compositionDiversity = 'Low';
    }

    // Add composition analysis to metaHealthData
    metaHealthData.compositionAnalysis = {
      ...metaHealthData.compositionAnalysis,
      ...compositionAnalysis
    };
    // Create a brief composition summary for the AI prompt to reduce tokens
    const compositionBrief = {
      mostPopularGroup: metaHealthData.compositionAnalysis.mostPopularGroup,
      specReplacements: metaHealthData.compositionAnalysis.specReplacements,
      compositionDiversity: metaHealthData.compositionAnalysis.compositionDiversity
    };

    // Pre-calculate spec usage totals and percentages for each role
    const specUsageData = {
      tank: { specs: {}, totalRuns: metaHealthData.roleAnalysis.tank.totalRuns },
      healer: { specs: {}, totalRuns: metaHealthData.roleAnalysis.healer.totalRuns },
      dps: { specs: {}, totalRuns: metaHealthData.roleAnalysis.dps.totalRuns }
    };

    // Calculate usage percentages for each spec in each role
    Object.keys(metaHealthData.roleAnalysis).forEach(role => {
      const roleData = metaHealthData.roleAnalysis[role];
      const totalRuns = roleData.totalRuns;
      
      Object.keys(roleData.specs).forEach(specId => {
        const spec = roleData.specs[specId];
        
        // For DPS, account for 3 spots per group
        let usagePercentage;
        if (role === 'dps') {
          const totalPossibleDpsSpots = totalRuns * 3;
          usagePercentage = totalPossibleDpsSpots > 0 ? (spec.appearances / totalPossibleDpsSpots) * 100 : 0;
        } else {
          // For tank and healer, use total runs (1 spot per group)
          usagePercentage = totalRuns > 0 ? (spec.appearances / totalRuns) * 100 : 0;
        }
        
        specUsageData[role].specs[specId] = {
          appearances: spec.appearances,
          usagePercentage: Math.round(usagePercentage * 100) / 100, // Round to 2 decimal places
          avgLevel: spec.avgLevel
        };
      });
    });

    // Prepare data for OpenAI analysis
  const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    
  const systemPrompt = `You are an expert World of Warcraft Mythic+ meta analyst. Your task is to provide simple, clear insights about the current meta state.

ANALYSIS REQUIREMENTS:
1. Identify the most dominant specs in each role (tank, healer, dps)
   - For tank and healer roles: identify the 3 specs with the HIGHEST usage percentages, but ONLY include specs with 5% or higher usage. If fewer than 3 specs meet the 5% threshold, include only those that do.
   - For DPS role: identify the 3 specs with the HIGHEST usage percentages (since there are 3 DPS spots in a group)
   - IMPORTANT: Sort specs by usage percentage (highest to lowest) for dominantSpecs
   - IMPORTANT: Use the pre-calculated usage percentages from the SPEC USAGE DATA - do NOT calculate percentages yourself
   - NOTE: DPS percentages are calculated based on total possible DPS spots (totalRuns * 3), not just total runs
2. Identify any specs that are clearly underperforming or rarely used
   - For each role: identify the 3 specs with the LOWEST usage percentages
   - IMPORTANT: Sort specs by usage percentage (lowest to highest) and take the bottom 3 for underusedSpecs
   - IMPORTANT: Use the pre-calculated usage percentages from the SPEC USAGE DATA
3. Analyze the most popular group composition and spec flexibility:
   - Focus on the single most popular group composition (defined by its 5 unique spec IDs)
   - For each of the 5 specs in the most popular group, identify which other specs are most likely to replace them
   - Analyze how often each spec in the popular group gets replaced and by which alternatives
   - Consider if the meta is flexible (many viable replacements) or rigid (few alternatives)
   - Note if certain specs in the popular group are more replaceable than others
4. Assess if there are any obvious balance issues:
   - For tank/healer: a single spec having more than 50% usage is concerning, 75% or more is bad for meta health  
   - For DPS: a single spec having more than 15% usage is too high (considering 26 DPS specs and only 3 spots available)
   - For DPS: if the accumulated usage of the top 3 specs is more than 46% of the total runs, then the DPS meta is bad
5. Provide 2-3 simple, actionable insights about the meta
6. Use the pre-calculated total run counts from the SPEC USAGE DATA
7. Keep output concise: dominantSpecs and underusedSpecs lists should include at most 3 items per role. Keep each description under 25 words.

SPEC ROLES MAPPING:
- Tank specs: 73, 66, 250, 104, 581, 268
- Healer specs: 65, 256, 257, 264, 105, 270, 1468
- DPS specs: 71, 72, 70, 253, 254, 255, 259, 260, 261, 258, 251, 252, 262, 263, 62, 63, 64, 265, 266, 267, 269, 102, 103, 577, 1467, 1473

SPEC NAMES REFERENCE:
- Tank specs: 73 (Protection Warrior), 66 (Protection Paladin), 250 (Blood Death Knight), 104 (Guardian Druid), 581 (Vengeance Demon Hunter), 268 (Brewmaster Monk)
- Healer specs: 65 (Holy Paladin), 256 (Discipline Priest), 257 (Holy Priest), 264 (Restoration Shaman), 105 (Restoration Druid), 270 (Mistweaver Monk), 1468 (Preservation Evoker)
- DPS specs: 71 (Arms Warrior), 72 (Fury Warrior), 70 (Retribution Paladin), 253 (Beast Mastery Hunter), 254 (Marksmanship Hunter), 255 (Survival Hunter), 259 (Assassination Rogue), 260 (Outlaw Rogue), 261 (Subtlety Rogue), 258 (Shadow Priest), 251 (Frost Death Knight), 252 (Unholy Death Knight), 262 (Elemental Shaman), 263 (Enhancement Shaman), 62 (Arcane Mage), 63 (Fire Mage), 64 (Frost Mage), 265 (Affliction Warlock), 266 (Demonology Warlock), 267 (Destruction Warlock), 269 (Windwalker Monk), 102 (Balance Druid), 103 (Feral Druid), 577 (Havoc Demon Hunter), 1467 (Devastation Evoker), 1473 (Augmentation Evoker)

RESPONSE FORMAT:
Return a JSON object with this exact structure:
{
  "metaSummary": {
    "overallState": string, /* "Healthy", "Concerning", "Unhealthy" */
    "summary": string, /* 1-2 sentence overview of the meta */
    "keyInsights": [string] /* 2-3 simple insights */
  },
  "roleAnalysis": {
    "tank": {
      "dominantSpecs": [{"specId": number, "usage": number, "name": string}], /* Top 3 most used specs */
      "underusedSpecs": [{"specId": number, "usage": number, "name": string}],
      "healthStatus": string, /* "Good", "Concerning", "Poor" */
      "totalRuns": number /* Total number of runs for this role */
    },
    "healer": {
      "dominantSpecs": [{"specId": number, "usage": number, "name": string}], /* Top 3 most used specs */
      "underusedSpecs": [{"specId": number, "usage": number, "name": string}],
      "healthStatus": string, /* "Good", "Concerning", "Poor" */
      "totalRuns": number /* Total number of runs for this role */
    },
    "dps": {
      "dominantSpecs": [{"specId": number, "usage": number, "name": string}], /* Top 3 most used specs */
      "underusedSpecs": [{"specId": number, "usage": number, "name": string}],
      "healthStatus": string, /* "Good", "Concerning", "Poor" */
      "totalRuns": number /* Total number of runs for this role */
    }
  },
  "compositionAnalysis": {
    "mostPopularGroup": {
      "specs": [number], /* Array of 5 spec IDs in the most popular composition */
      "specNames": [string], /* Array of spec names for display */
      "usage": number, /* Percentage of total runs this composition represents */
      "avgLevel": number, /* Average keystone level for this composition */
      "count": number /* Total count of this composition */
    },
    "specReplacements": {
      "specId": {
        "specName": string, /* Name of the spec in the most popular group */
        "role": string, /* "tank", "healer", or "dps" */
        "replacements": [
          {
            "specId": number, /* ID of the replacement spec */
            "specName": string, /* Name of the replacement spec */
            "count": number, /* How many times this replacement occurred */
            "avgLevel": number, /* Average keystone level for this replacement */
            "usage": number, /* Percentage of total runs this replacement represents */
            "role": string /* Role of the replacement spec */
          }
        ]
      }
    },
    "compositionDiversity": string, /* "High", "Medium", "Low" - assessment of composition variety */
    "dominantPatterns": [string] /* 1-2 sentences about composition flexibility and meta adaptability */
  },
  "balanceIssues": [
    {
      "type": string, /* "dominance", "underuse", "role_imbalance", "composition_stagnation" */
      "description": string, /* Unique, non-redundant description */
      "severity": string /* "low", "medium", "high" */
    }
  ]
}

IMPORTANT: Ensure balance issue descriptions are unique and non-redundant. Each issue should focus on a distinct aspect of the meta.`;

    const userPrompt = `Analyze this processed Mythic+ season data for meta health and diversity:

SEASON SUMMARY:
${JSON.stringify(metaHealthData.season, null, 2)}

COMPOSITION SUMMARY (top group and replacements only):
${JSON.stringify(compositionBrief, null, 2)}

PRE-CALCULATED SPEC USAGE DATA:
${JSON.stringify(specUsageData, null, 2)}

IMPORTANT: 
1. Use exact spec names from the reference
2. Respond ONLY with valid JSON in the exact format specified
3. Start your response with { and end with }
4. Do not include any additional text or markdown formatting
5. Use the pre-calculated usage percentages from the SPEC USAGE DATA above - do NOT calculate percentages yourself`;

    // Decide token parameter key based on model family
    const isGpt5Family = (openAIModel || '').toLowerCase().includes('gpt-5');
    const maxTokensMetaHealth = 10000; // 10k

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
          timeout: 90000
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
      console.warn('⚠️ [AI] Initial AI response invalid or truncated; attempting reformat retry (meta-health)');
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

    // Validate the AI response structure
    if (!parsedResponse.metaSummary || !parsedResponse.roleAnalysis || !parsedResponse.balanceIssues) {
      return res.status(500).json({ error: 'Invalid AI response format - missing required sections' });
    }
    const mhValidation = validateMetaHealthResponse(parsedResponse);
    if (!mhValidation.ok) {
      return res.status(500).json({ error: 'AI meta_health response failed validation', details: mhValidation.errors.slice(0, 10) });
    }

    // Remove duplicate specs within each role's dominant and underused specs
    Object.keys(parsedResponse.roleAnalysis).forEach(role => {
      const roleData = parsedResponse.roleAnalysis[role];
      
      // Remove duplicates from dominantSpecs
      if (roleData.dominantSpecs && Array.isArray(roleData.dominantSpecs)) {
        const seenDominant = new Set();
        roleData.dominantSpecs = roleData.dominantSpecs.filter(spec => {
          if (seenDominant.has(spec.specId)) {
            console.log(`⚠️ [AI] Removed duplicate dominant spec ${spec.specId} from ${role}`);
            return false;
          }
          seenDominant.add(spec.specId);
          return true;
        });
      }
      
      // Remove duplicates from underusedSpecs
      if (roleData.underusedSpecs && Array.isArray(roleData.underusedSpecs)) {
        const seenUnderused = new Set();
        roleData.underusedSpecs = roleData.underusedSpecs.filter(spec => {
          if (seenUnderused.has(spec.specId)) {
            console.log(`⚠️ [AI] Removed duplicate underused spec ${spec.specId} from ${role}`);
            return false;
          }
          seenUnderused.add(spec.specId);
          return true;
        });
      }
    });

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
    console.error('Meta health analysis error:', error);
    
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
  const generateHint = analysisType === 'meta_health' ? 'POST /ai/meta-health' : 'POST /ai/predictions';
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
    console.error('[AI AFFIX INSIGHTS ERROR]', err);
    return res.status(500).json({ error: 'Failed to generate affix insights' });
  }
});

module.exports = router; 