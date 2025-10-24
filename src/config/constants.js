// Blizzard API endpoints
const API_ENDPOINTS = {
  BATTLE_NET: {
    OAUTH_TOKEN: '/oauth/token',
    USER_INFO: '/oauth/userinfo'
  },
  // World of Warcraft Game Data
  WOW_GAME_DATA: {
    // Add WoW Token endpoint that we know works
    TOKEN: '/data/wow/token/index',
    ACHIEVEMENTS: '/data/wow/achievement/index',
    ACHIEVEMENT: '/data/wow/achievement/{id}',
    ACHIEVEMENT_CATEGORIES: '/data/wow/achievement-category/index',
    ACHIEVEMENT_CATEGORY: '/data/wow/achievement-category/{id}',
    ACHIEVEMENT_MEDIA: '/data/wow/media/achievement/{id}',
    
    CLASSES: '/data/wow/playable-class/index',
    CLASS: '/data/wow/playable-class/{id}',
    CLASS_MEDIA: '/data/wow/media/playable-class/{id}',
    
    RACES: '/data/wow/playable-race/index',
    RACE: '/data/wow/playable-race/{id}',
    
    SPECIALIZATIONS: '/data/wow/playable-specialization/index',
    SPECIALIZATION: '/data/wow/playable-specialization/{id}',
    SPECIALIZATION_MEDIA: '/data/wow/media/playable-specialization/{id}',
    
    // Item endpoints - no index exists, only specific item by ID
    ITEM: '/data/wow/item/{id}',
    ITEM_MEDIA: '/data/wow/media/item/{id}',
    ITEM_CLASSES: '/data/wow/item-class/index',
    ITEM_CLASS: '/data/wow/item-class/{id}',
    ITEM_SETS: '/data/wow/item-set/index',
    ITEM_SET: '/data/wow/item-set/{id}',
    
    REALMS: '/data/wow/realm/index',
    REALM: '/data/wow/realm/{slug}',
    
    MOUNTS: '/data/wow/mount/index',
    MOUNT: '/data/wow/mount/{id}',
    
    PETS: '/data/wow/pet/index',
    PET: '/data/wow/pet/{id}',
    PET_MEDIA: '/data/wow/media/pet/{id}',
    
    PROFESSIONS: '/data/wow/profession/index',
    PROFESSION: '/data/wow/profession/{id}',
    PROFESSION_SKILL_TIER: '/data/wow/profession/{id}/skill-tier/{skillTierId}',
    PROFESSION_RECIPE: '/data/wow/recipe/{id}',
    PROFESSION_MEDIA: '/data/wow/media/profession/{id}',
    
    TALENTS: '/data/wow/talent/index',
    TALENT: '/data/wow/talent/{id}',
    TALENT_TREES: '/data/wow/talent-tree/index',
    TALENT_TREE: '/data/wow/talent-tree/{id}',
    TALENT_TREE_NODES: '/data/wow/talent-tree/{id}/playable-specialization/{specId}',
    
    PVP_SEASONS: '/data/wow/pvp-season/index',
    PVP_SEASON: '/data/wow/pvp-season/{id}',
    PVP_LEADERBOARD: '/data/wow/pvp-season/{seasonId}/pvp-leaderboard/{bracket}',
    
    MYTHIC_RAID_LEADERBOARD: '/data/wow/mythic-raid/leaderboard/{raid}/{faction}',
    MYTHIC_DUNGEON_LEADERBOARD: '/data/wow/mythic-dungeon/leaderboard/{dungeon}/period/{period}',
    
    REPUTATIONS: '/data/wow/reputation-faction/index',
    REPUTATION_FACTION: '/data/wow/reputation-faction/{id}',
    REPUTATION_TIERS: '/data/wow/reputation-tiers/index',
    REPUTATION_TIER: '/data/wow/reputation-tiers/{id}',
    
    // Mythic Keystone Affix endpoints
    KEYSTONE_AFFIXES: '/data/wow/keystone-affix/index',
    KEYSTONE_AFFIX: '/data/wow/keystone-affix/{id}',
    KEYSTONE_AFFIX_MEDIA: '/data/wow/media/keystone-affix/{id}',
    
    // Mythic Keystone Dungeon endpoints
    MYTHIC_KEYSTONE: '/data/wow/mythic-keystone/index',
    MYTHIC_KEYSTONE_DUNGEONS: '/data/wow/mythic-keystone/dungeon/index',
    MYTHIC_KEYSTONE_DUNGEON: '/data/wow/mythic-keystone/dungeon/{id}',
    MYTHIC_KEYSTONE_PERIODS: '/data/wow/mythic-keystone/period/index',
    MYTHIC_KEYSTONE_PERIOD: '/data/wow/mythic-keystone/period/{id}',
    MYTHIC_KEYSTONE_SEASONS: '/data/wow/mythic-keystone/season/index',
    MYTHIC_KEYSTONE_SEASON: '/data/wow/mythic-keystone/season/{id}',
    
    // Mythic Keystone Leaderboard endpoints
    MYTHIC_LEADERBOARD_INDEX: '/data/wow/connected-realm/{connectedRealmId}/mythic-leaderboard/index',
    MYTHIC_LEADERBOARD: '/data/wow/connected-realm/{connectedRealmId}/mythic-leaderboard/{dungeonId}/period/{periodId}',
    
    // Playable Class endpoints
    PLAYABLE_CLASSES: '/data/wow/playable-class/index',
    PLAYABLE_CLASS: '/data/wow/playable-class/{id}',
    PLAYABLE_CLASS_MEDIA: '/data/wow/media/playable-class/{id}',
    PLAYABLE_CLASS_PVP_TALENT_SLOTS: '/data/wow/playable-class/{id}/pvp-talent-slots',
    
    // Playable Race endpoints
    PLAYABLE_RACES: '/data/wow/playable-race/index',
    PLAYABLE_RACE: '/data/wow/playable-race/{id}',
    
    // Playable Specialization endpoints
    PLAYABLE_SPECIALIZATIONS: '/data/wow/playable-specialization/index',
    PLAYABLE_SPECIALIZATION: '/data/wow/playable-specialization/{id}',
    PLAYABLE_SPECIALIZATION_MEDIA: '/data/wow/media/playable-specialization/{id}',
    
    // Realm endpoints
    REALMS: '/data/wow/realm/index',
    REALM: '/data/wow/realm/{slug}',
    REALM_SEARCH: '/data/wow/search/realm',
    
    // Region endpoints
    REGIONS: '/data/wow/region/index',
    REGION: '/data/wow/region/{id}',
    
    // Spell endpoints
    SPELL: '/data/wow/spell/{id}',
    SPELL_MEDIA: '/data/wow/media/spell/{id}',
    SPELL_SEARCH: '/data/wow/search/spell',
    
    // Talent endpoints
    TALENT_TREE_INDEX: '/data/wow/talent-tree/index',
    TALENT_TREE: '/data/wow/talent-tree/{treeId}/playable-specialization/{specId}',
    TALENT_TREE_NODES: '/data/wow/talent-tree/{treeId}',
    TALENTS_INDEX: '/data/wow/talent/index',
    TALENT: '/data/wow/talent/{id}',
    PVP_TALENTS_INDEX: '/data/wow/pvp-talent/index',
    PVP_TALENT: '/data/wow/pvp-talent/{id}',
    
    // Tech Talent endpoints
    TECH_TALENT_TREE_INDEX: '/data/wow/tech-talent-tree/index',
    TECH_TALENT_TREE: '/data/wow/tech-talent-tree/{id}',
    TECH_TALENT_INDEX: '/data/wow/tech-talent/index',
    TECH_TALENT: '/data/wow/tech-talent/{id}',
    TECH_TALENT_MEDIA: '/data/wow/media/tech-talent/{id}',
    
    // Connected Realm endpoints
    CONNECTED_REALMS_INDEX: '/data/wow/connected-realm/index',
    CONNECTED_REALM: '/data/wow/connected-realm/{id}',
    CONNECTED_REALM_SEARCH: '/data/wow/search/connected-realm',
    
    // Media Search endpoint
    MEDIA_SEARCH: '/data/wow/search/media',
    // PvP Season endpoints
    PVP_SEASONS_INDEX: '/data/wow/pvp-season/index',
    PVP_SEASON: '/data/wow/pvp-season/{seasonId}',
    PVP_LEADERBOARDS_INDEX: '/data/wow/pvp-season/{seasonId}/pvp-leaderboard/index',
    PVP_LEADERBOARD: '/data/wow/pvp-season/{seasonId}/pvp-leaderboard/{bracket}',
    PVP_REWARDS_INDEX: '/data/wow/pvp-season/{seasonId}/pvp-reward/index',
    // Reputation Factions endpoint
    REPUTATION_FACTIONS_INDEX: '/data/wow/reputation-faction/index',
    REPUTATION_FACTION: '/data/wow/reputation-faction/{id}',
    // Reputation Tiers endpoint
    REPUTATION_TIERS_INDEX: '/data/wow/reputation-tiers/index',
    REPUTATION_TIERS: '/data/wow/reputation-tiers/{id}',
    // WoW Token endpoint
    WOW_TOKEN_INDEX: '/data/wow/token/index'
  }
};

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

