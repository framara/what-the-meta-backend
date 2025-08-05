# AI Model Configuration Guide

## Available OpenAI Models

### 1. **gpt-4o** (Recommended for best results)
- **Cost**: ~$0.005 per 1K input tokens, ~$0.015 per 1K output tokens
- **Capabilities**: Most advanced reasoning, best for complex analysis
- **Use case**: When you need the highest quality predictions

### 2. **gpt-4o-mini** (Recommended for cost efficiency)
- **Cost**: ~$0.00015 per 1K input tokens, ~$0.0006 per 1K output tokens
- **Capabilities**: Fast, good reasoning, cost-effective
- **Use case**: Best balance of quality and cost (default)

### 3. **gpt-3.5-turbo** (Budget option)
- **Cost**: ~$0.0005 per 1K input tokens, ~$0.0015 per 1K output tokens
- **Capabilities**: Reliable, good for basic analysis
- **Use case**: When cost is the primary concern

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# OpenAI Configuration
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini  # or gpt-4o, gpt-3.5-turbo
```

### Model Selection

1. **For Testing/Development**: Use `gpt-4o-mini` (default)
2. **For Production**: Use `gpt-4o` for best results
3. **For Budget Constraints**: Use `gpt-3.5-turbo`

## Cost Estimation

For a typical analysis with 43,000 keys across 20 periods:

- **gpt-4o-mini**: ~$0.05-0.10 per analysis
- **gpt-4o**: ~$0.50-1.00 per analysis
- **gpt-3.5-turbo**: ~$0.02-0.05 per analysis

## Testing Without Credits

If you don't have OpenAI credits yet, you can:

1. **Use the fallback system**: The frontend will show statistical analysis instead
2. **Test with mock data**: The system gracefully handles API failures
3. **Set up billing**: Add payment method to OpenAI account

## Error Handling

The system will show helpful error messages for:
- Model not found
- Insufficient credits
- API key issues
- Network problems

## Recommendations

1. **Start with gpt-4o-mini** for testing
2. **Upgrade to gpt-4o** for production if budget allows
3. **Monitor costs** in OpenAI dashboard
4. **Use caching** to reduce API calls (already implemented) 