const express = require('express');
const axios = require('axios');
const db = require('../services/db');
const { WOW_SPECIALIZATIONS, WOW_CLASSES, WOW_CLASS_COLORS, WOW_SPEC_ROLES } = require('../config/constants');
const { getSpecEvolutionForSeason, getCompositionDataForSeason } = require('../services/meta-helpers');

const router = express.Router();

// POST /ai/predictions
// Send data to OpenAI for AI-powered meta predictions
router.post('/predictions', async (req, res) => {
  console.log(`🤖 [AI] POST /ai/predictions - Season: ${req.body.seasonId || 'unknown'}`);
  try {
    const { seasonId } = req.body;

    if (!seasonId) {
      return res.status(400).json({ error: 'Missing required data: seasonId' });
    }

    // Check for cached analysis first
    console.log(`📋 [AI] Checking cache for season ${seasonId}`);
    const cachedResult = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2 ORDER BY created_at DESC LIMIT 1',
      [seasonId, 'predictions']
    );

    if (cachedResult.rows.length > 0) {
      const cached = cachedResult.rows[0];
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
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
            max_age_hours: 24
          }
        };
        return res.json(responseWithCache);
      }
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
    const maxPeriodsToProcess = Math.min(seasonData.total_periods, 25); // Limit to 25 periods max
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

    // Cross-validate with official spec evolution data
    if (specEvolution && specEvolution.evolution) {
      specEvolution.evolution.forEach((periodData, periodIndex) => {
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
        const periodsWithData = specEvolution.evolution.length;
        if (periodsWithData > 0) {
          specTemporalData[specIdNum].crossValidationScore /= periodsWithData;
        }
      });
    }

    // Prepare data for OpenAI
    const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini"; // Default to gpt-4o-mini for cost efficiency
    
    const openAIPrompt = {
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
${JSON.stringify(specTemporalData, null, 2)}

SPEC EVOLUTION DATA:
${JSON.stringify(specEvolution, null, 2)}

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
      temperature: 0.3,
      max_tokens: 10000
    };

    // Call OpenAI API with retry logic for rate limits
    console.log(`🤖 [AI] Calling OpenAI API for season ${seasonId}...`);
    
    let openAIResponse;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', openAIPrompt, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 second timeout
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 429 && retryCount < maxRetries) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.log(`🤖 [AI] Rate limit hit, retrying in ${delay/1000}s (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Re-throw if not a 429 or max retries reached
        }
      }
    }

    const aiResponse = openAIResponse.data.choices[0].message.content;
    
    let parsedResponse;

    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw AI response:', aiResponse);
      
      // Try to extract JSON from the response if it contains extra text
      // First try to find JSON in markdown code blocks
      const codeBlockMatch = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        try {
          parsedResponse = JSON.parse(codeBlockMatch[1]);
        } catch (extractError) {
          console.error('Failed to extract JSON from code block:', extractError);
        }
      }
      
      // If no code block found, try to find any JSON object
      if (!parsedResponse) {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResponse = JSON.parse(jsonMatch[0]);
          } catch (extractError) {
            console.error('Failed to extract JSON:', extractError);
          }
        }
      }
      
      if (!parsedResponse) {
        return res.status(500).json({ 
          error: 'Failed to parse AI response',
          details: parseError.message,
          rawResponse: aiResponse.substring(0, 1000)
        });
      }
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

    // Cache the analysis result
    try {
      // First, delete any existing predictions analysis for this season
      await db.pool.query(
        'DELETE FROM ai_analysis WHERE season_id = $1 AND analysis_type = $2',
        [seasonId, 'predictions']
      );
      
      // Then insert the new analysis
      await db.pool.query(
        `INSERT INTO ai_analysis (season_id, analysis_data, analysis_type, confidence_score, data_quality)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          seasonId,
          JSON.stringify(analysisResult),
          'predictions',
          parsedResponse.analysis?.confidence || 75,
          parsedResponse.analysis?.dataQuality || 'Good'
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
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
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
    const maxPeriodsToProcess = Math.min(compositionData.total_periods, 25);
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
      .slice(0, 30); // Only keep top 20 compositions
    
    const limitedCompositionCounts = {};
    sortedCompositions.forEach(([key, comp]) => {
      if (comp.count > 0) {
        comp.avgLevel = Math.round(comp.avgLevel / comp.count);
      }
      limitedCompositionCounts[key] = comp;
    });
    
    metaHealthData.compositionAnalysis.compositionCounts = limitedCompositionCounts;

    // Prepare data for OpenAI analysis
    const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    
    const systemPrompt = `You are an expert World of Warcraft Mythic+ meta analyst. Your task is to provide simple, clear insights about the current meta state.

ANALYSIS REQUIREMENTS:
1. Identify the most dominant specs in each role (tank, healer, dps)
   - For tank and healer roles: identify the 3 specs with the HIGHEST usage percentages, but ONLY include specs with 5% or higher usage. If fewer than 3 specs meet the 5% threshold, include only those that do.
   - For DPS role: identify the 3 specs with the HIGHEST usage percentages (since there are 3 DPS spots in a group)
   - IMPORTANT: Sort specs by usage percentage (highest to lowest) for dominantSpecs
2. Identify any specs that are clearly underperforming or rarely used
   - For each role: identify the 3 specs with the LOWEST usage percentages
   - IMPORTANT: Sort specs by usage percentage (lowest to highest) and take the bottom 3 for underusedSpecs
3. Assess if there are any obvious balance issues:
   - For tank/healer: a single spec having more than 50% usage is concerning, 75% or more is bad for meta health  
   - For DPS: a single spec having more than 15% usage is too high (considering 26 DPS specs and only 3 spots available)
   - If the sum of the top 3 specs for a role is more than 46% of the total runs, then the meta is unbalanced
4. Provide 2-3 simple, actionable insights about the meta
5. Calculate total run counts for each role to enable percentage calculations

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
  "balanceIssues": [
    {
      "type": string, /* "dominance", "underuse", "role_imbalance" */
      "description": string, /* Unique, non-redundant description */
      "severity": string /* "low", "medium", "high" */
    }
  ]
}

IMPORTANT: Ensure balance issue descriptions are unique and non-redundant. Each issue should focus on a distinct aspect of the meta.`;

    const userPrompt = `Analyze this processed Mythic+ season data for meta health and diversity:

SEASON SUMMARY:
${JSON.stringify(metaHealthData.season, null, 2)}

ROLE ANALYSIS DATA:
${JSON.stringify(metaHealthData.roleAnalysis, null, 2)}

COMPOSITION ANALYSIS:
${JSON.stringify(metaHealthData.compositionAnalysis, null, 2)}

TEMPORAL ANALYSIS:
${JSON.stringify(metaHealthData.temporalAnalysis, null, 2)}



IMPORTANT: 
1. Use exact spec names from the reference
2. Respond ONLY with valid JSON in the exact format specified
3. Start your response with { and end with }
4. Do not include any additional text or markdown formatting`;

    const openAIPrompt = {
      model: openAIModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 12000
    };

    // Call OpenAI API with retry logic for rate limits
    console.log(`🤖 [AI] Calling OpenAI API for meta health analysis...`);
    
    let openAIResponse;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', openAIPrompt, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 429 && retryCount < maxRetries) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.log(`🤖 [AI] Rate limit hit, retrying in ${delay/1000}s (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Re-throw if not a 429 or max retries reached
        }
      }
    }

    const aiResponse = openAIResponse.data.choices[0].message.content;
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw AI response:', aiResponse);
      
      // Try to extract JSON from the response if it contains extra text
      const codeBlockMatch = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        try {
          parsedResponse = JSON.parse(codeBlockMatch[1]);
        } catch (extractError) {
          console.error('Failed to extract JSON from code block:', extractError);
        }
      }
      
      if (!parsedResponse) {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResponse = JSON.parse(jsonMatch[0]);
          } catch (extractError) {
            console.error('Failed to extract JSON:', extractError);
          }
        }
      }
      
      if (!parsedResponse) {
        return res.status(500).json({ 
          error: 'Failed to parse AI response',
          details: parseError.message,
          rawResponse: aiResponse.substring(0, 1000)
        });
      }
    }

    // Validate the AI response structure
    if (!parsedResponse.metaSummary || !parsedResponse.roleAnalysis || !parsedResponse.balanceIssues) {
      return res.status(500).json({ error: 'Invalid AI response format - missing required sections' });
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
  console.log(`🤖 [AI] GET /ai/analysis/${req.params.season_id}`);
  try {
    const season_id = Number(req.params.season_id);
    
    if (!season_id) {
      return res.status(400).json({ error: 'season_id is required' });
    }

    // Get analysis type from query parameter, default to 'predictions'
    const analysisType = req.query.type || 'predictions';
    
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
         
         // Check if cache is still valid (less than 24 hours old)
         const cacheAge = Date.now() - new Date(cached.created_at).getTime();
         const maxAge = 24 * 60 * 60 * 1000; // 24 hours
         
                   if (cacheAge < maxAge) {
            // Include cache metadata in the response
            const responseWithCache = {
              ...analysisData,
              _cache: {
                created_at: cached.created_at,
                age_hours: Math.round(cacheAge / (1000 * 60 * 60)),
                max_age_hours: 24
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

    // If no cache or expired, trigger new analysis
    // This would typically be done asynchronously, but for now we'll do it synchronously
    res.status(404).json({ error: 'No cached analysis available. Please use POST /ai/predictions to generate new analysis.' });

  } catch (error) {
    console.error('[AI ANALYSIS ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 