// Cache configuration
const CACHE_CONFIG = {
  TOKEN_CACHE_TTL: 3600000, // 1 hour in milliseconds
  API_CACHE_TTL: 300000,    // 5 minutes in milliseconds
  MAX_CACHE_SIZE: 100        // Maximum number of cached items
};

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || (process.env.NODE_ENV === 'development' ? 1000 : 100)
};

// Mythic+ season to dungeon mapping (to be filled in by automation)
const SEASON_DUNGEONS = {
  "1": [
    247,
    248,
    249,
    250,
    251,
    252,
    244,
    245,
    246,
    353
  ],
  "2": [
    247,
    248,
    249,
    250,
    251,
    252,
    244,
    245,
    246,
    353
  ],
  "3": [
    247,
    248,
    249,
    250,
    251,
    252,
    244,
    245,
    246,
    353
  ],
  "4": [
    247,
    248,
    249,
    250,
    251,
    252,
    244,
    245,
    246,
    353,
    369,
    370
  ],
  "5": [
    375,
    376,
    377,
    378,
    379,
    380,
    381,
    382
  ],
  "6": [
    375,
    376,
    377,
    378,
    379,
    380,
    381,
    382
  ],
  "7": [
    375,
    376,
    377,
    378,
    379,
    380,
    381,
    382,
    391,
    392
  ],
  "8": [
    169,
    166,
    234,
    227,
    369,
    370,
    391,
    392
  ],
  "9": [
    2,
    165,
    200,
    210,
    399,
    400,
    401,
    402
  ],
  "10": [
    206,
    251,
    245,
    403,
    404,
    405,
    406,
    438
  ],
  "11": [
    168,
    198,
    199,
    248,
    244,
    463,
    464,
    456
  ],
  "12": [
    399,
    400,
    401,
    402,
    403,
    404,
    405,
    406
  ],
  "13": [
    353,
    375,
    376,
    501,
    502,
    503,
    505,
    507
  ],
  "14": [
    247,
    370,
    382,
    499,
    500,
    504,
    506,
    525
  ],
  "15": [
    378,
    391,
    392,
    499,
    503,
    505,
    525,
    542
  ]
};

