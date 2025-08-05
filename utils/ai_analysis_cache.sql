-- AI Analysis Cache Table
-- This table stores cached AI analysis results to avoid repeated API calls

CREATE TABLE IF NOT EXISTS ai_analysis (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    analysis_type VARCHAR(50) DEFAULT 'meta_predictions',
    confidence_score DECIMAL(5,2),
    data_quality VARCHAR(20) DEFAULT 'good'
);

-- Index for fast lookups by season_id
CREATE INDEX IF NOT EXISTS idx_ai_analysis_season_id ON ai_analysis(season_id);

-- Index for finding the most recent analysis for each season
CREATE INDEX IF NOT EXISTS idx_ai_analysis_season_created ON ai_analysis(season_id, created_at DESC);

-- Add a unique constraint to ensure only one analysis per season at a time
-- We'll handle this in the application logic instead of a complex index
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_analysis_season_latest ON ai_analysis(season_id, created_at DESC);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update the updated_at column
CREATE TRIGGER trigger_update_ai_analysis_updated_at
    BEFORE UPDATE ON ai_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_analysis_updated_at();

-- Add comments for documentation
COMMENT ON TABLE ai_analysis IS 'Cache table for AI analysis results to avoid repeated OpenAI API calls';
COMMENT ON COLUMN ai_analysis.season_id IS 'The season ID this analysis is for';
COMMENT ON COLUMN ai_analysis.analysis_data IS 'JSON data containing the AI analysis results';
COMMENT ON COLUMN ai_analysis.analysis_type IS 'Type of analysis performed (e.g., meta_predictions)';
COMMENT ON COLUMN ai_analysis.confidence_score IS 'Overall confidence score for this analysis (0-100)';
COMMENT ON COLUMN ai_analysis.data_quality IS 'Quality assessment of the data used for analysis'; 