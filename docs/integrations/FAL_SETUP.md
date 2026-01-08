# FAL.ai Setup Guide

This guide explains how to set up and use FAL.ai models in Prism.

## Overview

FAL.ai is a serverless inference platform that provides access to various AI models including:
- **Seedream v4 Edit** by ByteDance (image-to-image editing)
- And more models can be added easily

## Getting Your FAL API Key

1. Go to [https://fal.ai/](https://fal.ai/)
2. Sign up or log in to your account
3. Navigate to your [API Keys page](https://fal.ai/dashboard/keys)
4. Click "Create new key" or copy an existing key
5. Give it a descriptive name (e.g., "Prism Development")
6. Copy the API key (it starts with something like `fal_...`)

## Adding the API Key to Prism

1. Open your `.env.local` file in the project root
2. Add or update the `FAL_API_KEY` variable:

```env
FAL_API_KEY=your_fal_api_key_here
```

3. Save the file
4. Restart your development server:

```bash
npm run dev
```

## Using Seedream v4 Edit

### Model Overview

**Seedream v4 Edit** is an advanced image-to-image editing model that:
- Transforms existing images based on text prompts
- **Requires a reference image as input** (you cannot use it without uploading or selecting an image first)
- Supports multiple aspect ratios (1:1, 16:9, 9:16, 4:3, 3:4)
- Can generate up to 4 variations per request
- Supports up to 4K resolution

### How to Use Seedream in Prism

1. **Create or open a project** in Prism
2. **Select an image session** (not video)
3. **Select Seedream v4 Edit** from the Model Picker
4. **Important**: Upload or select a reference image:
   - Click the **image icon** (Style button) in the prompt box
   - Choose "Upload" to upload from your computer
   - Or choose "Browse" to select from previously generated images
5. Enter your text prompt describing how you want to transform the image
6. Select your desired aspect ratio
7. Click "Generate"

### Example Use Cases

- **Style Transfer**: "Transform this photo into a watercolor painting"
- **Scene Changes**: "Change the time of day to sunset"
- **Object Replacement**: "Replace the car with a spaceship"
- **Artistic Effects**: "Add cyberpunk neon lighting to this cityscape"
- **Mood Adjustments**: "Make this scene look more dramatic and moody"

## Supported Parameters

When Seedream is selected, Prism automatically shows the appropriate parameters:

- **Aspect Ratio**: Choose from 1:1, 16:9, 9:16, 4:3, 3:4
- **Number of Outputs**: Generate 1 or 4 variations (default: 4 for images)
- **Reference Image**: Required - must upload or select an existing image

## API Details

### Endpoint
- Model: `fal-ai/bytedance/seedream/v4/edit`
- Documentation: [https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit](https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit)

### How It Works

1. **Submit Request**: Your prompt and reference image are sent to FAL's queue system
2. **Processing**: FAL processes the generation (typically takes 5-60 seconds)
3. **Polling**: Prism automatically polls for results every 5 seconds
4. **Results**: Once complete, images are displayed in the gallery

### Pricing

FAL.ai has a pay-per-use pricing model. Check their [pricing page](https://fal.ai/pricing) for current rates.

## Troubleshooting

### "FAL_API_KEY is not configured" Error

**Solution**: Make sure you've added your FAL API key to `.env.local` and restarted the dev server.

### "Seedream requires at least one reference image" Error

**Solution**: This model requires an input image. You must:
1. Click the image icon in the prompt box
2. Either upload an image or select one from previously generated images
3. Then submit your generation request

### Generation Taking Too Long

**Solution**: FAL.ai models can take 30-60 seconds depending on:
- Queue wait time
- Image complexity
- Number of outputs requested

Prism will automatically poll for up to 5 minutes before timing out.

### No Images Returned

**Possible causes**:
- Invalid reference image format
- Prompt too short or unclear
- FAL API issue

**Solution**: Try with a different image or more detailed prompt.

## Adding More FAL Models

To add more FAL.ai models to Prism:

1. Open `lib/models/adapters/fal.ts`
2. Create a new model configuration (similar to `SEEDREAM_V4_CONFIG`)
3. Update the adapter to handle the new model's specific parameters
4. Register the model in `lib/models/registry.ts`
5. The model will automatically appear in the Model Picker!

## Support

- **FAL.ai Documentation**: [https://fal.ai/docs](https://fal.ai/docs)
- **FAL.ai Discord**: Join their community for support
- **Prism Issues**: Report bugs in the GitHub repository