const SEASON_NAMES = {
  1: "BFA S1",
  2: "BFA S2",
  3: "BFA S3",
  4: "BFA S4",
  5: "SL S1",
  6: "SL S2",
  7: "SL S3",
  8: "SL S4",
  9: "DF S1",
  10: "DF S2",
  11: "DF S3",
  12: "DF S4",
  13: "TWW S1",
  14: "TWW S2",
  15: "TWW S3",
  16: "MN S1",
  17: "MN S2",
  18: "MN S3",
  19: "TLT S1",
  20: "TLT S2",
  21: "TLT S3",
};

// WoW Class IDs and Names (example, fill in all as needed)
const WOW_CLASSES = [
  { id: 1, name: 'Warrior' },
  { id: 2, name: 'Paladin' },
  { id: 3, name: 'Hunter' },
  { id: 4, name: 'Rogue' },
  { id: 5, name: 'Priest' },
  { id: 6, name: 'Death Knight' },
  { id: 7, name: 'Shaman' },
  { id: 8, name: 'Mage' },
  { id: 9, name: 'Warlock' },
  { id: 10, name: 'Monk' },
  { id: 11, name: 'Druid' },
  { id: 12, name: 'Demon Hunter' },
  { id: 13, name: 'Evoker' }
];

// WoW Specialization IDs and Names (example, fill in all as needed)
const WOW_SPECIALIZATIONS = [
  // Warrior
  { id: 71, name: 'Arms', classId: 1 },
  { id: 72, name: 'Fury', classId: 1 },
  { id: 73, name: 'Protection', classId: 1 },
  // Paladin
  { id: 65, name: 'Holy', classId: 2 },
  { id: 66, name: 'Protection', classId: 2 },
  { id: 70, name: 'Retribution', classId: 2 },
  // Hunter
  { id: 253, name: 'Beast Mastery', classId: 3 },
  { id: 254, name: 'Marksmanship', classId: 3 },
  { id: 255, name: 'Survival', classId: 3 },
  // Rogue
  { id: 259, name: 'Assassination', classId: 4 },
  { id: 260, name: 'Outlaw', classId: 4 },
  { id: 261, name: 'Subtlety', classId: 4 },
  // Priest
  { id: 256, name: 'Discipline', classId: 5 },
  { id: 257, name: 'Holy', classId: 5 },
  { id: 258, name: 'Shadow', classId: 5 },
  // Death Knight
  { id: 250, name: 'Blood', classId: 6 },
  { id: 251, name: 'Frost', classId: 6 },
  { id: 252, name: 'Unholy', classId: 6 },
  // Shaman
  { id: 262, name: 'Elemental', classId: 7 },
  { id: 263, name: 'Enhancement', classId: 7 },
  { id: 264, name: 'Restoration', classId: 7 },
  // Mage
  { id: 62, name: 'Arcane', classId: 8 },
  { id: 63, name: 'Fire', classId: 8 },
  { id: 64, name: 'Frost', classId: 8 },
  // Warlock
  { id: 265, name: 'Affliction', classId: 9 },
  { id: 266, name: 'Demonology', classId: 9 },
  { id: 267, name: 'Destruction', classId: 9 },
  // Monk
  { id: 268, name: 'Brewmaster', classId: 10 },
  { id: 269, name: 'Windwalker', classId: 10 },
  { id: 270, name: 'Mistweaver', classId: 10 },
  // Druid
  { id: 102, name: 'Balance', classId: 11 },
  { id: 103, name: 'Feral', classId: 11 },
  { id: 104, name: 'Guardian', classId: 11 },
  { id: 105, name: 'Restoration', classId: 11 },
  // Demon Hunter
  { id: 577, name: 'Havoc', classId: 12 },
  { id: 581, name: 'Vengeance', classId: 12 },
  // Evoker
  { id: 1467, name: 'Devastation', classId: 13 },
  { id: 1468, name: 'Preservation', classId: 13 },
  { id: 1473, name: 'Augmentation', classId: 13 }
];

