const express = require('express');
const axios = require('axios');
const db = require('../services/db');
const { WOW_SPECIALIZATIONS, WOW_CLASSES, WOW_CLASS_COLORS, WOW_SPEC_ROLES } = require('../config/constants');

const router = express.Router();

// Helper function to get spec evolution data
async function getSpecEvolutionForSeason(season_id) {
  try {
    const periodsResult = await db.pool.query(
      'SELECT id, name FROM period WHERE season_id = $1 ORDER BY id',
      [season_id]
    );
    const periods = periodsResult.rows;

    if (periods.length === 0) {
      return null;
    }

    const evolution = [];
    for (const period of periods) {
      const specCountsResult = await db.pool.query(
        'SELECT spec_id, COUNT(*) as count FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2 GROUP BY spec_id',
        [season_id, period.id]
      );

      const spec_counts = {};
      specCountsResult.rows.forEach(row => {
        spec_counts[row.spec_id] = parseInt(row.count);
      });

      evolution.push({
        period_id: period.id,
        period_name: period.name,
        spec_counts
      });
    }

    // Check if any periods have data
    const hasData = evolution.some(period => Object.keys(period.spec_counts).length > 0);
    if (!hasData) {
      return null;
    }

    return {
      season_id,
      evolution
    };
  } catch (err) {
    console.error('[SPEC EVOLUTION ERROR]', err);
    throw err;
  }
}

// POST /ai/predictions
// Send data to OpenAI for AI-powered meta predictions
router.post('/predictions', async (req, res) => {
  try {
    const { seasonData, specEvolution, dungeons, seasonId } = req.body;

    if (!seasonData || !specEvolution) {
      return res.status(400).json({ error: 'Missing required data for AI analysis' });
    }

    // Prepare data for AI analysis
    const analysisData = {
      season: {
        id: seasonId,
        totalPeriods: seasonData.total_periods,
        totalKeys: seasonData.total_keys,
        dungeons: dungeons.map(d => ({ id: d.dungeon_id, name: d.dungeon_name }))
      },
      specData: {},
      temporalAnalysis: {},
      metaContext: {
        currentPatch: "10.2.5", // You might want to make this dynamic
        seasonType: "Mythic+",
        analysisScope: "Meta trend prediction and spec viability forecasting"
      }
    };

    // Process spec data for AI - optimized for large datasets
    const specTemporalData = {};
    
    // Limit processing to avoid memory issues with very large datasets
    const maxPeriodsToProcess = Math.min(seasonData.total_periods, 25); // Limit to 20 periods max
    const periodsToProcess = seasonData.periods.slice(-maxPeriodsToProcess); // Use the last 20 periods
    
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
9. Identify if some specs perform better in some dungeons than others
10. Consider role balance (tank, healer, dps) in your analysis
11. Note any role-specific trends (e.g., tank meta shifts, healer viability changes)

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
- Dungeons: ${dungeons.map(d => d.dungeon_name).join(', ')}

SPEC TEMPORAL DATA:
${JSON.stringify(specTemporalData, null, 2)}

SPEC EVOLUTION DATA:
${JSON.stringify(specEvolution, null, 2)}

SPEC NAMES REFERENCE:
Use these exact spec names in your predictions:
${Object.keys(specTemporalData).map(specId => {
  const spec = WOW_SPECIALIZATIONS.find(s => s.id === parseInt(specId));
  const classInfo = WOW_CLASSES.find(c => c.id === spec?.classId);
  const role = WOW_SPEC_ROLES[parseInt(specId)] || 'unknown';
  return `- specId ${specId}: ${spec?.name || 'Unknown'} (${classInfo?.name || 'Unknown'}) - Role: ${role}`;
}).join('\n')}

IMPORTANT: 
1. Use the exact spec names from the reference above (e.g., "Vengeance", "Discipline", "Unholy")
2. Use the exact class names from the reference above (e.g., "Demon Hunter", "Priest", "Death Knight")
3. Make sure you do not repeat the same spec in the top 5 rising and declining lists
4. Do NOT include classColor in your response - we will handle colors on the backend
5. Respond ONLY with valid JSON in the exact format specified. Do not include any additional text, explanations, or markdown formatting. Start your response with { and end with }.`
          }
      ],
      temperature: 0.3,
      max_tokens: 4000
    };

    // Call OpenAI API
    
    const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', openAIPrompt, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });

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

    // Process predictions to ensure they have all required fields
    const processedPredictions = parsedResponse.predictions.map(pred => {
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
      // First, delete any existing analysis for this season
      await db.pool.query(
        'DELETE FROM ai_analysis WHERE season_id = $1',
        [seasonId]
      );
      
      // Then insert the new analysis
      await db.pool.query(
        `INSERT INTO ai_analysis (season_id, analysis_data, confidence_score, data_quality)
         VALUES ($1, $2, $3, $4)`,
        [
          seasonId,
          JSON.stringify(analysisResult),
          parsedResponse.analysis?.confidence || 75,
          parsedResponse.analysis?.dataQuality || 'Good'
        ]
      );
    } catch (cacheError) {
      console.error('❌ Failed to cache AI analysis:', cacheError);
      // Don't fail the request if caching fails
    }

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

// GET /ai/analysis/:season_id
// Get cached AI analysis for a season
router.get('/analysis/:season_id', async (req, res) => {
  try {
    const season_id = Number(req.params.season_id);
    
    if (!season_id) {
      return res.status(400).json({ error: 'season_id is required' });
    }

    // Check if we have cached analysis
    const cachedResult = await db.pool.query(
      'SELECT analysis_data, created_at FROM ai_analysis WHERE season_id = $1',
      [season_id]
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
            'DELETE FROM ai_analysis WHERE season_id = $1',
            [season_id]
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