const axios = require('axios');

/**
 * Lightweight Raider.IO API client
 * Docs: https://raider.io/api#/
 */
class RaiderIOClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://raider.io';
    this.apiKey = options.apiKey || process.env.RAIDERIO_API_KEY || '';
    this.defaultTimeout = Number(options.timeout || process.env.RAIDERIO_TIMEOUT_MS || 10000); // 10s
    // Simple global rate limiter: max requests per second (approx)
    this.maxRps = Number(options.maxRps || process.env.RAIDERIO_MAX_RPS || 10); // default 10 rps (<= 600 rpm)
    this.minIntervalMs = this.maxRps > 0 ? Math.ceil(1000 / this.maxRps) : 0;
    this._nextAvailableAtMs = 0;
    this.retryMax = Number(options.retryMax || process.env.RAIDERIO_RETRY_MAX || 2);
    this.retryBaseDelayMs = Number(options.retryBaseDelayMs || process.env.RAIDERIO_RETRY_BASE_DELAY_MS || 500);
  }

  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'wow-api-proxy/raider-io-client',
    };
    // Raider.IO commonly accepts X-Api-Key; keep api_key as query fallback in request
    if (this.apiKey) headers['X-Api-Key'] = this.apiKey;
    return headers;
  }
  /**
   * Static data for Mythic+ (dungeons, seasons, slugs) for a given expansion
   * @param {object} args
   * @param {number} args.expansion_id - 10=TWW, 9=DF, 8=SL, 7=BFA, 6=Legion
   */
  async getStaticData({ expansion_id }) {
    const params = {};
    if (expansion_id != null) params.expansion_id = expansion_id;
    return this.request('/api/v1/mythic-plus/static-data', { params });
  }

  async _throttle() {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const waitMs = Math.max(0, this._nextAvailableAtMs - now);
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const base = Math.max(now, this._nextAvailableAtMs);
    this._nextAvailableAtMs = base + this.minIntervalMs;
  }

  async request(path, { method = 'GET', params = {}, data = undefined, timeout } = {}) {
    const url = `${this.baseUrl}${path}`;
    const config = {
      method,
      url,
      timeout: timeout || this.defaultTimeout,
      headers: this.buildHeaders(),
      params: {
        ...(this.apiKey ? { access_key: this.apiKey } : {}),
        ...params,
      },
      data,
      validateStatus: (status) => status >= 200 && status < 500,
    };

    let attempt = 0;
    // retry policy for 429/5xx with simple backoff
    while (true) {
      await this._throttle();
      const response = await axios(config);
      if (response.status < 400) return response.data;
      const status = response.status;
      const retryable = status === 429 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt >= this.retryMax) {
        const msg = response.data?.message || response.statusText || 'Raider.IO API error';
        const err = new Error(`Raider.IO ${status}: ${msg}`);
        err.response = response;
        throw err;
      }
      attempt += 1;
      const retryAfterHeader = response.headers?.['retry-after'];
      let delayMs = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
      if (retryAfterHeader) {
        const parsed = Number(retryAfterHeader);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          delayMs = Math.max(delayMs, parsed * 1000);
        }
      }
      // jitter +/- 25%
      const jitter = delayMs * 0.25;
      const sleep = delayMs + (Math.random() * 2 - 1) * jitter;
      await new Promise((r) => setTimeout(r, Math.max(100, Math.floor(sleep))));
    }
  }

  /**
   * Fetch Mythic+ season cutoffs (contains top 0.1% rating thresholds)
   * @param {object} args
   * @param {string} args.season - e.g. 'season-tww-2'
   * @param {string} [args.region] - 'us' | 'eu' | 'kr' | 'tw' (optional)
   */
  async getSeasonCutoffs({ season, region } = {}) {
    const params = {};
    if (season) params.season = season;
    if (region) params.region = region;
    return this.request('/api/v1/mythic-plus/season-cutoffs', { params });
  }

  /**
   * Fetch Mythic+ character rankings for a season/region.
   * Note: Depending on Raider.IO API, this may be paginated; caller should loop until cutoff satisfied.
   * Common filters supported by Raider.IO include: class, spec, role, page, limit, realm, faction.
   * We pass through given params.
   * @param {object} params - query params (season, region, page, etc.)
   */
  async getCharacterRankings(params) {
    if (!params?.season) throw new Error('season is required');
    if (!params?.region) throw new Error('region is required');
    // Map common aliases
    const mapped = { ...params };
    if (mapped.limit && !mapped.page_size) {
      mapped.page_size = mapped.limit;
      delete mapped.limit;
    }
    // Prefer descending score/rank if API supports sort params
    if (!mapped.sort) mapped.sort = 'score';
    if (!mapped.order) mapped.order = 'desc';
    return this.request('/api/v1/mythic-plus/character-rankings', { params: mapped });
  }

  /**
   * Fetch top Mythic+ runs that match criteria.
   * Common params: season, region, page, limit, role, class, spec, dungeon, affixes, min_level, max_level
   */
  async getTopRuns(params) {
    if (!params?.season) throw new Error('season is required');
    if (!params?.region) throw new Error('region is required');
    return this.request('/api/v1/mythic-plus/runs', { params });
  }

  /**
   * Fetch character profile with optional fields (e.g., mythic_plus_scores_by_season:current)
   */
  async getCharacterProfile({ region, realm, name, fields }) {
    if (!region) throw new Error('region is required');
    if (!realm) throw new Error('realm is required');
    if (!name) throw new Error('name is required');
    const params = { region, realm, name };
    if (fields) params.fields = fields;
    return this.request('/api/v1/characters/profile', { params });
  }
}

module.exports = new RaiderIOClient();