// WoW Dungeon IDs and Names (auto-generated from dungeons.json)
const WOW_DUNGEONS = [
  {id: 56, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 1260000, upgrade_level: 2}, {qualifying_duration: 720000, upgrade_level: 3}], name: "Stormstout Brewery", shortname: "SB"},
  {id: 57, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 1320000, upgrade_level: 2}, {qualifying_duration: 780000, upgrade_level: 3}], name: "Gate of the Setting Sun", shortname: "GOTSS"},
  {id: 58, keystone_upgrades: [{qualifying_duration: 3600000, upgrade_level: 1}, {qualifying_duration: 2100000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Shado-Pan Monastery", shortname: "SPM"},
  {id: 59, keystone_upgrades: [{qualifying_duration: 3000000, upgrade_level: 1}, {qualifying_duration: 1800000, upgrade_level: 2}, {qualifying_duration: 1050000, upgrade_level: 3}], name: "Siege of Niuzao Temple", shortname: "SONT"},
  {id: 60, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 720000, upgrade_level: 3}], name: "Mogu'shan Palace", shortname: "MP"},
  {id: 2, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Temple of the Jade Serpent", shortname: "TOTJS"},
  {id: 76, keystone_upgrades: [{qualifying_duration: 3300000, upgrade_level: 1}, {qualifying_duration: 1980000, upgrade_level: 2}, {qualifying_duration: 1140000, upgrade_level: 3}], name: "Scholomance", shortname: "SCHOLO"},
  {id: 77, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 1320000, upgrade_level: 2}, {qualifying_duration: 780000, upgrade_level: 3}], name: "Scarlet Halls", shortname: "SH"},
  {id: 78, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 1320000, upgrade_level: 2}, {qualifying_duration: 780000, upgrade_level: 3}], name: "Scarlet Monastery", shortname: "SM"},
  {id: 168, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "The Everbloom", shortname: "EB"},
  {id: 169, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Iron Docks", shortname: "ID"},
  {id: 161, keystone_upgrades: [{qualifying_duration: 3400000, upgrade_level: 1}, {qualifying_duration: 1700000, upgrade_level: 2}, {qualifying_duration: 1020000, upgrade_level: 3}], name: "Skyreach", shortname: "SKY"},
  {id: 164, keystone_upgrades: [{qualifying_duration: 3300000, upgrade_level: 1}, {qualifying_duration: 1920000, upgrade_level: 2}, {qualifying_duration: 1140000, upgrade_level: 3}], name: "Auchindoun", shortname: "AUCH"},
  {id: 163, keystone_upgrades: [{qualifying_duration: 3600000, upgrade_level: 1}, {qualifying_duration: 2100000, upgrade_level: 2}, {qualifying_duration: 1320000, upgrade_level: 3}], name: "Bloodmaul Slag Mines", shortname: "BSM"},
  {id: 165, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Shadowmoon Burial Grounds", shortname: "SBG"},
  {id: 166, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Grimrail Depot", shortname: "GD"},
  {id: 167, keystone_upgrades: [{qualifying_duration: 5100000, upgrade_level: 1}, {qualifying_duration: 2580000, upgrade_level: 2}, {qualifying_duration: 1500000, upgrade_level: 3}], name: "Upper Blackrock Spire", shortname: "UBS"},
  {id: 200, keystone_upgrades: [{qualifying_duration: 2280000, upgrade_level: 1}, {qualifying_duration: 1824000, upgrade_level: 2}, {qualifying_duration: 1368000, upgrade_level: 3}], name: "Halls of Valor", shortname: "HOV"},
  {id: 197, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Eye of Azshara", shortname: "EOA"},
  {id: 198, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Darkheart Thicket", shortname: "DT"},
  {id: 199, keystone_upgrades: [{qualifying_duration: 2160000, upgrade_level: 1}, {qualifying_duration: 1728000, upgrade_level: 2}, {qualifying_duration: 1296000, upgrade_level: 3}], name: "Black Rook Hold", shortname: "BRH"},
  {id: 206, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Neltharion's Lair", shortname: "NL"},
  {id: 207, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Vault of the Wardens", shortname: "VOTW"},
  {id: 208, keystone_upgrades: [{qualifying_duration: 1440000, upgrade_level: 1}, {qualifying_duration: 1152000, upgrade_level: 2}, {qualifying_duration: 864000, upgrade_level: 3}], name: "Maw of Souls", shortname: "MOS"},
  {id: 209, keystone_upgrades: [{qualifying_duration: 2700000, upgrade_level: 1}, {qualifying_duration: 2160000, upgrade_level: 2}, {qualifying_duration: 1620000, upgrade_level: 3}], name: "The Arcway", shortname: "TA"},
  {id: 210, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Court of Stars", shortname: "COS"},
  {id: 234, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Return to Karazhan: Upper", shortname: "UPPER"},
  {id: 239, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Seat of the Triumvirate", shortname: "SOTT"},
  {id: 227, keystone_upgrades: [{qualifying_duration: 2520000, upgrade_level: 1}, {qualifying_duration: 2016000, upgrade_level: 2}, {qualifying_duration: 1512000, upgrade_level: 3}], name: "Return to Karazhan: Lower", shortname: "LOWER"},
  {id: 233, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Cathedral of Eternal Night", shortname: "COEN"},
  {id: 247, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "The MOTHERLODE!!", shortname: "ML"},
  {id: 248, keystone_upgrades: [{qualifying_duration: 2220000, upgrade_level: 1}, {qualifying_duration: 1776000, upgrade_level: 2}, {qualifying_duration: 1332000, upgrade_level: 3}], name: "Waycrest Manor", shortname: "WM"},
  {id: 249, keystone_upgrades: [{qualifying_duration: 2520000, upgrade_level: 1}, {qualifying_duration: 2016000, upgrade_level: 2}, {qualifying_duration: 1512000, upgrade_level: 3}], name: "Kings' Rest", shortname: "KR"},
  {id: 250, keystone_upgrades: [{qualifying_duration: 2160000, upgrade_level: 1}, {qualifying_duration: 1728000, upgrade_level: 2}, {qualifying_duration: 1296000, upgrade_level: 3}], name: "Temple of Sethraliss", shortname: "TOS"},
  {id: 251, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "The Underrot", shortname: "UNDER"},
  {id: 252, keystone_upgrades: [{qualifying_duration: 2520000, upgrade_level: 1}, {qualifying_duration: 2016000, upgrade_level: 2}, {qualifying_duration: 1512000, upgrade_level: 3}], name: "Shrine of the Storm", shortname: "SOTS"},
  {id: 244, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Atal'Dazar", shortname: "AD"},
  {id: 245, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Freehold", shortname: "FH"},
  {id: 246, keystone_upgrades: [{qualifying_duration: 2160000, upgrade_level: 1}, {qualifying_duration: 1728000, upgrade_level: 2}, {qualifying_duration: 1296000, upgrade_level: 3}], name: "Tol Dagor", shortname: "TD"},
  {id: 353, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Siege of Boralus", shortname: "SOB"},
  {id: 369, keystone_upgrades: [{qualifying_duration: 2280000, upgrade_level: 1}, {qualifying_duration: 1824000, upgrade_level: 2}, {qualifying_duration: 1368000, upgrade_level: 3}], name: "Operation: Mechagon - Junkyard", shortname: "JUNK"},
  {id: 370, keystone_upgrades: [{qualifying_duration: 1920000, upgrade_level: 1}, {qualifying_duration: 1536000, upgrade_level: 2}, {qualifying_duration: 1118000, upgrade_level: 3}], name: "Operation: Mechagon - Workshop", shortname: "WORK"},
  {id: 375, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Mists of Tirna Scithe", shortname: "MOTS"},
  {id: 376, keystone_upgrades: [{qualifying_duration: 1860000, upgrade_level: 1}, {qualifying_duration: 1488000, upgrade_level: 2}, {qualifying_duration: 1116000, upgrade_level: 3}], name: "The Necrotic Wake", shortname: "NW"},
  {id: 377, keystone_upgrades: [{qualifying_duration: 2580000, upgrade_level: 1}, {qualifying_duration: 2064000, upgrade_level: 2}, {qualifying_duration: 1548000, upgrade_level: 3}], name: "De Other Side", shortname: "DOS"},
  {id: 378, keystone_upgrades: [{qualifying_duration: 1920000, upgrade_level: 1}, {qualifying_duration: 1536000, upgrade_level: 2}, {qualifying_duration: 1152000, upgrade_level: 3}], name: "Halls of Atonement", shortname: "HOA"},
  {id: 379, keystone_upgrades: [{qualifying_duration: 2280000, upgrade_level: 1}, {qualifying_duration: 1824000, upgrade_level: 2}, {qualifying_duration: 1368000, upgrade_level: 3}], name: "Plaguefall", shortname: "PF"},
  {id: 380, keystone_upgrades: [{qualifying_duration: 2460000, upgrade_level: 1}, {qualifying_duration: 1968000, upgrade_level: 2}, {qualifying_duration: 1476000, upgrade_level: 3}], name: "Sanguine Depths", shortname: "SD"},
  {id: 381, keystone_upgrades: [{qualifying_duration: 2340000, upgrade_level: 1}, {qualifying_duration: 1872000, upgrade_level: 2}, {qualifying_duration: 1404000, upgrade_level: 3}], name: "Spires of Ascension", shortname: "SOA"},
  {id: 382, keystone_upgrades: [{qualifying_duration: 2040000, upgrade_level: 1}, {qualifying_duration: 1632000, upgrade_level: 2}, {qualifying_duration: 1224000, upgrade_level: 3}], name: "Theater of Pain", shortname: "TOP"},
  {id: 399, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Ruby Life Pools", shortname: "RLP"},
  {id: 400, keystone_upgrades: [{qualifying_duration: 2400000, upgrade_level: 1}, {qualifying_duration: 1920000, upgrade_level: 2}, {qualifying_duration: 1440000, upgrade_level: 3}], name: "The Nokhud Offensive", shortname: "NO"},
  {id: 401, keystone_upgrades: [{qualifying_duration: 2250000, upgrade_level: 1}, {qualifying_duration: 1800000, upgrade_level: 2}, {qualifying_duration: 1350000, upgrade_level: 3}], name: "The Azure Vault", shortname: "AV"},
  {id: 402, keystone_upgrades: [{qualifying_duration: 1920000, upgrade_level: 1}, {qualifying_duration: 1536000, upgrade_level: 2}, {qualifying_duration: 1152000, upgrade_level: 3}], name: "Algeth'ar Academy", shortname: "AA"},
  {id: 403, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Uldaman: Legacy of Tyr", shortname: "ULD"},
  {id: 404, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Neltharus", shortname: "NELT"},
  {id: 405, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Brackenhide Hollow", shortname: "BH"},
  {id: 406, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "Halls of Infusion", shortname: "HOI"},
  {id: 438, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "The Vortex Pinnacle", shortname: "VP"},
  {id: 463, keystone_upgrades: [{qualifying_duration: 2040000, upgrade_level: 1}, {qualifying_duration: 1632000, upgrade_level: 2}, {qualifying_duration: 1224000, upgrade_level: 3}], name: "Dawn of the Infinite: Galakrond's Fall", shortname: "FALL"},
  {id: 464, keystone_upgrades: [{qualifying_duration: 2160000, upgrade_level: 1}, {qualifying_duration: 1728000, upgrade_level: 2}, {qualifying_duration: 1296000, upgrade_level: 3}], name: "Dawn of the Infinite: Murozond's Rise", shortname: "RISE"},
  {id: 391, keystone_upgrades: [{qualifying_duration: 2340000, upgrade_level: 1}, {qualifying_duration: 1872000, upgrade_level: 2}, {qualifying_duration: 1404000, upgrade_level: 3}], name: "Tazavesh: Streets of Wonder", shortname: "STREET"},
  {id: 392, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Tazavesh: So'leah's Gambit", shortname: "GAMBIT"},
  {id: 456, keystone_upgrades: [{qualifying_duration: 2040000, upgrade_level: 1}, {qualifying_duration: 1632000, upgrade_level: 2}, {qualifying_duration: 1224000, upgrade_level: 3}], name: "Throne of the Tides", shortname: "TotT"},
  {id: 499, keystone_upgrades: [{qualifying_duration: 1950000, upgrade_level: 1}, {qualifying_duration: 1560000, upgrade_level: 2}, {qualifying_duration: 1170000, upgrade_level: 3}], name: "Priory of the Sacred Flame", shortname: "PotSF"},
  {id: 500, keystone_upgrades: [{qualifying_duration: 1740000, upgrade_level: 1}, {qualifying_duration: 1392000, upgrade_level: 2}, {qualifying_duration: 1044000, upgrade_level: 3}], name: "The Rookery", shortname: "ROOK"},
  {id: 501, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "The Stonevault", shortname: "SV"},
  {id: 502, keystone_upgrades: [{qualifying_duration: 2100000, upgrade_level: 1}, {qualifying_duration: 1680000, upgrade_level: 2}, {qualifying_duration: 1260000, upgrade_level: 3}], name: "City of Threads", shortname: "CoT"},
  {id: 503, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "Ara-Kara, City of Echoes", shortname: "ARAK"},
  {id: 504, keystone_upgrades: [{qualifying_duration: 1860000, upgrade_level: 1}, {qualifying_duration: 1488000, upgrade_level: 2}, {qualifying_duration: 1116000, upgrade_level: 3}], name: "Darkflame Cleft", shortname: "DFC"},
  {id: 505, keystone_upgrades: [{qualifying_duration: 1860000, upgrade_level: 1}, {qualifying_duration: 1488000, upgrade_level: 2}, {qualifying_duration: 1116000, upgrade_level: 3}], name: "The Dawnbreaker", shortname: "DAWN"},
  {id: 506, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Cinderbrew Meadery", shortname: "CM"},
  {id: 507, keystone_upgrades: [{qualifying_duration: 2040000, upgrade_level: 1}, {qualifying_duration: 1632000, upgrade_level: 2}, {qualifying_duration: 1224000, upgrade_level: 3}], name: "Grim Batol", shortname: "GB"},
  {id: 525, keystone_upgrades: [{qualifying_duration: 1980000, upgrade_level: 1}, {qualifying_duration: 1584000, upgrade_level: 2}, {qualifying_duration: 1188000, upgrade_level: 3}], name: "Operation: Floodgate", shortname: "FLOOD"},
  {id: 541, keystone_upgrades: [{qualifying_duration: 1800000, upgrade_level: 1}, {qualifying_duration: 1440000, upgrade_level: 2}, {qualifying_duration: 1080000, upgrade_level: 3}], name: "The Stonecore", shortname: "SC"},
  {id: 542, keystone_upgrades: [{qualifying_duration: 1860000, upgrade_level: 1}, {qualifying_duration: 1488000, upgrade_level: 2}, {qualifying_duration: 1116000, upgrade_level: 3}], name: "Eco-Dome Al'dani", shortname: "ECO"}
];

// WoW Race IDs and Names (auto-generated from races.json)
const WOW_RACES = [
  { id: 1, name: "Human" },
  { id: 8, name: "Troll" },
  { id: 11, name: "Draenei" },
  { id: 10, name: "Blood Elf" },
  { id: 4, name: "Night Elf" },
  { id: 3, name: "Dwarf" },
  { id: 25, name: "Pandaren" },
  { id: 6, name: "Tauren" },
  { id: 5, name: "Undead" },
  { id: 2, name: "Orc" },
  { id: 7, name: "Gnome" },
  { id: 31, name: "Zandalari Troll" },
  { id: 9, name: "Goblin" },
  { id: 32, name: "Kul Tiran" },
  { id: 30, name: "Lightforged Draenei" },
  { id: 28, name: "Highmountain Tauren" },
  { id: 27, name: "Nightborne" },
  { id: 22, name: "Worgen" },
  { id: 34, name: "Dark Iron Dwarf" },
  { id: 35, name: "Vulpera" },
  { id: 36, name: "Mag'har Orc" },
  { id: 24, name: "Pandaren" },
  { id: 26, name: "Pandaren" },
  { id: 29, name: "Void Elf" },
  { id: 37, name: "Mechagnome" },
  { id: 52, name: "Dracthyr" },
  { id: 70, name: "Dracthyr" },
  { id: 85, name: "Earthen" },
  { id: 84, name: "Earthen" }
];

const WOW_REGIONS = [
  { id: 1, name: "North America", tag: "US" },
  { id: 2, name: "Korea", tag: "KR" },
  { id: 3, name: "Taiwan", tag: "TW" },
  { id: 4, name: "Europe", tag: "EU" },
  { id: 5, name: "China", tag: "CN" }
];

// Official WoW class colors (hex)
const WOW_CLASS_COLORS = {
  1: '#C79C6E', // Warrior
  2: '#F58CBA', // Paladin
  3: '#ABD473', // Hunter
  4: '#FFF569', // Rogue
  5: '#FFFFFF', // Priest
  6: '#C41F3B', // Death Knight
  7: '#0070DE', // Shaman
  8: '#69CCF0', // Mage
  9: '#9482C9', // Warlock
  10: '#00FF96', // Monk
  11: '#FF7D0A', // Druid
  12: '#A330C9', // Demon Hunter
  13: '#33937F' // Evoker
};

// Spec roles (by spec id)
const WOW_SPEC_ROLES = {
  // Warrior
  71: 'dps', 72: 'dps', 73: 'tank',
  // Paladin
  65: 'healer', 66: 'tank', 70: 'dps',
  // Hunter
  253: 'dps', 254: 'dps', 255: 'dps',
  // Rogue
  259: 'dps', 260: 'dps', 261: 'dps',
  // Priest
  256: 'healer', 257: 'healer', 258: 'dps',
  // Death Knight
  250: 'tank', 251: 'dps', 252: 'dps',
  // Shaman
  262: 'dps', 263: 'dps', 264: 'healer',
  // Mage
  62: 'dps', 63: 'dps', 64: 'dps',
  // Warlock
  265: 'dps', 266: 'dps', 267: 'dps',
  // Monk
  268: 'tank', 269: 'dps', 270: 'healer',
  // Druid
  102: 'dps', 103: 'dps', 104: 'tank', 105: 'healer',
  // Demon Hunter
  577: 'dps', 581: 'tank',
  // Evoker
  1467: 'dps', 1468: 'healer', 1473: 'dps'
};

// Expansion/season metadata
const SEASON_METADATA = {
  1: { expansion: 'Battle for Azeroth', patch: '8.0', name: 'BFA S1' },
  2: { expansion: 'Battle for Azeroth', patch: '8.1', name: 'BFA S2' },
  3: { expansion: 'Battle for Azeroth', patch: '8.2', name: 'BFA S3' },
  4: { expansion: 'Battle for Azeroth', patch: '8.3', name: 'BFA S4' },
  5: { expansion: 'Shadowlands', patch: '9.0', name: 'SL S1' },
  6: { expansion: 'Shadowlands', patch: '9.1', name: 'SL S2' },
  7: { expansion: 'Shadowlands', patch: '9.2', name: 'SL S3' },
  8: { expansion: 'Shadowlands', patch: '9.2.5', name: 'SL S4' },
  9: { expansion: 'Dragonflight', patch: '10.0', name: 'DF S1' },
  10: { expansion: 'Dragonflight', patch: '10.1', name: 'DF S2' },
  11: { expansion: 'Dragonflight', patch: '10.2', name: 'DF S3' },
  12: { expansion: 'Dragonflight', patch: '10.2.6', name: 'DF S4' },
  13: { expansion: 'The War Within', patch: '11.0', name: 'TWW S1' },
  14: { expansion: 'The War Within', patch: '11.1', name: 'TWW S2' },
  15: { expansion: 'The War Within', patch: '11.2', name: 'TWW S3' },
  16: { expansion: 'Midnight', patch: '12.0', name: 'MN S1' },
  17: { expansion: 'Midnight', patch: '12.1', name: 'MN S2' },
  18: { expansion: 'Midnight', patch: '12.2', name: 'MN S3' },
  19: { expansion: 'The Last Titan', patch: '13.0', name: 'TLT S1' },
  20: { expansion: 'The Last Titan', patch: '13.1', name: 'TLT S2' },
  21: { expansion: 'The Last Titan', patch: '13.2', name: 'TLT S3' },
};

const EXPANSION_METADATA = {
  0: { name: 'World of Warcraft', shortName: 'WoW', seasons: [] },
  1: { name: 'The Burning Crusade', shortName: 'TBC', seasons: [] },
  2: { name: 'Wrath of the Lich King', shortName: 'WOTLK', seasons: [] },
  3: { name: 'Cataclysm', shortName: 'Cata', seasons: [] },
  4: { name: 'Mists of Pandaria', shortName: 'MoP', seasons: [] },
  5: { name: 'Warlords of Draenor', shortName: 'WoD', seasons: [] },
  6: { name: 'Legion', shortName: 'Legion', seasons: [] },
  7: { name: 'Battle for Azeroth', shortName: 'BfA', seasons: [1, 2, 3, 4] },
  8: { name: 'Shadowlands', shortName: 'SL', seasons: [5, 6, 7, 8] },
  9: { name: 'Dragonflight', shortName: 'DF', seasons: [9, 10, 11, 12] },
  10: { name: 'The War Within', shortName: 'TWW', seasons: [13, 14, 15] },
  11: { name: 'Midnight', shortName: 'MN', seasons: [16, 17, 18] },
  12: { name: 'The Last Titan', shortName: 'TLT', seasons: [19, 20, 21] },
};

module.exports = {
  API_ENDPOINTS,
  HTTP_STATUS,
  CACHE_CONFIG,
  RATE_LIMIT_CONFIG,
  SEASON_DUNGEONS,
  SEASON_NAMES,
  WOW_CLASSES,
  WOW_SPECIALIZATIONS,
  WOW_DUNGEONS,
  WOW_RACES,
  WOW_CLASS_COLORS,
  WOW_SPEC_ROLES,
  SEASON_METADATA,
  EXPANSION_METADATA,
  RAIDERIO_EXPANSION_IDS: {
    LEGION: 6,
    BFA: 7,
    SHADOWLANDS: 8,
    DRAGONFLIGHT: 9,
    THE_WAR_WITHIN: 10,
  }
}; 